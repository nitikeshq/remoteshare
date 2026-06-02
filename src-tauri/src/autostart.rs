#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::fs;
use std::path::PathBuf;

use thiserror::Error;

#[cfg(any(target_os = "linux", target_os = "windows"))]
const APP_NAME: &str = "RemoteShare";
#[cfg(target_os = "macos")]
const APP_ID: &str = "com.remoteshare.desktop";

#[derive(Debug, Error)]
pub enum AutostartError {
    #[error("failed to resolve current executable: {0}")]
    CurrentExe(#[source] std::io::Error),
    #[cfg(target_os = "macos")]
    #[error("failed to resolve home directory")]
    HomeDir,
    #[cfg(target_os = "linux")]
    #[error("failed to resolve config directory")]
    ConfigDir,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[error("failed to create autostart directory: {0}")]
    CreateDir(#[source] std::io::Error),
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[error("failed to write autostart entry: {0}")]
    Write(#[source] std::io::Error),
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[error("failed to remove autostart entry: {0}")]
    Remove(#[source] std::io::Error),
    #[cfg(target_os = "windows")]
    #[error("failed to update Windows autostart registry: {0}")]
    WindowsRegistry(#[source] std::io::Error),
    #[cfg(target_os = "windows")]
    #[error("Windows autostart registry command failed")]
    WindowsRegistryStatus,
}

pub fn set_enabled(enabled: bool) -> Result<(), AutostartError> {
    platform_set_enabled(enabled)
}

#[cfg(target_os = "macos")]
fn platform_set_enabled(enabled: bool) -> Result<(), AutostartError> {
    let path = macos_launch_agent_path()?;
    if !enabled {
        return remove_if_exists(path);
    }

    let executable = std::env::current_exe().map_err(AutostartError::CurrentExe)?;
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        xml_escape(APP_ID),
        xml_escape(&executable.to_string_lossy())
    );

    let parent = path.parent().ok_or(AutostartError::HomeDir)?;
    fs::create_dir_all(parent).map_err(AutostartError::CreateDir)?;
    fs::write(path, body).map_err(AutostartError::Write)
}

#[cfg(target_os = "linux")]
fn platform_set_enabled(enabled: bool) -> Result<(), AutostartError> {
    let path = linux_autostart_path()?;
    if !enabled {
        return remove_if_exists(path);
    }

    let executable = std::env::current_exe().map_err(AutostartError::CurrentExe)?;
    let body = format!(
        "[Desktop Entry]\nType=Application\nName={APP_NAME}\nExec={}\nX-GNOME-Autostart-enabled=true\n",
        desktop_escape(&executable.to_string_lossy())
    );

    let parent = path.parent().ok_or(AutostartError::ConfigDir)?;
    fs::create_dir_all(parent).map_err(AutostartError::CreateDir)?;
    fs::write(path, body).map_err(AutostartError::Write)
}

#[cfg(target_os = "windows")]
fn platform_set_enabled(enabled: bool) -> Result<(), AutostartError> {
    use std::process::Command;

    let status = if enabled {
        let executable = std::env::current_exe().map_err(AutostartError::CurrentExe)?;
        let command = windows_run_command(&executable);
        Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                APP_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &command,
                "/f",
            ])
            .status()
    } else {
        let output = Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                APP_NAME,
                "/f",
            ])
            .output()
            .map_err(AutostartError::WindowsRegistry)?;

        if output.status.success() || windows_registry_missing_value(&output.stderr) {
            return Ok(());
        }

        return Err(AutostartError::WindowsRegistryStatus);
    }
    .map_err(AutostartError::WindowsRegistry)?;

    if status.success() {
        Ok(())
    } else {
        Err(AutostartError::WindowsRegistryStatus)
    }
}

#[cfg(any(test, target_os = "windows"))]
fn windows_run_command(executable: &PathBuf) -> String {
    format!("\"{}\"", executable.to_string_lossy().replace('"', ""))
}

#[cfg(any(test, target_os = "windows"))]
fn windows_registry_missing_value(stderr: &[u8]) -> bool {
    String::from_utf8_lossy(stderr)
        .to_ascii_lowercase()
        .contains("unable to find")
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_set_enabled(_enabled: bool) -> Result<(), AutostartError> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_launch_agent_path() -> Result<PathBuf, AutostartError> {
    dirs_next::home_dir()
        .map(|home| {
            home.join("Library")
                .join("LaunchAgents")
                .join(format!("{APP_ID}.plist"))
        })
        .ok_or(AutostartError::HomeDir)
}

#[cfg(target_os = "linux")]
fn linux_autostart_path() -> Result<PathBuf, AutostartError> {
    dirs_next::config_dir()
        .map(|config| config.join("autostart").join("remoteshare.desktop"))
        .ok_or(AutostartError::ConfigDir)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn remove_if_exists(path: PathBuf) -> Result<(), AutostartError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AutostartError::Remove(error)),
    }
}

#[cfg(any(test, target_os = "macos"))]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(any(test, target_os = "linux"))]
fn desktop_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    #[test]
    fn macos_launch_agent_xml_escape_handles_special_chars() {
        assert_eq!(
            super::xml_escape(r#"RemoteShare & "Desk" <Input> 'Test'"#),
            "RemoteShare &amp; &quot;Desk&quot; &lt;Input&gt; &apos;Test&apos;"
        );
    }

    #[test]
    fn linux_desktop_escape_quotes_exec_path() {
        assert_eq!(
            super::desktop_escape(r#"/opt/RemoteShare "Desk"\RemoteShare"#),
            r#""/opt/RemoteShare \"Desk\"\\RemoteShare""#
        );
    }

    #[test]
    fn windows_run_command_quotes_executable_path() {
        let path = std::path::PathBuf::from(r#"C:\Program Files\RemoteShare\Remote"Share.exe"#);

        assert_eq!(
            super::windows_run_command(&path),
            r#""C:\Program Files\RemoteShare\RemoteShare.exe""#
        );
    }

    #[test]
    fn windows_registry_missing_value_detects_missing_autostart_entry() {
        assert!(super::windows_registry_missing_value(
            b"ERROR: The system was unable to find the specified registry key or value."
        ));
        assert!(!super::windows_registry_missing_value(
            b"ERROR: Access is denied."
        ));
    }
}
