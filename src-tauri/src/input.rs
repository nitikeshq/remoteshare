use std::sync::mpsc;

use serde::Serialize;
use thiserror::Error;

use crate::runtime::{InputEvent, InputEventKind};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPermissionStatus {
    pub accessibility: PermissionState,
    pub input_monitoring: PermissionState,
    pub input_injection: PermissionState,
    pub capture_engine: EngineState,
    pub injection_engine: EngineState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum PermissionState {
    Granted,
    Missing,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum EngineState {
    Ready,
    Planned,
    Unsupported,
}

pub fn permission_status() -> InputPermissionStatus {
    let accessibility = accessibility_status();
    let injection_engine = injection_engine_status(&accessibility);
    let input_monitoring = input_monitoring_status();
    let input_injection = input_injection_status(&accessibility);
    let capture_engine = capture_engine_status(&input_monitoring);
    InputPermissionStatus {
        accessibility,
        input_monitoring,
        input_injection,
        capture_engine,
        injection_engine,
    }
}

pub fn request_input_permissions() -> InputPermissionStatus {
    platform_request_input_permissions();
    permission_status()
}

#[derive(Debug, Error)]
pub enum InputError {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[error("input is not supported on this platform yet")]
    UnsupportedPlatform,
    #[error("input injection requires Accessibility permission")]
    MissingPermission,
    #[error("input capture requires Input Monitoring permission")]
    MissingCapturePermission,
    #[error("input event is not supported by the current injection engine yet")]
    UnsupportedEvent,
    #[error("key is not mapped by the current injection engine")]
    UnsupportedKey,
    #[error("failed to create native input event")]
    CreateNativeEvent,
}

pub fn apply_event(event: &InputEvent) -> Result<(), InputError> {
    platform_apply_event(event)
}

pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    platform_set_clipboard_text(text)
}

#[cfg(target_os = "macos")]
fn platform_set_clipboard_text(text: &str) -> Result<(), String> {
    use std::process::Command;
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn pbcopy: {e}"))?;
    use std::io::Write;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open pbcopy stdin.".to_string())?
        .write_all(text.as_bytes())
        .map_err(|e| format!("Failed to write to pbcopy: {e}"))?;
    let status = child.wait().map_err(|e| format!("pbcopy failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("pbcopy exited with error.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn platform_set_clipboard_text(text: &str) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr;

    const GMEM_MOVEABLE: u32 = 0x0002;
    const CF_UNICODETEXT: u32 = 13;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, mem: *mut c_void) -> *mut c_void;
        fn CloseClipboard() -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(mem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(mem: *mut c_void) -> i32;
    }

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let size = wide.len() * 2;
    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err("Failed to open clipboard.".to_string());
        }
        EmptyClipboard();
        let hmem = GlobalAlloc(GMEM_MOVEABLE, size);
        if hmem.is_null() {
            CloseClipboard();
            return Err("Failed to allocate clipboard memory.".to_string());
        }
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            CloseClipboard();
            return Err("Failed to lock clipboard memory.".to_string());
        }
        ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, size);
        GlobalUnlock(hmem);
        if SetClipboardData(CF_UNICODETEXT, hmem).is_null() {
            CloseClipboard();
            return Err("Failed to set clipboard data.".to_string());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_set_clipboard_text(_text: &str) -> Result<(), String> {
    Err("Clipboard is not supported on this platform yet.".to_string())
}

pub fn start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
    platform_start_capture_stream()
}

#[cfg(target_os = "macos")]
fn accessibility_status() -> PermissionState {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    let trusted = unsafe { AXIsProcessTrusted() };
    if trusted {
        PermissionState::Granted
    } else {
        PermissionState::Missing
    }
}

#[cfg(not(target_os = "macos"))]
fn accessibility_status() -> PermissionState {
    PermissionState::Unsupported
}

#[cfg(target_os = "macos")]
fn input_monitoring_status() -> PermissionState {
    if macos::preflight_listen_event_access() {
        PermissionState::Granted
    } else {
        PermissionState::Missing
    }
}

#[cfg(target_os = "windows")]
fn input_monitoring_status() -> PermissionState {
    PermissionState::Granted
}

