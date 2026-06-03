use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    crypto,
    identity::{ComputerRole, DeviceIdentity, PersistedState, TrustedDevice},
};

const PEER_TIMEOUT_MS: u128 = 20_000;
const PEER_RETENTION_MS: u128 = 120_000;
const PAIRING_TIMEOUT_MS: u128 = 120_000;
const MAX_RECENT_TRUSTED_ENDPOINTS: usize = 4;
pub(crate) const INVALID_ENDPOINT_MESSAGE: &str =
    "Endpoint must be a valid non-local host, host:port, IPv4, or IPv6 address.";
pub(crate) const PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE: &str =
    "Private network only is enabled. Use a private LAN endpoint or turn off Private network only.";

#[derive(Debug, Clone)]
struct EndpointSanitization {
    manual_endpoint: Option<String>,
    changed: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeStore {
    state: Arc<Mutex<RuntimeState>>,
}

#[derive(Debug, Clone)]
struct RuntimeState {
    persisted: PersistedState,
    started_at_ms: u128,
    network_health: NetworkHealth,
    discovery: DiscoveryState,
    capture: CaptureState,
    discovered_peers: HashMap<String, DiscoveredPeer>,
    pending_pairings: HashMap<String, PendingPairing>,
    input_events: Vec<InputEventRecord>,
    connection_health: HashMap<String, ConnectionHealth>,
    connection_failures: HashMap<String, ConnectionFailure>,
}

#[derive(Debug, Clone)]
struct NetworkHealth {
    startup_registration: ServiceHealth,
    control_listener: ServiceHealth,
    discovery: ServiceHealth,
    last_reconnect_attempt_at_ms: Option<u128>,
}

#[derive(Debug, Clone)]
struct ServiceHealth {
    state: ServiceHealthState,
    detail: String,
    updated_at_ms: Option<u128>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceHealthState {
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
struct DiscoveryState {
    service_type: String,
    port: u16,
    discovery_port: u16,
    last_scan_at_ms: Option<u128>,
    manual_endpoint: Option<String>,
}

#[derive(Debug, Clone)]
struct DiscoveredPeer {
    announcement: PeerAnnouncement,
    endpoint: String,
    last_seen_at_ms: u128,
}

#[derive(Debug, Clone)]
struct ConnectionHealth {
    endpoint: String,
    last_seen_at_ms: u128,
    latency_ms: Option<u16>,
}

#[derive(Debug, Clone)]
struct ConnectionFailure {
    endpoint: String,
    endpoint_source: EndpointSource,
    failed_at_ms: u128,
    message: String,
}

#[derive(Debug, Clone)]
struct CaptureState {
    active: bool,
    target_device_id: Option<String>,
    started_at_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairing {
    pub id: String,
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub role: ComputerRole,
    pub endpoint: String,
    pub control_port: u16,
    pub public_key_fingerprint: String,
    pub public_key: String,
    pub local_nonce: String,
    pub remote_nonce: String,
    pub local_dh_private_key: String,
    pub local_dh_public_key: String,
    pub remote_dh_public_key: String,
    pub code: String,
    pub direction: PairingDirection,
    pub local_approved: bool,
    pub remote_approved: bool,
    pub created_at_ms: u128,
    pub expires_at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PairingDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub this_device: String,
    pub this_device_id: String,
    pub this_public_key_fingerprint: String,
    pub platform: String,
    pub mode: ComputerRole,
    pub auto_start: bool,
    pub trusted_reconnect: bool,
    pub private_network_only: bool,
    pub allow_incoming_control: bool,
    pub network_health: NetworkHealthStatus,
    pub capture: CaptureStatus,
    pub discovery: DiscoveryStatus,
    pub devices: Vec<DeviceStatus>,
    pub pending_pairings: Vec<PendingPairing>,
    pub recent_input_events: Vec<InputEventRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkHealthStatus {
    pub started_at_ms: u128,
    pub startup_registration: ServiceHealthStatus,
    pub control_listener: ServiceHealthStatus,
    pub discovery: ServiceHealthStatus,
    pub last_reconnect_attempt_at_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHealthStatus {
    pub state: ServiceHealthState,
    pub detail: String,
    pub updated_at_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub active: bool,
    pub target_device_id: Option<String>,
    pub started_at_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryStatus {
    pub service_type: String,
    pub port: u16,
    pub discovery_port: u16,
    pub last_scan_at_ms: Option<u128>,
    pub manual_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub role: ComputerRole,
    pub trusted: bool,
    pub online: bool,
    pub connection: ConnectionType,
    pub latency_ms: Option<u16>,
    pub last_seen_at_ms: Option<u128>,
    pub endpoint: Option<String>,
    pub endpoint_source: EndpointSource,
    pub public_key_fingerprint: Option<String>,
    pub allow_incoming_control: bool,
    pub input_control_ready: bool,
    pub last_connection_failure: Option<ConnectionFailureStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFailureStatus {
    pub endpoint: String,
    pub endpoint_source: EndpointSource,
    pub failed_at_ms: u128,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum ConnectionType {
    DirectLan,
    Manual,
    Relay,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointSource {
    Discovery,
    Health,
    Saved,
    Manual,
    None,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub device_id: Option<String>,
    pub endpoint: Option<String>,
    #[serde(default)]
    pub manual_endpoint: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPairingRequest {
    pub pairing_id: String,
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPairingRequest {
    pub pairing_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateRequest {
    pub role: Option<ComputerRole>,
    pub auto_start: Option<bool>,
    pub trusted_reconnect: Option<bool>,
    pub private_network_only: Option<bool>,
    pub allow_incoming_control: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceControlUpdateRequest {
    pub device_id: String,
    pub allow_incoming_control: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTrustRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEndpointUpdateRequest {
    pub device_id: String,
    pub endpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInputRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureControlRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAction {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerAnnouncement {
    pub protocol_version: u16,
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub control_port: u16,
    pub public_key_fingerprint: String,
    #[serde(default = "default_peer_role")]
    pub role: ComputerRole,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub scan_request: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPeer {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    #[serde(default = "default_peer_role")]
    pub role: ComputerRole,
    pub control_port: u16,
    pub public_key_fingerprint: String,
    #[serde(default)]
    pub public_key: String,
}

#[derive(Debug, Clone)]
pub struct PairingTarget {
    pub device_id: String,
    pub endpoint: String,
    pub expected_peer: Option<PairingPeer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InputEventKind {
    MouseMove,
    MouseClick,
    KeyPress,
    Scroll,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputEvent {
    pub kind: InputEventKind,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub button: Option<String>,
    pub key: Option<String>,
    pub delta: Option<i32>,
    #[serde(default)]
    pub pressed: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputEventRecord {
    pub direction: InputEventDirection,
    pub device_id: String,
    pub summary: String,
    pub detail: Option<String>,
    pub accepted: bool,
    pub at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InputEventDirection {
    Incoming,
    Outgoing,
}

impl RuntimeStore {
    pub fn load_or_init() -> Self {
        let mut persisted = PersistedState::load_or_create();
        let manual_endpoint = sanitize_persisted_endpoints(&mut persisted).manual_endpoint;
        let started_at_ms = now_ms();
        let startup_registration = if persisted.settings.auto_start {
            ServiceHealth {
                state: ServiceHealthState::Starting,
                detail: "Start-at-login registration pending.".to_string(),
                updated_at_ms: Some(started_at_ms),
            }
        } else {
            ServiceHealth {
                state: ServiceHealthState::Ready,
                detail: "Start at login is disabled.".to_string(),
                updated_at_ms: Some(started_at_ms),
            }
        };
        Self {
            state: Arc::new(Mutex::new(RuntimeState {
                persisted,
                started_at_ms,
                network_health: NetworkHealth {
                    startup_registration,
                    control_listener: ServiceHealth {
                        state: ServiceHealthState::Starting,
                        detail: "TCP control listener starting.".to_string(),
                        updated_at_ms: Some(started_at_ms),
                    },
                    discovery: ServiceHealth {
                        state: ServiceHealthState::Starting,
                        detail: "UDP discovery starting.".to_string(),
                        updated_at_ms: Some(started_at_ms),
                    },
                    last_reconnect_attempt_at_ms: None,
                },
                discovery: DiscoveryState {
                    service_type: "udp-broadcast".to_string(),
                    port: 44777,
                    discovery_port: 44778,
                    last_scan_at_ms: None,
                    manual_endpoint,
                },
                capture: CaptureState {
                    active: false,
                    target_device_id: None,
                    started_at_ms: None,
                },
                discovered_peers: HashMap::new(),
                pending_pairings: HashMap::new(),
                input_events: Vec::new(),
                connection_health: HashMap::new(),
                connection_failures: HashMap::new(),
            })),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        clear_capture_if_target_unusable(&mut state);
        let persisted = &state.persisted;
        RuntimeStatus {
            this_device: persisted.identity.name.clone(),
            this_device_id: persisted.identity.id.clone(),
            this_public_key_fingerprint: persisted.identity.public_key_fingerprint.clone(),
            platform: persisted.identity.platform.clone(),
            mode: persisted.settings.role.clone(),
            auto_start: persisted.settings.auto_start,
            trusted_reconnect: persisted.settings.trusted_reconnect,
            private_network_only: persisted.settings.private_network_only,
            allow_incoming_control: persisted.settings.allow_incoming_control,
            network_health: NetworkHealthStatus {
                started_at_ms: state.started_at_ms,
                startup_registration: ServiceHealthStatus {
                    state: state.network_health.startup_registration.state.clone(),
                    detail: state.network_health.startup_registration.detail.clone(),
                    updated_at_ms: state.network_health.startup_registration.updated_at_ms,
                },
                control_listener: ServiceHealthStatus {
                    state: state.network_health.control_listener.state.clone(),
                    detail: state.network_health.control_listener.detail.clone(),
                    updated_at_ms: state.network_health.control_listener.updated_at_ms,
                },
                discovery: ServiceHealthStatus {
                    state: state.network_health.discovery.state.clone(),
                    detail: state.network_health.discovery.detail.clone(),
                    updated_at_ms: state.network_health.discovery.updated_at_ms,
                },
                last_reconnect_attempt_at_ms: state.network_health.last_reconnect_attempt_at_ms,
            },
            capture: CaptureStatus {
                active: state.capture.active,
                target_device_id: state.capture.target_device_id.clone(),
                started_at_ms: state.capture.started_at_ms,
            },
            discovery: DiscoveryStatus {
                service_type: state.discovery.service_type.clone(),
                port: state.discovery.port,
                discovery_port: state.discovery.discovery_port,
                last_scan_at_ms: state.discovery.last_scan_at_ms,
                manual_endpoint: state.discovery.manual_endpoint.clone(),
            },
            devices: devices(&state),
            pending_pairings: pending_pairings(&state),
            recent_input_events: state.input_events.iter().rev().take(8).cloned().collect(),
        }
    }

    pub fn mark_discovery_scan(&self) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.discovery.last_scan_at_ms = Some(now_ms());
        NetworkAction {
            ok: true,
            message: "LAN discovery scan requested.".to_string(),
        }
    }

    pub fn record_control_listener_health(&self, ready: bool, detail: String) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.network_health.control_listener = ServiceHealth {
            state: if ready {
                ServiceHealthState::Ready
            } else {
                ServiceHealthState::Failed
            },
            detail,
            updated_at_ms: Some(now_ms()),
        };
    }

    pub fn record_discovery_health(&self, ready: bool, detail: String) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.network_health.discovery = ServiceHealth {
            state: if ready {
                ServiceHealthState::Ready
            } else {
                ServiceHealthState::Failed
            },
            detail,
            updated_at_ms: Some(now_ms()),
        };
    }

    pub fn record_reconnect_attempt(&self) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.network_health.last_reconnect_attempt_at_ms = Some(now_ms());
    }

    pub fn record_startup_registration(&self, ok: bool, detail: String) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.network_health.startup_registration = ServiceHealth {
            state: if ok {
                ServiceHealthState::Ready
            } else {
                ServiceHealthState::Failed
            },
            detail,
            updated_at_ms: Some(now_ms()),
        };
    }

    pub fn remember_manual_endpoint(&self, endpoint: String) -> Result<(), String> {
        let endpoint =
            normalized_endpoint(&endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
        let mut state = self.state.lock().expect("runtime state poisoned");
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
        }
        let mut persisted = state.persisted.clone();
        persisted.settings.manual_endpoint = Some(endpoint.clone());
        persisted
            .save()
            .map_err(|error| format!("Failed to save manual connection target: {error}"))?;
        state.persisted = persisted;
        state.discovery.manual_endpoint = Some(endpoint);
        Ok(())
    }

    pub fn clear_manual_endpoint(&self) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let mut persisted = state.persisted.clone();
        persisted.settings.manual_endpoint = None;
        match persisted.save() {
            Ok(()) => {
                state.persisted = persisted;
                state.discovery.manual_endpoint = None;
                NetworkAction {
                    ok: true,
                    message: "Manual connection target cleared.".to_string(),
                }
            }
            Err(error) => NetworkAction {
                ok: false,
                message: format!("Failed to save manual connection target: {error}"),
            },
        }
    }

    pub fn update_settings(&self, request: SettingsUpdateRequest) -> NetworkAction {
        if let Some(auto_start) = request.auto_start {
            if let Err(error) = set_autostart_enabled(auto_start) {
                self.record_startup_registration(
                    false,
                    format!("Failed to update start-at-login setting: {error}"),
                );
                return NetworkAction {
                    ok: false,
                    message: format!("Failed to update start-at-login setting: {error}"),
                };
            }

        }

        let mut state = self.state.lock().expect("runtime state poisoned");
        let next_role = request
            .role
            .clone()
            .unwrap_or_else(|| state.persisted.settings.role.clone());
        if request.allow_incoming_control == Some(true) && !next_role.can_receive_input() {
            return NetworkAction {
                ok: false,
                message: "Set this computer role to Client or Both before enabling receive."
                    .to_string(),
            };
        }

        let mut persisted = state.persisted.clone();
        if let Some(auto_start) = request.auto_start {
            persisted.settings.auto_start = auto_start;
        }
        if let Some(role) = request.role {
            persisted.settings.role = role;
        }
        if let Some(trusted_reconnect) = request.trusted_reconnect {
            persisted.settings.trusted_reconnect = trusted_reconnect;
        }
        if let Some(private_network_only) = request.private_network_only {
            persisted.settings.private_network_only = private_network_only;
        }
        if let Some(allow_incoming_control) = request.allow_incoming_control {
            persisted.settings.allow_incoming_control = allow_incoming_control;
        }
        if !persisted.settings.role.can_receive_input() {
            persisted.settings.allow_incoming_control = false;
            for device in &mut persisted.trusted_devices {
                device.allow_incoming_control = false;
            }
        }
        let clear_capture_after_save = !persisted.settings.role.can_send_input();
        let mut cleaned_endpoints = false;
        let mut connection_health = state.connection_health.clone();
        let mut connection_failures = state.connection_failures.clone();
        if persisted.settings.private_network_only {
            cleaned_endpoints = sanitize_persisted_endpoints(&mut persisted).changed;
            let private_network_only = persisted.settings.private_network_only;
            let health_count = state.connection_health.len();
            connection_health.retain(|_, health| {
                private_guard_allows_endpoint(&health.endpoint, private_network_only)
            });
            cleaned_endpoints |= connection_health.len() != health_count;
            let failure_count = state.connection_failures.len();
            connection_failures.retain(|_, failure| {
                private_guard_allows_endpoint(&failure.endpoint, private_network_only)
            });
            cleaned_endpoints |= connection_failures.len() != failure_count;
        }

        match persisted.save() {
            Ok(()) => {
                state.persisted = persisted;
                if let Some(auto_start) = request.auto_start {
                    state.network_health.startup_registration = ServiceHealth {
                        state: ServiceHealthState::Ready,
                        detail: startup_registration_success_detail(auto_start),
                        updated_at_ms: Some(now_ms()),
                    };
                }
                if state.persisted.settings.private_network_only {
                    state.discovery.manual_endpoint =
                        state.persisted.settings.manual_endpoint.clone();
                    state.connection_health = connection_health;
                    state.connection_failures = connection_failures;
                }
                if clear_capture_after_save {
                    clear_capture_state(&mut state);
                }
                clear_capture_if_target_unusable(&mut state);
                NetworkAction {
                    ok: true,
                    message: if cleaned_endpoints {
                        "Settings saved. Public or invalid saved endpoints were removed."
                            .to_string()
                    } else {
                        "Settings saved.".to_string()
                    },
                }
            }
            Err(error) => {
                if request.auto_start.is_some() {
                    state.network_health.startup_registration = ServiceHealth {
                        state: ServiceHealthState::Failed,
                        detail: format!(
                            "Start-at-login setting changed, but RemoteShare settings failed to save: {error}"
                        ),
                        updated_at_ms: Some(now_ms()),
                    };
                }
                NetworkAction {
                    ok: false,
                    message: format!("Failed to save settings: {error}"),
                }
            }
        }
    }

    pub fn update_device_control(&self, request: DeviceControlUpdateRequest) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if request.allow_incoming_control && !state.persisted.settings.role.can_receive_input() {
            return NetworkAction {
                ok: false,
                message: "Set this computer role to Client or Both before enabling receive."
                    .to_string(),
            };
        }

        let mut persisted = state.persisted.clone();
        let Some(device) = persisted
            .trusted_devices
            .iter_mut()
            .find(|device| device.id == request.device_id)
        else {
            return NetworkAction {
                ok: false,
                message: "Trusted device not found.".to_string(),
            };
        };

        if request.allow_incoming_control && device.shared_secret.is_none() {
            return NetworkAction {
                ok: false,
                message: "Re-pair this device before enabling receive.".to_string(),
            };
        }

        device.allow_incoming_control = request.allow_incoming_control;
        match persisted.save() {
            Ok(()) => {
                state.persisted = persisted;
                NetworkAction {
                    ok: true,
                    message: "Device control permission saved.".to_string(),
                }
            }
            Err(error) => NetworkAction {
                ok: false,
                message: format!("Failed to save device permission: {error}"),
            },
        }
    }

    pub fn enable_receive_for_trusted_devices(&self) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let trusted_count = state.persisted.trusted_devices.len();
        if trusted_count == 0 {
            return NetworkAction {
                ok: false,
                message: "Pair a trusted device before enabling receive.".to_string(),
            };
        }

        if !state.persisted.settings.role.can_receive_input() {
            return NetworkAction {
                ok: false,
                message: "Set this computer role to Client or Both before enabling receive."
                    .to_string(),
            };
        }

        let ready_count = state
            .persisted
            .trusted_devices
            .iter()
            .filter(|device| device.shared_secret.is_some())
            .count();
        if ready_count == 0 {
            return NetworkAction {
                ok: false,
                message: "Re-pair a trusted device before enabling receive.".to_string(),
            };
        }

        let mut persisted = state.persisted.clone();
        persisted.settings.allow_incoming_control = true;
        for device in &mut persisted.trusted_devices {
            if device.shared_secret.is_some() {
                device.allow_incoming_control = true;
            }
        }

        match persisted.save() {
            Ok(()) => {
                state.persisted = persisted;
                NetworkAction {
                    ok: true,
                    message: format!(
                        "Receive enabled for {ready_count} trusted device{}.",
                        if ready_count == 1 { "" } else { "s" }
                    ),
                }
            }
            Err(error) => NetworkAction {
                ok: false,
                message: format!("Failed to save receive permissions: {error}"),
            },
        }
    }

    pub fn forget_trusted_device(&self, request: DeviceTrustRequest) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let mut persisted = state.persisted.clone();
        let original_len = persisted.trusted_devices.len();
        persisted
            .trusted_devices
            .retain(|device| device.id != request.device_id);

        if persisted.trusted_devices.len() == original_len {
            return NetworkAction {
                ok: false,
                message: "Trusted device not found.".to_string(),
            };
        }

        match persisted.save() {
            Ok(()) => {
                state.persisted = persisted;
                state.connection_health.remove(&request.device_id);
                state.connection_failures.remove(&request.device_id);
                state
                    .input_events
                    .retain(|event| event.device_id != request.device_id);
                state
                    .pending_pairings
                    .remove(&pairing_id(&request.device_id));
                if state.capture.target_device_id.as_deref() == Some(&request.device_id) {
                    state.capture.active = false;
                    state.capture.target_device_id = None;
                    state.capture.started_at_ms = None;
                }
                NetworkAction {
                    ok: true,
                    message: "Trusted device forgotten.".to_string(),
                }
            }
            Err(error) => NetworkAction {
                ok: false,
                message: format!("Failed to save trusted devices: {error}"),
            },
        }
    }

    pub fn start_capture(&self, request: CaptureControlRequest) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        if !state.persisted.settings.role.can_send_input() {
            return NetworkAction {
                ok: false,
                message: "Set this computer role to Main or Both before starting capture.".to_string(),
            };
        }

        let Some(device) = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == request.device_id)
        else {
            return NetworkAction {
                ok: false,
                message: "Capture target must be a trusted device.".to_string(),
            };
        };
        let device_id = device.id.clone();
        let device_name = device.name.clone();
        let has_shared_secret = device.shared_secret.is_some();

        if !has_shared_secret {
            return NetworkAction {
                ok: false,
                message: "Capture target must be re-paired before input control.".to_string(),
            };
        }

        if trusted_device_endpoint(&state, device).is_none() {
            return NetworkAction {
                ok: false,
                message: "Capture target has no known endpoint.".to_string(),
            };
        }

        state.capture.active = true;
        state.capture.target_device_id = Some(device_id);
        state.capture.started_at_ms = Some(now_ms());
        NetworkAction {
            ok: true,
            message: format!("Capture target set to {device_name}."),
        }
    }

    pub fn stop_capture(&self) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.capture.active = false;
        state.capture.target_device_id = None;
        state.capture.started_at_ms = None;
        NetworkAction {
            ok: true,
            message: "Capture stopped.".to_string(),
        }
    }

    pub fn stop_capture_if_target(&self, device_id: &str) -> bool {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if !state.capture.active || state.capture.target_device_id.as_deref() != Some(device_id) {
            return false;
        }

        state.capture.active = false;
        state.capture.target_device_id = None;
        state.capture.started_at_ms = None;
        true
    }

    pub fn local_announcement(&self) -> PeerAnnouncement {
        let state = self.state.lock().expect("runtime state poisoned");
        let identity = &state.persisted.identity;
        PeerAnnouncement {
            protocol_version: 1,
            device_id: identity.id.clone(),
            name: identity.name.clone(),
            platform: identity.platform.clone(),
            control_port: state.discovery.port,
            public_key_fingerprint: identity.public_key_fingerprint.clone(),
            role: state.persisted.settings.role.clone(),
            public_key: identity.identity_public_key.clone(),
            scan_request: false,
        }
    }

    pub fn local_pairing_peer(&self) -> PairingPeer {
        let state = self.state.lock().expect("runtime state poisoned");
        pairing_peer_from_identity(
            &state.persisted.identity,
            state.persisted.settings.role.clone(),
            state.discovery.port,
        )
    }

    pub fn local_device_id(&self) -> String {
        let state = self.state.lock().expect("runtime state poisoned");
        state.persisted.identity.id.clone()
    }

    pub fn record_peer(&self, announcement: PeerAnnouncement, endpoint: String) -> bool {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        let Some(endpoint) = normalized_endpoint(&endpoint) else {
            return false;
        };
        if normalized_endpoint_port(&endpoint) != Some(announcement.control_port) {
            return false;
        }
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return false;
        }
        if announcement.device_id == state.persisted.identity.id {
            return false;
        }
        if let Some(trusted_device) = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == announcement.device_id)
        {
            if trusted_device.public_key_fingerprint != announcement.public_key_fingerprint {
                return false;
            }
            if trusted_device
                .public_key
                .as_ref()
                .is_some_and(|public_key| public_key != &announcement.public_key)
            {
                return false;
            }
        }
        if !peer_public_key_matches_fingerprint(
            &announcement.public_key,
            &announcement.public_key_fingerprint,
        ) {
            return false;
        }

        let endpoint = endpoint;
        if state
            .connection_failures
            .get(&announcement.device_id)
            .is_some_and(|failure| failure.endpoint == endpoint)
        {
            state.connection_failures.remove(&announcement.device_id);
        }

        state.discovered_peers.insert(
            announcement.device_id.clone(),
            DiscoveredPeer {
                announcement,
                endpoint,
                last_seen_at_ms: now_ms(),
            },
        );
        true
    }

    pub fn pairing_target(&self, request: PairRequest) -> Result<PairingTarget, String> {
        let manual_endpoint_requested = request.manual_endpoint;
        let endpoint = match request.endpoint {
            Some(endpoint) => Some(
                normalized_endpoint(&endpoint)
                    .ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?,
            ),
            None => None,
        };
        let mut state = self.state.lock().expect("runtime state poisoned");
        let now = now_ms();
        prune_runtime_state(&mut state, now);

        if let Some(endpoint) = endpoint {
            if request.device_id.is_none() && !manual_endpoint_requested {
                return Err("Endpoint-only pairing requests must be marked as manual pairing."
                    .to_string());
            }
            if !private_guard_allows_endpoint(
                &endpoint,
                state.persisted.settings.private_network_only,
            ) {
                return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
            }
            let expected_peer = request
                .device_id
                .as_deref()
                .and_then(|device_id| expected_pairing_peer_for_device(&state, device_id, now));
            return Ok(PairingTarget {
                device_id: request.device_id.unwrap_or_else(|| endpoint.clone()),
                endpoint,
                expected_peer,
            });
        }

        let device_id = request
            .device_id
            .ok_or_else(|| "Device or endpoint is required.".to_string())?;
        let peer = state
            .discovered_peers
            .get(&device_id)
            .filter(|peer| peer_is_fresh(peer, now))
            .ok_or_else(|| "Device is not currently discoverable.".to_string())?;

        Ok(PairingTarget {
            device_id,
            endpoint: peer.endpoint.clone(),
            expected_peer: Some(pairing_peer_from_announcement(&peer.announcement)),
        })
    }

    pub fn register_outgoing_pairing(
        &self,
        target: &PairingTarget,
        peer: Option<PairingPeer>,
        local_nonce: String,
        remote_nonce: String,
        local_dh_private_key: String,
        local_dh_public_key: String,
        remote_dh_public_key: String,
        code: String,
    ) -> Result<String, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let now = now_ms();
        prune_runtime_state(&mut state, now);
        let expected_peer = target.expected_peer.as_ref();
        let fallback = state
            .discovered_peers
            .get(&target.device_id)
            .filter(|peer| peer_is_fresh(peer, now))
            .filter(|peer| {
                expected_peer.is_none_or(|expected| {
                    pairing_peer_matches_announcement(expected, &peer.announcement)
                })
            });
        let device_id = peer
            .as_ref()
            .map(|peer| peer.device_id.clone())
            .or_else(|| expected_peer.map(|peer| peer.device_id.clone()))
            .unwrap_or_else(|| target.device_id.clone());
        if device_id == state.persisted.identity.id {
            return Err("Cannot pair this computer with itself.".to_string());
        }
        if let Some(peer) = &peer {
            if !peer_public_key_matches_fingerprint(
                &peer.public_key,
                &peer.public_key_fingerprint,
            ) {
                return Err("Pairing public key does not match fingerprint.".to_string());
            }
        }
        let id = pairing_id(&device_id);
        if let Some(existing) = state.pending_pairings.get(&id) {
            if !pairing_can_be_replaced(existing, now) {
                return Err("A pairing request for this device is already being approved. Cancel it before starting a new one.".to_string());
            }
        }
        let pairing = PendingPairing {
            id: id.clone(),
            device_id,
            name: peer
                .as_ref()
                .map(|peer| peer.name.clone())
                .or_else(|| expected_peer.map(|peer| peer.name.clone()))
                .or_else(|| fallback.map(|peer| peer.announcement.name.clone()))
                .unwrap_or_else(|| target.endpoint.clone()),
            platform: peer
                .as_ref()
                .map(|peer| peer.platform.clone())
                .or_else(|| expected_peer.map(|peer| peer.platform.clone()))
                .or_else(|| fallback.map(|peer| peer.announcement.platform.clone()))
                .unwrap_or_else(|| "unknown".to_string()),
            role: peer
                .as_ref()
                .map(|peer| peer.role.clone())
                .or_else(|| expected_peer.map(|peer| peer.role.clone()))
                .or_else(|| fallback.map(|peer| peer.announcement.role.clone()))
                .unwrap_or(ComputerRole::Client),
            endpoint: target.endpoint.clone(),
            control_port: peer.as_ref().map(|peer| peer.control_port).unwrap_or(44777),
            public_key_fingerprint: peer
                .as_ref()
                .map(|peer| peer.public_key_fingerprint.clone())
                .or_else(|| expected_peer.map(|peer| peer.public_key_fingerprint.clone()))
                .or_else(|| fallback.map(|peer| peer.announcement.public_key_fingerprint.clone()))
                .unwrap_or_else(|| target.device_id.clone()),
            public_key: peer
                .as_ref()
                .map(|peer| peer.public_key.clone())
                .or_else(|| expected_peer.map(|peer| peer.public_key.clone()))
                .or_else(|| fallback.map(|peer| peer.announcement.public_key.clone()))
                .unwrap_or_default(),
            local_nonce,
            remote_nonce,
            local_dh_private_key,
            local_dh_public_key,
            remote_dh_public_key,
            code,
            direction: PairingDirection::Outgoing,
            local_approved: false,
            remote_approved: false,
            created_at_ms: now,
            expires_at_ms: now + PAIRING_TIMEOUT_MS,
        };

        state.pending_pairings.insert(id.clone(), pairing);
        Ok(id)
    }

    pub fn register_incoming_pairing(
        &self,
        peer: PairingPeer,
        endpoint: String,
        local_nonce: String,
        remote_nonce: String,
        local_dh_private_key: String,
        local_dh_public_key: String,
        remote_dh_public_key: String,
        code: String,
    ) -> Result<String, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let now = now_ms();
        prune_runtime_state(&mut state, now);
        if peer.device_id == state.persisted.identity.id {
            return Err("Cannot pair this computer with itself.".to_string());
        }
        let endpoint =
            normalized_endpoint(&endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
        }
        if !peer_public_key_matches_fingerprint(&peer.public_key, &peer.public_key_fingerprint) {
            return Err("Pairing public key does not match fingerprint.".to_string());
        }
        let id = pairing_id(&peer.device_id);
        if let Some(existing) = state.pending_pairings.get(&id) {
            if !pairing_can_be_replaced(existing, now) {
                return Err("A pairing request for this device is already being approved. Cancel it before starting a new one.".to_string());
            }
        }
        let pairing = PendingPairing {
            id: id.clone(),
            device_id: peer.device_id,
            name: peer.name,
            platform: peer.platform,
            role: peer.role,
            endpoint,
            control_port: peer.control_port,
            public_key_fingerprint: peer.public_key_fingerprint,
            public_key: peer.public_key,
            local_nonce,
            remote_nonce,
            local_dh_private_key,
            local_dh_public_key,
            remote_dh_public_key,
            code,
            direction: PairingDirection::Incoming,
            local_approved: false,
            remote_approved: false,
            created_at_ms: now,
            expires_at_ms: now + PAIRING_TIMEOUT_MS,
        };

        state.pending_pairings.insert(id.clone(), pairing);
        Ok(id)
    }

    pub fn confirm_pairing(
        &self,
        request: ConfirmPairingRequest,
    ) -> Result<PendingPairing, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if state
            .pending_pairings
            .get(&request.pairing_id)
            .is_some_and(|pairing| pairing_is_expired(pairing, now_ms()))
        {
            state.pending_pairings.remove(&request.pairing_id);
            return Err("Pairing request expired. Start pairing again.".to_string());
        }

        let pairing = state
            .pending_pairings
            .get_mut(&request.pairing_id)
            .ok_or_else(|| "Pairing request not found.".to_string())?;

        if pairing.code != request.code.trim() {
            return Err("Pairing code does not match.".to_string());
        }

        pairing.local_approved = true;
        Ok(pairing.clone())
    }

    pub fn reset_local_pairing_approval(&self, pairing_id: &str) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if let Some(pairing) = state.pending_pairings.get_mut(pairing_id) {
            pairing.local_approved = false;
        }
    }

    pub fn pending_pairing_shared_secret(&self, pairing_id: &str) -> Result<String, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if state
            .pending_pairings
            .get(pairing_id)
            .is_some_and(|pairing| pairing_is_expired(pairing, now_ms()))
        {
            state.pending_pairings.remove(pairing_id);
            return Err("Pairing request expired. Start pairing again.".to_string());
        }

        let pairing = state
            .pending_pairings
            .get(pairing_id)
            .cloned()
            .ok_or_else(|| "Pairing request not found.".to_string())?;
        pending_pairing_shared_secret(&state.persisted.identity.id, &pairing)
    }

    pub fn remove_pending_pairing(&self, pairing_id: &str) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.pending_pairings.remove(pairing_id);
    }

    pub fn cancel_pairing(&self, request: CancelPairingRequest) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        if state.pending_pairings.remove(&request.pairing_id).is_some() {
            NetworkAction {
                ok: true,
                message: "Pairing request cancelled.".to_string(),
            }
        } else {
            NetworkAction {
                ok: false,
                message: "Pairing request not found.".to_string(),
            }
        }
    }

    pub fn record_remote_pairing_approval(
        &self,
        peer: PairingPeer,
        endpoint: String,
        code: String,
    ) -> Result<bool, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if peer.device_id == state.persisted.identity.id {
            return Err("Cannot pair this computer with itself.".to_string());
        }
        let id = pairing_id(&peer.device_id);
        if state
            .pending_pairings
            .get(&id)
            .is_some_and(|pairing| pairing_is_expired(pairing, now_ms()))
        {
            state.pending_pairings.remove(&id);
            return Err("Pairing request expired. Start pairing again.".to_string());
        }

        let pairing = state
            .pending_pairings
            .get(&id)
            .ok_or_else(|| "Matching pairing request not found.".to_string())?;

        if pairing.code != code {
            return Err("Accepted pairing code does not match.".to_string());
        }

        if pairing.device_id != peer.device_id {
            return Err("Accepted pairing device does not match.".to_string());
        }

        if pairing.public_key_fingerprint != peer.public_key_fingerprint {
            return Err("Accepted pairing fingerprint does not match.".to_string());
        }

        if !pairing.public_key.is_empty() && pairing.public_key != peer.public_key {
            return Err("Accepted pairing public key does not match.".to_string());
        }

        if !peer_public_key_matches_fingerprint(&peer.public_key, &peer.public_key_fingerprint) {
            return Err("Accepted pairing public key does not match fingerprint.".to_string());
        }

        let endpoint =
            normalized_endpoint(&endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
        if !private_guard_allows_endpoint(&endpoint, state.persisted.settings.private_network_only)
        {
            return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
        }

        let pairing = state
            .pending_pairings
            .get_mut(&id)
            .ok_or_else(|| "Matching pairing request not found.".to_string())?;
        pairing.name = peer.name;
        pairing.platform = peer.platform;
        pairing.control_port = peer.control_port;
        pairing.endpoint = endpoint;
        pairing.public_key = peer.public_key;
        pairing.remote_approved = true;

        match complete_pairing_if_ready(&mut state, &id) {
            Ok(completed) => Ok(completed),
            Err(error) => {
                if let Some(pairing) = state.pending_pairings.get_mut(&id) {
                    pairing.remote_approved = false;
                }
                Err(error)
            }
        }
    }

    pub fn complete_pairing_if_ready(&self, pairing_id: &str) -> Result<bool, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        complete_pairing_if_ready(&mut state, pairing_id)
    }

