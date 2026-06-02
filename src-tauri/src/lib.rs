mod autostart;
mod crypto;
mod identity;
mod input;
mod network;
mod runtime;

use input::{EngineState, InputPermissionStatus};
use runtime::{
    CancelPairingRequest, CaptureControlRequest, ConfirmPairingRequest, DeviceControlUpdateRequest,
    DeviceEndpointUpdateRequest, DeviceTrustRequest, NetworkAction, PairRequest, RuntimeStatus,
    RuntimeStore, SendInputRequest, SettingsUpdateRequest,
};
#[cfg(not(debug_assertions))]
use tauri::Emitter;
use tauri::{Manager, State};

#[tauri::command]
fn runtime_status(store: State<'_, RuntimeStore>) -> RuntimeStatus {
    store.status()
}

#[tauri::command]
fn local_control_endpoints(store: State<'_, RuntimeStore>) -> Vec<String> {
    network::local_control_endpoints(store.status().discovery.port)
}

#[tauri::command]
async fn start_lan_discovery(store: State<'_, RuntimeStore>) -> Result<NetworkAction, String> {
    Ok(network::scan_lan(store.inner().clone()).await)
}

#[tauri::command]
fn clear_manual_endpoint(store: State<'_, RuntimeStore>) -> NetworkAction {
    store.clear_manual_endpoint()
}

#[tauri::command]
fn cancel_pairing(request: CancelPairingRequest, store: State<'_, RuntimeStore>) -> NetworkAction {
    store.cancel_pairing(request)
}

#[tauri::command]
fn update_settings(
    request: SettingsUpdateRequest,
    store: State<'_, RuntimeStore>,
) -> NetworkAction {
    store.update_settings(request)
}

#[tauri::command]
fn update_device_control(
    request: DeviceControlUpdateRequest,
    store: State<'_, RuntimeStore>,
) -> NetworkAction {
    store.update_device_control(request)
}

#[tauri::command]
fn enable_receive_for_trusted_devices(store: State<'_, RuntimeStore>) -> NetworkAction {
    store.enable_receive_for_trusted_devices()
}

#[tauri::command]
fn forget_trusted_device(
    request: DeviceTrustRequest,
    store: State<'_, RuntimeStore>,
) -> NetworkAction {
    store.forget_trusted_device(request)
}

#[tauri::command]
fn start_capture(request: CaptureControlRequest, store: State<'_, RuntimeStore>) -> NetworkAction {
    if input::permission_status().capture_engine != EngineState::Ready {
        return NetworkAction {
            ok: false,
            message: "Native input capture is not ready on this platform yet.".to_string(),
        };
    }

    store.start_capture(request)
}

#[tauri::command]
fn stop_capture(store: State<'_, RuntimeStore>) -> NetworkAction {
    store.stop_capture()
}

#[tauri::command]
fn input_permission_status() -> InputPermissionStatus {
    input::permission_status()
}

#[tauri::command]
fn request_input_permissions() -> InputPermissionStatus {
    input::request_input_permissions()
}

#[tauri::command]
async fn initiate_pairing(
    request: PairRequest,
    store: State<'_, RuntimeStore>,
) -> Result<NetworkAction, String> {
    Ok(network::initiate_pairing(store.inner().clone(), request).await)
}

#[tauri::command]
async fn confirm_pairing(
    request: ConfirmPairingRequest,
    app: tauri::AppHandle,
    store: State<'_, RuntimeStore>,
) -> Result<NetworkAction, String> {
    Ok(network::confirm_pairing(app, store.inner().clone(), request).await)
}

#[tauri::command]
async fn send_test_input(
    request: SendInputRequest,
    store: State<'_, RuntimeStore>,
) -> Result<NetworkAction, String> {
    Ok(network::send_test_input(store.inner().clone(), request).await)
}

#[tauri::command]
async fn check_trusted_device(
    request: DeviceTrustRequest,
    store: State<'_, RuntimeStore>,
) -> Result<NetworkAction, String> {
    Ok(network::check_trusted_device(store.inner().clone(), request).await)
}

#[tauri::command]
async fn update_trusted_endpoint(
    request: DeviceEndpointUpdateRequest,
    store: State<'_, RuntimeStore>,
) -> Result<NetworkAction, String> {
    Ok(network::update_trusted_endpoint(store.inner().clone(), request).await)
}

pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeStore::load_or_init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            local_control_endpoints,
            start_lan_discovery,
            clear_manual_endpoint,
            cancel_pairing,
            update_settings,
            update_device_control,
            enable_receive_for_trusted_devices,
            forget_trusted_device,
            start_capture,
            stop_capture,
            input_permission_status,
            request_input_permissions,
            initiate_pairing,
            confirm_pairing,
            send_test_input,
            check_trusted_device,
            update_trusted_endpoint
        ])
        .setup(|app| {
            let store = app.state::<RuntimeStore>().inner().clone();
            network::start_supervisor(app.handle().clone(), store.clone());
            #[cfg(not(debug_assertions))]
            {
                let auto_start = app.state::<RuntimeStore>().auto_start_enabled();
                if let Err(error) = autostart::set_enabled(auto_start) {
                    store.record_startup_registration(
                        false,
                        format!("Start-at-login registration failed: {error}"),
                    );
                    let _ = app.emit(
                        "remoteshare://network-error",
                        format!("Start-at-login registration failed: {error}"),
                    );
                } else {
                    store.record_startup_registration(
                        true,
                        if auto_start {
                            "Start at login is registered.".to_string()
                        } else {
                            "Start at login is disabled.".to_string()
                        },
                    );
                }
            }
            #[cfg(debug_assertions)]
            {
                store.record_startup_registration(
                    true,
                    "Start-at-login registration skipped in development.".to_string(),
                );
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run RemoteShare");
}
