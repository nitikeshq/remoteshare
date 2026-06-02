use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream, UdpSocket},
    time::timeout,
};

use crate::{
    crypto,
    input,
    runtime::{
        pairing_code, pairing_dh_keypair, pairing_nonce, ConfirmPairingRequest,
        DeviceEndpointUpdateRequest, DeviceTrustRequest, InputEvent, InputEventKind,
        NetworkAction, PairRequest, PairingPeer, RuntimeStore, SendInputRequest,
        TrustedReconnectTarget, TrustedTarget,
    },
};

const DISCOVERY_PORT: u16 = 44778;
const BROADCAST_ADDR: &str = "255.255.255.255:44778";
const PROTOCOL_VERSION: u16 = 1;
const BEACON_INTERVAL: Duration = Duration::from_secs(5);
const BEACON_TARGET_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const RECONNECT_INTERVAL: Duration = Duration::from_secs(8);
const RECONNECT_MAX_BACKOFF: Duration = Duration::from_secs(60);
const RECONNECT_WAKE_RESET_GRACE: Duration = Duration::from_secs(5);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
const AUTH_REPLAY_WINDOW: Duration = Duration::from_secs(120);
const MAX_CONTROL_MESSAGE_SIZE: usize = 64 * 1024;
const BUFFER_SIZE: usize = 2048;
const TRUSTED_ENDPOINT_RECOVERY_HINT: &str =
    " Copy the current endpoint from the other computer, use Set IP, then Verify IP.";

pub fn start_supervisor(app: AppHandle, store: RuntimeStore) {
    tauri::async_runtime::spawn(async move {
        start_control_listener(app.clone(), store.clone());
        start_reconnect_loop(app.clone(), store.clone());
        start_capture_forwarder(app.clone(), store.clone());

        match discovery_socket().await {
            Ok(socket) => {
                store.record_discovery_health(
                    true,
                    format!("UDP discovery listening on {DISCOVERY_PORT}."),
                );
                let socket = std::sync::Arc::new(socket);
                start_beacon_loop(socket.clone(), store.clone());
                start_listener_loop(socket, store, app);
            }
            Err(error) => {
                store.record_discovery_health(false, format!("UDP discovery unavailable: {error}"));
                let _ = app.emit(
                    "remoteshare://network-error",
                    format!("LAN discovery unavailable: {error}"),
                );
            }
        }
    });
}

pub async fn scan_lan(store: RuntimeStore) -> NetworkAction {
    let _ = store.mark_discovery_scan();
    let mut announcement = store.local_announcement();
    announcement.scan_request = true;
    let payload = match serde_json::to_vec(&announcement) {
        Ok(payload) => payload,
        Err(error) => return action(false, format!("Failed to prepare LAN scan: {error}")),
    };
    let targets = discovery_broadcast_targets();

    match send_discovery_payload(&payload, &targets).await {
        Ok(sent_count) if sent_count > 0 => action(
            true,
            format!("LAN discovery scan sent to {sent_count} broadcast target(s)."),
        ),
        Ok(_) => action(false, "LAN discovery scan had no broadcast targets.".to_string()),
        Err(error) => action(false, format!("LAN discovery scan failed: {error}")),
    }
}

fn start_reconnect_loop(app: AppHandle, store: RuntimeStore) {
    tauri::async_runtime::spawn(async move {
        let mut retry_state: HashMap<String, ReconnectRetry> = HashMap::new();
        let mut last_loop_at = Instant::now();

        loop {
            let now = Instant::now();
            if reconnect_loop_should_reset_after_delay(last_loop_at, now) {
                retry_state.clear();
            }
            last_loop_at = now;

            if store.trusted_reconnect_enabled() {
                for reconnect_target in store.trusted_reconnect_targets() {
                    if reconnect_retry_should_wait(&retry_state, &reconnect_target, now) {
                        continue;
                    }
                    store.record_reconnect_attempt();

                    let endpoints = reconnect_target.endpoints.clone();
                    let mut last_failure = None;
                    let mut reconnected = false;
                    for endpoint in endpoints.clone() {
                        let target = TrustedTarget {
                            device_id: reconnect_target.device_id.clone(),
                            endpoint: endpoint.clone(),
                            public_key_fingerprint: reconnect_target.public_key_fingerprint.clone(),
                            public_key: reconnect_target.public_key.clone(),
                            shared_secret: Some(reconnect_target.shared_secret.clone()),
                        };
                        let started = Instant::now();
                        let challenge = pairing_nonce();
                        let message = ControlMessage::Ping {
                            source: store.local_pairing_peer(),
                            challenge: challenge.clone(),
                        };

                        let reconnect_result = send_control_message_for_response_with_secret(
                            &target.endpoint,
                            &message,
                            target.shared_secret.as_deref(),
                        )
                        .await;

                        if reconnect_pong_matches(&reconnect_result, &target, &challenge) {
                            let latency_ms =
                                started.elapsed().as_millis().min(u16::MAX as u128) as u16;
                            if let Err(error) = store.record_trusted_connection(
                                target.device_id.clone(),
                                target.endpoint,
                                Some(latency_ms),
                            ) {
                                let _ = app.emit("remoteshare://network-error", error);
                            }
                            let _ = app.emit("remoteshare://devices-changed", ());
                            retry_state.remove(&target.device_id);
                            reconnected = true;
                            break;
                        } else {
                            let failure_message = reconnect_failure_message(reconnect_result);
                            store.record_trusted_connection_failure(
                                &target.device_id,
                                &target.endpoint,
                                &failure_message,
                            );
                            last_failure = Some((target.device_id, target.endpoint));
                        }
                    }

                    if reconnected {
                        continue;
                    }

                    if let Some((device_id, _endpoint)) = last_failure {
                        schedule_reconnect_retry(&mut retry_state, &device_id, endpoints);
                        let _ = app.emit("remoteshare://devices-changed", ());
                    }
                }
            } else {
                retry_state.clear();
            }

            tokio::time::sleep(RECONNECT_INTERVAL).await;
        }
    });
}

fn reconnect_loop_should_reset_after_delay(last_loop_at: Instant, now: Instant) -> bool {
    now.duration_since(last_loop_at) > RECONNECT_INTERVAL + RECONNECT_WAKE_RESET_GRACE
}

fn reconnect_pong_matches(
    result: &std::io::Result<Option<ControlMessage>>,
    target: &TrustedTarget,
    challenge: &str,
) -> bool {
    matches!(
        result,
        Ok(Some(ControlMessage::Pong { source, challenge: response_challenge }))
            if source.device_id == target.device_id
                && source.public_key_fingerprint == target.public_key_fingerprint
                && peer_public_key_matches_fingerprint(
                    &source.public_key,
                    &source.public_key_fingerprint,
                )
                && target
                    .public_key
                    .as_ref()
                    .is_none_or(|public_key| public_key == &source.public_key)
                && response_challenge == challenge
    )
}

fn peer_public_key_matches_fingerprint(public_key: &str, fingerprint: &str) -> bool {
    if public_key.is_empty() {
        return true;
    }

    crypto::fingerprint_from_public_key(public_key).is_ok_and(|computed| computed == fingerprint)
}

fn reconnect_failure_message(result: std::io::Result<Option<ControlMessage>>) -> String {
    match result {
        Ok(Some(ControlMessage::Pong { .. })) => {
            "Authenticated reconnect replied with an unexpected identity.".to_string()
        }
        Ok(Some(_)) => {
            "Authenticated reconnect replied with an unexpected control message.".to_string()
        }
        Ok(None) => "Authenticated reconnect closed before replying.".to_string(),
        Err(error) => format!("Authenticated reconnect check failed: {error}"),
    }
}

#[derive(Debug, Clone)]
struct ReconnectRetry {
    failures: u8,
    next_attempt_at: Instant,
    endpoints: Vec<String>,
}

fn reconnect_retry_should_wait(
    retry_state: &HashMap<String, ReconnectRetry>,
    target: &TrustedReconnectTarget,
    now: Instant,
) -> bool {
    retry_state
        .get(&target.device_id)
        .is_some_and(|retry| retry.endpoints == target.endpoints && retry.next_attempt_at > now)
}

fn schedule_reconnect_retry(
    retry_state: &mut HashMap<String, ReconnectRetry>,
    device_id: &str,
    endpoints: Vec<String>,
) {
    let entry = retry_state
        .entry(device_id.to_string())
        .or_insert(ReconnectRetry {
            failures: 0,
            next_attempt_at: Instant::now(),
            endpoints: endpoints.clone(),
        });
    entry.failures = entry.failures.saturating_add(1).min(8);
    entry.endpoints = endpoints;

    let multiplier = 1_u32 << (entry.failures.saturating_sub(1) as u32);
    let delay = RECONNECT_INTERVAL
        .saturating_mul(multiplier)
        .min(RECONNECT_MAX_BACKOFF);
    entry.next_attempt_at = Instant::now() + delay;
}