    pub fn trusted_reconnect_targets(&self) -> Vec<TrustedReconnectTarget> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        state
            .persisted
            .trusted_devices
            .iter()
            .filter_map(|device| {
                let shared_secret = device.shared_secret.clone()?;
                let endpoints = trusted_device_endpoints(&state, device);
                if endpoints.is_empty() {
                    return None;
                }

                Some(TrustedReconnectTarget {
                    device_id: device.id.clone(),
                    endpoints,
                    public_key_fingerprint: device.public_key_fingerprint.clone(),
                    public_key: device.public_key.clone(),
                    shared_secret,
                })
            })
            .collect()
    }

    pub fn trusted_target(&self, device_id: &str) -> Result<TrustedTarget, String> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        let device = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == device_id)
            .ok_or_else(|| "Device is not trusted.".to_string())?;
        let shared_secret = device.shared_secret.clone().ok_or_else(|| {
            "Trusted device needs to be re-paired before reconnect checks.".to_string()
        })?;
        let endpoint = trusted_device_endpoint(&state, device)
            .ok_or_else(|| "Trusted device has no reachable endpoint.".to_string())?;

        Ok(TrustedTarget {
            device_id: device.id.clone(),
            endpoint,
            public_key_fingerprint: device.public_key_fingerprint.clone(),
            public_key: device.public_key.clone(),
            shared_secret: Some(shared_secret),
        })
    }

    pub fn input_sending_enabled(&self) -> bool {
        let state = self.state.lock().expect("runtime state poisoned");
        state.persisted.settings.role.can_send_input()
    }

    pub fn trusted_target_for_endpoint(
        &self,
        device_id: &str,
        endpoint: String,
    ) -> Result<TrustedTarget, String> {
        let endpoint =
            normalized_endpoint(&endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
        }
        let device = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == device_id)
            .ok_or_else(|| "Device is not trusted.".to_string())?;
        let shared_secret = device.shared_secret.clone().ok_or_else(|| {
            "Trusted device needs to be re-paired before endpoint verification.".to_string()
        })?;

        Ok(TrustedTarget {
            device_id: device.id.clone(),
            endpoint,
            public_key_fingerprint: device.public_key_fingerprint.clone(),
            public_key: device.public_key.clone(),
            shared_secret: Some(shared_secret),
        })
    }

    pub fn active_capture_target(&self) -> Option<TrustedReconnectTarget> {
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        if !state.capture.active {
            return None;
        }

        if clear_capture_if_target_unusable(&mut state) {
            return None;
        }

        let device_id = state.capture.target_device_id.clone()?;
        let device = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == device_id)?;
        let shared_secret = device.shared_secret.clone()?;
        let endpoints = trusted_device_endpoints(&state, device);

        Some(TrustedReconnectTarget {
            device_id: device.id.clone(),
            endpoints,
            public_key_fingerprint: device.public_key_fingerprint.clone(),
            public_key: device.public_key.clone(),
            shared_secret,
        })
    }

    pub fn trusted_shared_secret(&self, device_id: &str) -> Result<Option<String>, String> {
        let state = self.state.lock().expect("runtime state poisoned");
        state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == device_id)
            .map(|device| device.shared_secret.clone())
            .ok_or_else(|| "Device is not trusted.".to_string())
    }

    pub fn trusted_identity_matches(&self, source: &PairingPeer) -> bool {
        let state = self.state.lock().expect("runtime state poisoned");
        state
            .persisted
            .trusted_devices
            .iter()
            .any(|device| trusted_device_matches_source(device, source))
    }

    pub fn trusted_reconnect_enabled(&self) -> bool {
        let state = self.state.lock().expect("runtime state poisoned");
        state.persisted.settings.trusted_reconnect
    }

    pub fn private_network_only_enabled(&self) -> bool {
        let state = self.state.lock().expect("runtime state poisoned");
        state.persisted.settings.private_network_only
    }

    #[cfg(not(debug_assertions))]
    pub fn auto_start_enabled(&self) -> bool {
        let state = self.state.lock().expect("runtime state poisoned");
        state.persisted.settings.auto_start
    }

    pub fn record_trusted_connection(
        &self,
        device_id: String,
        endpoint: String,
        latency_ms: Option<u16>,
    ) -> Result<(), String> {
        let endpoint =
            normalized_endpoint(&endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
        let mut state = self.state.lock().expect("runtime state poisoned");
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
        }
        let Some(device_index) = state
            .persisted
            .trusted_devices
            .iter()
            .position(|device| device.id == device_id)
        else {
            return Ok(());
        };

        let mut persisted = state.persisted.clone();
        let device = &mut persisted.trusted_devices[device_index];
        let changed = remember_trusted_endpoint(device, endpoint.clone());
        if changed {
            persisted
                .save()
                .map_err(|error| format!("Failed to save trusted endpoint: {error}"))?;
            state.persisted = persisted;
        }
        state.connection_failures.remove(&device_id);
        state.connection_health.insert(
            device_id.clone(),
            ConnectionHealth {
                endpoint: endpoint.clone(),
                latency_ms,
                last_seen_at_ms: now_ms(),
            },
        );
        Ok(())
    }

    pub fn record_trusted_connection_failure(
        &self,
        device_id: &str,
        endpoint: &str,
        message: &str,
    ) {
        let Some(endpoint) = normalized_endpoint(endpoint) else {
            return;
        };
        let mut state = self.state.lock().expect("runtime state poisoned");
        prune_runtime_state(&mut state, now_ms());
        if !private_guard_allows_endpoint(
            &endpoint,
            state.persisted.settings.private_network_only,
        ) {
            return;
        }
        if !state
            .persisted
            .trusted_devices
            .iter()
            .any(|device| device.id == device_id)
        {
            return;
        }

        let endpoint_source = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == device_id)
            .map(|device| {
                failure_endpoint_source(
                    device,
                    state.discovered_peers.get(device_id),
                    state.connection_health.get(device_id),
                    &endpoint,
                )
            })
            .unwrap_or(EndpointSource::None);

        if state
            .connection_health
            .get(device_id)
            .is_some_and(|health| health.endpoint == endpoint)
        {
            state.connection_health.remove(device_id);
        }
        state.connection_failures.insert(
            device_id.to_string(),
            ConnectionFailure {
                endpoint,
                endpoint_source,
                failed_at_ms: now_ms(),
                message: message.to_string(),
            },
        );
    }

    #[cfg(test)]
    pub fn clear_trusted_connection_failure(&self, device_id: &str) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        state.connection_failures.remove(device_id);
    }

    pub fn record_outgoing_input(&self, device_id: String, event: InputEvent) {
        let mut state = self.state.lock().expect("runtime state poisoned");
        if !state
            .persisted
            .trusted_devices
            .iter()
            .any(|device| device.id == device_id)
        {
            return;
        }

        push_input_record(
            &mut state,
            InputEventRecord {
                direction: InputEventDirection::Outgoing,
                device_id,
                summary: input_summary(&event),
                detail: None,
                accepted: true,
                at_ms: now_ms(),
            },
        );
    }

    pub fn authorize_incoming_input(&self, source: &PairingPeer) -> NetworkAction {
        let state = self.state.lock().expect("runtime state poisoned");
        let receive_role_enabled = state.persisted.settings.role.can_receive_input();
        let global_incoming_enabled = state.persisted.settings.allow_incoming_control;
        let trusted_device = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == source.device_id);
        let trusted = trusted_device.is_some();
        let trusted_identity_match = trusted_device
            .is_some_and(|device| trusted_device_matches_source(device, source));
        let device_incoming_enabled = trusted_device
            .map(|device| device.allow_incoming_control)
            .unwrap_or(false);
        let accepted = receive_role_enabled
            && global_incoming_enabled
            && device_incoming_enabled
            && trusted_identity_match;

        if !trusted {
            return NetworkAction {
                ok: false,
                message: "Rejected input event from untrusted device.".to_string(),
            };
        }

        if !trusted_identity_match {
            return NetworkAction {
                ok: false,
                message: "Rejected input event because trusted identity does not match."
                    .to_string(),
            };
        }

        if !receive_role_enabled {
            return NetworkAction {
                ok: false,
                message: "Rejected input event: this computer role is not Client or Both."
                    .to_string(),
            };
        }

        if !global_incoming_enabled {
            return NetworkAction {
                ok: false,
                message: "Rejected input event because Allow incoming control is off.".to_string(),
            };
        }

        if !device_incoming_enabled {
            return NetworkAction {
                ok: false,
                message: "Rejected input event because Receive is off for this trusted device."
                    .to_string(),
            };
        }

        if !accepted {
            return NetworkAction {
                ok: false,
                message: "Rejected input event because incoming control is disabled.".to_string(),
            };
        }

        NetworkAction {
            ok: true,
            message: "Incoming input is authorized.".to_string(),
        }
    }

    pub fn record_incoming_input(
        &self,
        source: PairingPeer,
        event: InputEvent,
        accepted: bool,
        detail: Option<String>,
    ) -> NetworkAction {
        let mut state = self.state.lock().expect("runtime state poisoned");
        let summary = input_summary(&event);

        push_input_record(
            &mut state,
            InputEventRecord {
                direction: InputEventDirection::Incoming,
                device_id: source.device_id,
                summary: summary.clone(),
                detail: detail.clone(),
                accepted,
                at_ms: now_ms(),
            },
        );

        NetworkAction {
            ok: accepted,
            message: if accepted {
                format!("Accepted input event: {summary}.")
            } else {
                detail
                    .map(|detail| format!("Rejected input event: {detail}."))
                    .unwrap_or_else(|| "Rejected input event.".to_string())
            },
        }
    }

    pub fn test_input_event() -> InputEvent {
        InputEvent {
            kind: InputEventKind::KeyPress,
            x: None,
            y: None,
            button: None,
            key: Some("r".to_string()),
            delta: None,
            pressed: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TrustedTarget {
    pub device_id: String,
    pub endpoint: String,
    pub public_key_fingerprint: String,
    pub public_key: Option<String>,
    pub shared_secret: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TrustedReconnectTarget {
    pub device_id: String,
    pub endpoints: Vec<String>,
    pub public_key_fingerprint: String,
    pub public_key: Option<String>,
    pub shared_secret: String,
}

fn devices(state: &RuntimeState) -> Vec<DeviceStatus> {
    let now = now_ms();
    let mut devices: Vec<DeviceStatus> = state
        .persisted
        .trusted_devices
        .iter()
        .map(|device| {
            device_from_trusted_with_health(
                device,
                state.discovered_peers.get(&device.id).filter(|peer| {
                    peer_is_fresh(peer, now) && peer_matches_trusted_device(peer, device)
                }),
                state
                    .connection_health
                    .get(&device.id)
                    .filter(|health| peer_is_fresh_health(health, now)),
                state.connection_failures.get(&device.id),
            )
        })
        .collect();

    for peer in state.discovered_peers.values() {
        if !peer_is_fresh(peer, now) {
            continue;
        }

        if state
            .persisted
            .trusted_devices
            .iter()
            .any(|device| device.id == peer.announcement.device_id)
        {
            continue;
        }

        devices.push(DeviceStatus {
            id: peer.announcement.device_id.clone(),
            name: peer.announcement.name.clone(),
            platform: peer.announcement.platform.clone(),
            role: peer.announcement.role.clone(),
            trusted: false,
            online: true,
            connection: ConnectionType::DirectLan,
            latency_ms: None,
            last_seen_at_ms: Some(peer.last_seen_at_ms),
            endpoint: Some(peer.endpoint.clone()),
            endpoint_source: EndpointSource::Discovery,
            public_key_fingerprint: Some(peer.announcement.public_key_fingerprint.clone()),
            allow_incoming_control: false,
            input_control_ready: false,
            last_connection_failure: None,
        });
    }

    if let Some(endpoint) = &state.discovery.manual_endpoint {
        let already_listed = devices
            .iter()
            .any(|device| device.endpoint.as_ref() == Some(endpoint));
        if !already_listed {
            devices.push(DeviceStatus {
                id: format!("manual-{endpoint}"),
                name: endpoint.clone(),
                platform: "unknown".to_string(),
                role: ComputerRole::Client,
                trusted: false,
                online: false,
                connection: ConnectionType::Manual,
                latency_ms: None,
                last_seen_at_ms: None,
                endpoint: Some(endpoint.clone()),
                endpoint_source: EndpointSource::Manual,
                public_key_fingerprint: None,
                allow_incoming_control: false,
                input_control_ready: false,
                last_connection_failure: None,
            });
        }
    }

    devices.sort_by(|left, right| {
        right
            .trusted
            .cmp(&left.trusted)
            .then_with(|| right.online.cmp(&left.online))
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.endpoint.cmp(&right.endpoint))
            .then_with(|| left.id.cmp(&right.id))
    });
    devices
}

fn pending_pairings(state: &RuntimeState) -> Vec<PendingPairing> {
    let mut pairings: Vec<PendingPairing> = state.pending_pairings.values().cloned().collect();
    pairings.sort_by(|left, right| {
        left.expires_at_ms
            .cmp(&right.expires_at_ms)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.endpoint.cmp(&right.endpoint))
            .then_with(|| left.id.cmp(&right.id))
    });
    pairings
}

fn device_from_trusted_with_health(
    device: &TrustedDevice,
    peer: Option<&DiscoveredPeer>,
    health: Option<&ConnectionHealth>,
    failure: Option<&ConnectionFailure>,
) -> DeviceStatus {
    let online = peer.is_some() || health.is_some();
    let endpoint_source = match (
        peer.is_some(),
        health.is_some(),
        device.last_endpoint.is_some(),
    ) {
        (true, _, _) => EndpointSource::Discovery,
        (false, true, _) => EndpointSource::Health,
        (false, false, true) => EndpointSource::Saved,
        (false, false, false) => EndpointSource::None,
    };
    DeviceStatus {
        id: device.id.clone(),
        name: device.name.clone(),
        platform: device.platform.clone(),
        role: peer
            .map(|peer| peer.announcement.role.clone())
            .unwrap_or_else(|| device.role.clone()),
        trusted: true,
        online,
        connection: match (peer.is_some(), health.is_some()) {
            (true, _) => ConnectionType::DirectLan,
            (false, true) => ConnectionType::Manual,
            (false, false) => ConnectionType::Offline,
        },
        latency_ms: health.and_then(|health| health.latency_ms),
        last_seen_at_ms: health
            .map(|health| health.last_seen_at_ms)
            .or_else(|| peer.map(|peer| peer.last_seen_at_ms)),
        endpoint: peer
            .map(|peer| peer.endpoint.clone())
            .or_else(|| health.map(|health| health.endpoint.clone()))
            .or_else(|| device.last_endpoint.clone()),
        endpoint_source,
        public_key_fingerprint: Some(device.public_key_fingerprint.clone()),
        allow_incoming_control: device.allow_incoming_control,
        input_control_ready: device.shared_secret.is_some(),
        last_connection_failure: failure.map(|failure| ConnectionFailureStatus {
            endpoint: failure.endpoint.clone(),
            endpoint_source: failure.endpoint_source.clone(),
            failed_at_ms: failure.failed_at_ms,
            message: failure.message.clone(),
        }),
    }
}

fn failure_endpoint_source(
    device: &TrustedDevice,
    peer: Option<&DiscoveredPeer>,
    health: Option<&ConnectionHealth>,
    endpoint: &str,
) -> EndpointSource {
    if peer.is_some_and(|peer| peer.endpoint == endpoint) {
        return EndpointSource::Discovery;
    }
    if health.is_some_and(|health| health.endpoint == endpoint) {
        return EndpointSource::Health;
    }
    if device.last_endpoint.as_deref() == Some(endpoint)
        || device
            .recent_endpoints
            .iter()
            .any(|candidate| candidate == endpoint)
    {
        return EndpointSource::Saved;
    }
    EndpointSource::None
}

fn peer_matches_trusted_device(peer: &DiscoveredPeer, device: &TrustedDevice) -> bool {
    peer.announcement.device_id == device.id
        && peer.announcement.public_key_fingerprint == device.public_key_fingerprint
        && device
            .public_key
            .as_ref()
            .is_none_or(|public_key| &peer.announcement.public_key == public_key)
}

fn default_peer_role() -> ComputerRole {
    ComputerRole::Client
}

fn trusted_device_matches_source(device: &TrustedDevice, source: &PairingPeer) -> bool {
    if device.id != source.device_id
        || device.public_key_fingerprint != source.public_key_fingerprint
    {
        return false;
    }

    if !peer_public_key_matches_fingerprint(&source.public_key, &source.public_key_fingerprint) {
        return false;
    }

    device
        .public_key
        .as_ref()
        .is_none_or(|public_key| public_key == &source.public_key)
}

fn peer_public_key_matches_fingerprint(public_key: &str, fingerprint: &str) -> bool {
    if public_key.is_empty() {
        return true;
    }

    crypto::fingerprint_from_public_key(public_key)
        .is_ok_and(|computed| computed == fingerprint)
}

fn trusted_device_endpoint(state: &RuntimeState, device: &TrustedDevice) -> Option<String> {
    trusted_device_endpoints(state, device).into_iter().next()
}

fn trusted_device_endpoints(state: &RuntimeState, device: &TrustedDevice) -> Vec<String> {
    let now = now_ms();
    let mut endpoints = Vec::new();
    let private_network_only = state.persisted.settings.private_network_only;

    if let Some(endpoint) = state
        .discovered_peers
        .get(&device.id)
        .filter(|peer| peer_is_fresh(peer, now) && peer_matches_trusted_device(peer, device))
        .map(|peer| peer.endpoint.clone())
    {
        push_unique_endpoint_if_private_guard_allows(
            &mut endpoints,
            endpoint,
            private_network_only,
        );
    }

    if let Some(endpoint) = state
        .connection_health
        .get(&device.id)
        .filter(|health| peer_is_fresh_health(health, now))
        .map(|health| health.endpoint.clone())
    {
        push_unique_endpoint_if_private_guard_allows(
            &mut endpoints,
            endpoint,
            private_network_only,
        );
    }

    for endpoint in saved_trusted_endpoints(device) {
        push_unique_endpoint_if_private_guard_allows(&mut endpoints, endpoint, private_network_only);
    }

    endpoints
}

fn push_unique_endpoint_if_private_guard_allows(
    endpoints: &mut Vec<String>,
    endpoint: String,
    private_network_only: bool,
) {
    if private_guard_allows_endpoint(&endpoint, private_network_only) {
        push_unique_endpoint(endpoints, endpoint);
    }
}

fn push_unique_endpoint(endpoints: &mut Vec<String>, endpoint: String) {
    if !endpoints.iter().any(|existing| existing == &endpoint) {
        endpoints.push(endpoint);
    }
}

fn saved_trusted_endpoints(device: &TrustedDevice) -> Vec<String> {
    let mut endpoints = Vec::new();
    if let Some(endpoint) = device.last_endpoint.clone() {
        push_unique_endpoint(&mut endpoints, endpoint);
    }

    for endpoint in &device.recent_endpoints {
        push_unique_endpoint(&mut endpoints, endpoint.clone());
    }

    endpoints
}

fn remember_trusted_endpoint(device: &mut TrustedDevice, endpoint: String) -> bool {
    let previous_last_endpoint = device.last_endpoint.clone();
    let mut changed = device.last_endpoint.as_deref() != Some(endpoint.as_str());
    device.last_endpoint = Some(endpoint.clone());

    let before = device.recent_endpoints.clone();
    device.recent_endpoints.retain(|existing| existing != &endpoint);
    device.recent_endpoints.insert(0, endpoint);
    if let Some(previous_endpoint) = previous_last_endpoint {
        if !device
            .recent_endpoints
            .iter()
            .any(|existing| existing == &previous_endpoint)
        {
            device.recent_endpoints.push(previous_endpoint);
        }
    }
    device.recent_endpoints.truncate(MAX_RECENT_TRUSTED_ENDPOINTS);

    changed |= device.recent_endpoints != before;
    changed
}

fn non_empty_public_key(public_key: String) -> Option<String> {
    if public_key.is_empty() {
        None
    } else {
        Some(public_key)
    }
}

fn pairing_peer_from_identity(
    identity: &DeviceIdentity,
    role: ComputerRole,
    control_port: u16,
) -> PairingPeer {
    PairingPeer {
        device_id: identity.id.clone(),
        name: identity.name.clone(),
        platform: identity.platform.clone(),
        role,
        control_port,
        public_key_fingerprint: identity.public_key_fingerprint.clone(),
        public_key: identity.identity_public_key.clone(),
    }
}

fn pairing_peer_from_announcement(announcement: &PeerAnnouncement) -> PairingPeer {
    PairingPeer {
        device_id: announcement.device_id.clone(),
        name: announcement.name.clone(),
        platform: announcement.platform.clone(),
        role: announcement.role.clone(),
        control_port: announcement.control_port,
        public_key_fingerprint: announcement.public_key_fingerprint.clone(),
        public_key: announcement.public_key.clone(),
    }
}

fn pairing_peer_matches_announcement(peer: &PairingPeer, announcement: &PeerAnnouncement) -> bool {
    peer.device_id == announcement.device_id
        && peer.public_key_fingerprint == announcement.public_key_fingerprint
        && (peer.public_key.is_empty() || peer.public_key == announcement.public_key)
}

fn pairing_peer_from_trusted_device(device: &TrustedDevice) -> PairingPeer {
    PairingPeer {
        device_id: device.id.clone(),
        name: device.name.clone(),
        platform: device.platform.clone(),
        role: device.role.clone(),
        control_port: 44777,
        public_key_fingerprint: device.public_key_fingerprint.clone(),
        public_key: device.public_key.clone().unwrap_or_default(),
    }
}

fn expected_pairing_peer_for_device(
    state: &RuntimeState,
    device_id: &str,
    now: u128,
) -> Option<PairingPeer> {
    state
        .discovered_peers
        .get(device_id)
        .filter(|peer| peer_is_fresh(peer, now))
        .map(|peer| pairing_peer_from_announcement(&peer.announcement))
        .or_else(|| {
            state
                .persisted
                .trusted_devices
                .iter()
                .find(|device| device.id == device_id)
                .map(pairing_peer_from_trusted_device)
        })
}

fn upsert_trusted_device(
    state: &mut PersistedState,
    peer: PairingPeer,
    endpoint: String,
    shared_secret: String,
) {
    if let Some(device) = state
        .trusted_devices
        .iter_mut()
        .find(|device| device.id == peer.device_id)
    {
        device.name = peer.name;
        device.platform = peer.platform;
        device.role = peer.role;
        device.public_key_fingerprint = peer.public_key_fingerprint;
        device.public_key = non_empty_public_key(peer.public_key);
        device.shared_secret = Some(shared_secret);
        remember_trusted_endpoint(device, endpoint);
        return;
    }

    let recent_endpoints = vec![endpoint.clone()];
    state.trusted_devices.push(TrustedDevice {
        id: peer.device_id,
        name: peer.name,
        platform: peer.platform,
        role: peer.role,
        public_key_fingerprint: peer.public_key_fingerprint,
        public_key: non_empty_public_key(peer.public_key),
        shared_secret: Some(shared_secret),
        last_endpoint: Some(endpoint),
        recent_endpoints,
        allow_incoming_control: false,
    });
}

fn complete_pairing_if_ready(state: &mut RuntimeState, pairing_id: &str) -> Result<bool, String> {
    let Some(pairing) = state.pending_pairings.get(pairing_id).cloned() else {
        return Ok(false);
    };

    if pairing_is_expired(&pairing, now_ms()) {
        state.pending_pairings.remove(pairing_id);
        return Err("Pairing request expired. Start pairing again.".to_string());
    }

    if !pairing.local_approved || !pairing.remote_approved {
        return Ok(false);
    }

    let peer = PairingPeer {
        device_id: pairing.device_id.clone(),
        name: pairing.name.clone(),
        platform: pairing.platform.clone(),
        role: pairing.role.clone(),
        control_port: pairing.control_port,
        public_key_fingerprint: pairing.public_key_fingerprint.clone(),
        public_key: pairing.public_key.clone(),
    };
    let local_device_id = state.persisted.identity.id.clone();
    let shared_secret = pending_pairing_shared_secret(&local_device_id, &pairing)?;
    let endpoint =
        normalized_endpoint(&pairing.endpoint).ok_or_else(|| INVALID_ENDPOINT_MESSAGE.to_string())?;
    if !private_guard_allows_endpoint(&endpoint, state.persisted.settings.private_network_only) {
        return Err(PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE.to_string());
    }
    let device_id = peer.device_id.clone();
    let mut persisted = state.persisted.clone();
    upsert_trusted_device(&mut persisted, peer, endpoint, shared_secret);
    persisted
        .save()
        .map_err(|error| format!("Failed to save trusted device: {error}"))?;
    state.persisted = persisted;
    state.connection_health.remove(&device_id);
    state.connection_failures.remove(&device_id);
    state.pending_pairings.remove(pairing_id);
    Ok(true)
}

fn prune_runtime_state(state: &mut RuntimeState, now: u128) {
    state
        .pending_pairings
        .retain(|_, pairing| !pairing_is_expired(pairing, now));
    state
        .discovered_peers
        .retain(|_, peer| now.saturating_sub(peer.last_seen_at_ms) <= PEER_RETENTION_MS);
    state
        .connection_health
        .retain(|_, health| now.saturating_sub(health.last_seen_at_ms) <= PEER_RETENTION_MS);
    state
        .connection_failures
        .retain(|_, failure| now.saturating_sub(failure.failed_at_ms) <= PEER_RETENTION_MS);
}

fn clear_capture_state(state: &mut RuntimeState) {
    state.capture.active = false;
    state.capture.target_device_id = None;
    state.capture.started_at_ms = None;
}

fn clear_capture_if_target_unusable(state: &mut RuntimeState) -> bool {
    if !state.capture.active {
        return false;
    }

    if !state.persisted.settings.role.can_send_input() {
        clear_capture_state(state);
        return true;
    }

    let Some(device_id) = state.capture.target_device_id.as_deref() else {
        clear_capture_state(state);
        return true;
    };

    let Some(device) = state
        .persisted
        .trusted_devices
        .iter()
        .find(|device| device.id == device_id)
    else {
        clear_capture_state(state);
        return true;
    };

    if device.shared_secret.is_none() || trusted_device_endpoint(state, device).is_none() {
        clear_capture_state(state);
        return true;
    }

    false
}

fn pairing_is_expired(pairing: &PendingPairing, now: u128) -> bool {
    now >= pairing.expires_at_ms
}

fn pairing_can_be_replaced(pairing: &PendingPairing, now: u128) -> bool {
    pairing_is_expired(pairing, now) || (!pairing.local_approved && !pairing.remote_approved)
}

fn push_input_record(state: &mut RuntimeState, record: InputEventRecord) {
    state.input_events.push(record);
    if state.input_events.len() > 50 {
        let excess = state.input_events.len() - 50;
        state.input_events.drain(0..excess);
    }
}

fn input_summary(event: &InputEvent) -> String {
    match event.kind {
        InputEventKind::MouseMove => format!(
            "mouse move {},{}",
            event.x.unwrap_or_default(),
            event.y.unwrap_or_default()
        ),
        InputEventKind::MouseClick => {
            let state = input_state_label(event.pressed);
            format!(
                "mouse {state} {}",
                event.button.as_deref().unwrap_or("primary")
            )
        }
        InputEventKind::KeyPress => {
            let state = input_state_label(event.pressed);
            format!("key {state} {}", event.key.as_deref().unwrap_or("unknown"))
        }
        InputEventKind::Scroll => format!("scroll {}", event.delta.unwrap_or_default()),
    }
}

fn input_state_label(pressed: Option<bool>) -> &'static str {
    match pressed {
        Some(true) => "down",
        Some(false) => "up",
        None => "press",
    }
}

