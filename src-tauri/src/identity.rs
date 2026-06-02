#[cfg(test)]
use std::sync::{Mutex, OnceLock};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::crypto::{fingerprint_from_public_key, identity_keypair};

const STATE_FILE: &str = "state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub id: String,
    pub name: String,
    pub platform: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub identity_private_key: String,
    #[serde(default)]
    pub identity_public_key: String,
    pub public_key_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    #[serde(default = "default_computer_role")]
    pub role: ComputerRole,
    #[serde(default = "default_true")]
    pub auto_start: bool,
    #[serde(default = "default_true")]
    pub trusted_reconnect: bool,
    #[serde(default = "default_true")]
    pub private_network_only: bool,
    #[serde(default)]
    pub allow_incoming_control: bool,
    #[serde(default)]
    pub manual_endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerRole {
    Main,
    Client,
    Both,
}

impl ComputerRole {
    pub fn can_send_input(&self) -> bool {
        matches!(self, Self::Main | Self::Both)
    }

    pub fn can_receive_input(&self) -> bool {
        matches!(self, Self::Client | Self::Both)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub public_key_fingerprint: String,
    #[serde(default)]
    pub public_key: Option<String>,
    #[serde(default)]
    pub shared_secret: Option<String>,
    #[serde(default)]
    pub last_endpoint: Option<String>,
    #[serde(default)]
    pub recent_endpoints: Vec<String>,
    #[serde(default)]
    pub allow_incoming_control: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub identity: DeviceIdentity,
    pub settings: UserSettings,
    pub trusted_devices: Vec<TrustedDevice>,
}

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("failed to create config directory: {0}")]
    CreateDir(#[source] std::io::Error),
    #[cfg(unix)]
    #[error("failed to secure config permissions: {0}")]
    Permissions(#[source] std::io::Error),
    #[error("failed to read persisted state: {0}")]
    Read(#[source] std::io::Error),
    #[error("failed to parse persisted state: {0}")]
    Parse(#[source] serde_json::Error),
    #[error("failed to serialize persisted state: {0}")]
    Serialize(#[source] serde_json::Error),
    #[error("failed to write persisted state: {0}")]
    Write(#[source] std::io::Error),
}

impl PersistedState {
    pub fn load_or_create() -> Self {
        match Self::load() {
            Ok(mut state) => {
                state.ensure_identity_keypair();
                state
            }
            Err(error) => {
                preserve_failed_state(&error);
                let state = Self::new();
                let _ = state.save();
                state
            }
        }
    }

    pub fn save(&self) -> Result<(), IdentityError> {
        let path = state_path()?;
        let temp_path = path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(self).map_err(IdentityError::Serialize)?;
        let mut file = create_state_file(&temp_path)?;
        file.write_all(body.as_bytes())
            .map_err(IdentityError::Write)?;
        file.sync_all().map_err(IdentityError::Write)?;
        drop(file);

        #[cfg(target_os = "windows")]
        if path.exists() {
            fs::remove_file(&path).map_err(IdentityError::Write)?;
        }

        fs::rename(&temp_path, &path).map_err(IdentityError::Write)?;
        secure_state_file(&path)
    }

    fn load() -> Result<Self, IdentityError> {
        let path = state_path()?;
        let body = fs::read_to_string(path).map_err(IdentityError::Read)?;
        serde_json::from_str(&body).map_err(IdentityError::Parse)
    }

    fn new() -> Self {
        let id = Uuid::new_v4().to_string();
        let (identity_private_key, identity_public_key) = identity_keypair();
        let public_key_fingerprint = fingerprint_from_public_key(&identity_public_key)
            .expect("generated identity public key should be valid");
        Self {
            identity: DeviceIdentity {
                public_key_fingerprint,
                secret: String::new(),
                identity_private_key,
                identity_public_key,
                id,
                name: hostname(),
                platform: std::env::consts::OS.to_string(),
            },
            settings: UserSettings {
                role: ComputerRole::Main,
                auto_start: true,
                trusted_reconnect: true,
                private_network_only: true,
                allow_incoming_control: false,
                manual_endpoint: None,
            },
            trusted_devices: Vec::new(),
        }
    }

    fn ensure_identity_keypair(&mut self) {
        let existing_fingerprint = fingerprint_from_public_key(&self.identity.identity_public_key);
        if self.identity.identity_private_key.is_empty()
            || self.identity.identity_public_key.is_empty()
            || existing_fingerprint
                .as_ref()
                .is_ok_and(|fingerprint| fingerprint != &self.identity.public_key_fingerprint)
            || existing_fingerprint.is_err()
        {
            let (identity_private_key, identity_public_key) = identity_keypair();
            self.identity.identity_private_key = identity_private_key;
            self.identity.identity_public_key = identity_public_key;
            self.identity.public_key_fingerprint =
                fingerprint_from_public_key(&self.identity.identity_public_key)
                    .expect("generated identity public key should be valid");
            self.identity.secret.clear();
            let _ = self.save();
        }
    }
}

fn state_path() -> Result<PathBuf, IdentityError> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(IdentityError::CreateDir)?;
    secure_config_dir(&dir)?;
    Ok(dir.join(STATE_FILE))
}

fn create_state_file(path: &PathBuf) -> Result<fs::File, IdentityError> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path).map_err(IdentityError::Write)
}

#[cfg(unix)]
fn secure_config_dir(path: &PathBuf) -> Result<(), IdentityError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(IdentityError::Permissions)
}

#[cfg(not(unix))]
fn secure_config_dir(_path: &PathBuf) -> Result<(), IdentityError> {
    Ok(())
}

#[cfg(unix)]
fn secure_state_file(path: &PathBuf) -> Result<(), IdentityError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(IdentityError::Permissions)
}