pub async fn initiate_pairing(store: RuntimeStore, request: PairRequest) -> NetworkAction {
    let manual_endpoint_requested = request.manual_endpoint;
    let target = match store.pairing_target(request) {
        Ok(target) => target,
        Err(message) => return action(false, message),
    };

    let local_nonce = pairing_nonce();
    let (local_dh_private_key, local_dh_public_key) = pairing_dh_keypair();
    let message = ControlMessage::PairRequest {
        peer: store.local_pairing_peer(),
        nonce: local_nonce.clone(),
        dh_public_key: local_dh_public_key.clone(),
    };

    match send_control_message_for_response(&target.endpoint, &message).await {
        Ok(response) => {
            let ack = response.and_then(|message| match message {
                ControlMessage::PairAck {
                    peer,
                    nonce,
                    dh_public_key,
                } => Some(Ok((peer, nonce, dh_public_key))),
                ControlMessage::PairRejected { reason } => Some(Err(reason)),
                _ => None,
            });
            let Some(ack) = ack else {
                return action(
                    false,
                    "Pairing target did not reply with a pair acknowledgement.".to_string(),
                );
            };
            let (peer, remote_nonce, remote_dh_public_key) = match ack {
                Ok(ack) => ack,
                Err(reason) => return action(false, reason),
            };
            if peer.device_id == store.local_device_id() {
                return action(false, "Cannot pair this computer with itself.".to_string());
            }
            if let Some(expected_peer) = &target.expected_peer {
                if expected_peer.device_id != peer.device_id
                    || expected_peer.public_key_fingerprint != peer.public_key_fingerprint
                    || (!expected_peer.public_key.is_empty()
                        && expected_peer.public_key != peer.public_key)
                {
                    return action(
                        false,
                        "Pairing acknowledgement identity did not match the selected device."
                            .to_string(),
                    );
                }
            }
            let code = pairing_code(
                &store.local_device_id(),
                &peer.device_id,
                &local_nonce,
                &remote_nonce,
                &local_dh_public_key,
                &remote_dh_public_key,
            );
            let id = match store.register_outgoing_pairing(
                &target,
                Some(peer),
                local_nonce,
                remote_nonce,
                local_dh_private_key,
                local_dh_public_key,
                remote_dh_public_key,
                code.clone(),
            ) {
                Ok(id) => id,
                Err(message) => return action(false, message),
            };
            if manual_endpoint_requested {
                if let Err(error) = store.remember_manual_endpoint(target.endpoint.clone()) {
                    store.remove_pending_pairing(&id);
                    return action(false, error);
                }
            }
            action(
                true,
                format!(
                    "Pairing request sent. Confirm code {code} on both computers. Request: {id}"
                ),
            )
        }
        Err(error) => action(false, format!("Failed to send pairing request: {error}")),
    }
}

pub async fn confirm_pairing(
    app: AppHandle,
    store: RuntimeStore,
    request: ConfirmPairingRequest,
) -> NetworkAction {
    let pairing = match store.confirm_pairing(request) {
        Ok(pairing) => pairing,
        Err(message) => return action(false, message),
    };

    let message = ControlMessage::PairAccepted {
        peer: store.local_pairing_peer(),
        code: pairing.code.clone(),
    };
    let shared_secret = match store.pending_pairing_shared_secret(&pairing.id) {
        Ok(secret) => secret,
        Err(error) => {
            store.reset_local_pairing_approval(&pairing.id);
            return action(false, error);
        }
    };

    if let Err(error) =
        send_control_message_with_secret(&pairing.endpoint, &message, Some(&shared_secret)).await
    {
        store.reset_local_pairing_approval(&pairing.id);
        let _ = app.emit("remoteshare://devices-changed", ());
        return action(
            false,
            format!("Pairing accepted locally, but reply failed: {error}"),
        );
    }

    match store.complete_pairing_if_ready(&pairing.id) {
        Ok(true) => {
            let _ = app.emit("remoteshare://devices-changed", ());
            action(true, "Pairing confirmed and trusted.".to_string())
        }
        Ok(false) => {
            let _ = app.emit("remoteshare://devices-changed", ());
            action(
                true,
                "Code confirmed locally. Waiting for the other computer to approve.".to_string(),
            )
        }
        Err(error) => action(false, error),
    }
}

pub async fn send_test_input(store: RuntimeStore, request: SendInputRequest) -> NetworkAction {
    if !store.input_sending_enabled() {
        return action(
            false,
            "Set this computer role to Main or Both before sending test input.".to_string(),
        );
    }

    let reconnect_target = match store
        .trusted_reconnect_targets()
        .into_iter()
        .find(|target| target.device_id == request.device_id)
    {
        Some(target) => target,
        None => {
            return match store.trusted_target(&request.device_id) {
                Ok(_) => action(
                    false,
                    trusted_endpoint_recovery_message("Trusted device has no reachable endpoint."),
                ),
                Err(message) => action(false, message),
            }
        }
    };
    let event = RuntimeStore::test_input_event();
    let message = ControlMessage::InputEvent {
        source: store.local_pairing_peer(),
        event: event.clone(),
    };

    let mut last_failure = None;
    for endpoint in reconnect_target.endpoints {
        match send_control_message_for_response_with_secret(
            &endpoint,
            &message,
            Some(&reconnect_target.shared_secret),
        )
        .await
        {
            Ok(Some(ControlMessage::InputAck { ok: true, message })) => {
                if let Err(error) = store.record_trusted_connection(
                    request.device_id.clone(),
                    endpoint.clone(),
                    None,
                ) {
                    return action(false, error);
                }
                store.record_outgoing_input(request.device_id, event);
                return action(true, format!("{message} Endpoint: {endpoint}."));
            }
            Ok(Some(ControlMessage::InputAck { ok: false, message })) => {
                store.record_trusted_connection_failure(&request.device_id, &endpoint, &message);
                last_failure = Some(message);
            }
            Ok(Some(_)) => {
                let message =
                    "Input event target replied with an unexpected control message.".to_string();
                store.record_trusted_connection_failure(&request.device_id, &endpoint, &message);
                last_failure = Some(message);
            }
            Ok(None) => {
                let message = "Input event target closed before acknowledging.".to_string();
                store.record_trusted_connection_failure(&request.device_id, &endpoint, &message);
                last_failure = Some(message);
            }
            Err(error) => {
                let message = format!("Failed to send input event: {error}");
                store.record_trusted_connection_failure(
                    &request.device_id,
                    &endpoint,
                    &message,
                );
                last_failure = Some(message);
            }
        }
    }

    action(
        false,
        trusted_endpoint_recovery_message(
            last_failure.unwrap_or_else(|| "Trusted device has no reachable endpoint.".to_string()),
        ),
    )
}

pub async fn check_trusted_device(
    store: RuntimeStore,
    request: DeviceTrustRequest,
) -> NetworkAction {
    if !store.trusted_reconnect_enabled() {
        return action(
            false,
            "Turn on Auto reconnect before running trusted checks.".to_string(),
        );
    }

    let reconnect_target = match store
        .trusted_reconnect_targets()
        .into_iter()
        .find(|target| target.device_id == request.device_id)
    {
        Some(target) => target,
        None => {
            return match store.trusted_target(&request.device_id) {
                Ok(_) => action(
                    false,
                    trusted_endpoint_recovery_message("Trusted device has no reachable endpoint."),
                ),
                Err(message) => action(false, message),
            }
        }
    };

    let mut last_failure = None;
    for endpoint in reconnect_target.endpoints {
        let target = TrustedTarget {
            device_id: reconnect_target.device_id.clone(),
            endpoint: endpoint.clone(),
            public_key_fingerprint: reconnect_target.public_key_fingerprint.clone(),
            public_key: reconnect_target.public_key.clone(),
            shared_secret: Some(reconnect_target.shared_secret.clone()),
        };
        let challenge = pairing_nonce();
        let message = ControlMessage::Ping {
            source: store.local_pairing_peer(),
            challenge: challenge.clone(),
        };
        let started = Instant::now();

        let reconnect_result = send_control_message_for_response_with_secret(
            &endpoint,
            &message,
            target.shared_secret.as_deref(),
        )
        .await;

        if reconnect_pong_matches(&reconnect_result, &target, &challenge) {
            let latency_ms = started.elapsed().as_millis().min(u16::MAX as u128) as u16;
            return match store.record_trusted_connection(
                target.device_id,
                endpoint.clone(),
                Some(latency_ms),
            ) {
                Ok(()) => action(true, format!("Trusted device reachable at {endpoint}.")),
                Err(error) => action(false, error),
            };
        } else {
            let failure_message = reconnect_failure_message(reconnect_result);
            store.record_trusted_connection_failure(
                &target.device_id,
                &endpoint,
                &failure_message,
            );
            last_failure = Some(failure_message);
        }
    }

    action(
        false,
        trusted_endpoint_recovery_message(
            last_failure.unwrap_or_else(|| "Trusted device has no reachable endpoint.".to_string()),
        ),
    )
}