#[cfg(target_os = "linux")]
fn input_monitoring_status() -> PermissionState {
    PermissionState::Unknown
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn input_monitoring_status() -> PermissionState {
    PermissionState::Unsupported
}

fn input_injection_status(accessibility: &PermissionState) -> PermissionState {
    platform_input_injection_status(accessibility)
}

fn capture_engine_status(input_monitoring: &PermissionState) -> EngineState {
    platform_capture_engine_status(input_monitoring)
}

#[cfg(target_os = "macos")]
fn platform_capture_engine_status(input_monitoring: &PermissionState) -> EngineState {
    match input_monitoring {
        PermissionState::Granted => EngineState::Ready,
        PermissionState::Missing | PermissionState::Unknown => EngineState::Planned,
        PermissionState::Unsupported => EngineState::Unsupported,
    }
}

#[cfg(target_os = "windows")]
fn platform_capture_engine_status(_input_monitoring: &PermissionState) -> EngineState {
    EngineState::Ready
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_capture_engine_status(_input_monitoring: &PermissionState) -> EngineState {
    EngineState::Planned
}

#[cfg(target_os = "macos")]
fn platform_input_injection_status(accessibility: &PermissionState) -> PermissionState {
    accessibility.clone()
}

#[cfg(target_os = "windows")]
fn platform_input_injection_status(_accessibility: &PermissionState) -> PermissionState {
    PermissionState::Granted
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_input_injection_status(_accessibility: &PermissionState) -> PermissionState {
    PermissionState::Unsupported
}

#[cfg(target_os = "macos")]
fn platform_request_input_permissions() {
    let _ = macos::request_listen_event_access();
}

#[cfg(not(target_os = "macos"))]
fn platform_request_input_permissions() {}

fn injection_engine_status(accessibility: &PermissionState) -> EngineState {
    platform_injection_engine_status(accessibility)
}

#[cfg(target_os = "macos")]
fn platform_injection_engine_status(accessibility: &PermissionState) -> EngineState {
    match accessibility {
        PermissionState::Granted => EngineState::Ready,
        PermissionState::Missing => EngineState::Planned,
        PermissionState::Unsupported | PermissionState::Unknown => EngineState::Planned,
    }
}

#[cfg(target_os = "windows")]
fn platform_injection_engine_status(_accessibility: &PermissionState) -> EngineState {
    EngineState::Ready
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_injection_engine_status(_accessibility: &PermissionState) -> EngineState {
    EngineState::Unsupported
}

#[cfg(target_os = "macos")]
fn platform_apply_event(event: &InputEvent) -> Result<(), InputError> {
    if !matches!(accessibility_status(), PermissionState::Granted) {
        return Err(InputError::MissingPermission);
    }

    macos::apply_event(event)
}

#[cfg(target_os = "windows")]
fn platform_apply_event(event: &InputEvent) -> Result<(), InputError> {
    windows::apply_event(event)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_apply_event(_event: &InputEvent) -> Result<(), InputError> {
    Err(InputError::UnsupportedPlatform)
}

#[cfg(target_os = "macos")]
fn platform_start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
    if !matches!(input_monitoring_status(), PermissionState::Granted) {
        return Err(InputError::MissingCapturePermission);
    }

    macos::start_capture_stream()
}

#[cfg(target_os = "windows")]
fn platform_start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
    windows_capture::start_capture_stream()
}

#[cfg(target_os = "linux")]
fn platform_start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
    // Linux input capture (evdev/libinput) is planned but not yet implemented.
    Err(InputError::UnsupportedPlatform)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
    Err(InputError::UnsupportedPlatform)
}

#[cfg(any(test, target_os = "windows"))]
fn windows_virtual_key(key: &str) -> Option<u16> {
    match key.to_ascii_lowercase().as_str() {
        "a" => Some(0x41),
        "b" => Some(0x42),
        "c" => Some(0x43),
        "d" => Some(0x44),
        "e" => Some(0x45),
        "f" => Some(0x46),
        "g" => Some(0x47),
        "h" => Some(0x48),
        "i" => Some(0x49),
        "j" => Some(0x4a),
        "k" => Some(0x4b),
        "l" => Some(0x4c),
        "m" => Some(0x4d),
        "n" => Some(0x4e),
        "o" => Some(0x4f),
        "p" => Some(0x50),
        "q" => Some(0x51),
        "r" => Some(0x52),
        "s" => Some(0x53),
        "t" => Some(0x54),
        "u" => Some(0x55),
        "v" => Some(0x56),
        "w" => Some(0x57),
        "x" => Some(0x58),
        "y" => Some(0x59),
        "z" => Some(0x5a),
        "0" => Some(0x30),
        "1" => Some(0x31),
        "2" => Some(0x32),
        "3" => Some(0x33),
        "4" => Some(0x34),
        "5" => Some(0x35),
        "6" => Some(0x36),
        "7" => Some(0x37),
        "8" => Some(0x38),
        "9" => Some(0x39),
        "space" => Some(0x20),
        "enter" | "return" => Some(0x0d),
        "tab" => Some(0x09),
        "backspace" => Some(0x08),
        "delete" => Some(0x2e),
        "escape" | "esc" => Some(0x1b),
        "shift" => Some(0x10),
        "control" | "ctrl" => Some(0x11),
        "alt" | "option" => Some(0x12),
        "meta" | "command" | "cmd" | "win" | "windows" => Some(0x5b),
        "left" | "arrowleft" => Some(0x25),
        "up" | "arrowup" => Some(0x26),
        "right" | "arrowright" => Some(0x27),
        "down" | "arrowdown" => Some(0x28),
        "home" => Some(0x24),
        "end" => Some(0x23),
        "pageup" | "page-up" => Some(0x21),
        "pagedown" | "page-down" => Some(0x22),
        "insert" => Some(0x2d),
        "=" => Some(0xbb),
        "," => Some(0xbc),
        "-" => Some(0xbd),
        "." => Some(0xbe),
        "/" => Some(0xbf),
        "`" => Some(0xc0),
        ";" => Some(0xba),
        "'" => Some(0xde),
        "[" => Some(0xdb),
        "\\" => Some(0xdc),
        "]" => Some(0xdd),
        _ => None,
    }
}

#[cfg(any(test, target_os = "windows"))]
fn windows_absolute_coordinate(value: i32, dimension: i32) -> i32 {
    let max_index = dimension.saturating_sub(1);
    if max_index <= 0 {
        return 0;
    }
    value.clamp(0, max_index) * 65_535 / max_index
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use super::{InputError, InputEvent, InputEventKind};

    type CGEventRef = *mut c_void;
    type CGEventSourceRef = *mut c_void;
    type CGEventTapLocation = u32;
    type CGEventType = u32;
    type CGMouseButton = u32;
    type CGScrollEventUnit = u32;
    type CGKeyCode = u16;
    type CGEventTapProxy = *mut c_void;
    type CGEventTapPlacement = u32;
    type CGEventTapOptions = u32;
    type CGEventMask = u64;
    type CGEventFlags = u64;
    type CGEventField = u32;
    type CFMachPortRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFIndex = isize;

    const K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;
    const K_CG_HEAD_INSERT_EVENT_TAP: CGEventTapPlacement = 0;
    const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: CGEventTapOptions = 1;
    const K_CG_EVENT_LEFT_MOUSE_DOWN: CGEventType = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: CGEventType = 2;
    const K_CG_EVENT_RIGHT_MOUSE_DOWN: CGEventType = 3;
    const K_CG_EVENT_RIGHT_MOUSE_UP: CGEventType = 4;
    const K_CG_EVENT_MOUSE_MOVED: CGEventType = 5;
    const K_CG_EVENT_LEFT_MOUSE_DRAGGED: CGEventType = 6;
    const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: CGEventType = 7;
    const K_CG_EVENT_KEY_DOWN: CGEventType = 10;
    const K_CG_EVENT_KEY_UP: CGEventType = 11;
    const K_CG_EVENT_FLAGS_CHANGED: CGEventType = 12;
    const K_CG_EVENT_SCROLL_WHEEL: CGEventType = 22;
    const K_CG_MOUSE_BUTTON_LEFT: CGMouseButton = 0;
    const K_CG_MOUSE_BUTTON_RIGHT: CGMouseButton = 1;
    const K_CG_SCROLL_EVENT_UNIT_PIXEL: CGScrollEventUnit = 0;
    const K_CG_MOUSE_EVENT_BUTTON_NUMBER: CGEventField = 3;
    const K_CG_KEYBOARD_EVENT_KEYCODE: CGEventField = 9;
    const K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1: CGEventField = 11;
    const K_CG_EVENT_FLAG_MASK_SHIFT: CGEventFlags = 1 << 17;
    const K_CG_EVENT_FLAG_MASK_CONTROL: CGEventFlags = 1 << 18;
    const K_CG_EVENT_FLAG_MASK_ALTERNATE: CGEventFlags = 1 << 19;
    const K_CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 1 << 20;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
        fn CGEventTapCreate(
            tap: CGEventTapLocation,
            place: CGEventTapPlacement,
            options: CGEventTapOptions,
            events_of_interest: CGEventMask,
            callback: extern "C" fn(
                CGEventTapProxy,
                CGEventType,
                CGEventRef,
                *mut c_void,
            ) -> CGEventRef,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            tap: CFMachPortRef,
            order: CFIndex,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(
            run_loop: CFRunLoopRef,
            source: CFRunLoopSourceRef,
            mode: CFStringRef,
        );
        fn CFRunLoopRun();
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        fn CGEventGetFlags(event: CGEventRef) -> CGEventFlags;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: CGEventField) -> i64;
        fn CGEventCreateMouseEvent(
            source: CGEventSourceRef,
            mouse_type: CGEventType,
            mouse_cursor_position: CGPoint,
            mouse_button: CGMouseButton,
        ) -> CGEventRef;
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtual_key: CGKeyCode,
            key_down: bool,
        ) -> CGEventRef;
        fn CGEventCreateScrollWheelEvent(
            source: CGEventSourceRef,
            units: CGScrollEventUnit,
            wheel_count: u32,
            wheel1: i32,
            ...
        ) -> CGEventRef;
        fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
        fn CFRelease(value: *const c_void);
        #[link_name = "kCFRunLoopCommonModes"]
        static K_CF_RUN_LOOP_COMMON_MODES: CFStringRef;
    }

    pub fn preflight_listen_event_access() -> bool {
        unsafe { CGPreflightListenEventAccess() }
    }

    pub fn request_listen_event_access() -> bool {
        unsafe { CGRequestListenEventAccess() }
    }

    pub fn apply_event(event: &InputEvent) -> Result<(), InputError> {
        match event.kind {
            InputEventKind::MouseMove => mouse_move(event),
            InputEventKind::MouseClick => mouse_click(event),
            InputEventKind::KeyPress => key_press(event),
            InputEventKind::Scroll => scroll(event),
        }
    }

    pub fn start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
        let (event_sender, event_receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::channel();

        thread::spawn(move || {
            let sender = Box::new(event_sender);
            let user_info = Box::into_raw(sender).cast::<c_void>();
            let tap = unsafe {
                CGEventTapCreate(
                    K_CG_HID_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                    capture_event_mask(),
                    capture_callback,
                    user_info,
                )
            };

            if tap.is_null() {
                unsafe {
                    drop(Box::from_raw(user_info.cast::<mpsc::Sender<InputEvent>>()));
                }
                let _ = ready_sender.send(Err(InputError::CreateNativeEvent));
                return;
            }

            let source =
                unsafe { CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0 as CFIndex) };
            if source.is_null() {
                unsafe {
                    CFRelease(tap.cast_const());
                    drop(Box::from_raw(user_info.cast::<mpsc::Sender<InputEvent>>()));
                }
                let _ = ready_sender.send(Err(InputError::CreateNativeEvent));
                return;
            }

            unsafe {
                CGEventTapEnable(tap, true);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, K_CF_RUN_LOOP_COMMON_MODES);
            }
            let _ = ready_sender.send(Ok(()));
            unsafe {
                CFRunLoopRun();
            }
        });

        match ready_receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(event_receiver),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(InputError::CreateNativeEvent),
        }
    }

    extern "C" fn capture_callback(
        _proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef {
        if !user_info.is_null() {
            let sender = unsafe { &*(user_info.cast::<mpsc::Sender<InputEvent>>()) };
            if let Some(input_event) = capture_event(event_type, event) {
                let _ = sender.send(input_event);
            }
        }

        event
    }

    fn capture_event_mask() -> CGEventMask {
        [
            K_CG_EVENT_LEFT_MOUSE_DOWN,
            K_CG_EVENT_LEFT_MOUSE_UP,
            K_CG_EVENT_RIGHT_MOUSE_DOWN,
            K_CG_EVENT_RIGHT_MOUSE_UP,
            K_CG_EVENT_MOUSE_MOVED,
            K_CG_EVENT_LEFT_MOUSE_DRAGGED,
            K_CG_EVENT_RIGHT_MOUSE_DRAGGED,
            K_CG_EVENT_KEY_DOWN,
            K_CG_EVENT_KEY_UP,
            K_CG_EVENT_FLAGS_CHANGED,
            K_CG_EVENT_SCROLL_WHEEL,
        ]
        .iter()
        .fold(0, |mask, event_type| mask | (1_u64 << event_type))
    }

    fn capture_event(event_type: CGEventType, event: CGEventRef) -> Option<InputEvent> {
        match event_type {
            K_CG_EVENT_MOUSE_MOVED
            | K_CG_EVENT_LEFT_MOUSE_DRAGGED
            | K_CG_EVENT_RIGHT_MOUSE_DRAGGED => {
                let point = unsafe { CGEventGetLocation(event) };
                Some(InputEvent {
                    kind: InputEventKind::MouseMove,
                    x: Some(point.x.round() as i32),
                    y: Some(point.y.round() as i32),
                    button: None,
                    key: None,
                    delta: None,
                    pressed: None,
                })
            }
            K_CG_EVENT_LEFT_MOUSE_DOWN
            | K_CG_EVENT_LEFT_MOUSE_UP
            | K_CG_EVENT_RIGHT_MOUSE_DOWN
            | K_CG_EVENT_RIGHT_MOUSE_UP => {
                let button_number =
                    unsafe { CGEventGetIntegerValueField(event, K_CG_MOUSE_EVENT_BUTTON_NUMBER) };
                let point = unsafe { CGEventGetLocation(event) };
                Some(InputEvent {
                    kind: InputEventKind::MouseClick,
                    x: Some(point.x.round() as i32),
                    y: Some(point.y.round() as i32),
                    button: Some(mouse_button_name(button_number).to_string()),
                    key: None,
                    delta: None,
                    pressed: Some(matches!(
                        event_type,
                        K_CG_EVENT_LEFT_MOUSE_DOWN | K_CG_EVENT_RIGHT_MOUSE_DOWN
                    )),
                })
            }
            K_CG_EVENT_KEY_DOWN | K_CG_EVENT_KEY_UP => {
                let key_code =
                    unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
                key_name(key_code as CGKeyCode).map(|key| InputEvent {
                    kind: InputEventKind::KeyPress,
                    x: None,
                    y: None,
                    button: None,
                    key: Some(key.to_string()),
                    delta: None,
                    pressed: Some(event_type == K_CG_EVENT_KEY_DOWN),
                })
            }
            K_CG_EVENT_FLAGS_CHANGED => {
                let key_code =
                    unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
                let flags = unsafe { CGEventGetFlags(event) };
                modifier_key(key_code as CGKeyCode).map(|(key, flag)| InputEvent {
                    kind: InputEventKind::KeyPress,
                    x: None,
                    y: None,
                    button: None,
                    key: Some(key.to_string()),
                    delta: None,
                    pressed: Some(flags & flag != 0),
                })
            }
            K_CG_EVENT_SCROLL_WHEEL => {
                let delta = unsafe {
                    CGEventGetIntegerValueField(event, K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1)
                };
                Some(InputEvent {
                    kind: InputEventKind::Scroll,
                    x: None,
                    y: None,
                    button: None,
                    key: None,
                    delta: Some((delta as i32).clamp(-120, 120)),
                    pressed: None,
                })
            }
            _ => None,
        }
    }

    fn mouse_button_name(button_number: i64) -> &'static str {
        match button_number {
            1 => "secondary",
            _ => "primary",
        }
    }

    fn mouse_move(event: &InputEvent) -> Result<(), InputError> {
        let point = CGPoint {
            x: event.x.unwrap_or_default() as f64,
            y: event.y.unwrap_or_default() as f64,
        };
        post_mouse_event(K_CG_EVENT_MOUSE_MOVED, point, K_CG_MOUSE_BUTTON_LEFT)
    }

    fn mouse_click(event: &InputEvent) -> Result<(), InputError> {
        let point = CGPoint {
            x: event.x.unwrap_or_default() as f64,
            y: event.y.unwrap_or_default() as f64,
        };
        let (down, up, button) = match event.button.as_deref().unwrap_or("primary") {
            "secondary" | "right" => (
                K_CG_EVENT_RIGHT_MOUSE_DOWN,
                K_CG_EVENT_RIGHT_MOUSE_UP,
                K_CG_MOUSE_BUTTON_RIGHT,
            ),
            "primary" | "left" => (
                K_CG_EVENT_LEFT_MOUSE_DOWN,
                K_CG_EVENT_LEFT_MOUSE_UP,
                K_CG_MOUSE_BUTTON_LEFT,
            ),
            _ => return Err(InputError::UnsupportedEvent),
        };
        match event.pressed {
            Some(true) => post_mouse_event(down, point, button),
            Some(false) => post_mouse_event(up, point, button),
            None => {
                post_mouse_event(down, point, button)?;
                post_mouse_event(up, point, button)
            }
        }
    }

    fn key_press(event: &InputEvent) -> Result<(), InputError> {
        let key = event.key.as_deref().ok_or(InputError::UnsupportedKey)?;
        let key_code = key_code(key).ok_or(InputError::UnsupportedKey)?;
        match event.pressed {
            Some(pressed) => post_keyboard_event(key_code, pressed),
            None => {
                post_keyboard_event(key_code, true)?;
                post_keyboard_event(key_code, false)
            }
        }
    }

    fn scroll(event: &InputEvent) -> Result<(), InputError> {
        let delta = event.delta.unwrap_or_default();
        let native_delta = delta.clamp(-120, 120);
        let scroll_event = unsafe {
            CGEventCreateScrollWheelEvent(
                std::ptr::null_mut(),
                K_CG_SCROLL_EVENT_UNIT_PIXEL,
                1,
                native_delta,
            )
        };
        post_event(scroll_event)
    }

    fn post_mouse_event(
        event_type: CGEventType,
        point: CGPoint,
        button: CGMouseButton,
    ) -> Result<(), InputError> {
        let event =
            unsafe { CGEventCreateMouseEvent(std::ptr::null_mut(), event_type, point, button) };
        post_event(event)
    }

    fn post_keyboard_event(key_code: CGKeyCode, key_down: bool) -> Result<(), InputError> {
        let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null_mut(), key_code, key_down) };
        post_event(event)
    }

    fn post_event(event: CGEventRef) -> Result<(), InputError> {
        if event.is_null() {
            return Err(InputError::CreateNativeEvent);
        }

        unsafe {
            CGEventPost(K_CG_HID_EVENT_TAP, event);
            CFRelease(event.cast_const());
        }
        Ok(())
    }

    fn key_code(key: &str) -> Option<CGKeyCode> {
        match key.to_ascii_lowercase().as_str() {
            "a" => Some(0x00),
            "s" => Some(0x01),
            "d" => Some(0x02),
            "f" => Some(0x03),
            "h" => Some(0x04),
            "g" => Some(0x05),
            "z" => Some(0x06),
            "x" => Some(0x07),
            "c" => Some(0x08),
            "v" => Some(0x09),
            "b" => Some(0x0b),
            "q" => Some(0x0c),
            "w" => Some(0x0d),
            "e" => Some(0x0e),
            "r" => Some(0x0f),
            "y" => Some(0x10),
            "t" => Some(0x11),
            "1" => Some(0x12),
            "2" => Some(0x13),
            "3" => Some(0x14),
            "4" => Some(0x15),
            "6" => Some(0x16),
            "5" => Some(0x17),
            "=" => Some(0x18),
            "9" => Some(0x19),
            "7" => Some(0x1a),
            "-" => Some(0x1b),
            "8" => Some(0x1c),
            "0" => Some(0x1d),
            "]" => Some(0x1e),
            "o" => Some(0x1f),
            "u" => Some(0x20),
            "[" => Some(0x21),
            "i" => Some(0x22),
            "p" => Some(0x23),
            "l" => Some(0x25),
            "j" => Some(0x26),
            "'" => Some(0x27),
            "k" => Some(0x28),
            ";" => Some(0x29),
            "\\" => Some(0x2a),
            "," => Some(0x2b),
            "/" => Some(0x2c),
            "n" => Some(0x2d),
            "m" => Some(0x2e),
            "." => Some(0x2f),
            "`" => Some(0x32),
            "space" => Some(0x31),
            "enter" | "return" => Some(0x24),
            "tab" => Some(0x30),
            "backspace" => Some(0x33),
            "delete" => Some(0x75),
            "escape" | "esc" => Some(0x35),
            "shift" => Some(0x38),
            "control" | "ctrl" => Some(0x3b),
            "alt" | "option" => Some(0x3a),
            "meta" | "command" | "cmd" => Some(0x37),
            "left" | "arrowleft" => Some(0x7b),
            "right" | "arrowright" => Some(0x7c),
            "down" | "arrowdown" => Some(0x7d),
            "up" | "arrowup" => Some(0x7e),
            "home" => Some(0x73),
            "end" => Some(0x77),
            "pageup" | "page-up" => Some(0x74),
            "pagedown" | "page-down" => Some(0x79),
            "insert" => Some(0x72),
            _ => None,
        }
    }

    fn key_name(key_code: CGKeyCode) -> Option<&'static str> {
        match key_code {
            0x00 => Some("a"),
            0x01 => Some("s"),
            0x02 => Some("d"),
            0x03 => Some("f"),
            0x04 => Some("h"),
            0x05 => Some("g"),
            0x06 => Some("z"),
            0x07 => Some("x"),
            0x08 => Some("c"),
            0x09 => Some("v"),
            0x0b => Some("b"),
            0x0c => Some("q"),
            0x0d => Some("w"),
            0x0e => Some("e"),
            0x0f => Some("r"),
            0x10 => Some("y"),
            0x11 => Some("t"),
            0x12 => Some("1"),
            0x13 => Some("2"),
            0x14 => Some("3"),
            0x15 => Some("4"),
            0x16 => Some("6"),
            0x17 => Some("5"),
            0x18 => Some("="),
            0x19 => Some("9"),
            0x1a => Some("7"),
            0x1b => Some("-"),
            0x1c => Some("8"),
            0x1d => Some("0"),
            0x1e => Some("]"),
            0x1f => Some("o"),
            0x20 => Some("u"),
            0x21 => Some("["),
            0x22 => Some("i"),
            0x23 => Some("p"),
            0x24 => Some("enter"),
            0x25 => Some("l"),
            0x26 => Some("j"),
            0x27 => Some("'"),
            0x28 => Some("k"),
            0x29 => Some(";"),
            0x2a => Some("\\"),
            0x2b => Some(","),
            0x2c => Some("/"),
            0x2d => Some("n"),
            0x2e => Some("m"),
            0x2f => Some("."),
            0x30 => Some("tab"),
            0x31 => Some("space"),
            0x32 => Some("`"),
            0x33 => Some("backspace"),
            0x35 => Some("escape"),
            0x37 | 0x36 => Some("meta"),
            0x38 | 0x3c => Some("shift"),
            0x3a | 0x3d => Some("alt"),
            0x3b | 0x3e => Some("control"),
            0x72 => Some("insert"),
            0x73 => Some("home"),
            0x74 => Some("pageup"),
            0x75 => Some("delete"),
            0x77 => Some("end"),
            0x79 => Some("pagedown"),
            0x7b => Some("left"),
            0x7c => Some("right"),
            0x7d => Some("down"),
            0x7e => Some("up"),
            _ => None,
        }
    }

    fn modifier_key(key_code: CGKeyCode) -> Option<(&'static str, CGEventFlags)> {
        match key_code {
            0x37 | 0x36 => Some(("meta", K_CG_EVENT_FLAG_MASK_COMMAND)),
            0x38 | 0x3c => Some(("shift", K_CG_EVENT_FLAG_MASK_SHIFT)),
            0x3a | 0x3d => Some(("alt", K_CG_EVENT_FLAG_MASK_ALTERNATE)),
            0x3b | 0x3e => Some(("control", K_CG_EVENT_FLAG_MASK_CONTROL)),
            _ => None,
        }
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn macos_key_map_includes_modifiers_and_navigation_keys() {
            for (key, key_code) in [
                ("shift", 0x38),
                ("control", 0x3b),
                ("alt", 0x3a),
                ("meta", 0x37),
                ("left", 0x7b),
                ("right", 0x7c),
                ("up", 0x7e),
                ("down", 0x7d),
                ("pageup", 0x74),
                ("pagedown", 0x79),
                ("delete", 0x75),
            ] {
                assert_eq!(super::key_code(key), Some(key_code));
            }
        }

        #[test]
        fn macos_flags_changed_keys_map_to_generic_modifier_names() {
            for (key_code, expected_key, expected_flag) in [
                (0x38, "shift", super::K_CG_EVENT_FLAG_MASK_SHIFT),
                (0x3c, "shift", super::K_CG_EVENT_FLAG_MASK_SHIFT),
                (0x3b, "control", super::K_CG_EVENT_FLAG_MASK_CONTROL),
                (0x3e, "control", super::K_CG_EVENT_FLAG_MASK_CONTROL),
                (0x3a, "alt", super::K_CG_EVENT_FLAG_MASK_ALTERNATE),
                (0x3d, "alt", super::K_CG_EVENT_FLAG_MASK_ALTERNATE),
                (0x37, "meta", super::K_CG_EVENT_FLAG_MASK_COMMAND),
                (0x36, "meta", super::K_CG_EVENT_FLAG_MASK_COMMAND),
            ] {
                assert_eq!(
                    super::modifier_key(key_code),
                    Some((expected_key, expected_flag))
                );
                assert_eq!(super::key_name(key_code), Some(expected_key));
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{InputError, InputEvent, InputEventKind};

    type Dword = u32;
    type Uint = u32;
    type Word = u16;
    type Long = i32;
    type UlongPtr = usize;
    type Int = i32;

    const INPUT_MOUSE: Dword = 0;
    const INPUT_KEYBOARD: Dword = 1;
    const MOUSEEVENTF_MOVE: Dword = 0x0001;
    const MOUSEEVENTF_LEFTDOWN: Dword = 0x0002;
    const MOUSEEVENTF_LEFTUP: Dword = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN: Dword = 0x0008;
    const MOUSEEVENTF_RIGHTUP: Dword = 0x0010;
    const MOUSEEVENTF_WHEEL: Dword = 0x0800;
    const MOUSEEVENTF_ABSOLUTE: Dword = 0x8000;
    const KEYEVENTF_KEYUP: Dword = 0x0002;
    const WHEEL_DELTA: i32 = 120;
    const SM_CXSCREEN: Int = 0;
    const SM_CYSCREEN: Int = 1;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: Long,
        dy: Long,
        mouse_data: Dword,
        flags: Dword,
        time: Dword,
        extra_info: UlongPtr,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        virtual_key: Word,
        scan_code: Word,
        flags: Dword,
        time: Dword,
        extra_info: UlongPtr,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    union InputData {
        mouse: MouseInput,
        keyboard: KeyboardInput,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Input {
        input_type: Dword,
        data: InputData,
    }

    #[link(name = "user32")]
    extern "system" {
        fn SendInput(count: Uint, inputs: *const Input, size: Int) -> Uint;
        fn GetSystemMetrics(index: Int) -> Int;
    }

    pub fn apply_event(event: &InputEvent) -> Result<(), InputError> {
        match event.kind {
            InputEventKind::MouseMove => mouse_move(event),
            InputEventKind::MouseClick => mouse_click(event),
            InputEventKind::KeyPress => key_press(event),
            InputEventKind::Scroll => scroll(event),
        }
    }

    fn mouse_move(event: &InputEvent) -> Result<(), InputError> {
        let x = event.x.unwrap_or_default();
        let y = event.y.unwrap_or_default();
        let (dx, dy) = absolute_coordinates(x, y);
        send_mouse(dx, dy, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE)
    }

    fn mouse_click(event: &InputEvent) -> Result<(), InputError> {
        let x = event.x.unwrap_or_default();
        let y = event.y.unwrap_or_default();
        let (dx, dy) = absolute_coordinates(x, y);
        let (down, up) = match event.button.as_deref().unwrap_or("primary") {
            "secondary" | "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "primary" | "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            _ => return Err(InputError::UnsupportedEvent),
        };
        send_mouse(dx, dy, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE)?;
        match event.pressed {
            Some(true) => send_mouse(0, 0, 0, down),
            Some(false) => send_mouse(0, 0, 0, up),
            None => {
                send_mouse(0, 0, 0, down)?;
                send_mouse(0, 0, 0, up)
            }
        }
    }

    fn key_press(event: &InputEvent) -> Result<(), InputError> {
        let key = event.key.as_deref().ok_or(InputError::UnsupportedKey)?;
        let virtual_key = super::windows_virtual_key(key).ok_or(InputError::UnsupportedKey)?;
        match event.pressed {
            Some(true) => send_key(virtual_key, 0),
            Some(false) => send_key(virtual_key, KEYEVENTF_KEYUP),
            None => {
                send_key(virtual_key, 0)?;
                send_key(virtual_key, KEYEVENTF_KEYUP)
            }
        }
    }

    fn scroll(event: &InputEvent) -> Result<(), InputError> {
        let delta = event.delta.unwrap_or_default().clamp(-10, 10) * WHEEL_DELTA;
        send_mouse(0, 0, delta as u32, MOUSEEVENTF_WHEEL)
    }

    fn send_mouse(dx: Long, dy: Long, mouse_data: Dword, flags: Dword) -> Result<(), InputError> {
        let input = Input {
            input_type: INPUT_MOUSE,
            data: InputData {
                mouse: MouseInput {
                    dx,
                    dy,
                    mouse_data,
                    flags,
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        send_input(&[input])
    }

    fn send_key(virtual_key: Word, flags: Dword) -> Result<(), InputError> {
        let input = Input {
            input_type: INPUT_KEYBOARD,
            data: InputData {
                keyboard: KeyboardInput {
                    virtual_key,
                    scan_code: 0,
                    flags,
                    time: 0,
                    extra_info: 0,
                },
            },
        };
        send_input(&[input])
    }

    fn send_input(inputs: &[Input]) -> Result<(), InputError> {
        let sent = unsafe {
            SendInput(
                inputs.len() as Uint,
                inputs.as_ptr(),
                std::mem::size_of::<Input>() as Int,
            )
        };
        if sent == inputs.len() as Uint {
            Ok(())
        } else {
            Err(InputError::CreateNativeEvent)
        }
    }

    fn absolute_coordinates(x: i32, y: i32) -> (Long, Long) {
        let width = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1);
        let height = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1);
        let dx = super::windows_absolute_coordinate(x, width);
        let dy = super::windows_absolute_coordinate(y, height);
        (dx, dy)
    }
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use std::ffi::c_void;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use super::{InputError, InputEvent, InputEventKind};

    type Dword = u32;
    type Long = i32;
    type LResult = isize;
    type WParam = usize;
    type LParam = isize;
    type HHook = *mut c_void;
    type HInstance = *mut c_void;

    const WH_KEYBOARD_LL: i32 = 13;
    const WH_MOUSE_LL: i32 = 14;
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;
    const WM_MOUSEMOVE: u32 = 0x0200;
    const WM_LBUTTONDOWN: u32 = 0x0201;
    const WM_LBUTTONUP: u32 = 0x0202;
    const WM_RBUTTONDOWN: u32 = 0x0204;
    const WM_RBUTTONUP: u32 = 0x0205;
    const WM_MOUSEWHEEL: u32 = 0x020A;

    #[repr(C)]
    struct KbdLlHookStruct {
        vk_code: Dword,
        scan_code: Dword,
        flags: Dword,
        time: Dword,
        extra_info: usize,
    }

    #[repr(C)]
    struct MsLlHookStruct {
        x: Long,
        y: Long,
        mouse_data: Dword,
        flags: Dword,
        time: Dword,
        extra_info: usize,
    }

    #[repr(C)]
    struct Msg {
        hwnd: *mut c_void,
        message: u32,
        w_param: WParam,
        l_param: LParam,
        time: Dword,
        pt_x: Long,
        pt_y: Long,
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowsHookExW(
            id_hook: i32,
            lpfn: unsafe extern "system" fn(i32, WParam, LParam) -> LResult,
            hmod: HInstance,
            thread_id: Dword,
        ) -> HHook;
        fn CallNextHookEx(hhk: HHook, code: i32, w_param: WParam, l_param: LParam) -> LResult;
        fn GetMessageW(msg: *mut Msg, hwnd: *mut c_void, filter_min: u32, filter_max: u32)
            -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> LResult;
    }

    static mut KEYBOARD_SENDER: Option<*const mpsc::Sender<InputEvent>> = None;
    static mut MOUSE_SENDER: Option<*const mpsc::Sender<InputEvent>> = None;

    pub fn start_capture_stream() -> Result<mpsc::Receiver<InputEvent>, InputError> {
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();

        thread::spawn(move || {
            let sender = Box::new(tx);
            let sender_ptr = Box::into_raw(sender);

            unsafe {
                KEYBOARD_SENDER = Some(sender_ptr);
                MOUSE_SENDER = Some(sender_ptr);
            }

            let kb_hook = unsafe {
                SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    keyboard_hook_proc,
                    std::ptr::null_mut(),
                    0,
                )
            };
            if kb_hook.is_null() {
                unsafe {
                    KEYBOARD_SENDER = None;
                    MOUSE_SENDER = None;
                    drop(Box::from_raw(sender_ptr));
                }
                let _ = ready_tx.send(Err(InputError::CreateNativeEvent));
                return;
            }

            let mouse_hook = unsafe {
                SetWindowsHookExW(WH_MOUSE_LL, mouse_hook_proc, std::ptr::null_mut(), 0)
            };
            if mouse_hook.is_null() {
                unsafe {
                    KEYBOARD_SENDER = None;
                    MOUSE_SENDER = None;
                    drop(Box::from_raw(sender_ptr));
                }
                let _ = ready_tx.send(Err(InputError::CreateNativeEvent));
                return;
            }

            let _ = ready_tx.send(Ok(()));

            // Message loop required for low-level hooks to work
            unsafe {
                let mut msg: Msg = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(rx),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(InputError::CreateNativeEvent),
        }
    }

    unsafe extern "system" fn keyboard_hook_proc(
        code: i32,
        w_param: WParam,
        l_param: LParam,
    ) -> LResult {
        if code >= 0 {
            if let Some(sender_ptr) = KEYBOARD_SENDER {
                let info = &*(l_param as *const KbdLlHookStruct);
                let msg = w_param as u32;
                if let Some(event) = keyboard_event(info, msg) {
                    let _ = (*sender_ptr).send(event);
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
    }

    unsafe extern "system" fn mouse_hook_proc(
        code: i32,
        w_param: WParam,
        l_param: LParam,
    ) -> LResult {
        if code >= 0 {
            if let Some(sender_ptr) = MOUSE_SENDER {
                let info = &*(l_param as *const MsLlHookStruct);
                let msg = w_param as u32;
                if let Some(event) = mouse_event(info, msg) {
                    let _ = (*sender_ptr).send(event);
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
    }

    fn keyboard_event(info: &KbdLlHookStruct, msg: u32) -> Option<InputEvent> {
        let pressed = matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN);
        let released = matches!(msg, WM_KEYUP | WM_SYSKEYUP);
        if !pressed && !released {
            return None;
        }
        let key = windows_vk_to_key_name(info.vk_code)?;
        Some(InputEvent {
            kind: InputEventKind::KeyPress,
            x: None,
            y: None,
            button: None,
            key: Some(key.to_string()),
            delta: None,
            pressed: Some(pressed),
        })
    }

    fn mouse_event(info: &MsLlHookStruct, msg: u32) -> Option<InputEvent> {
        match msg {
            WM_MOUSEMOVE => Some(InputEvent {
                kind: InputEventKind::MouseMove,
                x: Some(info.x),
                y: Some(info.y),
                button: None,
                key: None,
                delta: None,
                pressed: None,
            }),
            WM_LBUTTONDOWN => Some(InputEvent {
                kind: InputEventKind::MouseClick,
                x: Some(info.x),
                y: Some(info.y),
                button: Some("primary".to_string()),
                key: None,
                delta: None,
                pressed: Some(true),
            }),
            WM_LBUTTONUP => Some(InputEvent {
                kind: InputEventKind::MouseClick,
                x: Some(info.x),
                y: Some(info.y),
                button: Some("primary".to_string()),
                key: None,
                delta: None,
                pressed: Some(false),
            }),
            WM_RBUTTONDOWN => Some(InputEvent {
                kind: InputEventKind::MouseClick,
                x: Some(info.x),
                y: Some(info.y),
                button: Some("secondary".to_string()),
                key: None,
                delta: None,
                pressed: Some(true),
            }),
            WM_RBUTTONUP => Some(InputEvent {
                kind: InputEventKind::MouseClick,
                x: Some(info.x),
                y: Some(info.y),
                button: Some("secondary".to_string()),
                key: None,
                delta: None,
                pressed: Some(false),
            }),
            WM_MOUSEWHEEL => {
                let delta = ((info.mouse_data >> 16) as i16) as i32 / 120;
                Some(InputEvent {
                    kind: InputEventKind::Scroll,
                    x: None,
                    y: None,
                    button: None,
                    key: None,
                    delta: Some(delta.clamp(-120, 120)),
                    pressed: None,
                })
            }
            _ => None,
        }
    }

    fn windows_vk_to_key_name(vk: Dword) -> Option<&'static str> {
        match vk {
            0x41 => Some("a"),
            0x42 => Some("b"),
            0x43 => Some("c"),
            0x44 => Some("d"),
            0x45 => Some("e"),
            0x46 => Some("f"),
            0x47 => Some("g"),
            0x48 => Some("h"),
            0x49 => Some("i"),
            0x4a => Some("j"),
            0x4b => Some("k"),
            0x4c => Some("l"),
            0x4d => Some("m"),
            0x4e => Some("n"),
            0x4f => Some("o"),
            0x50 => Some("p"),
            0x51 => Some("q"),
            0x52 => Some("r"),
            0x53 => Some("s"),
            0x54 => Some("t"),
            0x55 => Some("u"),
            0x56 => Some("v"),
            0x57 => Some("w"),
            0x58 => Some("x"),
            0x59 => Some("y"),
            0x5a => Some("z"),
            0x30 => Some("0"),
            0x31 => Some("1"),
            0x32 => Some("2"),
            0x33 => Some("3"),
            0x34 => Some("4"),
            0x35 => Some("5"),
            0x36 => Some("6"),
            0x37 => Some("7"),
            0x38 => Some("8"),
            0x39 => Some("9"),
            0x20 => Some("space"),
            0x0d => Some("enter"),
            0x09 => Some("tab"),
            0x08 => Some("backspace"),
            0x2e => Some("delete"),
            0x1b => Some("escape"),
            0x10 => Some("shift"),
            0x11 => Some("control"),
            0x12 => Some("alt"),
            0x5b => Some("meta"),
            0x25 => Some("left"),
            0x26 => Some("up"),
            0x27 => Some("right"),
            0x28 => Some("down"),
            0x24 => Some("home"),
            0x23 => Some("end"),
            0x21 => Some("pageup"),
            0x22 => Some("pagedown"),
            0x2d => Some("insert"),
            0xbb => Some("="),
            0xbc => Some(","),
            0xbd => Some("-"),
            0xbe => Some("."),
            0xbf => Some("/"),
            0xc0 => Some("`"),
            0xba => Some(";"),
            0xde => Some("'"),
            0xdb => Some("["),
            0xdc => Some("\\"),
            0xdd => Some("]"),
            _ => None,
        }
    }
}

// --- Hotkey detection ---

/// Tracks modifier state from the input event stream and returns true when
/// the toggle-capture hotkey combo (Cmd+Shift+Space on macOS, Ctrl+Shift+Space on Windows) is detected.
pub struct HotkeyTracker {
    ctrl_or_cmd_down: bool,
    shift_down: bool,
}

impl HotkeyTracker {
    pub fn new() -> Self {
        Self {
            ctrl_or_cmd_down: false,
            shift_down: false,
        }
    }

    /// Feed an event. Returns true if this event completes the hotkey combo.
    pub fn feed(&mut self, event: &InputEvent) -> bool {
        if event.kind != InputEventKind::KeyPress {
            return false;
        }
        let key = match event.key.as_deref() {
            Some(k) => k,
            None => return false,
        };
        let pressed = event.pressed.unwrap_or(false);

        match key {
            #[cfg(target_os = "macos")]
            "meta" => {
                self.ctrl_or_cmd_down = pressed;
                false
            }
            #[cfg(not(target_os = "macos"))]
            "control" => {
                self.ctrl_or_cmd_down = pressed;
                false
            }
            "shift" => {
                self.shift_down = pressed;
                false
            }
            "space" if pressed => self.ctrl_or_cmd_down && self.shift_down,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_virtual_key_maps_basic_keyboard_keys() {
        for (key, expected) in [
            ("a", 0x41),
            ("z", 0x5a),
            ("0", 0x30),
            ("9", 0x39),
            ("space", 0x20),
            ("enter", 0x0d),
            ("tab", 0x09),
            ("escape", 0x1b),
            ("shift", 0x10),
            ("control", 0x11),
            ("alt", 0x12),
            ("meta", 0x5b),
            ("left", 0x25),
            ("up", 0x26),
            ("right", 0x27),
            ("down", 0x28),
            ("home", 0x24),
            ("end", 0x23),
            ("pageup", 0x21),
            ("pagedown", 0x22),
            ("insert", 0x2d),
            ("delete", 0x2e),
        ] {
            assert_eq!(super::windows_virtual_key(key), Some(expected));
        }
    }

    #[test]
    fn windows_virtual_key_maps_punctuation_captured_by_macos() {
        for (key, expected) in [
            ("=", 0xbb),
            (",", 0xbc),
            ("-", 0xbd),
            (".", 0xbe),
            ("/", 0xbf),
            ("`", 0xc0),
            (";", 0xba),
            ("'", 0xde),
            ("[", 0xdb),
            ("\\", 0xdc),
            ("]", 0xdd),
        ] {
            assert_eq!(super::windows_virtual_key(key), Some(expected));
        }
    }

    #[test]
    fn windows_virtual_key_rejects_unmapped_keys() {
        assert_eq!(super::windows_virtual_key("f13"), None);
    }

    #[test]
    fn windows_absolute_coordinate_reaches_screen_edges() {
        assert_eq!(super::windows_absolute_coordinate(0, 1920), 0);
        assert_eq!(super::windows_absolute_coordinate(1919, 1920), 65_535);
        assert_eq!(super::windows_absolute_coordinate(1920, 1920), 65_535);
        assert_eq!(super::windows_absolute_coordinate(-10, 1920), 0);
    }

    #[test]
    fn windows_absolute_coordinate_handles_small_dimensions() {
        assert_eq!(super::windows_absolute_coordinate(0, 1), 0);
        assert_eq!(super::windows_absolute_coordinate(10, 1), 0);
    }

    #[test]
    fn all_macos_captured_key_names_are_mapped_by_windows_virtual_key() {
        let macos_key_names = [
            "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p",
            "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5",
            "6", "7", "8", "9", "space", "enter", "tab", "backspace", "delete", "escape",
            "meta", "shift", "alt", "control", "home", "pageup", "pagedown", "end", "insert",
            "left", "right", "down", "up", "=", "-", "]", "[", "'", ";", "\\", ",", "/", ".",
            "`",
        ];
        for key in macos_key_names {
            assert!(
                super::windows_virtual_key(key).is_some(),
                "macOS key name {key:?} is not mapped by windows_virtual_key"
            );
        }
    }
}