fn pairing_id(device_id: &str) -> String {
    format!("pair-{device_id}")
}

pub fn pairing_nonce() -> String {
    crypto::random_hex(16)
}

pub fn pairing_code(
    local_device_id: &str,
    remote_device_id: &str,
    local_nonce: &str,
    remote_nonce: &str,
    local_dh_public_key: &str,
    remote_dh_public_key: &str,
) -> String {
    crypto::pairing_code(
        local_device_id,
        remote_device_id,
        local_nonce,
        remote_nonce,
        local_dh_public_key,
        remote_dh_public_key,
    )
}

pub fn pairing_dh_keypair() -> (String, String) {
    crypto::x25519_keypair()
}

pub fn pairing_dh_public_key_is_well_formed(public_key: &str) -> bool {
    crypto::x25519_public_key_is_well_formed(public_key)
}

fn pending_pairing_shared_secret(
    local_device_id: &str,
    pairing: &PendingPairing,
) -> Result<String, String> {
    let dh_shared_secret =
        crypto::x25519_shared_secret(&pairing.local_dh_private_key, &pairing.remote_dh_public_key)?;
    Ok(crypto::pairing_shared_secret(
        local_device_id,
        &pairing.device_id,
        &pairing.local_nonce,
        &pairing.remote_nonce,
        &pairing.local_dh_public_key,
        &pairing.remote_dh_public_key,
        &dh_shared_secret,
    ))
}