pub async fn update_trusted_endpoint(
    store: RuntimeStore,
    request: DeviceEndpointUpdateRequest,
) -> NetworkAction {
    let target = match store.trusted_target_for_endpoint(&request.device_id, request.endpoint) {
        Ok(target) => target,
        Err(message) if message == crate::runtime::INVALID_ENDPOINT_MESSAGE => {
            return action(false, "Enter a reachable LAN endpoint, not localhost.".to_string())
        }
        Err(message) => return action(false, message),
    };
    let challenge = pairing_nonce();
    let message = ControlMessage::Ping {
        source: store.local_pairing_peer(),
        challenge: challenge.clone(),
    };
    let started = Instant::now();
    let reconnect_result = send_control_message_for_response_with_secret(
        &target.endpoint,
        &message,
        target.shared_secret.as_deref(),
    )
    .await;

    if reconnect_pong_matches(&reconnect_result, &target, &challenge) {
        let latency_ms = started.elapsed().as_millis().min(u16::MAX as u128) as u16;
        return match store.record_trusted_connection(
            target.device_id,
            target.endpoint.clone(),
            Some(latency_ms),
        ) {
            Ok(()) => action(
                true,
                format!("Trusted endpoint updated and verified at {}.", target.endpoint),
            ),
            Err(error) => action(false, error),
        };
    }

    let failure_message = reconnect_failure_message(reconnect_result);
    store.record_trusted_connection_failure(&target.device_id, &target.endpoint, &failure_message);
    action(false, trusted_endpoint_recovery_message(failure_message))
}

fn start_capture_forwarder(app: AppHandle, store: RuntimeStore) {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let receiver = loop {
                match input::start_capture_stream() {
                    Ok(receiver) => break receiver,
                    Err(input::InputError::MissingCapturePermission) => {
                        std::thread::sleep(Duration::from_secs(10));
                    }
                    Err(error) => {
                        let _ = app.emit(
                            "remoteshare://network-error",
                            format!("Input capture unavailable: {error}"),
                        );
                        return;
                    }
                }
            };

            let mut last_mouse_move_at = Instant::now() - Duration::from_secs(1);
            let mouse_move_in_flight = Arc::new(AtomicBool::new(false));
            while let Ok(event) = receiver.recv() {
                let is_mouse_move = matches!(event.kind, InputEventKind::MouseMove);
                if is_mouse_move {
                    let now = Instant::now();
                    if now.duration_since(last_mouse_move_at) < Duration::from_millis(8) {
                        continue;
                    }
                    last_mouse_move_at = now;
                    if mouse_move_in_flight.swap(true, Ordering::AcqRel) {
                        continue;
                    }
                }

                let Some(target) = store.active_capture_target() else {
                    if is_mouse_move {
                        mouse_move_in_flight.store(false, Ordering::Release);
                    }
                    continue;
                };
                let app = app.clone();
                let store = store.clone();
                let mouse_move_in_flight = mouse_move_in_flight.clone();
                tauri::async_runtime::spawn(async move {
                    let target_device_id = target.device_id.clone();
                    match send_input_to_target(store.clone(), target, event).await {
                        Ok(()) => {
                            let _ = app.emit("remoteshare://devices-changed", ());
                        }
                        Err(error) => {
                            let message = format!("Failed to forward captured input: {error}");
                            store.stop_capture_if_target(&target_device_id);
                            let _ = app.emit(
                                "remoteshare://network-error",
                                format!("{message}. Capture stopped."),
                            );
                            let _ = app.emit("remoteshare://devices-changed", ());
                        }
                    }
                    if is_mouse_move {
                        mouse_move_in_flight.store(false, Ordering::Release);
                    }
                });
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, store);
    }
}

async fn send_input_to_target(
    store: RuntimeStore,
    target: TrustedReconnectTarget,
    event: InputEvent,
) -> std::io::Result<()> {
    let message = ControlMessage::InputEvent {
        source: store.local_pairing_peer(),
        event: event.clone(),
    };
    let mut last_error = None;

    for endpoint in &target.endpoints {
        match send_control_message_for_response_with_secret(
            endpoint,
            &message,
            Some(&target.shared_secret),
        )
        .await
        {
            Ok(Some(ControlMessage::InputAck { ok: true, .. })) => {
                store
                    .record_trusted_connection(target.device_id.clone(), endpoint.clone(), None)
                    .map_err(std::io::Error::other)?;
                store.record_outgoing_input(target.device_id.clone(), event);
                return Ok(());
            }
            Ok(Some(ControlMessage::InputAck { ok: false, message })) => {
                store.record_trusted_connection_failure(&target.device_id, endpoint, &message);
                last_error = Some(std::io::Error::other(message));
            }
            Ok(Some(_)) => {
                let message =
                    "Input event target replied with an unexpected control message.".to_string();
                store.record_trusted_connection_failure(&target.device_id, endpoint, &message);
                last_error = Some(std::io::Error::new(std::io::ErrorKind::InvalidData, message));
            }
            Ok(None) => {
                let message = "Input event target closed before acknowledging.".to_string();
                store.record_trusted_connection_failure(&target.device_id, endpoint, &message);
                last_error = Some(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    message,
                ));
            }
            Err(error) => {
                let message = format!("Failed to send input event: {error}");
                store.record_trusted_connection_failure(
                    &target.device_id,
                    endpoint,
                    &message,
                );
                last_error = Some(error);
            }
        }
    }

    Err(last_error
        .map(|error| {
            std::io::Error::new(
                error.kind(),
                trusted_endpoint_recovery_message(error.to_string()),
            )
        })
        .unwrap_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                trusted_endpoint_recovery_message("trusted device has no reachable endpoint"),
            )
        }))
}

fn trusted_endpoint_recovery_message(message: impl AsRef<str>) -> String {
    let message = message.as_ref();
    if message.contains("Set IP") || message.contains("Verify IP") {
        message.to_string()
    } else {
        format!("{message}{TRUSTED_ENDPOINT_RECOVERY_HINT}")
    }
}

fn start_control_listener(app: AppHandle, store: RuntimeStore) {
    tauri::async_runtime::spawn(async move {
        let replay_cache = Arc::new(Mutex::new(ReplayCache::default()));
        let mut listener_errors = Vec::new();
        let mut listener_labels = Vec::new();

        match control_listener(SocketAddr::V6(SocketAddrV6::new(
            Ipv6Addr::UNSPECIFIED,
            44777,
            0,
            0,
        )))
        .await
        {
            Ok(listener) => {
                listener_labels.push("IPv6");
                start_control_accept_loop(
                    "IPv6",
                    listener,
                    app.clone(),
                    store.clone(),
                    replay_cache.clone(),
                )
            }
            Err(error) => listener_errors.push(format!("IPv6: {error}")),
        }

        match control_listener(SocketAddr::V4(SocketAddrV4::new(
            Ipv4Addr::UNSPECIFIED,
            44777,
        )))
        .await
        {
            Ok(listener) => {
                listener_labels.push("IPv4");
                start_control_accept_loop(
                    "IPv4",
                    listener,
                    app.clone(),
                    store.clone(),
                    replay_cache,
                )
            }
            Err(error) => listener_errors.push(format!("IPv4: {error}")),
        }

        if listener_errors.len() == 2 {
            store.record_control_listener_health(
                false,
                format!("TCP 44777 unavailable ({})", listener_errors.join("; ")),
            );
            let _ = app.emit(
                "remoteshare://network-error",
                format!(
                    "Pairing listener unavailable on TCP 44777 ({})",
                    listener_errors.join("; ")
                ),
            );
        } else {
            store.record_control_listener_health(
                true,
                format!("TCP 44777 listening on {}.", listener_labels.join(" and ")),
            );
            let _ = app.emit("remoteshare://devices-changed", ());
        }
    });
}

async fn control_listener(address: SocketAddr) -> std::io::Result<TcpListener> {
    let socket = match address {
        SocketAddr::V4(_) => TcpSocket::new_v4()?,
        SocketAddr::V6(_) => TcpSocket::new_v6()?,
    };
    socket.bind(address)?;
    socket.listen(1024)
}

fn start_control_accept_loop(
    label: &'static str,
    listener: TcpListener,
    app: AppHandle,
    store: RuntimeStore,
    replay_cache: Arc<Mutex<ReplayCache>>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, sender)) => {
                    let app = app.clone();
                    let store = store.clone();
                    let replay_cache = replay_cache.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_control_stream(app, store, replay_cache, stream, sender).await;
                    });
                }
                Err(error) => {
                    let _ = app.emit(
                        "remoteshare://network-error",
                        format!("{label} pairing listener failed: {error}"),
                    );
                }
            }
        }
    });
}

