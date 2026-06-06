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
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
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
fn toggle_capture(store: State<'_, RuntimeStore>) -> NetworkAction {
    if input::permission_status().capture_engine != EngineState::Ready {
        return NetworkAction {
            ok: false,
            message: "Native input capture is not ready on this platform yet.".to_string(),
        };
    }

    store.toggle_capture()
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

#[tauri::command]
fn sync_clipboard(content: String, store: State<'_, RuntimeStore>) -> NetworkAction {
    if !store.clipboard_sync_enabled() {
        return NetworkAction {
            ok: false,
            message: "Clipboard sync is not enabled.".to_string(),
        };
    }
    if content.is_empty() {
        return NetworkAction {
            ok: false,
            message: "Clipboard content is empty.".to_string(),
        };
    }
    NetworkAction {
        ok: true,
        message: "Clipboard sync ready.".to_string(),
    }
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
            toggle_capture,
            input_permission_status,
            request_input_permissions,
            initiate_pairing,
            confirm_pairing,
            send_test_input,
            check_trusted_device,
            update_trusted_endpoint,
            sync_clipboard
        ])
        .setup(|app| {
            let store = app.state::<RuntimeStore>().inner().clone();
            network::start_supervisor(app.handle().clone(), store.clone());

            // System tray
            let title = MenuItemBuilder::with_id("title", "RemoteShare")
                .enabled(false)
                .build(app)?;
            let capture_label = if store.status().capture.active {
                "Stop Capture"
            } else {
                "Start Capture"
            };
            let capture_item = MenuItemBuilder::with_id("toggle_capture", capture_label).build(app)?;
            let scan_item = MenuItemBuilder::with_id("scan_lan", "Scan LAN").build(app)?;
            let show_item = MenuItemBuilder::with_id("show_window", "Show Window").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&title)
                .separator()
                .item(&capture_item)
                .item(&scan_item)
                .separator()
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "toggle_capture" => {
                            let s = app.state::<RuntimeStore>();
                            if s.status().capture.active {
                                s.stop_capture();
                            } else {
                                // Cannot start without a target device from tray
                                let _ = s.stop_capture();
                            }
                        }
                        "scan_lan" => {
                            let s = app.state::<RuntimeStore>().inner().clone();
                            tokio::spawn(async move { network::scan_lan(s).await; });
                        }
                        "show_window" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            #[cfg(not(debug_assertions))]
            {
                let action = store.sync_startup_registration();
                if !action.ok {
                    let _ = app.emit("remoteshare://network-error", action.message);
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