pub(crate) fn normalized_endpoint(endpoint: &str) -> Option<String> {
    let trimmed = endpoint.trim();
    if trimmed.is_empty() {
        return None;
    }
    if hostname_is_local_only(trimmed) {
        return None;
    }

    if let Ok(address) = trimmed.parse::<std::net::SocketAddr>() {
        if address.port() == 0 || socket_address_is_local_only(address) {
            return None;
        }
        return Some(trimmed.to_string());
    }

    if let Ok(address) = trimmed.parse::<std::net::Ipv4Addr>() {
        if address.is_loopback() || address.is_unspecified() {
            return None;
        }
        return Some(format!("{trimmed}:44777"));
    }

    if let Ok(address) = trimmed.parse::<std::net::Ipv6Addr>() {
        if address.is_loopback()
            || address.is_unspecified()
            || ipv6_is_unscoped_link_local(address)
        {
            return None;
        }
        return Some(format!("[{trimmed}]:44777"));
    }

    if trimmed.starts_with('[') {
        if let Some(host) = trimmed
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            if host
                .parse::<std::net::Ipv6Addr>()
                .is_ok_and(|address| {
                    !address.is_loopback()
                        && !address.is_unspecified()
                        && !ipv6_is_unscoped_link_local(address)
                })
            {
                return Some(format!("[{host}]:44777"));
            }
            return None;
        }

        let (host, port) = trimmed.rsplit_once("]:")?;
        let host = host.strip_prefix('[')?;
        if host
            .parse::<std::net::Ipv6Addr>()
            .is_ok_and(|address| {
                !address.is_loopback()
                    && !address.is_unspecified()
                    && !ipv6_is_unscoped_link_local(address)
            })
            && valid_port(port)
        {
            return Some(trimmed.to_string());
        }
        return None;
    }

    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if valid_hostname(host) && !hostname_is_local_only(host) && valid_port(port) {
            return Some(format!("{}:{port}", canonical_hostname(host)));
        }
        return None;
    }

    valid_hostname(trimmed).then(|| format!("{}:44777", canonical_hostname(trimmed)))
}

fn socket_address_is_local_only(address: std::net::SocketAddr) -> bool {
    match address.ip() {
        std::net::IpAddr::V4(address) => address.is_loopback() || address.is_unspecified(),
        std::net::IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || ipv6_is_unscoped_link_local(address)
        }
    }
}

fn ipv6_is_unscoped_link_local(address: std::net::Ipv6Addr) -> bool {
    (address.segments()[0] & 0xffc0) == 0xfe80
}

fn private_guard_allows_endpoint(endpoint: &str, private_network_only: bool) -> bool {
    if !private_network_only {
        return true;
    }

    normalized_endpoint_ip(endpoint)
        .map(ip_address_is_private_or_local)
        .unwrap_or(true)
}

fn normalized_endpoint_ip(endpoint: &str) -> Option<std::net::IpAddr> {
    endpoint
        .parse::<std::net::SocketAddr>()
        .ok()
        .map(|address| address.ip())
}

fn normalized_endpoint_port(endpoint: &str) -> Option<u16> {
    if let Ok(address) = endpoint.parse::<std::net::SocketAddr>() {
        return Some(address.port());
    }

    if endpoint.starts_with('[') {
        return endpoint
            .rsplit_once("]:")
            .and_then(|(_, port)| port.parse::<u16>().ok());
    }

    endpoint
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

fn ip_address_is_private_or_local(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => {
            address.is_private() || address.is_loopback() || address.is_link_local()
        }
        std::net::IpAddr::V6(address) => {
            if let Some(mapped_address) = address.to_ipv4_mapped() {
                return mapped_address.is_private()
                    || mapped_address.is_loopback()
                    || mapped_address.is_link_local();
            }

            address.is_loopback()
                || ipv6_is_unique_local(address)
                || ipv6_is_unscoped_link_local(address)
        }
    }
}

fn ipv6_is_unique_local(address: std::net::Ipv6Addr) -> bool {
    (address.segments()[0] & 0xfe00) == 0xfc00
}

fn sanitize_persisted_endpoints(persisted: &mut PersistedState) -> EndpointSanitization {
    let mut changed = false;
    let manual_endpoint = persisted
        .settings
        .manual_endpoint
        .as_deref()
        .and_then(|endpoint| sanitize_endpoint_for_private_guard(
            endpoint,
            persisted.settings.private_network_only,
        ));

    if persisted.settings.manual_endpoint != manual_endpoint {
        persisted.settings.manual_endpoint = manual_endpoint.clone();
        changed = true;
    }

    for device in &mut persisted.trusted_devices {
        let last_endpoint = device
            .last_endpoint
            .as_deref()
            .and_then(|endpoint| sanitize_endpoint_for_private_guard(
                endpoint,
                persisted.settings.private_network_only,
            ));
        if device.last_endpoint != last_endpoint {
            device.last_endpoint = last_endpoint;
            changed = true;
        }

        let mut recent_endpoints = Vec::new();
        for endpoint in device
            .recent_endpoints
            .iter()
            .filter_map(|endpoint| {
                sanitize_endpoint_for_private_guard(
                    endpoint,
                    persisted.settings.private_network_only,
                )
            })
        {
            push_unique_endpoint(&mut recent_endpoints, endpoint);
        }

        if let Some(endpoint) = &device.last_endpoint {
            recent_endpoints.retain(|existing| existing != endpoint);
            recent_endpoints.insert(0, endpoint.clone());
        }
        recent_endpoints.truncate(MAX_RECENT_TRUSTED_ENDPOINTS);

        if device.recent_endpoints != recent_endpoints {
            device.recent_endpoints = recent_endpoints;
            changed = true;
        }
    }

    if changed {
        let _ = persisted.save();
    }

    EndpointSanitization {
        manual_endpoint,
        changed,
    }
}

fn sanitize_endpoint_for_private_guard(
    endpoint: &str,
    private_network_only: bool,
) -> Option<String> {
    let endpoint = normalized_endpoint(endpoint)?;
    private_guard_allows_endpoint(&endpoint, private_network_only).then_some(endpoint)
}

fn hostname_is_local_only(host: &str) -> bool {
    let normalized = canonical_hostname(host);
    normalized == "localhost" || normalized == "localhost.localdomain"
}

fn canonical_hostname(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

fn valid_hostname(host: &str) -> bool {
    let hostname = host.trim_end_matches('.');
    !hostname.is_empty()
        && host.len() <= 253
        && hostname.split('.').all(valid_hostname_label)
}

fn valid_hostname_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && label
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && label
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_port(port: &str) -> bool {
    port.parse::<u16>().is_ok_and(|port| port > 0)
}

fn peer_is_fresh(peer: &DiscoveredPeer, now_ms: u128) -> bool {
    now_ms.saturating_sub(peer.last_seen_at_ms) <= PEER_TIMEOUT_MS
}

fn peer_is_fresh_health(health: &ConnectionHealth, now_ms: u128) -> bool {
    now_ms.saturating_sub(health.last_seen_at_ms) <= PEER_TIMEOUT_MS
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn startup_registration_success_detail(auto_start: bool) -> String {
    if auto_start {
        "Start at login is registered.".to_string()
    } else {
        "Start at login is disabled.".to_string()
    }
}

fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(test)]
    {
        if TEST_SKIP_AUTOSTART_REGISTRATION
            .get_or_init(|| std::sync::atomic::AtomicBool::new(false))
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Ok(());
        }
    }

    crate::autostart::set_enabled(enabled).map_err(|error| error.to_string())
}

#[cfg(test)]
static TEST_SKIP_AUTOSTART_REGISTRATION: std::sync::OnceLock<std::sync::atomic::AtomicBool> =
    std::sync::OnceLock::new();