async fn handle_control_stream(
    app: AppHandle,
    store: RuntimeStore,
    replay_cache: Arc<Mutex<ReplayCache>>,
    mut stream: TcpStream,
    sender: SocketAddr,
) {
    if store.private_network_only_enabled() && !is_private_or_local_address(sender.ip()) {
        let _ = app.emit(
            "remoteshare://network-error",
            format!("Rejected control connection from non-private address {sender}."),
        );
        return;
    }

    let received = match read_control_message(&mut stream).await {
        Ok(Some(received)) => received,
        Ok(None) => return,
        Err(error) => {
            let _ = app.emit(
                "remoteshare://network-error",
                format!("Rejected control connection from {sender}: {error}"),
            );
            return;
        }
    };

    match received.message.clone() {
        ControlMessage::PairRequest {
            peer,
            nonce: remote_nonce,
            dh_public_key: remote_dh_public_key,
        } => {
            let endpoint = endpoint(sender, peer.control_port);
            let local_nonce = pairing_nonce();
            let (local_dh_private_key, local_dh_public_key) = pairing_dh_keypair();
            let code = pairing_code(
                &store.local_device_id(),
                &peer.device_id,
                &local_nonce,
                &remote_nonce,
                &local_dh_public_key,
                &remote_dh_public_key,
            );
            let pairing_id = match store.register_incoming_pairing(
                peer,
                endpoint,
                local_nonce.clone(),
                remote_nonce,
                local_dh_private_key,
                local_dh_public_key.clone(),
                remote_dh_public_key,
                code,
            ) {
                Ok(pairing_id) => pairing_id,
                Err(error) => {
                    let rejection = ControlMessage::PairRejected {
                        reason: error.clone(),
                    };
                    let _ = write_control_message(&mut stream, &rejection, None).await;
                    let _ = app.emit(
                        "remoteshare://network-error",
                        format!("Pairing request rejected: {error}"),
                    );
                    let _ = app.emit("remoteshare://devices-changed", ());
                    return;
                }
            };
            let ack = ControlMessage::PairAck {
                peer: store.local_pairing_peer(),
                nonce: local_nonce,
                dh_public_key: local_dh_public_key,
            };
            if let Err(error) = write_control_message(&mut stream, &ack, None).await {
                store.remove_pending_pairing(&pairing_id);
                let _ = app.emit(
                    "remoteshare://network-error",
                    format!("Pairing acknowledgement failed: {error}"),
                );
            }
            let _ = app.emit("remoteshare://devices-changed", ());
        }
        ControlMessage::PairAccepted { peer, code } => {
            let endpoint = endpoint(sender, peer.control_port);
            let pairing_id = format!("pair-{}", peer.device_id);
            let shared_secret = match store.pending_pairing_shared_secret(&pairing_id) {
                Ok(secret) => secret,
                Err(error) => {
                    let _ = app.emit(
                        "remoteshare://network-error",
                        format!("Pairing approval rejected: {error}"),
                    );
                    let _ = app.emit("remoteshare://devices-changed", ());
                    return;
                }
            };
            if verify_received_message_with_replay(&received, &shared_secret, &replay_cache)
                .is_err()
            {
                let _ = app.emit(
                    "remoteshare://network-error",
                    "Pairing approval rejected: authentication failed.".to_string(),
                );
                let _ = app.emit("remoteshare://devices-changed", ());
                return;
            }
            if let Err(error) = store.record_remote_pairing_approval(peer, endpoint, code) {
                let _ = app.emit(
                    "remoteshare://network-error",
                    format!("Pairing approval rejected: {error}"),
                );
            }
            let _ = app.emit("remoteshare://devices-changed", ());
        }
        ControlMessage::InputEvent { source, event } => {
            let auth_ok = store
                .trusted_shared_secret(&source.device_id)
                .ok()
                .flatten()
                .map(|secret| {
                    verify_received_message_with_replay(&received, &secret, &replay_cache).is_ok()
                })
                .unwrap_or(false);
            if !auth_ok {
                store.record_incoming_input(
                    source,
                    event,
                    false,
                    Some("authentication failed".to_string()),
                );
                let _ = app.emit(
                    "remoteshare://network-error",
                    "Rejected input event because authentication failed.".to_string(),
                );
                let _ = app.emit("remoteshare://devices-changed", ());
                return;
            }

            let shared_secret = store
                .trusted_shared_secret(&source.device_id)
                .ok()
                .flatten();
            let action = store.authorize_incoming_input(&source);
            let ack = if action.ok {
                match input::apply_event(&event) {
                    Ok(()) => store.record_incoming_input(source, event, true, None),
                    Err(error) => {
                        let detail = format!("injection failed: {error}");
                        let ack =
                            store.record_incoming_input(source, event, false, Some(detail.clone()));
                        let _ = app.emit(
                            "remoteshare://network-error",
                            format!("Input event accepted but {detail}"),
                        );
                        ack
                    }
                }
            } else {
                store.record_incoming_input(source, event, false, Some(action.message))
            };
            if let Some(shared_secret) = shared_secret {
                let response = ControlMessage::InputAck {
                    ok: ack.ok,
                    message: ack.message,
                };
                let _ = write_control_message(&mut stream, &response, Some(&shared_secret)).await;
            }
            let _ = app.emit("remoteshare://devices-changed", ());
        }
        ControlMessage::Ping { source, challenge } => {
            let shared_secret = store
                .trusted_shared_secret(&source.device_id)
                .ok()
                .flatten();
            let Some(shared_secret) = shared_secret else {
                return;
            };
            if verify_received_message_with_replay(&received, &shared_secret, &replay_cache)
                .is_err()
            {
                return;
            }
            if !store.trusted_identity_matches(&source) {
                let _ = app.emit(
                    "remoteshare://network-error",
                    "Rejected reconnect ping because trusted identity does not match."
                        .to_string(),
                );
                let _ = app.emit("remoteshare://devices-changed", ());
                return;
            }

            let source_endpoint = endpoint(sender, source.control_port);
            if let Err(error) = store.record_trusted_connection(
                source.device_id.clone(),
                source_endpoint.clone(),
                None,
            ) {
                let _ = app.emit("remoteshare://network-error", error);
            }

            let pong = ControlMessage::Pong {
                source: store.local_pairing_peer(),
                challenge,
            };
            if let Err(error) =
                write_control_message(&mut stream, &pong, Some(&shared_secret)).await
            {
                let message = format!("Trusted reconnect pong failed: {error}");
                store.record_trusted_connection_failure(
                    &source.device_id,
                    &source_endpoint,
                    &message,
                );
                let _ = app.emit(
                    "remoteshare://network-error",
                    format!("Trusted reconnect pong failed: {error}"),
                );
            }
            let _ = app.emit("remoteshare://devices-changed", ());
        }
        ControlMessage::Pong { .. } => {}
        ControlMessage::InputAck { .. } => {}
        ControlMessage::PairAck { .. } => {}
        ControlMessage::PairRejected { .. } => {}
    }
}

fn is_private_or_local_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private() || address.is_loopback() || address.is_link_local()
        }
        IpAddr::V6(address) => {
            if let Some(mapped_address) = address.to_ipv4_mapped() {
                return mapped_address.is_private()
                    || mapped_address.is_loopback()
                    || mapped_address.is_link_local();
            }

            address.is_loopback() || is_ipv6_unique_local(address) || is_ipv6_unicast_link_local(address)
        }
    }
}

fn is_ipv6_unique_local(address: Ipv6Addr) -> bool {
    (address.segments()[0] & 0xfe00) == 0xfc00
}

fn is_ipv6_unicast_link_local(address: Ipv6Addr) -> bool {
    (address.segments()[0] & 0xffc0) == 0xfe80
}

fn start_beacon_loop(socket: std::sync::Arc<UdpSocket>, store: RuntimeStore) {
    tauri::async_runtime::spawn(async move {
        let mut targets = discovery_broadcast_targets();
        let mut last_target_refresh = Instant::now();

        loop {
            if let Ok(payload) = serde_json::to_vec(&store.local_announcement()) {
                if last_target_refresh.elapsed() >= BEACON_TARGET_REFRESH_INTERVAL {
                    targets = discovery_broadcast_targets();
                    last_target_refresh = Instant::now();
                }

                for target in &targets {
                    let _ = socket.send_to(&payload, target).await;
                }
            }
            tokio::time::sleep(BEACON_INTERVAL).await;
        }
    });
}

async fn send_discovery_payload(payload: &[u8], targets: &[String]) -> std::io::Result<usize> {
    if targets.is_empty() {
        return Ok(0);
    }

    let socket = std::net::UdpSocket::bind(("0.0.0.0", 0))?;
    socket.set_broadcast(true)?;
    socket.set_nonblocking(true)?;
    let socket = UdpSocket::from_std(socket)?;
    let mut sent_count = 0;
    let mut last_error = None;

    for target in targets {
        match socket.send_to(payload, target).await {
            Ok(_) => sent_count += 1,
            Err(error) => last_error = Some(error),
        }
    }

    if sent_count == 0 {
        if let Some(error) = last_error {
            return Err(error);
        }
    }

    Ok(sent_count)
}