#[cfg(not(unix))]
fn secure_state_file(_path: &PathBuf) -> Result<(), IdentityError> {
    Ok(())
}

fn preserve_failed_state(error: &IdentityError) {
    if matches!(
        error,
        IdentityError::Read(read_error) if read_error.kind() == std::io::ErrorKind::NotFound
    ) {
        return;
    }

    let Ok(path) = state_path() else {
        return;
    };
    if !path.exists() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let backup_path = path.with_extension(format!("json.failed-{timestamp}"));
    let _ = fs::copy(path, backup_path);
}

fn config_dir() -> PathBuf {
    #[cfg(test)]
    if let Some(dir) = test_config_dir() {
        return dir;
    }

    dirs_next::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("RemoteShare")
}

#[cfg(test)]
static TEST_CONFIG_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
pub fn set_test_config_dir(path: PathBuf) {
    let mut guard = TEST_CONFIG_DIR
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("test config dir lock poisoned");
    *guard = Some(path);
}

#[cfg(test)]
fn test_config_dir() -> Option<PathBuf> {
    TEST_CONFIG_DIR
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("test config dir lock poisoned")
        .clone()
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "This computer".to_string())
}

fn default_true() -> bool {
    true
}

fn default_computer_role() -> ComputerRole {
    ComputerRole::Main
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use crate::crypto::fingerprint_from_public_key;

    use super::{set_test_config_dir, ComputerRole, PersistedState, STATE_FILE};

    #[test]
    fn parses_older_state_with_missing_optional_fields() {
        let state = serde_json::from_str::<PersistedState>(
            r#"{
  "identity": {
    "id": "local-device",
    "name": "Local Mac",
    "platform": "macos",
    "publicKeyFingerprint": "local-fingerprint"
  },
  "settings": {},
  "trustedDevices": [
    {
      "id": "remote-device",
      "name": "Remote Windows",
      "platform": "windows",
      "publicKeyFingerprint": "remote-fingerprint"
    }
  ]
}"#,
        )
        .expect("older state should parse");

        assert_eq!(state.identity.id, "local-device");
        assert_eq!(state.identity.secret, "");
        assert_eq!(state.identity.identity_private_key, "");
        assert_eq!(state.identity.identity_public_key, "");
        assert_eq!(state.settings.role, ComputerRole::Main);
        assert!(state.settings.auto_start);
        assert!(state.settings.trusted_reconnect);
        assert!(!state.settings.allow_incoming_control);
        assert_eq!(state.settings.manual_endpoint, None);
        assert_eq!(state.trusted_devices.len(), 1);
        assert_eq!(state.trusted_devices[0].public_key, None);
        assert_eq!(state.trusted_devices[0].shared_secret, None);
        assert_eq!(state.trusted_devices[0].last_endpoint, None);
        assert!(state.trusted_devices[0].recent_endpoints.is_empty());
        assert!(!state.trusted_devices[0].allow_incoming_control);
    }

    #[test]
    fn new_state_uses_public_key_fingerprint() {
        let state = PersistedState::new();

        assert_eq!(state.identity.secret, "");
        assert_eq!(state.identity.identity_private_key.len(), 64);
        assert_eq!(state.identity.identity_public_key.len(), 64);
        assert_eq!(
            state.identity.public_key_fingerprint,
            fingerprint_from_public_key(&state.identity.identity_public_key)
                .expect("identity public key should parse")
        );
    }

    #[test]
    fn older_state_migrates_to_identity_keypair_on_load() {
        let dir = std::env::temp_dir().join(format!(
            "remoteshare-identity-key-migration-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("test config dir should be created");
        fs::write(
            dir.join(STATE_FILE),
            r#"{
  "identity": {
    "id": "local-device",
    "name": "Local Mac",
    "platform": "macos",
    "secret": "legacy-secret",
    "publicKeyFingerprint": "legacy-fingerprint"
  },
  "settings": {},
  "trustedDevices": []
}"#,
        )
        .expect("legacy state should be written");
        set_test_config_dir(dir.clone());

        let state = PersistedState::load_or_create();

        assert_eq!(state.identity.id, "local-device");
        assert_eq!(state.identity.secret, "");
        assert_eq!(state.identity.identity_private_key.len(), 64);
        assert_eq!(state.identity.identity_public_key.len(), 64);
        assert_ne!(state.identity.public_key_fingerprint, "legacy-fingerprint");
        assert_eq!(
            state.identity.public_key_fingerprint,
            fingerprint_from_public_key(&state.identity.identity_public_key)
                .expect("migrated identity public key should parse")
        );
    }

    #[test]
    fn backs_up_corrupt_state_before_recreating() {
        let dir = std::env::temp_dir().join(format!(
            "remoteshare-corrupt-state-backup-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("test config dir should be created");
        fs::write(dir.join(STATE_FILE), "{not valid json")
            .expect("corrupt state should be written");
        set_test_config_dir(dir.clone());

        let state = PersistedState::load_or_create();

        assert!(!state.identity.id.is_empty());
        let backup_exists = fs::read_dir(&dir)
            .expect("test config dir should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("state.json.failed-")
            });
        assert!(backup_exists, "corrupt state should be backed up");
    }

    #[cfg(unix)]
    #[test]
    fn save_uses_private_unix_permissions() {
        let dir = std::env::temp_dir().join(format!(
            "remoteshare-private-state-permissions-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        set_test_config_dir(dir.clone());

        let state = PersistedState::new();
        state.save().expect("state should save");

        let dir_mode = fs::metadata(&dir)
            .expect("config dir should exist")
            .permissions()
            .mode()
            & 0o777;
        let file_mode = fs::metadata(dir.join(STATE_FILE))
            .expect("state file should exist")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }
}