#[cfg(test)]
fn skip_autostart_registration_for_tests() {
    TEST_SKIP_AUTOSTART_REGISTRATION
        .get_or_init(|| std::sync::atomic::AtomicBool::new(false))
        .store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use crate::identity::{ComputerRole, TrustedDevice};

    use super::{
        input_summary, normalized_endpoint, now_ms, pairing_id, INVALID_ENDPOINT_MESSAGE,
        PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE,
    };
    use super::{
        CancelPairingRequest, ConfirmPairingRequest, InputEvent, InputEventKind,
        PairingDirection, PairingPeer, PairingTarget, PeerAnnouncement, PendingPairing,
        DiscoveredPeer, RuntimeStore, ServiceHealthState, PEER_TIMEOUT_MS,
        skip_autostart_registration_for_tests,
    };

    #[test]
    fn normalizes_host_without_port() {
        assert_eq!(
            normalized_endpoint("macbook.local"),
            Some("macbook.local:44777".to_string())
        );
        assert_eq!(
            normalized_endpoint("macbook.local."),
            Some("macbook.local:44777".to_string())
        );
        assert_eq!(
            normalized_endpoint("MacBook.LOCAL"),
            Some("macbook.local:44777".to_string())
        );
    }

    #[test]
    fn canonicalizes_host_with_port() {
        assert_eq!(
            normalized_endpoint("MacBook.LOCAL.:44778"),
            Some("macbook.local:44778".to_string())
        );
    }

    #[test]
    fn keeps_valid_host_with_port() {
        assert_eq!(
            normalized_endpoint("192.168.1.25:44777"),
            Some("192.168.1.25:44777".to_string())
        );
    }

    #[test]
    fn wraps_ipv6_without_port() {
        assert_eq!(
            normalized_endpoint("fd12:3456:789a::10"),
            Some("[fd12:3456:789a::10]:44777".to_string())
        );
    }

    #[test]
    fn wraps_bracketed_ipv6_without_port() {
        assert_eq!(
            normalized_endpoint("[fd12:3456:789a::10]"),
            Some("[fd12:3456:789a::10]:44777".to_string())
        );
    }

    #[test]
    fn keeps_bracketed_ipv6_with_port() {
        assert_eq!(
            normalized_endpoint("[fd12:3456:789a::10]:44778"),
            Some("[fd12:3456:789a::10]:44778".to_string())
        );
    }

    #[test]
    fn rejects_local_only_manual_endpoints() {
        assert_eq!(normalized_endpoint("localhost"), None);
        assert_eq!(normalized_endpoint("localhost."), None);
        assert_eq!(normalized_endpoint("localhost:44777"), None);
        assert_eq!(normalized_endpoint("localhost.:44777"), None);
        assert_eq!(normalized_endpoint("localhost.localdomain"), None);
        assert_eq!(normalized_endpoint("localhost.localdomain:44777"), None);
        assert_eq!(normalized_endpoint("127.0.0.1"), None);
        assert_eq!(normalized_endpoint("127.0.0.1:44777"), None);
        assert_eq!(normalized_endpoint("0.0.0.0"), None);
        assert_eq!(normalized_endpoint("0.0.0.0:44777"), None);
        assert_eq!(normalized_endpoint("::1"), None);
        assert_eq!(normalized_endpoint("[::1]"), None);
        assert_eq!(normalized_endpoint("[::1]:44777"), None);
        assert_eq!(normalized_endpoint("::"), None);
        assert_eq!(normalized_endpoint("[::]"), None);
        assert_eq!(normalized_endpoint("[::]:44777"), None);
    }

    #[test]
    fn rejects_unscoped_link_local_ipv6_manual_endpoints() {
        assert_eq!(normalized_endpoint("fe80::1"), None);
        assert_eq!(normalized_endpoint("[fe80::1]"), None);
        assert_eq!(normalized_endpoint("[fe80::1]:44777"), None);
    }

    #[test]
    fn rejects_invalid_ports() {
        assert_eq!(normalized_endpoint("192.168.1.25:0"), None);
        assert_eq!(normalized_endpoint("[fd12:3456:789a::10]:0"), None);
        assert_eq!(normalized_endpoint("192.168.1.25:99999"), None);
        assert_eq!(normalized_endpoint("macbook.local:not-a-port"), None);
    }

    #[test]
    fn rejects_invalid_manual_hostnames() {
        assert_eq!(normalized_endpoint("mac_book.local"), None);
        assert_eq!(normalized_endpoint("macbook..local"), None);
        assert_eq!(normalized_endpoint("-macbook.local"), None);
        assert_eq!(normalized_endpoint("macbook-.local"), None);
        assert_eq!(normalized_endpoint("macbook.local_"), None);
        assert_eq!(normalized_endpoint("macbook.local%en0"), None);
    }

    #[test]
    fn input_event_pressed_defaults_for_older_messages() {
        let event = serde_json::from_str::<InputEvent>(
            r#"{"kind":"key-press","x":null,"y":null,"button":null,"key":"a","delta":null}"#,
        )
        .expect("older input events should remain parseable");

        assert_eq!(event.pressed, None);
        assert_eq!(input_summary(&event), "key press a");
    }

    #[test]
    fn peer_announcement_scan_request_defaults_for_older_messages() {
        let announcement = serde_json::from_str::<PeerAnnouncement>(
            r#"{"protocolVersion":1,"deviceId":"remote-device","name":"Remote Windows","platform":"windows","controlPort":44777,"publicKeyFingerprint":"remote-fingerprint"}"#,
        )
        .expect("older peer announcements should remain parseable");

        assert!(!announcement.scan_request);
        assert_eq!(announcement.role, ComputerRole::Client);
    }

    #[test]
    fn local_role_setting_updates_status_and_announcement() {
        crate::identity::set_test_config_dir(unique_test_dir("local-role-setting"));

        let store = RuntimeStore::load_or_init();
        assert_eq!(store.status().mode, ComputerRole::Main);
        assert_eq!(store.local_announcement().role, ComputerRole::Main);

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: Some(ComputerRole::Both),
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(action.ok);
        assert_eq!(store.status().mode, ComputerRole::Both);
        assert_eq!(store.local_announcement().role, ComputerRole::Both);
    }

    #[test]
    fn settings_save_failure_does_not_mutate_runtime_settings() {
        let config_file = unique_test_dir("settings-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: Some(ComputerRole::Client),
            auto_start: None,
            trusted_reconnect: Some(false),
            private_network_only: Some(false),
            allow_incoming_control: Some(true),
        });

        assert!(!action.ok);
        assert!(action.message.starts_with("Failed to save settings:"));
        let status = store.status();
        assert_eq!(status.mode, ComputerRole::Main);
        assert!(status.trusted_reconnect);
        assert!(status.private_network_only);
        assert!(!status.allow_incoming_control);
    }

    #[test]
    fn auto_start_setting_updates_startup_health_after_save() {
        skip_autostart_registration_for_tests();
        crate::identity::set_test_config_dir(unique_test_dir("auto-start-save-success"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: Some(true),
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(action.ok, "{}", action.message);
        let status = store.status();
        assert!(status.auto_start);
        assert_eq!(
            status.network_health.startup_registration.state,
            ServiceHealthState::Ready
        );
        assert_eq!(
            status.network_health.startup_registration.detail,
            "Start at login is registered."
        );
    }

    #[test]
    fn auto_start_save_failure_does_not_mutate_runtime_setting_or_ready_health() {
        skip_autostart_registration_for_tests();
        let config_file = unique_test_dir("auto-start-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: Some(false),
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(!action.ok);
        assert!(action.message.starts_with("Failed to save settings:"));
        let status = store.status();
        assert!(status.auto_start);
        assert_eq!(
            status.network_health.startup_registration.state,
            ServiceHealthState::Failed
        );
        assert!(status
            .network_health
            .startup_registration
            .detail
            .starts_with("Start-at-login setting changed, but RemoteShare settings failed to save:"));
    }

    #[test]
    fn global_receive_requires_receive_role() {
        crate::identity::set_test_config_dir(unique_test_dir("global-receive-role"));

        let store = RuntimeStore::load_or_init();
        assert_eq!(store.status().mode, ComputerRole::Main);

        let rejected = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: Some(true),
        });

        assert!(!rejected.ok);
        assert_eq!(
            rejected.message,
            "Set this computer role to Client or Both before enabling receive."
        );
        assert!(!store.status().allow_incoming_control);

        let accepted = store.update_settings(super::SettingsUpdateRequest {
            role: Some(ComputerRole::Client),
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: Some(true),
        });

        assert!(accepted.ok);
        assert_eq!(store.status().mode, ComputerRole::Client);
        assert!(store.status().allow_incoming_control);
    }

    #[test]
    fn changing_to_main_clears_receive_permissions() {
        crate::identity::set_test_config_dir(unique_test_dir("main-clears-receive"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.settings.allow_incoming_control = true;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: true,
            });
        }

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: Some(ComputerRole::Main),
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(action.ok);
        let status = store.status();
        assert_eq!(status.mode, ComputerRole::Main);
        assert!(!status.allow_incoming_control);
        assert!(!status.devices[0].allow_incoming_control);
    }

    #[test]
    fn trusted_reconnect_setting_persists_after_restart() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-reconnect-setting"));

        let store = RuntimeStore::load_or_init();
        assert!(store.status().trusted_reconnect);

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: Some(false),
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(action.ok);
        assert!(!store.status().trusted_reconnect);

        let restored = RuntimeStore::load_or_init();
        assert!(!restored.status().trusted_reconnect);

        let action = restored.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: Some(true),
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(action.ok);
        let restored_again = RuntimeStore::load_or_init();
        assert!(restored_again.status().trusted_reconnect);
    }

    #[test]
    fn status_exposes_local_public_key_fingerprint_for_audit() {
        crate::identity::set_test_config_dir(unique_test_dir("status-local-fingerprint"));

        let store = RuntimeStore::load_or_init();
        let status = store.status();
        let announcement = store.local_announcement();

        assert_eq!(
            status.this_public_key_fingerprint,
            announcement.public_key_fingerprint
        );
        assert!(!status.this_public_key_fingerprint.is_empty());
    }

    #[test]
    fn record_peer_reports_only_accepted_announcements() {
        crate::identity::set_test_config_dir(unique_test_dir("record-peer-accepted"));

        let store = RuntimeStore::load_or_init();
        assert!(!store.record_peer(
            store.local_announcement(),
            "192.168.1.99:44777".to_string(),
        ));

        let (_private_key, public_key) = crate::crypto::identity_keypair();
        let public_key_fingerprint = crate::crypto::fingerprint_from_public_key(&public_key)
            .expect("generated public key should fingerprint");
        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "invalid-endpoint".to_string(),
                name: "Invalid Endpoint".to_string(),
                platform: "windows".to_string(),
                control_port: 0,
                public_key_fingerprint: public_key_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "192.168.1.70:0".to_string(),
        ));
        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "public-discovery".to_string(),
                name: "Public Discovery".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: public_key_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "8.8.8.8:44777".to_string(),
        ));
        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "bad-public-key".to_string(),
                name: "Bad Key".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "wrong-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "192.168.1.66:44777".to_string(),
        ));
        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "mismatched-port".to_string(),
                name: "Mismatched Port".to_string(),
                platform: "windows".to_string(),
                control_port: 44778,
                public_key_fingerprint: public_key_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "192.168.1.67:44777".to_string(),
        ));
        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "remote-device".to_string(),
                name: "Remote Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: public_key_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "192.168.1.50:44777".to_string(),
        ));
        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "non-default-port".to_string(),
                name: "Non Default Port".to_string(),
                platform: "windows".to_string(),
                control_port: 44888,
                public_key_fingerprint: public_key_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: public_key.clone(),
                scan_request: true,
            },
            "192.168.1.51:44888".to_string(),
        ));

        let status = store.status();
        let accepted = status
            .devices
            .iter()
            .find(|device| device.id == "remote-device")
            .expect("accepted peer should be discovered");
        assert!(accepted.online);
        assert_eq!(accepted.endpoint.as_deref(), Some("192.168.1.50:44777"));
        let non_default_port = status
            .devices
            .iter()
            .find(|device| device.id == "non-default-port")
            .expect("non-default port peer should be discovered");
        assert_eq!(non_default_port.endpoint.as_deref(), Some("192.168.1.51:44888"));
        assert!(status
            .devices
            .iter()
            .all(|device| device.id != "bad-public-key"));
        assert!(status
            .devices
            .iter()
            .all(|device| device.id != "mismatched-port"));
        assert!(status
            .devices
            .iter()
            .all(|device| device.id != "invalid-endpoint"));
        assert!(status
            .devices
            .iter()
            .all(|device| device.id != "public-discovery"));
    }

    #[test]
    fn public_discovery_requires_private_guard_off() {
        crate::identity::set_test_config_dir(unique_test_dir("public-discovery-guard-off"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);

        let (_private_key, public_key) = crate::crypto::identity_keypair();
        let public_key_fingerprint = crate::crypto::fingerprint_from_public_key(&public_key)
            .expect("generated public key should fingerprint");
        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "public-discovery".to_string(),
                name: "Public Discovery".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint,
                role: ComputerRole::Client,
                public_key,
                scan_request: true,
            },
            "8.8.8.8:44777".to_string(),
        ));

        let status = store.status();
        let accepted = status
            .devices
            .iter()
            .find(|device| device.id == "public-discovery")
            .expect("public peer should be discovered after guard is off");
        assert_eq!(accepted.endpoint.as_deref(), Some("8.8.8.8:44777"));
    }

    #[test]
    fn input_summary_includes_press_release_state() {
        let mouse_down = InputEvent {
            kind: InputEventKind::MouseClick,
            x: Some(10),
            y: Some(12),
            button: Some("primary".to_string()),
            key: None,
            delta: None,
            pressed: Some(true),
        };
        let key_up = InputEvent {
            kind: InputEventKind::KeyPress,
            x: None,
            y: None,
            button: None,
            key: Some("a".to_string()),
            delta: None,
            pressed: Some(false),
        };

        assert_eq!(input_summary(&mouse_down), "mouse down primary");
        assert_eq!(input_summary(&key_up), "key up a");
    }

    #[test]
    fn input_summary_covers_capture_smoke_event_categories() {
        let mouse_move = InputEvent {
            kind: InputEventKind::MouseMove,
            x: Some(320),
            y: Some(240),
            button: None,
            key: None,
            delta: None,
            pressed: None,
        };
        let mouse_click = InputEvent {
            kind: InputEventKind::MouseClick,
            x: Some(320),
            y: Some(240),
            button: Some("primary".to_string()),
            key: None,
            delta: None,
            pressed: Some(false),
        };
        let scroll = InputEvent {
            kind: InputEventKind::Scroll,
            x: None,
            y: None,
            button: None,
            key: None,
            delta: Some(-1),
            pressed: None,
        };
        let key = InputEvent {
            kind: InputEventKind::KeyPress,
            x: None,
            y: None,
            button: None,
            key: Some("enter".to_string()),
            delta: None,
            pressed: Some(true),
        };

        assert_eq!(input_summary(&mouse_move), "mouse move 320,240");
        assert_eq!(input_summary(&mouse_click), "mouse up primary");
        assert_eq!(input_summary(&scroll), "scroll -1");
        assert_eq!(input_summary(&key), "key down enter");
    }

    #[test]
    fn test_input_event_is_visible_key_tap() {
        let event = RuntimeStore::test_input_event();

        assert_eq!(event.kind, InputEventKind::KeyPress);
        assert_eq!(event.key.as_deref(), Some("r"));
        assert_eq!(event.delta, None);
        assert_eq!(event.pressed, None);
        assert_eq!(input_summary(&event), "key press r");
    }

    #[test]
    fn incoming_input_record_can_capture_injection_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("incoming-input-failure-record"));

        let store = RuntimeStore::load_or_init();
        let source = PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: String::new(),
        };
        let action = store.record_incoming_input(
            source,
            RuntimeStore::test_input_event(),
            false,
            Some("injection failed: missing permission".to_string()),
        );

        assert!(!action.ok);
        assert_eq!(
            action.message,
            "Rejected input event: injection failed: missing permission."
        );
        let status = store.status();
        let event = status
            .recent_input_events
            .first()
            .expect("incoming input record should be visible");
        assert!(!event.accepted);
        assert_eq!(event.summary, "key press r");
        assert_eq!(
            event.detail.as_deref(),
            Some("injection failed: missing permission")
        );
    }

    #[test]
    fn outgoing_input_record_ignores_unknown_device_without_ghost_audit() {
        crate::identity::set_test_config_dir(unique_test_dir("outgoing-input-unknown-device"));

        let store = RuntimeStore::load_or_init();
        store.record_outgoing_input("forgotten-device".to_string(), RuntimeStore::test_input_event());

        let status = store.status();
        assert!(status.recent_input_events.is_empty());
    }

    #[test]
    fn incoming_input_authorization_requires_global_and_device_permission() {
        crate::identity::set_test_config_dir(unique_test_dir("incoming-input-authorization"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }
        let source = PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: String::new(),
        };

        let global_off = store.authorize_incoming_input(&source);
        assert!(!global_off.ok);
        assert_eq!(
            global_off.message,
            "Rejected input event because Allow incoming control is off."
        );

        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.allow_incoming_control = true;
        }

        let device_off = store.authorize_incoming_input(&source);
        assert!(!device_off.ok);
        assert_eq!(
            device_off.message,
            "Rejected input event because Receive is off for this trusted device."
        );

        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices[0].allow_incoming_control = true;
        }

        assert!(store.authorize_incoming_input(&source).ok);
    }

    #[test]
    fn receive_shortcut_enables_global_and_trusted_device_permissions() {
        crate::identity::set_test_config_dir(unique_test_dir("receive-shortcut"));

        let store = RuntimeStore::load_or_init();
        let empty_action = store.enable_receive_for_trusted_devices();
        assert!(!empty_action.ok);
        assert_eq!(
            empty_action.message,
            "Pair a trusted device before enabling receive."
        );

        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device-1".to_string(),
                name: "Trusted Mac 1".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint-1".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret-1".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device-2".to_string(),
                name: "Trusted Mac 2".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint-2".to_string(),
                public_key: None,
                shared_secret: None,
                last_endpoint: Some("192.168.1.51:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.enable_receive_for_trusted_devices();
        assert!(action.ok, "{}", action.message);
        assert_eq!(action.message, "Receive enabled for 1 trusted device.");

        let status = store.status();
        assert!(status.allow_incoming_control);
        let ready = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device-1")
            .expect("ready trusted device should be listed");
        assert!(ready.allow_incoming_control);
        let stale = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device-2")
            .expect("stale trusted device should be listed");
        assert!(!stale.allow_incoming_control);
        assert!(!stale.input_control_ready);
    }

    #[test]
    fn receive_shortcut_rejects_stale_trusted_devices() {
        crate::identity::set_test_config_dir(unique_test_dir("receive-shortcut-stale"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "stale-device".to_string(),
                name: "Stale Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "stale-fingerprint".to_string(),
                public_key: None,
                shared_secret: None,
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.enable_receive_for_trusted_devices();
        assert!(!action.ok);
        assert_eq!(
            action.message,
            "Re-pair a trusted device before enabling receive."
        );

        let status = store.status();
        assert!(!status.allow_incoming_control);
        assert!(!status.devices[0].allow_incoming_control);
    }

    #[test]
    fn receive_shortcut_save_failure_does_not_toggle_runtime_permissions() {
        let config_file = unique_test_dir("receive-shortcut-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.enable_receive_for_trusted_devices();

        assert!(!action.ok);
        assert!(action
            .message
            .starts_with("Failed to save receive permissions:"));
        let status = store.status();
        assert!(!status.allow_incoming_control);
        assert!(!status.devices[0].allow_incoming_control);
    }

    #[test]
    fn device_receive_permission_requires_receive_role_and_input_secret() {
        crate::identity::set_test_config_dir(unique_test_dir("device-receive-gating"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Main;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "ready-device".to_string(),
                name: "Ready Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "ready-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("ready-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "stale-device".to_string(),
                name: "Stale Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "stale-fingerprint".to_string(),
                public_key: None,
                shared_secret: None,
                last_endpoint: Some("192.168.1.51:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let wrong_role = store.update_device_control(super::DeviceControlUpdateRequest {
            device_id: "ready-device".to_string(),
            allow_incoming_control: true,
        });
        assert!(!wrong_role.ok);
        assert_eq!(
            wrong_role.message,
            "Set this computer role to Client or Both before enabling receive."
        );

        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
        }

        let stale = store.update_device_control(super::DeviceControlUpdateRequest {
            device_id: "stale-device".to_string(),
            allow_incoming_control: true,
        });
        assert!(!stale.ok);
        assert_eq!(stale.message, "Re-pair this device before enabling receive.");

        let ready = store.update_device_control(super::DeviceControlUpdateRequest {
            device_id: "ready-device".to_string(),
            allow_incoming_control: true,
        });
        assert!(ready.ok, "{}", ready.message);

        let status = store.status();
        assert!(status
            .devices
            .iter()
            .find(|device| device.id == "ready-device")
            .expect("ready device should be listed")
            .allow_incoming_control);
        assert!(!status
            .devices
            .iter()
            .find(|device| device.id == "stale-device")
            .expect("stale device should be listed")
            .allow_incoming_control);
    }

    #[test]
    fn device_receive_save_failure_does_not_toggle_runtime_permission() {
        let config_file = unique_test_dir("device-receive-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "ready-device".to_string(),
                name: "Ready Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Main,
                public_key_fingerprint: "ready-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("ready-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.update_device_control(super::DeviceControlUpdateRequest {
            device_id: "ready-device".to_string(),
            allow_incoming_control: true,
        });

        assert!(!action.ok);
        assert!(action.message.starts_with("Failed to save device permission:"));
        assert!(!store.status().devices[0].allow_incoming_control);
    }

    #[test]
    fn incoming_input_authorization_requires_stored_public_key_match() {
        crate::identity::set_test_config_dir(unique_test_dir("incoming-input-public-key"));

        let store = RuntimeStore::load_or_init();
        let (_trusted_private_key, trusted_public_key) = crate::crypto::identity_keypair();
        let trusted_fingerprint =
            crate::crypto::fingerprint_from_public_key(&trusted_public_key)
                .expect("trusted public key should fingerprint");
        let (_other_private_key, other_public_key) = crate::crypto::identity_keypair();
        let other_fingerprint =
            crate::crypto::fingerprint_from_public_key(&other_public_key)
                .expect("other public key should fingerprint");
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.settings.allow_incoming_control = true;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: trusted_fingerprint.clone(),
                public_key: Some(trusted_public_key.clone()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: true,
            });
        }

        let matching_source = PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: trusted_fingerprint.clone(),
            public_key: trusted_public_key,
        };
        assert!(store.authorize_incoming_input(&matching_source).ok);

        let wrong_key_source = PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: trusted_fingerprint,
            public_key: other_public_key,
        };
        let action = store.authorize_incoming_input(&wrong_key_source);
        assert!(!action.ok);
        assert_eq!(
            action.message,
            "Rejected input event because trusted identity does not match."
        );

        let wrong_fingerprint_source = PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: other_fingerprint,
            public_key: String::new(),
        };
        assert!(!store.authorize_incoming_input(&wrong_fingerprint_source).ok);
    }

    #[test]
    fn remembered_manual_endpoint_is_restored_and_cleared() {
        crate::identity::set_test_config_dir(unique_test_dir("manual-endpoint"));

        let store = RuntimeStore::load_or_init();
        store
            .remember_manual_endpoint("macbook.local".to_string())
            .expect("manual endpoint should persist");
        assert_eq!(
            store.status().discovery.manual_endpoint,
            Some("macbook.local:44777".to_string())
        );

        let restored = RuntimeStore::load_or_init();
        assert_eq!(
            restored.status().discovery.manual_endpoint,
            Some("macbook.local:44777".to_string())
        );

        let action = restored.clear_manual_endpoint();
        assert!(action.ok, "{}", action.message);

        let cleared = RuntimeStore::load_or_init();
        assert_eq!(cleared.status().discovery.manual_endpoint, None);
    }

    #[test]
    fn remember_manual_endpoint_reports_persisted_success() {
        crate::identity::set_test_config_dir(unique_test_dir("remember-manual-endpoint"));

        let store = RuntimeStore::load_or_init();
        store
            .remember_manual_endpoint("192.168.1.50".to_string())
            .expect("manual endpoint should persist");

        let restored = RuntimeStore::load_or_init();
        assert_eq!(
            restored.status().discovery.manual_endpoint,
            Some("192.168.1.50:44777".to_string())
        );

        let error = restored
            .remember_manual_endpoint("localhost".to_string())
            .expect_err("invalid manual endpoint should be rejected");
        assert_eq!(error, INVALID_ENDPOINT_MESSAGE);
    }

    #[test]
    fn manual_endpoint_save_failure_does_not_update_runtime_status() {
        let config_file = unique_test_dir("manual-endpoint-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        let error = store
            .remember_manual_endpoint("192.168.1.50".to_string())
            .expect_err("save failure should reject manual endpoint persistence");

        assert!(error.starts_with("Failed to save manual connection target:"));
        assert_eq!(store.status().discovery.manual_endpoint, None);
    }

    #[test]
    fn clear_manual_endpoint_save_failure_keeps_runtime_status() {
        let config_file = unique_test_dir("clear-manual-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.discovery.manual_endpoint = Some("192.168.1.50:44777".to_string());
            state.persisted.settings.manual_endpoint = Some("192.168.1.50:44777".to_string());
        }

        let action = store.clear_manual_endpoint();

        assert!(!action.ok);
        assert!(action
            .message
            .starts_with("Failed to save manual connection target:"));
        let status = store.status();
        assert_eq!(
            status.discovery.manual_endpoint,
            Some("192.168.1.50:44777".to_string())
        );
        let state = store.state.lock().expect("runtime state poisoned");
        assert_eq!(
            state.persisted.settings.manual_endpoint.as_deref(),
            Some("192.168.1.50:44777")
        );
    }

    #[test]
    fn private_network_guard_rejects_public_manual_endpoint_literals() {
        crate::identity::set_test_config_dir(unique_test_dir("manual-public-private-guard"));

        let store = RuntimeStore::load_or_init();

        let error = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("8.8.8.8".to_string()),
                manual_endpoint: true,
            })
            .expect_err("public manual endpoint should be rejected while guard is on");
        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);

        let error = store
            .remember_manual_endpoint("8.8.8.8".to_string())
            .expect_err("public manual endpoint should not be saved while guard is on");
        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);

        let allowed = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("192.168.1.50".to_string()),
                manual_endpoint: true,
            })
            .expect("private manual endpoint should be allowed");
        assert_eq!(allowed.endpoint, "192.168.1.50:44777");
    }

    #[test]
    fn public_manual_endpoint_literals_require_private_guard_off() {
        crate::identity::set_test_config_dir(unique_test_dir("manual-public-guard-off"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);

        let target = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("8.8.8.8".to_string()),
                manual_endpoint: true,
            })
            .expect("public manual endpoint should be allowed after guard is off");
        assert_eq!(target.endpoint, "8.8.8.8:44777");
    }

    #[test]
    fn enabling_private_network_guard_clears_saved_public_endpoint_literals() {
        crate::identity::set_test_config_dir(unique_test_dir("private-guard-toggle-clears-public"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);

        store
            .remember_manual_endpoint("8.8.8.8".to_string())
            .expect("public manual endpoint should save while guard is off");
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("8.8.4.4:44777".to_string()),
                recent_endpoints: vec![
                    "1.1.1.1:44777".to_string(),
                    "192.168.1.50:44777".to_string(),
                ],
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "8.8.4.4:44777".to_string(),
                    last_seen_at_ms: now_ms(),
                    latency_ms: Some(4),
                },
            );
            state.connection_failures.insert(
                "trusted-device".to_string(),
                super::ConnectionFailure {
                    endpoint: "1.1.1.1:44777".to_string(),
                    endpoint_source: super::EndpointSource::Saved,
                    failed_at_ms: now_ms(),
                    message: "connection refused".to_string(),
                },
            );
        }

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(true),
            allow_incoming_control: None,
        });
        assert!(action.ok, "{}", action.message);
        assert_eq!(
            action.message,
            "Settings saved. Public or invalid saved endpoints were removed."
        );

        assert_eq!(store.status().discovery.manual_endpoint, None);
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
        {
            let state = store.state.lock().expect("runtime state poisoned");
            assert_eq!(state.persisted.settings.manual_endpoint, None);
            assert_eq!(state.persisted.trusted_devices[0].last_endpoint, None);
            assert_eq!(
                state.persisted.trusted_devices[0].recent_endpoints,
                vec!["192.168.1.50:44777".to_string()]
            );
            assert!(state.connection_health.is_empty());
            assert!(state.connection_failures.is_empty());
        }

        let restored = RuntimeStore::load_or_init();
        assert_eq!(restored.status().discovery.manual_endpoint, None);
        assert_eq!(
            restored.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
    }

    #[test]
    fn enabling_private_network_guard_reports_transient_public_endpoint_cleanup() {
        crate::identity::set_test_config_dir(unique_test_dir("private-guard-clears-transient"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);

        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "8.8.4.4:44777".to_string(),
                    last_seen_at_ms: now_ms(),
                    latency_ms: Some(4),
                },
            );
            state.connection_failures.insert(
                "trusted-device".to_string(),
                super::ConnectionFailure {
                    endpoint: "1.1.1.1:44777".to_string(),
                    endpoint_source: super::EndpointSource::Saved,
                    failed_at_ms: now_ms(),
                    message: "connection refused".to_string(),
                },
            );
        }

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(true),
            allow_incoming_control: None,
        });
        assert!(action.ok, "{}", action.message);
        assert_eq!(
            action.message,
            "Settings saved. Public or invalid saved endpoints were removed."
        );

        let state = store.state.lock().expect("runtime state poisoned");
        assert_eq!(
            state.persisted.trusted_devices[0].last_endpoint.as_deref(),
            Some("192.168.1.50:44777")
        );
        assert!(state.connection_health.is_empty());
        assert!(state.connection_failures.is_empty());
    }

    #[test]
    fn startup_registration_health_is_reported_in_status() {
        crate::identity::set_test_config_dir(unique_test_dir("startup-registration-health"));

        let store = RuntimeStore::load_or_init();
        let status = store.status();
        assert_eq!(
            status.network_health.startup_registration.state,
            ServiceHealthState::Starting
        );
        assert_eq!(
            status.network_health.startup_registration.detail,
            "Start-at-login registration pending."
        );

        store.record_startup_registration(false, "Start-at-login registration failed.".to_string());
        let status = store.status();
        assert_eq!(
            status.network_health.startup_registration.state,
            ServiceHealthState::Failed
        );
        assert_eq!(
            status.network_health.startup_registration.detail,
            "Start-at-login registration failed."
        );

        store.record_startup_registration(true, "Start at login is registered.".to_string());
        let status = store.status();
        assert_eq!(
            status.network_health.startup_registration.state,
            ServiceHealthState::Ready
        );
        assert_eq!(
            status.network_health.startup_registration.detail,
            "Start at login is registered."
        );
    }

    #[test]
    fn saved_endpoints_are_sanitized_on_startup() {
        crate::identity::set_test_config_dir(unique_test_dir("sanitize-saved-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.manual_endpoint = Some("localhost".to_string());
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("0.0.0.0:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.persisted.save().expect("state should save");
        }

        let restored = RuntimeStore::load_or_init();
        assert_eq!(restored.status().discovery.manual_endpoint, None);
        assert!(restored.trusted_reconnect_targets().is_empty());

        let state = restored.state.lock().expect("runtime state poisoned");
        assert_eq!(state.persisted.settings.manual_endpoint, None);
        assert_eq!(state.persisted.trusted_devices[0].last_endpoint, None);
        assert!(state.persisted.trusted_devices[0].recent_endpoints.is_empty());
    }

    #[test]
    fn unscoped_link_local_ipv6_saved_endpoints_are_sanitized_on_startup() {
        crate::identity::set_test_config_dir(unique_test_dir("sanitize-link-local-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.manual_endpoint = Some("[fe80::1]:44777".to_string());
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("fe80::2".to_string()),
                recent_endpoints: vec!["[fe80::3]:44777".to_string()],
                allow_incoming_control: false,
            });
            state.persisted.save().expect("state should save");
        }

        let restored = RuntimeStore::load_or_init();
        assert_eq!(restored.status().discovery.manual_endpoint, None);
        assert!(restored.trusted_reconnect_targets().is_empty());

        let state = restored.state.lock().expect("runtime state poisoned");
        assert_eq!(state.persisted.settings.manual_endpoint, None);
        assert_eq!(state.persisted.trusted_devices[0].last_endpoint, None);
        assert!(state.persisted.trusted_devices[0].recent_endpoints.is_empty());
    }

    #[test]
    fn saved_endpoints_are_normalized_on_startup() {
        crate::identity::set_test_config_dir(unique_test_dir("normalize-saved-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.manual_endpoint = Some("macbook.local".to_string());
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.persisted.save().expect("state should save");
        }

        let restored = RuntimeStore::load_or_init();
        assert_eq!(
            restored.status().discovery.manual_endpoint,
            Some("macbook.local:44777".to_string())
        );
        assert_eq!(
            restored.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
        let state = restored.state.lock().expect("runtime state poisoned");
        assert_eq!(
            state.persisted.trusted_devices[0].recent_endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
    }

    #[test]
    fn private_network_guard_skips_public_trusted_endpoint_candidates() {
        crate::identity::set_test_config_dir(unique_test_dir("skip-public-trusted-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("8.8.8.8:44777".to_string()),
                recent_endpoints: vec!["192.168.1.50:44777".to_string()],
                allow_incoming_control: false,
            });
        }

        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec![
                "8.8.8.8:44777".to_string(),
                "192.168.1.50:44777".to_string()
            ]
        );
    }

    #[test]
    fn saved_recent_trusted_endpoints_are_normalized_bounded_and_prioritized() {
        crate::identity::set_test_config_dir(unique_test_dir("normalize-recent-trusted-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50".to_string()),
                recent_endpoints: vec![
                    "192.168.1.51".to_string(),
                    "localhost".to_string(),
                    "192.168.1.50:44777".to_string(),
                    "192.168.1.52:44777".to_string(),
                    "192.168.1.53:44777".to_string(),
                    "192.168.1.54:44777".to_string(),
                ],
                allow_incoming_control: false,
            });
            state.persisted.save().expect("state should save");
        }

        let restored = RuntimeStore::load_or_init();
        assert_eq!(
            restored.trusted_reconnect_targets()[0].endpoints,
            vec![
                "192.168.1.50:44777".to_string(),
                "192.168.1.51:44777".to_string(),
                "192.168.1.52:44777".to_string(),
                "192.168.1.53:44777".to_string(),
            ]
        );
    }

    #[test]
    fn trusted_connection_recording_normalizes_and_rejects_invalid_endpoints() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-record-endpoint"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.50".to_string(),
                None,
            )
            .expect("trusted endpoint should normalize and save");
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );

        let error = store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "8.8.8.8:44777".to_string(),
                None,
            )
            .expect_err("public trusted endpoint should be rejected while guard is on");
        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );

        let error = store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.50:0".to_string(),
                None,
            )
            .expect_err("invalid trusted endpoint should be rejected");
        assert_eq!(error, INVALID_ENDPOINT_MESSAGE);
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
    }

    #[test]
    fn trusted_connection_save_failure_does_not_update_runtime_endpoint() {
        let config_file = unique_test_dir("trusted-record-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_failures.insert(
                "trusted-device".to_string(),
                super::ConnectionFailure {
                    endpoint: "192.168.1.10:44777".to_string(),
                    endpoint_source: super::EndpointSource::Saved,
                    failed_at_ms: now_ms(),
                    message: "old failure".to_string(),
                },
            );
        }

        let error = store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.50:44777".to_string(),
                Some(7),
            )
            .expect_err("save failure should reject trusted endpoint update");

        assert!(error.starts_with("Failed to save trusted endpoint:"));
        let state = store.state.lock().expect("runtime state poisoned");
        let device = state
            .persisted
            .trusted_devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should remain");
        assert_eq!(device.last_endpoint.as_deref(), Some("192.168.1.10:44777"));
        assert!(device.recent_endpoints.is_empty());
        assert!(state.connection_health.get("trusted-device").is_none());
        assert!(state.connection_failures.get("trusted-device").is_some());
    }

    #[test]
    fn trusted_endpoint_update_target_does_not_require_saved_endpoint() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-update-without-endpoint"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: Some("trusted-public-key".to_string()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let target = store
            .trusted_target_for_endpoint("trusted-device", "192.168.1.50".to_string())
            .expect("trusted endpoint update should not require saved endpoint");
        assert_eq!(target.device_id, "trusted-device");
        assert_eq!(target.endpoint, "192.168.1.50:44777");
        assert_eq!(target.public_key_fingerprint, "trusted-fingerprint");
        assert_eq!(target.public_key.as_deref(), Some("trusted-public-key"));
        assert_eq!(target.shared_secret.as_deref(), Some("shared-secret"));

        let error = store
            .trusted_target_for_endpoint("trusted-device", "localhost".to_string())
            .expect_err("local-only endpoint should be rejected");
        assert_eq!(error, INVALID_ENDPOINT_MESSAGE);

        let error = store
            .trusted_target_for_endpoint("trusted-device", "8.8.8.8".to_string())
            .expect_err("public endpoint should be rejected while private guard is on");
        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);

        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok);

        let public_target = store
            .trusted_target_for_endpoint("trusted-device", "8.8.8.8".to_string())
            .expect("public endpoint should be allowed after private guard is off");
        assert_eq!(public_target.endpoint, "8.8.8.8:44777");
    }

    #[test]
    fn trusted_connection_recording_ignores_unknown_device_without_ghost_health() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-record-unknown-device"));

        let store = RuntimeStore::load_or_init();
        store
            .record_trusted_connection(
                "forgotten-device".to_string(),
                "192.168.1.50:44777".to_string(),
                Some(12),
            )
            .expect("unknown device should not fail late reconnect handling");

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("forgotten-device").is_none());
        assert!(state
            .persisted
            .trusted_devices
            .iter()
            .all(|device| device.id != "forgotten-device"));
    }

    #[test]
    fn trusted_connection_failure_ignores_unknown_device_without_ghost_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-unknown-device"));

        let store = RuntimeStore::load_or_init();
        store.record_trusted_connection_failure(
            "forgotten-device",
            "192.168.1.50:44777",
            "connection timed out",
        );

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_failures.get("forgotten-device").is_none());
        assert!(state
            .persisted
            .trusted_devices
            .iter()
            .all(|device| device.id != "forgotten-device"));
    }

    #[test]
    fn trusted_connection_recording_keeps_recent_endpoint_fallbacks() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-record-recent-endpoints"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Device".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        for endpoint in [
            "192.168.1.20:44777",
            "192.168.1.21:44777",
            "192.168.1.22:44777",
            "192.168.1.23:44777",
        ] {
            store
                .record_trusted_connection(
                    "trusted-device".to_string(),
                    endpoint.to_string(),
                    Some(4),
                )
                .expect("trusted endpoint should record");
        }

        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec![
                "192.168.1.23:44777".to_string(),
                "192.168.1.22:44777".to_string(),
                "192.168.1.21:44777".to_string(),
                "192.168.1.20:44777".to_string(),
            ]
        );
    }

    #[test]
    fn local_pairing_approval_can_be_reset_after_delivery_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("pairing-approval-reset"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should register");

        store
            .confirm_pairing(ConfirmPairingRequest {
                pairing_id: pairing_id.clone(),
                code: "123456".to_string(),
            })
            .expect("pairing should confirm locally");

        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id && pairing.local_approved));

        store.reset_local_pairing_approval(&pairing_id);

        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id && !pairing.local_approved));
    }

    #[test]
    fn outgoing_pairing_rejects_local_device_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("outgoing-self-pairing"));

        let store = RuntimeStore::load_or_init();
        let local_peer = store.local_pairing_peer();
        let target = PairingTarget {
            device_id: local_peer.device_id.clone(),
            endpoint: "127.0.0.1:44777".to_string(),
            expected_peer: None,
        };

        let error = store
            .register_outgoing_pairing(
                &target,
                Some(local_peer),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect_err("self pairing should be rejected");

        assert_eq!(error, "Cannot pair this computer with itself.");
        assert!(store.status().pending_pairings.is_empty());
    }

    #[test]
    fn incoming_pairing_rejects_local_device_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("incoming-self-pairing"));

        let store = RuntimeStore::load_or_init();
        let error = store
            .register_incoming_pairing(
                store.local_pairing_peer(),
                "127.0.0.1:44777".to_string(),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect_err("self pairing should be rejected");

        assert_eq!(error, "Cannot pair this computer with itself.");
        assert!(store.status().pending_pairings.is_empty());
    }

    #[test]
    fn remote_pairing_approval_rejects_local_device_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("approval-self-pairing"));

        let store = RuntimeStore::load_or_init();
        let error = store
            .record_remote_pairing_approval(
                store.local_pairing_peer(),
                "127.0.0.1:44777".to_string(),
                "123456".to_string(),
            )
            .expect_err("self pairing approval should be rejected");

        assert_eq!(error, "Cannot pair this computer with itself.");
    }

    #[test]
    fn remote_pairing_approval_requires_matching_fingerprint() {
        crate::identity::set_test_config_dir(unique_test_dir("pairing-approval-fingerprint"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should register");

        let error = store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "wrong-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "192.168.1.50:44777".to_string(),
                "123456".to_string(),
            )
            .expect_err("mismatched fingerprint must be rejected");

        assert_eq!(error, "Accepted pairing fingerprint does not match.");
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id
                && !pairing.remote_approved
                && pairing.public_key_fingerprint == "remote-fingerprint"));
    }

    #[test]
    fn remote_pairing_approval_requires_matching_public_key() {
        crate::identity::set_test_config_dir(unique_test_dir("pairing-approval-public-key"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let (_identity_private_key, identity_public_key) = crate::crypto::identity_keypair();
        let identity_fingerprint = crate::crypto::fingerprint_from_public_key(&identity_public_key)
            .expect("identity public key should fingerprint");
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: identity_fingerprint.clone(),
                    public_key: identity_public_key.clone(),
                }),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should register");

        let error = store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: identity_fingerprint,
                    public_key: String::new(),
                },
                "192.168.1.50:44777".to_string(),
                "123456".to_string(),
            )
            .expect_err("mismatched approval public key must be rejected");

        assert_eq!(error, "Accepted pairing public key does not match.");
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id
                && !pairing.remote_approved
                && pairing.public_key == identity_public_key));
    }

    #[test]
    fn approved_pending_pairing_cannot_be_replaced() {
        crate::identity::set_test_config_dir(unique_test_dir("approved-pairing-replace"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let peer = PairingPeer {
            device_id: "remote-device".to_string(),
            name: "Remote Windows".to_string(),
            platform: "windows".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "remote-fingerprint".to_string(),
            public_key: String::new(),
        };
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(peer.clone()),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("first pairing should register");

        store
            .confirm_pairing(ConfirmPairingRequest {
                pairing_id: pairing_id.clone(),
                code: "123456".to_string(),
            })
            .expect("pairing should confirm locally");

        let error = store
            .register_outgoing_pairing(
                &target,
                Some(peer),
                "new-local-nonce".to_string(),
                "new-remote-nonce".to_string(),
                "new-local-private-key".to_string(),
                "new-local-public-key".to_string(),
                "new-remote-public-key".to_string(),
                "654321".to_string(),
            )
            .expect_err("approved pairing should not be replaced");

        assert_eq!(
            error,
            "A pairing request for this device is already being approved. Cancel it before starting a new one."
        );
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id
                && pairing.local_approved
                && pairing.code == "123456"));
    }

    #[test]
    fn registering_pairing_prunes_expired_pending_requests() {
        crate::identity::set_test_config_dir(unique_test_dir("register-prunes-expired-pairing"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.pending_pairings.insert(
                "pair-old-device".to_string(),
                expired_pairing("old-device", "111111"),
            );
        }

        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("new pairing should register");

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(!state.pending_pairings.contains_key("pair-old-device"));
        assert!(state.pending_pairings.contains_key("pair-remote-device"));
    }

    #[test]
    fn status_prunes_expired_pending_pairing_rows() {
        crate::identity::set_test_config_dir(unique_test_dir("status-prunes-expired-pairing"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.pending_pairings.insert(
                "pair-old-device".to_string(),
                expired_pairing("old-device", "111111"),
            );
        }

        assert!(store.status().pending_pairings.is_empty());

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(!state.pending_pairings.contains_key("pair-old-device"));
    }

    #[test]
    fn status_sorts_devices_deterministically() {
        crate::identity::set_test_config_dir(unique_test_dir("status-sorts-devices"));

        let store = RuntimeStore::load_or_init();
        let now = now_ms();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-zulu".to_string(),
                name: "Zulu Trusted".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-zulu-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.30:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-alpha".to_string(),
                name: "Alpha Trusted".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-alpha-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.20:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-alpha".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.20:44777".to_string(),
                    last_seen_at_ms: now,
                    latency_ms: Some(3),
                },
            );
            state.discovered_peers.insert(
                "discovered-beta".to_string(),
                DiscoveredPeer {
                    announcement: PeerAnnouncement {
                        protocol_version: 1,
                        device_id: "discovered-beta".to_string(),
                        name: "Beta Discovered".to_string(),
                        platform: "windows".to_string(),
                        control_port: 44777,
                        public_key_fingerprint: "discovered-beta-fingerprint".to_string(),
                        role: ComputerRole::Client,
                        public_key: String::new(),
                        scan_request: false,
                    },
                    endpoint: "192.168.1.40:44777".to_string(),
                    last_seen_at_ms: now,
                },
            );
            state.discovery.manual_endpoint = Some("192.168.1.50:44777".to_string());
        }

        let device_ids: Vec<String> = store
            .status()
            .devices
            .iter()
            .map(|device| device.id.clone())
            .collect();

        assert_eq!(
            device_ids,
            vec![
                "trusted-alpha".to_string(),
                "trusted-zulu".to_string(),
                "discovered-beta".to_string(),
                "manual-192.168.1.50:44777".to_string(),
            ]
        );
    }

    #[test]
    fn status_sorts_pending_pairings_deterministically() {
        crate::identity::set_test_config_dir(unique_test_dir("status-sorts-pairings"));

        let store = RuntimeStore::load_or_init();
        let now = now_ms();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            for pairing in [
                PendingPairing {
                    id: "pair-zulu-endpoint".to_string(),
                    device_id: "zulu-endpoint".to_string(),
                    name: "Shared Name".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    endpoint: "192.168.1.80:44777".to_string(),
                    control_port: 44777,
                    public_key_fingerprint: "zulu-endpoint-fingerprint".to_string(),
                    public_key: String::new(),
                    local_nonce: "local-nonce".to_string(),
                    remote_nonce: "remote-nonce".to_string(),
                    local_dh_private_key: "local-private-key".to_string(),
                    local_dh_public_key: "local-public-key".to_string(),
                    remote_dh_public_key: "remote-public-key".to_string(),
                    code: "333333".to_string(),
                    direction: PairingDirection::Outgoing,
                    local_approved: false,
                    remote_approved: false,
                    created_at_ms: now,
                    expires_at_ms: now + 30_000,
                },
                PendingPairing {
                    id: "pair-alpha-endpoint".to_string(),
                    device_id: "alpha-endpoint".to_string(),
                    name: "shared name".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    endpoint: "192.168.1.70:44777".to_string(),
                    control_port: 44777,
                    public_key_fingerprint: "alpha-endpoint-fingerprint".to_string(),
                    public_key: String::new(),
                    local_nonce: "local-nonce".to_string(),
                    remote_nonce: "remote-nonce".to_string(),
                    local_dh_private_key: "local-private-key".to_string(),
                    local_dh_public_key: "local-public-key".to_string(),
                    remote_dh_public_key: "remote-public-key".to_string(),
                    code: "222222".to_string(),
                    direction: PairingDirection::Outgoing,
                    local_approved: false,
                    remote_approved: false,
                    created_at_ms: now,
                    expires_at_ms: now + 30_000,
                },
                PendingPairing {
                    id: "pair-earliest".to_string(),
                    device_id: "earliest".to_string(),
                    name: "Zulu Earlier".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    endpoint: "192.168.1.90:44777".to_string(),
                    control_port: 44777,
                    public_key_fingerprint: "earliest-fingerprint".to_string(),
                    public_key: String::new(),
                    local_nonce: "local-nonce".to_string(),
                    remote_nonce: "remote-nonce".to_string(),
                    local_dh_private_key: "local-private-key".to_string(),
                    local_dh_public_key: "local-public-key".to_string(),
                    remote_dh_public_key: "remote-public-key".to_string(),
                    code: "111111".to_string(),
                    direction: PairingDirection::Outgoing,
                    local_approved: false,
                    remote_approved: false,
                    created_at_ms: now,
                    expires_at_ms: now + 20_000,
                },
            ] {
                state.pending_pairings.insert(pairing.id.clone(), pairing);
            }
        }

        let pairing_ids: Vec<String> = store
            .status()
            .pending_pairings
            .iter()
            .map(|pairing| pairing.id.clone())
            .collect();

        assert_eq!(
            pairing_ids,
            vec![
                "pair-earliest".to_string(),
                "pair-alpha-endpoint".to_string(),
                "pair-zulu-endpoint".to_string(),
            ]
        );
    }

    #[test]
    fn pending_pairing_shared_secret_rejects_expired_pairing() {
        crate::identity::set_test_config_dir(unique_test_dir("secret-prunes-expired-pairing"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.pending_pairings.insert(
                "pair-old-device".to_string(),
                expired_pairing("old-device", "111111"),
            );
        }

        let error = store
            .pending_pairing_shared_secret("pair-old-device")
            .expect_err("expired pairing should not expose a shared secret");
        assert_eq!(error, "Pairing request expired. Start pairing again.");

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(!state.pending_pairings.contains_key("pair-old-device"));
    }

    #[test]
    fn completed_pairing_normalizes_trusted_endpoint_before_saving() {
        crate::identity::set_test_config_dir(unique_test_dir("complete-normalizes-endpoint"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50".to_string(),
            expected_peer: None,
        };
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
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
            .expect("local approval should be recorded");
        assert!(store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "192.168.1.50".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should complete"));

        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
    }

    #[test]
    fn completed_pairing_rejects_invalid_trusted_endpoint() {
        crate::identity::set_test_config_dir(unique_test_dir("complete-rejects-endpoint"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
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
            .expect("local approval should be recorded");
        let error = store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "localhost".to_string(),
                "123456".to_string(),
            )
            .expect_err("invalid trusted endpoint should not complete pairing");

        assert_eq!(error, INVALID_ENDPOINT_MESSAGE);
        assert!(store.trusted_reconnect_targets().is_empty());
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id
                && !pairing.remote_approved
                && pairing.endpoint == "192.168.1.50:44777"));
    }

    #[test]
    fn completed_pairing_rejects_public_trusted_endpoint_while_guard_is_on() {
        crate::identity::set_test_config_dir(unique_test_dir("complete-rejects-public-endpoint"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
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
            .expect("local approval should be recorded");
        let error = store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "8.8.8.8:44777".to_string(),
                "123456".to_string(),
            )
            .expect_err("public trusted endpoint should not complete pairing while guard is on");

        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);
        assert!(store.trusted_reconnect_targets().is_empty());
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id
                && !pairing.remote_approved
                && pairing.endpoint == "192.168.1.50:44777"));
    }

    #[test]
    fn completed_pairing_save_failure_does_not_trust_device_in_memory() {
        let config_file = unique_test_dir("complete-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
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
            .expect("local approval should be recorded");
        let error = store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "192.168.1.50:44777".to_string(),
                "123456".to_string(),
            )
            .expect_err("save failure should prevent pairing completion");

        assert!(error.starts_with("Failed to save trusted device:"));
        assert!(store.trusted_reconnect_targets().is_empty());
        assert!(store
            .status()
            .pending_pairings
            .iter()
            .any(|pairing| pairing.id == pairing_id && !pairing.remote_approved));
    }

    #[test]
    fn completed_repair_clears_stale_connection_state() {
        crate::identity::set_test_config_dir(unique_test_dir("complete-repair-clears-state"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "remote-device".to_string(),
                name: "Old Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "old-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("old-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "remote-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.20:44777".to_string(),
                    last_seen_at_ms: now_ms(),
                    latency_ms: Some(4),
                },
            );
            state.connection_failures.insert(
                "remote-device".to_string(),
                super::ConnectionFailure {
                    endpoint: "192.168.1.30:44777".to_string(),
                    endpoint_source: super::EndpointSource::Saved,
                    failed_at_ms: now_ms(),
                    message: "old stale endpoint".to_string(),
                },
            );
        }

        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.60:44777".to_string(),
            expected_peer: None,
        };
        let (local_private_key, local_public_key) = crate::crypto::x25519_keypair();
        let (_remote_private_key, remote_public_key) = crate::crypto::x25519_keypair();
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
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
                pairing_id,
                code: "123456".to_string(),
            })
            .expect("local approval should be recorded");
        assert!(store
            .record_remote_pairing_approval(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "192.168.1.60:44777".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should complete"));

        assert_eq!(
            store.trusted_target("remote-device").unwrap().endpoint,
            "192.168.1.60:44777"
        );
        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("remote-device").is_none());
        assert!(state.connection_failures.get("remote-device").is_none());
        assert_eq!(
            state.persisted.trusted_devices[0].last_endpoint.as_deref(),
            Some("192.168.1.60:44777")
        );
    }

    #[test]
    fn cancelling_pairing_prunes_expired_pending_request() {
        crate::identity::set_test_config_dir(unique_test_dir("cancel-prunes-expired-pairing"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.pending_pairings.insert(
                "pair-old-device".to_string(),
                expired_pairing("old-device", "111111"),
            );
        }

        let action = store.cancel_pairing(CancelPairingRequest {
            pairing_id: "pair-old-device".to_string(),
        });

        assert!(!action.ok);
        assert_eq!(action.message, "Pairing request not found.");
        assert!(store
            .state
            .lock()
            .expect("runtime state poisoned")
            .pending_pairings
            .is_empty());
    }

    #[test]
    fn pending_pairing_can_be_removed_after_manual_endpoint_save_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("remove-pending-pairing"));

        let store = RuntimeStore::load_or_init();
        let target = PairingTarget {
            device_id: "remote-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: None,
        };
        let pairing_id = store
            .register_outgoing_pairing(
                &target,
                Some(PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                }),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should register");

        store.remove_pending_pairing(&pairing_id);

        assert!(store.status().pending_pairings.is_empty());
    }

    #[test]
    fn incoming_pending_pairing_can_be_removed_after_ack_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("remove-incoming-pairing"));

        let store = RuntimeStore::load_or_init();
        let pairing_id = store
            .register_incoming_pairing(
                PairingPeer {
                    device_id: "remote-device".to_string(),
                    name: "Remote Windows".to_string(),
                    platform: "windows".to_string(),
                    role: ComputerRole::Client,
                    control_port: 44777,
                    public_key_fingerprint: "remote-fingerprint".to_string(),
                    public_key: String::new(),
                },
                "192.168.1.50:44777".to_string(),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("incoming pairing should register");

        store.remove_pending_pairing(&pairing_id);

        assert!(store.status().pending_pairings.is_empty());
    }

    #[test]
    fn incoming_pairing_rejects_invalid_or_public_endpoint_before_ack() {
        crate::identity::set_test_config_dir(unique_test_dir("incoming-rejects-bad-endpoints"));

        let store = RuntimeStore::load_or_init();
        let peer = PairingPeer {
            device_id: "remote-device".to_string(),
            name: "Remote Windows".to_string(),
            platform: "windows".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "remote-fingerprint".to_string(),
            public_key: String::new(),
        };

        let error = store
            .register_incoming_pairing(
                peer.clone(),
                "localhost".to_string(),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect_err("invalid incoming endpoint should be rejected before ack");
        assert_eq!(error, INVALID_ENDPOINT_MESSAGE);

        let error = store
            .register_incoming_pairing(
                peer,
                "8.8.8.8:44777".to_string(),
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect_err("public incoming endpoint should be rejected before ack");
        assert_eq!(error, PUBLIC_ENDPOINT_PRIVATE_GUARD_MESSAGE);
        assert!(store.status().pending_pairings.is_empty());
    }

    #[test]
    fn discovered_pairing_target_keeps_expected_peer_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("discovered-pairing-target"));

        let store = RuntimeStore::load_or_init();
        store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "remote-device".to_string(),
                name: "Remote Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "remote-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.50:44777".to_string(),
        );

        let target = store
            .pairing_target(super::PairRequest {
                device_id: Some("remote-device".to_string()),
                endpoint: None,
                manual_endpoint: false,
            })
            .expect("discovered target should resolve");
        let expected_peer = target
            .expected_peer
            .expect("discovered target should keep expected identity");

        assert_eq!(target.device_id, "remote-device");
        assert_eq!(target.endpoint, "192.168.1.50:44777");
        assert_eq!(expected_peer.device_id, "remote-device");
        assert_eq!(expected_peer.public_key_fingerprint, "remote-fingerprint");
    }

    #[test]
    fn stale_discovered_pairing_target_is_rejected() {
        crate::identity::set_test_config_dir(unique_test_dir("stale-discovered-pairing-target"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.discovered_peers.insert(
                "remote-device".to_string(),
                DiscoveredPeer {
                    announcement: PeerAnnouncement {
                        protocol_version: 1,
                        device_id: "remote-device".to_string(),
                        name: "Remote Windows".to_string(),
                        platform: "windows".to_string(),
                        control_port: 44777,
                        public_key_fingerprint: "remote-fingerprint".to_string(),
                        role: ComputerRole::Client,
                        public_key: String::new(),
                        scan_request: false,
                    },
                    endpoint: "192.168.1.50:44777".to_string(),
                    last_seen_at_ms: now_ms().saturating_sub(PEER_TIMEOUT_MS + 1),
                },
            );
        }

        let error = store
            .pairing_target(super::PairRequest {
                device_id: Some("remote-device".to_string()),
                endpoint: None,
                manual_endpoint: false,
            })
            .expect_err("stale discovery row should not be pairable");

        assert_eq!(error, "Device is not currently discoverable.");
    }

    #[test]
    fn explicit_endpoint_pairing_target_keeps_known_device_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("explicit-known-pairing-target"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: Some("trusted-public-key".to_string()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let target = store
            .pairing_target(super::PairRequest {
                device_id: Some("trusted-device".to_string()),
                endpoint: Some("192.168.1.50".to_string()),
                manual_endpoint: false,
            })
            .expect("explicit endpoint should resolve");
        let expected_peer = target
            .expected_peer
            .expect("selected trusted device should keep expected identity");

        assert_eq!(target.device_id, "trusted-device");
        assert_eq!(target.endpoint, "192.168.1.50:44777");
        assert_eq!(expected_peer.device_id, "trusted-device");
        assert_eq!(expected_peer.public_key_fingerprint, "trusted-fingerprint");
        assert_eq!(expected_peer.public_key, "trusted-public-key");
    }

    #[test]
    fn explicit_endpoint_pairing_target_ignores_stale_discovery_identity() {
        crate::identity::set_test_config_dir(unique_test_dir("explicit-stale-discovery-target"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: Some("trusted-public-key".to_string()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.discovered_peers.insert(
                "trusted-device".to_string(),
                DiscoveredPeer {
                    announcement: PeerAnnouncement {
                        protocol_version: 1,
                        device_id: "trusted-device".to_string(),
                        name: "Stale Windows".to_string(),
                        platform: "windows".to_string(),
                        control_port: 44777,
                        public_key_fingerprint: "stale-fingerprint".to_string(),
                        role: ComputerRole::Client,
                        public_key: "stale-public-key".to_string(),
                        scan_request: false,
                    },
                    endpoint: "192.168.1.66:44777".to_string(),
                    last_seen_at_ms: now_ms().saturating_sub(PEER_TIMEOUT_MS + 1),
                },
            );
        }

        let target = store
            .pairing_target(super::PairRequest {
                device_id: Some("trusted-device".to_string()),
                endpoint: Some("192.168.1.50".to_string()),
                manual_endpoint: false,
            })
            .expect("explicit endpoint should resolve");
        let expected_peer = target
            .expected_peer
            .expect("trusted identity should be used after discovery expires");

        assert_eq!(target.endpoint, "192.168.1.50:44777");
        assert_eq!(expected_peer.device_id, "trusted-device");
        assert_eq!(expected_peer.public_key_fingerprint, "trusted-fingerprint");
        assert_eq!(expected_peer.public_key, "trusted-public-key");
    }

    #[test]
    fn outgoing_pairing_registration_prefers_expected_identity_over_stale_discovery() {
        crate::identity::set_test_config_dir(unique_test_dir("outgoing-pairing-expected-identity"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.discovered_peers.insert(
                "trusted-device".to_string(),
                DiscoveredPeer {
                    announcement: PeerAnnouncement {
                        protocol_version: 1,
                        device_id: "trusted-device".to_string(),
                        name: "Stale Windows".to_string(),
                        platform: "windows".to_string(),
                        control_port: 44777,
                        public_key_fingerprint: "stale-fingerprint".to_string(),
                        role: ComputerRole::Client,
                        public_key: "stale-public-key".to_string(),
                        scan_request: false,
                    },
                    endpoint: "192.168.1.66:44777".to_string(),
                    last_seen_at_ms: now_ms().saturating_sub(PEER_TIMEOUT_MS + 1),
                },
            );
        }

        let target = PairingTarget {
            device_id: "trusted-device".to_string(),
            endpoint: "192.168.1.50:44777".to_string(),
            expected_peer: Some(PairingPeer {
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                control_port: 44777,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: "trusted-public-key".to_string(),
            }),
        };

        store
            .register_outgoing_pairing(
                &target,
                None,
                "local-nonce".to_string(),
                "remote-nonce".to_string(),
                "local-private-key".to_string(),
                "local-public-key".to_string(),
                "remote-public-key".to_string(),
                "123456".to_string(),
            )
            .expect("pairing should register with expected identity metadata");

        let pairing = store
            .status()
            .pending_pairings
            .into_iter()
            .find(|pairing| pairing.device_id == "trusted-device")
            .expect("pending pairing should be visible");
        assert_eq!(pairing.name, "Trusted Windows");
        assert_eq!(pairing.public_key_fingerprint, "trusted-fingerprint");
        assert_eq!(pairing.public_key, "trusted-public-key");
        assert_eq!(pairing.endpoint, "192.168.1.50:44777");
    }

    #[test]
    fn manual_endpoint_pairing_target_without_known_device_learns_identity_from_ack() {
        crate::identity::set_test_config_dir(unique_test_dir("manual-open-pairing-target"));

        let store = RuntimeStore::load_or_init();
        let target = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("192.168.1.50".to_string()),
                manual_endpoint: true,
            })
            .expect("manual endpoint should resolve");

        assert_eq!(target.device_id, "192.168.1.50:44777");
        assert_eq!(target.endpoint, "192.168.1.50:44777");
        assert!(target.expected_peer.is_none());
    }

    #[test]
    fn endpoint_only_pairing_target_requires_manual_flag() {
        crate::identity::set_test_config_dir(unique_test_dir("endpoint-only-requires-manual"));

        let store = RuntimeStore::load_or_init();
        let error = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("192.168.1.50".to_string()),
                manual_endpoint: false,
            })
            .expect_err("endpoint-only target should be marked manual");

        assert_eq!(
            error,
            "Endpoint-only pairing requests must be marked as manual pairing."
        );
    }

    #[test]
    fn pairing_target_rejects_invalid_manual_endpoint_with_specific_message() {
        crate::identity::set_test_config_dir(unique_test_dir("invalid-manual-pairing-target"));

        let store = RuntimeStore::load_or_init();
        let error = store
            .pairing_target(super::PairRequest {
                device_id: None,
                endpoint: Some("127.0.0.1".to_string()),
                manual_endpoint: true,
            })
            .expect_err("local-only manual endpoint should be rejected");

        assert_eq!(error, super::INVALID_ENDPOINT_MESSAGE);
    }

    #[test]
    fn trusted_discovery_requires_matching_fingerprint() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-discovery-fingerprint"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Spoofed Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "wrong-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.66:44777".to_string(),
        ));

        let status = store.status();
        let trusted = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should remain listed");
        assert!(!trusted.online);
        assert_eq!(trusted.endpoint, None);

        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.50:44777".to_string(),
        ));

        let status = store.status();
        let trusted = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should remain listed");
        assert!(trusted.online);
        assert_eq!(trusted.endpoint.as_deref(), Some("192.168.1.50:44777"));
    }

    #[test]
    fn trusted_discovery_requires_stored_public_key_match() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-discovery-public-key"));

        let (_trusted_private_key, trusted_public_key) = crate::crypto::identity_keypair();
        let trusted_fingerprint = crate::crypto::fingerprint_from_public_key(&trusted_public_key)
            .expect("trusted public key should fingerprint");
        let (_other_private_key, other_public_key) = crate::crypto::identity_keypair();
        let other_fingerprint = crate::crypto::fingerprint_from_public_key(&other_public_key)
            .expect("other public key should fingerprint");

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: trusted_fingerprint.clone(),
                public_key: Some(trusted_public_key.clone()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Missing Key Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: trusted_fingerprint.clone(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.66:44777".to_string(),
        ));

        assert!(!store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Other Key Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: other_fingerprint,
                role: ComputerRole::Client,
                public_key: other_public_key,
                scan_request: false,
            },
            "192.168.1.67:44777".to_string(),
        ));

        let status = store.status();
        let trusted = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should remain listed");
        assert!(!trusted.online);
        assert_eq!(trusted.endpoint, None);

        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: trusted_fingerprint,
                role: ComputerRole::Client,
                public_key: trusted_public_key,
                scan_request: false,
            },
            "192.168.1.50:44777".to_string(),
        ));

        let status = store.status();
        let trusted = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should remain listed");
        assert!(trusted.online);
        assert_eq!(trusted.endpoint.as_deref(), Some("192.168.1.50:44777"));
    }

    #[test]
    fn trusted_endpoint_priority_is_discovery_health_saved() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-endpoint-priority"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.10:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        assert_eq!(
            store.trusted_target("trusted-device").unwrap().endpoint,
            "192.168.1.10:44777"
        );
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.10:44777".to_string()]
        );

        store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.20:44777".to_string(),
                Some(6),
            )
            .expect("trusted health should record");
        assert_eq!(
            store.trusted_target("trusted-device").unwrap().endpoint,
            "192.168.1.20:44777"
        );
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec![
                "192.168.1.20:44777".to_string(),
                "192.168.1.10:44777".to_string()
            ]
        );

        store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Spoofed Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "wrong-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.66:44777".to_string(),
        );
        assert_eq!(
            store.trusted_target("trusted-device").unwrap().endpoint,
            "192.168.1.20:44777"
        );

        store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                role: ComputerRole::Client,
                public_key: String::new(),
                scan_request: false,
            },
            "192.168.1.30:44777".to_string(),
        );
        assert_eq!(
            store.trusted_target("trusted-device").unwrap().endpoint,
            "192.168.1.30:44777"
        );
        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec![
                "192.168.1.30:44777".to_string(),
                "192.168.1.20:44777".to_string(),
                "192.168.1.10:44777".to_string()
            ]
        );
    }

    #[test]
    fn stop_capture_if_target_only_stops_matching_target() {
        crate::identity::set_test_config_dir(unique_test_dir("stop-capture-target"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(action.ok, "{}", action.message);
        assert!(!store.stop_capture_if_target("other-device"));
        assert!(store.status().capture.active);
        assert!(store.stop_capture_if_target("trusted-device"));
        assert!(!store.status().capture.active);
    }

    #[test]
    fn active_capture_target_clears_capture_without_usable_endpoint() {
        crate::identity::set_test_config_dir(unique_test_dir("capture-clears-no-endpoint"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok, "{}", action.message);
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("8.8.8.8:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let capture = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(capture.ok, "{}", capture.message);
        assert!(store.status().capture.active);

        let private_guard = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(true),
            allow_incoming_control: None,
        });
        assert!(private_guard.ok, "{}", private_guard.message);

        assert!(store.active_capture_target().is_none());
        assert!(!store.status().capture.active);
    }

    #[test]
    fn status_clears_capture_without_usable_endpoint() {
        crate::identity::set_test_config_dir(unique_test_dir("status-clears-capture-no-endpoint"));

        let store = RuntimeStore::load_or_init();
        let action = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(false),
            allow_incoming_control: None,
        });
        assert!(action.ok, "{}", action.message);
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("8.8.8.8:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let capture = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(capture.ok, "{}", capture.message);
        assert!(store.status().capture.active);

        let private_guard = store.update_settings(super::SettingsUpdateRequest {
            role: None,
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: Some(true),
            allow_incoming_control: None,
        });
        assert!(private_guard.ok, "{}", private_guard.message);

        let status = store.status();
        assert!(!status.capture.active);
        assert!(status.capture.target_device_id.is_none());
    }

    #[test]
    fn start_capture_prunes_stale_health_before_endpoint_check() {
        crate::identity::set_test_config_dir(unique_test_dir("capture-prunes-stale-health"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.50:44777".to_string(),
                    latency_ms: Some(3),
                    last_seen_at_ms: now_ms() - super::PEER_RETENTION_MS - 1,
                },
            );
        }

        let action = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });

        assert!(!action.ok);
        assert!(action.message.contains("no known endpoint"));
        assert!(!store.status().capture.active);
        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("trusted-device").is_none());
    }

    #[test]
    fn client_role_cannot_start_capture() {
        crate::identity::set_test_config_dir(unique_test_dir("client-role-capture"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Client;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let action = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });

        assert!(!action.ok);
        assert!(action.message.contains("Main or Both"));
        assert!(!store.status().capture.active);
        assert!(store.active_capture_target().is_none());
    }

    #[test]
    fn changing_to_client_clears_active_capture() {
        crate::identity::set_test_config_dir(unique_test_dir("client-role-clears-capture"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        let capture = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(capture.ok, "{}", capture.message);
        assert!(store.status().capture.active);

        let role_change = store.update_settings(super::SettingsUpdateRequest {
            role: Some(ComputerRole::Client),
            auto_start: None,
            trusted_reconnect: None,
            private_network_only: None,
            allow_incoming_control: None,
        });

        assert!(role_change.ok);
        assert_eq!(store.status().mode, ComputerRole::Client);
        assert!(!store.status().capture.active);
        assert!(store.active_capture_target().is_none());
    }

    #[test]
    fn main_role_rejects_incoming_input_even_when_receive_toggles_are_on() {
        crate::identity::set_test_config_dir(unique_test_dir("main-role-receive"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Main;
            state.persisted.settings.allow_incoming_control = true;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: true,
            });
        }

        let action = store.authorize_incoming_input(&PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: String::new(),
        });

        assert!(!action.ok);
        assert!(action.message.contains("Client or Both"));
    }

    #[test]
    fn both_role_accepts_incoming_input_when_receive_toggles_are_on() {
        crate::identity::set_test_config_dir(unique_test_dir("both-role-receive"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.settings.role = ComputerRole::Both;
            state.persisted.settings.allow_incoming_control = true;
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Mac".to_string(),
                platform: "macos".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: true,
            });
        }

        let action = store.authorize_incoming_input(&PairingPeer {
            device_id: "trusted-device".to_string(),
            name: "Trusted Mac".to_string(),
            platform: "macos".to_string(),
            role: ComputerRole::Client,
            control_port: 44777,
            public_key_fingerprint: "trusted-fingerprint".to_string(),
            public_key: String::new(),
        });

        assert!(action.ok);
    }

    #[test]
    fn forget_trusted_device_clears_runtime_state_for_that_device() {
        crate::identity::set_test_config_dir(unique_test_dir("forget-trusted-clears-runtime"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            let mut pending_pairing = expired_pairing("trusted-device", "123456");
            pending_pairing.created_at_ms = now_ms();
            pending_pairing.expires_at_ms = now_ms() + super::PAIRING_TIMEOUT_MS;
            state
                .pending_pairings
                .insert(pairing_id("trusted-device"), pending_pairing);
        }

        store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.50:44777".to_string(),
                Some(4),
            )
            .expect("trusted connection should record");
        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.51:44777",
            "connection timed out",
        );
        store.record_outgoing_input(
            "trusted-device".to_string(),
            RuntimeStore::test_input_event(),
        );
        store.record_incoming_input(
            PairingPeer {
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                control_port: 44777,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: String::new(),
            },
            RuntimeStore::test_input_event(),
            true,
            None,
        );
        assert_eq!(store.status().recent_input_events.len(), 2);
        let action = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(action.ok, "{}", action.message);

        let action = store.forget_trusted_device(super::DeviceTrustRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(action.ok, "{}", action.message);

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.persisted.trusted_devices.is_empty());
        assert!(state.connection_health.get("trusted-device").is_none());
        assert!(state.connection_failures.get("trusted-device").is_none());
        assert!(state.input_events.is_empty());
        assert!(!state.pending_pairings.contains_key(&pairing_id("trusted-device")));
        assert!(!state.capture.active);
        assert_eq!(state.capture.target_device_id, None);
        assert_eq!(state.capture.started_at_ms, None);
    }

    #[test]
    fn forget_trusted_device_save_failure_keeps_runtime_state() {
        let config_file = unique_test_dir("forget-save-failure-file");
        fs::write(&config_file, "not a directory").expect("test config path should be a file");
        crate::identity::set_test_config_dir(config_file);

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.pending_pairings.insert(
                pairing_id("trusted-device"),
                expired_pairing("trusted-device", "123456"),
            );
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.50:44777".to_string(),
                    last_seen_at_ms: now_ms(),
                    latency_ms: Some(4),
                },
            );
        }

        store.record_outgoing_input(
            "trusted-device".to_string(),
            RuntimeStore::test_input_event(),
        );
        let action = store.start_capture(super::CaptureControlRequest {
            device_id: "trusted-device".to_string(),
        });
        assert!(action.ok, "{}", action.message);

        let action = store.forget_trusted_device(super::DeviceTrustRequest {
            device_id: "trusted-device".to_string(),
        });

        assert!(!action.ok);
        assert!(action.message.starts_with("Failed to save trusted devices:"));
        let state = store.state.lock().expect("runtime state poisoned");
        assert_eq!(state.persisted.trusted_devices.len(), 1);
        assert!(state.connection_health.get("trusted-device").is_some());
        assert_eq!(state.input_events.len(), 1);
        assert!(state.capture.active);
        assert_eq!(
            state.capture.target_device_id.as_deref(),
            Some("trusted-device")
        );
    }

    #[test]
    fn trusted_connection_failure_is_visible_until_success() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-connection-failure"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50:44777",
            "connection timed out",
        );

        let status = store.status();
        let failure = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .expect("failure should be visible");
        assert_eq!(failure.endpoint, "192.168.1.50:44777");
        assert_eq!(failure.message, "connection timed out");

        store
            .record_trusted_connection(
                "trusted-device".to_string(),
                "192.168.1.50:44777".to_string(),
                Some(4),
            )
            .expect("successful reconnect should save health");

        let status = store.status();
        assert!(status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should be listed")
            .last_connection_failure
            .is_none());
    }

    #[test]
    fn trusted_discovery_clears_matching_stale_connection_failure() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-discovery-clears-failure"));

        let store = RuntimeStore::load_or_init();
        let (_private_key, public_key) = crate::crypto::identity_keypair();
        let public_key_fingerprint = crate::crypto::fingerprint_from_public_key(&public_key)
            .expect("generated public key should fingerprint");
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: public_key_fingerprint.clone(),
                public_key: Some(public_key.clone()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50:44777",
            "connection timed out",
        );
        assert!(store
            .status()
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .is_some());

        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint,
                role: ComputerRole::Client,
                public_key,
                scan_request: false,
            },
            "192.168.1.50".to_string(),
        ));

        let device = store
            .status()
            .devices
            .into_iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should be listed");
        assert_eq!(device.endpoint.as_deref(), Some("192.168.1.50:44777"));
        assert!(device.online);
        assert!(device.last_connection_failure.is_none());
    }

    #[test]
    fn trusted_discovery_keeps_different_endpoint_failure_visible() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-discovery-keeps-failure"));

        let store = RuntimeStore::load_or_init();
        let (_private_key, public_key) = crate::crypto::identity_keypair();
        let public_key_fingerprint = crate::crypto::fingerprint_from_public_key(&public_key)
            .expect("generated public key should fingerprint");
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: public_key_fingerprint.clone(),
                public_key: Some(public_key.clone()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.51:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.51:44777",
            "connection refused",
        );
        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint,
                role: ComputerRole::Client,
                public_key,
                scan_request: false,
            },
            "192.168.1.50".to_string(),
        ));

        let failure = store
            .status()
            .devices
            .into_iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure)
            .expect("different endpoint failure should stay visible");
        assert_eq!(failure.endpoint, "192.168.1.51:44777");
        assert!(matches!(failure.endpoint_source, super::EndpointSource::Saved));
        assert_eq!(failure.message, "connection refused");
    }

    #[test]
    fn trusted_connection_failure_keeps_original_endpoint_source() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-source-stable"));

        let store = RuntimeStore::load_or_init();
        let (_private_key, public_key) = crate::crypto::identity_keypair();
        let public_key_fingerprint = crate::crypto::fingerprint_from_public_key(&public_key)
            .expect("generated public key should fingerprint");
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: public_key_fingerprint.clone(),
                public_key: Some(public_key.clone()),
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: None,
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        assert!(store.record_peer(
            PeerAnnouncement {
                protocol_version: 1,
                device_id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                control_port: 44777,
                public_key_fingerprint,
                role: ComputerRole::Client,
                public_key,
                scan_request: false,
            },
            "192.168.1.50".to_string(),
        ));
        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50:44777",
            "connection refused",
        );
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.discovered_peers.clear();
        }

        let failure = store
            .status()
            .devices
            .into_iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure)
            .expect("failure should stay visible");
        assert_eq!(failure.endpoint, "192.168.1.50:44777");
        assert!(matches!(
            failure.endpoint_source,
            super::EndpointSource::Discovery
        ));
    }

    #[test]
    fn trusted_connection_failure_normalizes_endpoint_for_status() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-normalized"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.50:44777".to_string(),
                    last_seen_at_ms: now_ms(),
                    latency_ms: Some(4),
                },
            );
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50",
            "connection timed out",
        );

        let status = store.status();
        let device = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should be listed");
        assert_eq!(
            device
                .last_connection_failure
                .as_ref()
                .expect("failure should be visible")
                .endpoint,
            "192.168.1.50:44777"
        );
        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("trusted-device").is_none());
    }

    #[test]
    fn private_network_guard_ignores_public_connection_failures() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-public-guard"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "8.8.8.8:44777",
            "connection timed out",
        );

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_failures.get("trusted-device").is_none());
    }

    #[test]
    fn trusted_connection_failure_ignores_invalid_endpoints() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-invalid-endpoint"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "localhost",
            "connection refused",
        );
        store.record_trusted_connection_failure(
            "trusted-device",
            "macbook..local:44777",
            "connection refused",
        );

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_failures.get("trusted-device").is_none());
    }

    #[test]
    fn trusted_connection_failure_prunes_stale_health_before_source_label() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-prune-health"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.50:44777".to_string(),
                    last_seen_at_ms: now_ms() - super::PEER_RETENTION_MS - 1,
                    latency_ms: Some(4),
                },
            );
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50:44777",
            "connection timed out",
        );

        let status = store.status();
        let failure = status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .expect("failure should be visible");
        assert_eq!(failure.endpoint, "192.168.1.50:44777");
        assert!(matches!(failure.endpoint_source, super::EndpointSource::Saved));
        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("trusted-device").is_none());
    }

    #[test]
    fn trusted_connection_failure_can_be_cleared_after_successful_input_send() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-clear-input"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
        }

        store.record_trusted_connection_failure(
            "trusted-device",
            "192.168.1.50:44777",
            "input send failed",
        );
        assert!(store
            .status()
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .is_some());

        store.clear_trusted_connection_failure("trusted-device");

        assert!(store
            .status()
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .and_then(|device| device.last_connection_failure.as_ref())
            .is_none());
    }

    #[test]
    fn stale_trusted_connection_failures_are_pruned_from_status() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-failure-pruned"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_failures.insert(
                "trusted-device".to_string(),
                super::ConnectionFailure {
                    endpoint: "192.168.1.50:44777".to_string(),
                    endpoint_source: super::EndpointSource::Saved,
                    failed_at_ms: now_ms() - super::PEER_RETENTION_MS - 1,
                    message: "old stale endpoint".to_string(),
                },
            );
        }

        let status = store.status();
        assert!(status
            .devices
            .iter()
            .find(|device| device.id == "trusted-device")
            .expect("trusted device should be listed")
            .last_connection_failure
            .is_none());
        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_failures.get("trusted-device").is_none());
    }

    #[test]
    fn trusted_target_selection_prunes_stale_health() {
        crate::identity::set_test_config_dir(unique_test_dir("trusted-target-prunes-health"));

        let store = RuntimeStore::load_or_init();
        {
            let mut state = store.state.lock().expect("runtime state poisoned");
            state.persisted.trusted_devices.push(TrustedDevice {
                id: "trusted-device".to_string(),
                name: "Trusted Windows".to_string(),
                platform: "windows".to_string(),
                role: ComputerRole::Client,
                public_key_fingerprint: "trusted-fingerprint".to_string(),
                public_key: None,
                shared_secret: Some("shared-secret".to_string()),
                last_endpoint: Some("192.168.1.50:44777".to_string()),
                recent_endpoints: Vec::new(),
                allow_incoming_control: false,
            });
            state.connection_health.insert(
                "trusted-device".to_string(),
                super::ConnectionHealth {
                    endpoint: "192.168.1.60:44777".to_string(),
                    last_seen_at_ms: now_ms() - super::PEER_RETENTION_MS - 1,
                    latency_ms: Some(7),
                },
            );
        }

        assert_eq!(
            store.trusted_reconnect_targets()[0].endpoints,
            vec!["192.168.1.50:44777".to_string()]
        );
        assert_eq!(
            store.trusted_target("trusted-device").unwrap().endpoint,
            "192.168.1.50:44777"
        );

        let state = store.state.lock().expect("runtime state poisoned");
        assert!(state.connection_health.get("trusted-device").is_none());
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "remoteshare-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ))
    }

    fn expired_pairing(device_id: &str, code: &str) -> PendingPairing {
        PendingPairing {
            id: format!("pair-{device_id}"),
            device_id: device_id.to_string(),
            name: "Expired Device".to_string(),
            platform: "unknown".to_string(),
            role: ComputerRole::Client,
            endpoint: "192.168.1.10:44777".to_string(),
            control_port: 44777,
            public_key_fingerprint: format!("{device_id}-fingerprint"),
            public_key: String::new(),
            local_nonce: "expired-local-nonce".to_string(),
            remote_nonce: "expired-remote-nonce".to_string(),
            local_dh_private_key: "expired-local-private-key".to_string(),
            local_dh_public_key: "expired-local-public-key".to_string(),
            remote_dh_public_key: "expired-remote-public-key".to_string(),
            code: code.to_string(),
            direction: PairingDirection::Outgoing,
            local_approved: true,
            remote_approved: false,
            created_at_ms: 0,
            expires_at_ms: 1,
        }
    }
}