fn start_listener_loop(socket: std::sync::Arc<UdpSocket>, store: RuntimeStore, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut buffer = [0_u8; BUFFER_SIZE];

        loop {
            match socket.recv_from(&mut buffer).await {
                Ok((size, sender)) => {
                    if let Ok(announcement) =
                        serde_json::from_slice::<crate::runtime::PeerAnnouncement>(&buffer[..size])
                    {
                        if announcement.protocol_version != 1 {
                            continue;
                        }

                        let reply_requested = announcement.scan_request;
                        let endpoint = endpoint(sender, announcement.control_port);
                        let accepted = store.record_peer(announcement, endpoint);
                        if accepted && reply_requested {
                            if let Ok(payload) = serde_json::to_vec(&store.local_announcement()) {
                                let _ = socket
                                    .send_to(&payload, discovery_reply_target(sender))
                                    .await;
                            }
                        }
                        if accepted {
                            let _ = app.emit("remoteshare://devices-changed", ());
                        }
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        "remoteshare://network-error",
                        format!("LAN discovery listener failed: {error}"),
                    );
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    });
}

async fn discovery_socket() -> std::io::Result<UdpSocket> {
    let socket = std::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT))?;
    socket.set_broadcast(true)?;
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket)
}

fn discovery_broadcast_targets() -> Vec<String> {
    let mut targets = HashSet::from([BROADCAST_ADDR.to_string()]);
    for address in platform_broadcast_addresses() {
        targets.insert(SocketAddrV4::new(address, DISCOVERY_PORT).to_string());
    }

    let mut targets = targets.into_iter().collect::<Vec<_>>();
    targets.sort();
    targets
}

pub fn local_control_endpoints(control_port: u16) -> Vec<String> {
    let mut ipv4_addresses = HashSet::new();
    for address in platform_local_ipv4_addresses() {
        if !address.is_loopback() && !address.is_unspecified() {
            ipv4_addresses.insert(address);
        }
    }
    let mut ipv6_addresses = HashSet::new();
    for address in platform_local_ipv6_addresses() {
        if !address.is_loopback()
            && !address.is_unspecified()
            && !address.is_multicast()
            && !is_ipv6_unicast_link_local(address)
        {
            ipv6_addresses.insert(address);
        }
    }

    let mut ipv4_addresses = ipv4_addresses.into_iter().collect::<Vec<_>>();
    ipv4_addresses
        .sort_by_key(|address| (local_ipv4_endpoint_priority(*address), u32::from(*address)));
    let mut endpoints = ipv4_addresses
        .into_iter()
        .map(|address| SocketAddrV4::new(address, control_port).to_string())
        .collect::<Vec<_>>();

    let mut ipv6_addresses = ipv6_addresses.into_iter().collect::<Vec<_>>();
    ipv6_addresses.sort_by_key(|address| (local_ipv6_endpoint_priority(*address), *address));
    endpoints.extend(
        ipv6_addresses
            .into_iter()
            .map(|address| SocketAddrV6::new(address, control_port, 0, 0).to_string()),
    );

    endpoints
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_broadcast_addresses() -> Vec<Ipv4Addr> {
    match Command::new("ifconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ifconfig_broadcast_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn platform_broadcast_addresses() -> Vec<Ipv4Addr> {
    match Command::new("ipconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ipconfig_broadcast_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_broadcast_addresses() -> Vec<Ipv4Addr> {
    Vec::new()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_local_ipv4_addresses() -> Vec<Ipv4Addr> {
    match Command::new("ifconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ifconfig_local_ipv4_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn platform_local_ipv4_addresses() -> Vec<Ipv4Addr> {
    match Command::new("ipconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ipconfig_local_ipv4_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_local_ipv4_addresses() -> Vec<Ipv4Addr> {
    Vec::new()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_local_ipv6_addresses() -> Vec<Ipv6Addr> {
    match Command::new("ifconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ifconfig_local_ipv6_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn platform_local_ipv6_addresses() -> Vec<Ipv6Addr> {
    match Command::new("ipconfig").output() {
        Ok(output) if output.status.success() => {
            let output = String::from_utf8_lossy(&output.stdout);
            parse_ipconfig_local_ipv6_addresses(&output)
        }
        _ => Vec::new(),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_local_ipv6_addresses() -> Vec<Ipv6Addr> {
    Vec::new()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_ifconfig_broadcast_addresses(output: &str) -> Vec<Ipv4Addr> {
    let mut addresses = HashSet::new();
    let tokens = output.split_whitespace().collect::<Vec<_>>();

    for (index, token) in tokens.iter().enumerate() {
        if *token == "broadcast" {
            if let Some(address) = tokens.get(index + 1).and_then(|value| value.parse().ok()) {
                addresses.insert(address);
            }
        } else if let Some(value) = token.strip_prefix("Bcast:") {
            if let Ok(address) = value.parse() {
                addresses.insert(address);
            }
        }
    }

    addresses.into_iter().collect()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_ifconfig_local_ipv4_addresses(output: &str) -> Vec<Ipv4Addr> {
    let mut addresses = HashSet::new();
    let tokens = output.split_whitespace().collect::<Vec<_>>();

    for (index, token) in tokens.iter().enumerate() {
        if *token == "inet" {
            if let Some(address) = tokens
                .get(index + 1)
                .and_then(|value| parse_ipv4_value(value))
            {
                addresses.insert(address);
            }
        } else if let Some(value) = token.strip_prefix("addr:") {
            if let Some(address) = parse_ipv4_value(value) {
                addresses.insert(address);
            }
        }
    }

    addresses.into_iter().collect()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_ifconfig_local_ipv6_addresses(output: &str) -> Vec<Ipv6Addr> {
    let mut addresses = HashSet::new();
    let tokens = output.split_whitespace().collect::<Vec<_>>();

    for (index, token) in tokens.iter().enumerate() {
        let candidate = if *token == "inet6" {
            tokens.get(index + 1).copied()
        } else {
            token.strip_prefix("addr:")
        };

        if let Some(address) = candidate.and_then(parse_ipv6_value) {
            addresses.insert(address);
        }
    }

    addresses.into_iter().collect()
}

#[cfg(target_os = "windows")]
fn parse_ipconfig_broadcast_addresses(output: &str) -> Vec<Ipv4Addr> {
    let mut addresses = HashSet::new();
    let mut current_ipv4 = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            current_ipv4 = None;
            continue;
        }

        if trimmed.contains("IPv4") {
            current_ipv4 = line
                .rsplit_once(':')
                .and_then(|(_, value)| parse_ipv4_value(value));
        } else if trimmed.contains("Subnet Mask") {
            if let (Some(ip), Some(mask)) = (
                current_ipv4,
                line.rsplit_once(':')
                    .and_then(|(_, value)| parse_ipv4_value(value)),
            ) {
                addresses.insert(ipv4_broadcast(ip, mask));
            }
        }
    }

    addresses.into_iter().collect()
}

#[cfg(target_os = "windows")]
fn parse_ipconfig_local_ipv4_addresses(output: &str) -> Vec<Ipv4Addr> {
    let mut addresses = HashSet::new();

    for line in output.lines() {
        if line.trim().contains("IPv4") {
            if let Some(address) = line
                .rsplit_once(':')
                .and_then(|(_, value)| parse_ipv4_value(value))
            {
                addresses.insert(address);
            }
        }
    }

    addresses.into_iter().collect()
}

#[cfg(target_os = "windows")]
fn parse_ipconfig_local_ipv6_addresses(output: &str) -> Vec<Ipv6Addr> {
    let mut addresses = HashSet::new();

    for line in output.lines() {
        if !line.to_ascii_lowercase().contains("ipv6") {
            continue;
        }
        if let Some(address) = line
            .split_once(':')
            .and_then(|(_, value)| parse_ipv6_value(value))
        {
            addresses.insert(address);
        }
    }

    addresses.into_iter().collect()
}

#[cfg(target_os = "windows")]
fn ipv4_broadcast(address: Ipv4Addr, mask: Ipv4Addr) -> Ipv4Addr {
    let address = u32::from(address);
    let mask = u32::from(mask);
    Ipv4Addr::from(address | !mask)
}

fn parse_ipv4_value(value: &str) -> Option<Ipv4Addr> {
    let candidate = value
        .trim()
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>();
    candidate.parse().ok()
}

fn parse_ipv6_value(value: &str) -> Option<Ipv6Addr> {
    let trimmed = value.trim().trim_start_matches("addr:");
    let without_zone = trimmed
        .split_once('%')
        .map(|(address, _)| address)
        .unwrap_or(trimmed);
    let candidate = without_zone
        .chars()
        .take_while(|character| character.is_ascii_hexdigit() || *character == ':')
        .collect::<String>();
    candidate.parse().ok()
}

fn local_ipv4_endpoint_priority(address: Ipv4Addr) -> u8 {
    if address.is_private() {
        0
    } else if address.is_link_local() {
        1
    } else {
        2
    }
}

fn local_ipv6_endpoint_priority(address: Ipv6Addr) -> u8 {
    if is_ipv6_unique_local(address) {
        0
    } else if is_ipv6_unicast_link_local(address) {
        1
    } else {
        2
    }
}

fn endpoint(sender: SocketAddr, control_port: u16) -> String {
    match sender.ip() {
        std::net::IpAddr::V4(address) => format!("{address}:{control_port}"),
        std::net::IpAddr::V6(address) => {
            if let Some(mapped_address) = address.to_ipv4_mapped() {
                return format!("{mapped_address}:{control_port}");
            }

            format!("[{address}]:{control_port}")
        }
    }
}

fn discovery_reply_target(sender: SocketAddr) -> SocketAddr {
    match sender {
        SocketAddr::V4(sender) => SocketAddr::V4(SocketAddrV4::new(*sender.ip(), DISCOVERY_PORT)),
        SocketAddr::V6(sender) => {
            SocketAddr::V6(SocketAddrV6::new(*sender.ip(), DISCOVERY_PORT, 0, sender.scope_id()))
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlEnvelope {
    protocol_version: u16,
    message: ControlMessage,
    auth: Option<ControlAuth>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlAuth {
    nonce: String,
    mac: String,
}

#[derive(Debug, Default)]
struct ReplayCache {
    seen: HashMap<String, Instant>,
}

impl ReplayCache {
    fn accept(&mut self, auth: &ControlAuth) -> bool {
        let now = Instant::now();
        self.seen
            .retain(|_, seen_at| now.duration_since(*seen_at) <= AUTH_REPLAY_WINDOW);

        let key = format!("{}:{}", auth.nonce, auth.mac);
        if self.seen.contains_key(&key) {
            return false;
        }

        self.seen.insert(key, now);
        true
    }
}

#[derive(Debug, Clone)]
struct ReceivedControlMessage {
    message: ControlMessage,
    auth: Option<ControlAuth>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ControlMessage {
    PairRequest {
        peer: PairingPeer,
        nonce: String,
        dh_public_key: String,
    },
    PairAck {
        peer: PairingPeer,
        nonce: String,
        dh_public_key: String,
    },
    PairRejected {
        reason: String,
    },
    PairAccepted {
        peer: PairingPeer,
        code: String,
    },
    InputEvent {
        source: PairingPeer,
        event: InputEvent,
    },
    InputAck {
        ok: bool,
        message: String,
    },
    Ping {
        source: PairingPeer,
        challenge: String,
    },
    Pong {
        source: PairingPeer,
        challenge: String,
    },
}

async fn send_control_message_for_response(
    endpoint: &str,
    message: &ControlMessage,
) -> std::io::Result<Option<ControlMessage>> {
    send_control_message_for_response_with_secret(endpoint, message, None).await
}

async fn send_control_message_for_response_with_secret(
    endpoint: &str,
    message: &ControlMessage,
    shared_secret: Option<&str>,
) -> std::io::Result<Option<ControlMessage>> {
    let mut stream = connect_with_timeout(endpoint).await?;
    write_control_message(&mut stream, message, shared_secret).await?;
    let Some(received) = read_control_message(&mut stream).await? else {
        return Ok(None);
    };

    if let Some(secret) = shared_secret {
        verify_received_message(&received, secret)?;
    }

    Ok(Some(received.message))
}

async fn send_control_message_with_secret(
    endpoint: &str,
    message: &ControlMessage,
    shared_secret: Option<&str>,
) -> std::io::Result<()> {
    let mut stream = connect_with_timeout(endpoint).await?;
    write_control_message(&mut stream, message, shared_secret).await?;
    timeout(CONTROL_TIMEOUT, stream.shutdown())
        .await
        .map_err(|_| timed_out("control shutdown timed out"))?
}

async fn write_control_message(
    stream: &mut TcpStream,
    message: &ControlMessage,
    shared_secret: Option<&str>,
) -> std::io::Result<()> {
    let message_payload = serde_json::to_vec(message).map_err(std::io::Error::other)?;
    let envelope = ControlEnvelope {
        protocol_version: PROTOCOL_VERSION,
        message: message.clone(),
        auth: shared_secret.map(|secret| {
            let nonce = crate::crypto::random_hex(16);
            let mac = crate::crypto::control_mac(secret, &nonce, &message_payload);
            ControlAuth { nonce, mac }
        }),
    };
    let payload = serde_json::to_vec(&envelope).map_err(std::io::Error::other)?;
    if payload.is_empty() || payload.len() > MAX_CONTROL_MESSAGE_SIZE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message size is invalid",
        ));
    }

    let size = (payload.len() as u32).to_be_bytes();
    timeout(CONTROL_TIMEOUT, stream.write_all(&size))
        .await
        .map_err(|_| timed_out("control frame header write timed out"))??;
    timeout(CONTROL_TIMEOUT, stream.write_all(&payload))
        .await
        .map_err(|_| timed_out("control frame body write timed out"))?
}

async fn read_control_message(
    stream: &mut TcpStream,
) -> std::io::Result<Option<ReceivedControlMessage>> {
    let mut header = [0_u8; 4];
    match timeout(CONTROL_TIMEOUT, stream.read_exact(&mut header)).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err(timed_out("control frame header read timed out")),
    }

    let size = u32::from_be_bytes(header) as usize;
    if size == 0 || size > MAX_CONTROL_MESSAGE_SIZE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control frame size is invalid",
        ));
    }

    let mut payload = vec![0_u8; size];
    timeout(CONTROL_TIMEOUT, stream.read_exact(&mut payload))
        .await
        .map_err(|_| timed_out("control frame body read timed out"))??;

    let envelope = serde_json::from_slice::<ControlEnvelope>(&payload)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    if envelope.protocol_version != PROTOCOL_VERSION {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "unsupported control protocol version",
        ));
    }

    Ok(Some(ReceivedControlMessage {
        message: envelope.message,
        auth: envelope.auth,
    }))
}

fn verify_received_message(
    received: &ReceivedControlMessage,
    shared_secret: &str,
) -> std::io::Result<()> {
    let Some(auth) = &received.auth else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message authentication is missing",
        ));
    };
    let payload = serde_json::to_vec(&received.message).map_err(std::io::Error::other)?;
    let expected = crate::crypto::control_mac(shared_secret, &auth.nonce, &payload);
    if auth.mac != expected {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message authentication failed",
        ));
    }

    Ok(())
}

fn verify_received_message_with_replay(
    received: &ReceivedControlMessage,
    shared_secret: &str,
    replay_cache: &Arc<Mutex<ReplayCache>>,
) -> std::io::Result<()> {
    verify_received_message(received, shared_secret)?;

    let Some(auth) = &received.auth else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message authentication is missing",
        ));
    };
    let mut cache = replay_cache.lock().map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control replay cache is unavailable",
        )
    })?;
    if !cache.accept(auth) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message replay rejected",
        ));
    }

    Ok(())
}

async fn connect_with_timeout(endpoint: &str) -> std::io::Result<TcpStream> {
    timeout(CONTROL_TIMEOUT, TcpStream::connect(endpoint))
        .await
        .map_err(|_| timed_out("control connection timed out"))?
}

fn timed_out(message: &'static str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::TimedOut, message)
}

fn action(ok: bool, message: String) -> NetworkAction {
    NetworkAction { ok, message }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        io,
        net::{Ipv4Addr, Ipv6Addr},
        path::PathBuf,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use crate::runtime::{
        ConfirmPairingRequest, PairingPeer, PairingTarget, RuntimeStore, TrustedReconnectTarget,
        TrustedTarget,
    };
    use tokio::net::TcpListener;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn parses_ifconfig_broadcast_addresses() {
        let output = r#"
en0: flags=8863<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
        inet 192.168.1.44 netmask 0xffffff00 broadcast 192.168.1.255
eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500
        inet addr:10.0.0.12  Bcast:10.0.0.255  Mask:255.255.255.0
"#;

        let mut addresses = super::parse_ifconfig_broadcast_addresses(output);
        addresses.sort();

        assert_eq!(
            addresses,
            vec![
                "10.0.0.255".parse::<Ipv4Addr>().unwrap(),
                "192.168.1.255".parse::<Ipv4Addr>().unwrap()
            ]
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn parses_ifconfig_local_ipv4_addresses() {
        let output = r#"
lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
        inet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
        inet 192.168.1.44 netmask 0xffffff00 broadcast 192.168.1.255
eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500
        inet addr:10.0.0.12  Bcast:10.0.0.255  Mask:255.255.255.0
"#;

        let mut addresses = super::parse_ifconfig_local_ipv4_addresses(output);
        addresses.sort();

        assert_eq!(
            addresses,
            vec![
                "10.0.0.12".parse::<Ipv4Addr>().unwrap(),
                "127.0.0.1".parse::<Ipv4Addr>().unwrap(),
                "192.168.1.44".parse::<Ipv4Addr>().unwrap()
            ]
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn parses_ifconfig_local_ipv6_addresses() {
        let output = r#"
lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
        inet6 ::1 prefixlen 128
en0: flags=8863<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
        inet6 fe80::1c2d:3e4f:5a6b:7c8d%en0 prefixlen 64 secured scopeid 0x6
        inet6 fd12:3456:789a::10 prefixlen 64
eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500
        inet6 addr:2001:db8::20/64 Scope:Global
"#;

        let mut addresses = super::parse_ifconfig_local_ipv6_addresses(output);
        addresses.sort();

        assert_eq!(
            addresses,
            vec![
                "::1".parse::<Ipv6Addr>().unwrap(),
                "2001:db8::20".parse::<Ipv6Addr>().unwrap(),
                "fd12:3456:789a::10".parse::<Ipv6Addr>().unwrap(),
                "fe80::1c2d:3e4f:5a6b:7c8d".parse::<Ipv6Addr>().unwrap()
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_ipconfig_local_ipv4_addresses() {
        let output = r#"
Wireless LAN adapter Wi-Fi:

   IPv4 Address. . . . . . . . . . . : 192.168.1.44(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
"#;

        let mut addresses = super::parse_ipconfig_local_ipv4_addresses(output);
        addresses.sort();

        assert_eq!(addresses, vec![Ipv4Addr::new(192, 168, 1, 44)]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_ipconfig_local_ipv6_addresses() {
        let output = r#"
Wireless LAN adapter Wi-Fi:

   IPv6 Address. . . . . . . . . . . : fd12:3456:789a::10(Preferred)
   Link-local IPv6 Address . . . . . : fe80::1c2d:3e4f:5a6b:7c8d%12(Preferred)
"#;

        let mut addresses = super::parse_ipconfig_local_ipv6_addresses(output);
        addresses.sort();

        assert_eq!(
            addresses,
            vec![
                Ipv6Addr::from([0xfd12, 0x3456, 0x789a, 0, 0, 0, 0, 0x10]),
                Ipv6Addr::from([0xfe80, 0, 0, 0, 0x1c2d, 0x3e4f, 0x5a6b, 0x7c8d])
            ]
        );
    }

    #[test]
    fn local_control_endpoints_skip_loopback_addresses() {
        let mut addresses = [
            "127.0.0.1".parse().unwrap(),
            "192.168.1.44".parse().unwrap(),
            "169.254.10.20".parse().unwrap(),
            "203.0.113.10".parse().unwrap(),
        ]
        .into_iter()
        .filter(|address: &std::net::Ipv4Addr| !address.is_loopback() && !address.is_unspecified())
        .collect::<Vec<_>>();
        addresses.sort_by_key(|address| {
            (
                super::local_ipv4_endpoint_priority(*address),
                u32::from(*address),
            )
        });
        let endpoints = addresses
            .into_iter()
            .map(|address| std::net::SocketAddrV4::new(address, 44777).to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            endpoints,
            vec![
                "192.168.1.44:44777",
                "169.254.10.20:44777",
                "203.0.113.10:44777"
            ]
        );
    }

    #[test]
    fn local_endpoint_priority_prefers_private_lan_addresses() {
        assert_eq!(
            super::local_ipv4_endpoint_priority("192.168.1.44".parse().unwrap()),
            0
        );
        assert_eq!(
            super::local_ipv4_endpoint_priority("10.0.0.5".parse().unwrap()),
            0
        );
        assert_eq!(
            super::local_ipv4_endpoint_priority("169.254.10.20".parse().unwrap()),
            1
        );
        assert_eq!(
            super::local_ipv4_endpoint_priority("203.0.113.10".parse().unwrap()),
            2
        );
    }

    #[test]
    fn local_endpoint_priority_prefers_unique_local_ipv6_addresses() {
        assert_eq!(
            super::local_ipv6_endpoint_priority("fd12:3456:789a::10".parse().unwrap()),
            0
        );
        assert_eq!(
            super::local_ipv6_endpoint_priority("fe80::1".parse().unwrap()),
            1
        );
        assert_eq!(
            super::local_ipv6_endpoint_priority("2001:db8::20".parse().unwrap()),
            2
        );
    }

    #[test]
    fn copyable_ipv6_endpoints_skip_link_local_addresses() {
        let addresses = [
            "::1",
            "fd12:3456:789a::10",
            "fe80::1",
            "ff02::1",
            "2001:db8::20",
        ]
        .into_iter()
        .map(|address| address.parse().unwrap())
        .filter(|address: &std::net::Ipv6Addr| {
            !address.is_loopback()
                && !address.is_unspecified()
                && !address.is_multicast()
                && !super::is_ipv6_unicast_link_local(*address)
        })
        .collect::<Vec<_>>();

        assert_eq!(
            addresses,
            vec![
                "fd12:3456:789a::10".parse::<Ipv6Addr>().unwrap(),
                "2001:db8::20".parse::<Ipv6Addr>().unwrap()
            ]
        );
    }

    #[tokio::test]
    async fn discovery_payload_send_reports_empty_target_set() {
        let sent_count = super::send_discovery_payload(b"{}", &[])
            .await
            .expect("empty target set should not fail");

        assert_eq!(sent_count, 0);
    }

    #[tokio::test]
    async fn input_ack_round_trip_requires_authentication() {
        let secret = "shared-secret";
        let Some(listener) = bind_localhost_listener_or_skip("input ack round trip").await else {
            return;
        };
        let endpoint = listener.local_addr().expect("listener should have address");
        let server_secret = secret.to_string();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("client should connect");
            let received = super::read_control_message(&mut stream)
                .await
                .expect("message should read")
                .expect("message should be present");
            super::verify_received_message(&received, &server_secret)
                .expect("input event should be authenticated");
            assert!(matches!(
                received.message,
                super::ControlMessage::InputEvent { .. }
            ));
            let ack = super::ControlMessage::InputAck {
                ok: true,
                message: "Accepted input event: key press r.".to_string(),
            };
            super::write_control_message(&mut stream, &ack, Some(&server_secret))
                .await
                .expect("ack should write");
        });

        let message = super::ControlMessage::InputEvent {
            source: peer("trusted-device", "trusted-fingerprint"),
            event: RuntimeStore::test_input_event(),
        };
        let response = super::send_control_message_for_response_with_secret(
            &endpoint.to_string(),
            &message,
            Some(secret),
        )
        .await
        .expect("signed input ack should verify");

        assert!(matches!(
            response,
            Some(super::ControlMessage::InputAck { ok: true, .. })
        ));
        server.await.expect("server task should finish");

        let Some(listener) = bind_localhost_listener_or_skip("unsigned input ack").await else {
            return;
        };
        let endpoint = listener.local_addr().expect("listener should have address");
        let unsigned_server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("client should connect");
            let _ = super::read_control_message(&mut stream)
                .await
                .expect("message should read");
            let ack = super::ControlMessage::InputAck {
                ok: true,
                message: "Accepted input event: key press r.".to_string(),
            };
            super::write_control_message(&mut stream, &ack, None)
                .await
                .expect("unsigned ack should write");
        });

        let error = super::send_control_message_for_response_with_secret(
            &endpoint.to_string(),
            &message,
            Some(secret),
        )
        .await
        .expect_err("unsigned input ack should be rejected");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        unsigned_server.await.expect("server task should finish");
    }

    #[tokio::test]
    async fn capture_forwarding_requires_receiver_acknowledgement() {
        crate::identity::set_test_config_dir(unique_test_dir("capture-input-ack"));

        let Some(listener) = bind_localhost_listener_or_skip("capture forwarding ack").await else {
            return;
        };
        let endpoint = listener.local_addr().expect("listener should have address");
        let store = trusted_store_for_network_test("127.0.0.1:44777");
        let target = TrustedReconnectTarget {
            device_id: "trusted-device".to_string(),
            endpoints: vec![endpoint.to_string()],
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: None,
            shared_secret: "shared-secret".to_string(),
        };
        let event = RuntimeStore::test_input_event();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("client should connect");
            let received = super::read_control_message(&mut stream)
                .await
                .expect("message should read")
                .expect("message should be present");
            super::verify_received_message(&received, "shared-secret")
                .expect("capture event should be authenticated");
            assert!(matches!(
                received.message,
                super::ControlMessage::InputEvent { .. }
            ));
            let ack = super::ControlMessage::InputAck {
                ok: false,
                message: "Rejected input event: receive control is disabled.".to_string(),
            };
            super::write_control_message(&mut stream, &ack, Some("shared-secret"))
                .await
                .expect("ack should write");
        });

        let error = super::send_input_to_target(store.clone(), target, event)
            .await
            .expect_err("receiver rejection should stop capture forwarding");
        let expected_rejection = format!(
            "Rejected input event: receive control is disabled.{}",
            super::TRUSTED_ENDPOINT_RECOVERY_HINT
        );
        assert_eq!(
            error.to_string(),
            expected_rejection
        );
        server.await.expect("server task should finish");

        let status = store.status();
        let failure = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .expect("receiver rejection should be visible on trusted device");
        assert_eq!(failure.endpoint, endpoint.to_string());
        assert_eq!(
            failure.message,
            "Rejected input event: receive control is disabled."
        );
    }

    #[test]
    fn private_guard_accepts_ipv4_mapped_ipv6_private_addresses() {
        let address = "::ffff:192.168.1.44".parse().unwrap();
        assert!(super::is_private_or_local_address(std::net::IpAddr::V6(address)));
    }

    #[test]
    fn endpoint_normalizes_ipv4_mapped_ipv6_sender() {
        let sender = "[::ffff:192.168.1.44]:50000".parse().unwrap();
        assert_eq!(super::endpoint(sender, 44777), "192.168.1.44:44777");
    }

    #[test]
    fn discovery_reply_target_uses_sender_ip_and_discovery_port() {
        let ipv4_sender = "192.168.1.44:53000".parse().unwrap();
        assert_eq!(
            super::discovery_reply_target(ipv4_sender).to_string(),
            "192.168.1.44:44778"
        );

        let ipv6_sender = std::net::SocketAddr::V6(std::net::SocketAddrV6::new(
            "fd12:3456:789a::10".parse().unwrap(),
            53000,
            0,
            7,
        ));
        assert_eq!(
            super::discovery_reply_target(ipv6_sender).to_string(),
            "[fd12:3456:789a::10%7]:44778"
        );
    }

    #[test]
    fn reconnect_pong_requires_expected_identity() {
        let target = trusted_target();
        let matching = Ok(Some(super::ControlMessage::Pong {
            source: peer("trusted-device", "trusted-fingerprint"),
            challenge: "ping-challenge".to_string(),
        }));
        let wrong_fingerprint = Ok(Some(super::ControlMessage::Pong {
            source: peer("trusted-device", "wrong-fingerprint"),
            challenge: "ping-challenge".to_string(),
        }));
        let wrong_challenge = Ok(Some(super::ControlMessage::Pong {
            source: peer("trusted-device", "trusted-fingerprint"),
            challenge: "old-challenge".to_string(),
        }));

        assert!(super::reconnect_pong_matches(
            &matching,
            &target,
            "ping-challenge"
        ));
        assert!(!super::reconnect_pong_matches(
            &wrong_fingerprint,
            &target,
            "ping-challenge"
        ));
        assert!(!super::reconnect_pong_matches(
            &wrong_challenge,
            &target,
            "ping-challenge"
        ));
    }

    #[test]
    fn reconnect_pong_requires_matching_public_key_when_stored() {
        let (_trusted_private_key, trusted_public_key) = crate::crypto::identity_keypair();
        let trusted_fingerprint =
            crate::crypto::fingerprint_from_public_key(&trusted_public_key).unwrap();
        let (_other_private_key, other_public_key) = crate::crypto::identity_keypair();
        let other_fingerprint =
            crate::crypto::fingerprint_from_public_key(&other_public_key).unwrap();
        let target = TrustedTarget {
            device_id: "trusted-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            public_key_fingerprint: trusted_fingerprint.clone(),
            public_key: Some(trusted_public_key.clone()),
            shared_secret: Some("shared-secret".to_string()),
        };
        let matching = Ok(Some(super::ControlMessage::Pong {
            source: peer_with_public_key(
                "trusted-device",
                &trusted_fingerprint,
                &trusted_public_key,
            ),
            challenge: "ping-challenge".to_string(),
        }));
        let wrong_stored_key = Ok(Some(super::ControlMessage::Pong {
            source: peer_with_public_key("trusted-device", &other_fingerprint, &other_public_key),
            challenge: "ping-challenge".to_string(),
        }));
        let mismatched_fingerprint = Ok(Some(super::ControlMessage::Pong {
            source: peer_with_public_key("trusted-device", &trusted_fingerprint, &other_public_key),
            challenge: "ping-challenge".to_string(),
        }));

        assert!(super::reconnect_pong_matches(
            &matching,
            &target,
            "ping-challenge"
        ));
        assert!(!super::reconnect_pong_matches(
            &wrong_stored_key,
            &target,
            "ping-challenge"
        ));
        assert!(!super::reconnect_pong_matches(
            &mismatched_fingerprint,
            &target,
            "ping-challenge"
        ));
    }

    #[test]
    fn reconnect_failure_message_preserves_reason() {
        assert_eq!(
            super::reconnect_failure_message(Ok(Some(super::ControlMessage::Pong {
                source: peer("trusted-device", "wrong-fingerprint"),
                challenge: "ping-challenge".to_string(),
            }))),
            "Authenticated reconnect replied with an unexpected identity."
        );
        assert_eq!(
            super::reconnect_failure_message(Ok(None)),
            "Authenticated reconnect closed before replying."
        );
        assert_eq!(
            super::reconnect_failure_message(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "control connection timed out"
            ))),
            "Authenticated reconnect check failed: control connection timed out"
        );
    }

    #[test]
    fn trusted_endpoint_recovery_message_adds_set_ip_hint_once() {
        assert_eq!(
            super::trusted_endpoint_recovery_message("Trusted device has no reachable endpoint."),
            "Trusted device has no reachable endpoint. Copy the current endpoint from the other computer, use Set IP, then Verify IP."
        );
        assert_eq!(
            super::trusted_endpoint_recovery_message(
                "Copy the current endpoint from the other computer, use Set IP, then Verify IP."
            ),
            "Copy the current endpoint from the other computer, use Set IP, then Verify IP."
        );
    }

    #[test]
    fn reconnect_retry_resets_when_endpoint_candidates_change() {
        let mut retry_state = HashMap::new();
        let first_target = trusted_reconnect_target(vec!["192.168.1.50:44777"]);
        let now = Instant::now();

        super::schedule_reconnect_retry(
            &mut retry_state,
            &first_target.device_id,
            first_target.endpoints.clone(),
        );

        assert!(super::reconnect_retry_should_wait(
            &retry_state,
            &first_target,
            now
        ));

        let changed_target = trusted_reconnect_target(vec!["192.168.1.51:44777"]);
        assert!(!super::reconnect_retry_should_wait(
            &retry_state,
            &changed_target,
            now
        ));
    }

    #[test]
    fn reconnect_retry_resets_after_wake_like_loop_delay() {
        let last_loop_at = Instant::now();

        assert!(!super::reconnect_loop_should_reset_after_delay(
            last_loop_at,
            last_loop_at + super::RECONNECT_INTERVAL
        ));
        assert!(!super::reconnect_loop_should_reset_after_delay(
            last_loop_at,
            last_loop_at + super::RECONNECT_INTERVAL + super::RECONNECT_WAKE_RESET_GRACE
        ));
        assert!(super::reconnect_loop_should_reset_after_delay(
            last_loop_at,
            last_loop_at
                + super::RECONNECT_INTERVAL
                + super::RECONNECT_WAKE_RESET_GRACE
                + Duration::from_millis(1)
        ));
    }

    #[test]
    fn private_network_guard_allows_private_and_local_addresses() {
        for address in [
            "10.0.0.5",
            "172.16.2.5",
            "192.168.1.20",
            "127.0.0.1",
            "169.254.10.20",
            "::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
        ] {
            assert!(
                super::is_private_or_local_address(address.parse().unwrap()),
                "{address} should be accepted by the private-network guard"
            );
        }
    }

    #[test]
    fn private_network_guard_rejects_public_addresses() {
        for address in ["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"] {
            assert!(
                !super::is_private_or_local_address(address.parse().unwrap()),
                "{address} should be rejected by the private-network guard"
            );
        }
    }

    fn trusted_target() -> TrustedTarget {
        TrustedTarget {
            device_id: "trusted-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: None,
            shared_secret: Some("shared-secret".to_string()),
        }
    }

    fn trusted_reconnect_target(endpoints: Vec<&str>) -> TrustedReconnectTarget {
        TrustedReconnectTarget {
            device_id: "trusted-device".to_string(),
            endpoints: endpoints.into_iter().map(str::to_string).collect(),
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: None,
            shared_secret: "shared-secret".to_string(),
        }
    }

    fn trusted_store_for_network_test(endpoint: &str) -> RuntimeStore {
        let store = RuntimeStore::load_or_init();
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let target = PairingTarget {
            device_id: "trusted-device".to_string(),
            endpoint: endpoint.to_string(),
            expected_peer: None,
        };
        let peer = peer("trusted-device", "trusted-fingerprint");
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(peer.clone()),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                local_private_key,
                local_public_key,
                remote_public_key,
                "123456".to_string(),
            )
            .expect("pairing should register");
        store
            .confirm_pairing(ConfirmPairingRequest {
                pairing_id: pairing_id.clone(),
                code: "123456".to_string(),
            })
            .expect("pairing should confirm locally");
        store
            .record_remote_pairing_approval(peer, endpoint.to_string(), "123456".to_string())
            .expect("remote approval should complete pairing");

        store
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_millis();
        std::env::temp_dir().join(format!(
            "remoteshare-network-{name}-{}-{now_ms}",
            std::process::id()
        ))
    }

    async fn bind_localhost_listener_or_skip(test_name: &str) -> Option<TcpListener> {
        match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => Some(listener),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                eprintln!("skipping {test_name}: localhost bind denied by environment");
                None
            }
            Err(error) => panic!("{test_name} listener should bind: {error}"),
        }
    }

    fn peer(device_id: &str, public_key_fingerprint: &str) -> PairingPeer {
        peer_with_public_key(device_id, public_key_fingerprint, "")
    }

    fn peer_with_public_key(
        device_id: &str,
        public_key_fingerprint: &str,
        public_key: &str,
    ) -> PairingPeer {
        PairingPeer {
            device_id: device_id.to_string(),
            name: "Trusted Windows".to_string(),
            platform: "windows".to_string(),
            control_port: 44777,
            public_key_fingerprint: public_key_fingerprint.to_string(),
            public_key: public_key.to_string(),
        }
    }
}
