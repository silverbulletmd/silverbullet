//! Config model, directory resolution, load/save, and space resolution for the
//! `sb` CLI.
//!
//! ## On-disk shape
//! ```json
//! {
//!   "spaces": [
//!     {
//!       "id": "...", "name": "...", "url": "...",
//!       "auth": { "method": "token", "encryptedToken": "..." },
//!       "appOnlyField": 42
//!     }
//!   ]
//! }
//! ```
//!
//! Unknown per-space fields (added by the Desktop layer) survive load→save
//! round-trips via a flattened [`serde_json::Map`] on [`SpaceConfig`].
//!
//! The file is written with 2-space JSON indentation + trailing newline, mode
//! 0600 (unix), directory mode 0700 (unix).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::crypto;

/// Authentication credentials for a space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AuthConfig {
    /// `"token"`, `"password"`, `"browser"`, or `"none"`.
    pub method: String,
    #[serde(
        rename = "encryptedToken",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub encrypted_token: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub username: String,
    #[serde(
        rename = "encryptedPassword",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub encrypted_password: String,
    #[serde(
        rename = "encryptedRefreshToken",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub encrypted_refresh_token: String,
    #[serde(rename = "expiresAt", default, skip_serializing_if = "is_zero")]
    pub expires_at: i64,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Optional per-space server-side environment overrides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct SpaceEnv {
    #[serde(
        rename = "indexPage",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub index_page: String,
    #[serde(rename = "readOnly", skip_serializing_if = "is_false", default)]
    pub read_only: bool,
    #[serde(
        rename = "shellBackend",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub shell_backend: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

fn is_false(b: &bool) -> bool {
    !b
}

/// A configured SilverBullet space.
///
/// Unknown JSON fields (added by the Desktop layer) are preserved in `extra` and
/// round-trip transparently through serialize/deserialize.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct SpaceConfig {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub url: String,
    #[serde(
        rename = "folderPath",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub folder_path: String,
    pub auth: AuthConfig,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub env: Option<SpaceEnv>,
    /// Preserves any Desktop-specific fields that Server does not model.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Top-level config structure: a list of spaces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Config {
    pub spaces: Vec<SpaceConfig>,
}

/// Compute the config directory from explicit XDG / home values (pure, testable).
///
/// `xdg` — value of `$XDG_CONFIG_HOME` (empty string means "not set").
/// `home` — value of `$HOME` / `dirs::home_dir()`.
pub fn config_dir_from(xdg: Option<&str>, home: &str) -> PathBuf {
    match xdg {
        Some(x) if !x.is_empty() => PathBuf::from(x).join("silverbullet"),
        _ => PathBuf::from(home).join(".config").join("silverbullet"),
    }
}

/// The environment inputs that decide where the registry lives.
#[derive(Debug, Clone, Default)]
pub struct ConfigEnv {
    /// `$SB_CONFIG_DIR`: the exact directory, used by SilverBullet Desktop and tests.
    pub sb_config_dir: Option<String>,
    pub xdg: Option<String>,
    pub appdata: Option<String>,
    pub home: String,
    pub windows: bool,
}

impl ConfigEnv {
    fn current() -> Self {
        let var = |name| std::env::var(name).ok().filter(|v: &String| !v.is_empty());
        ConfigEnv {
            sb_config_dir: var("SB_CONFIG_DIR"),
            xdg: var("XDG_CONFIG_HOME"),
            appdata: var("APPDATA"),
            home: home_dir(),
            windows: cfg!(windows),
        }
    }
}

/// Registry directory shared with SilverBullet Desktop (pure, testable).
pub fn config_dir_for(env: &ConfigEnv) -> PathBuf {
    if let Some(dir) = &env.sb_config_dir {
        return PathBuf::from(dir);
    }
    // Desktop always uses %APPDATA% on Windows, so XDG_CONFIG_HOME (common in
    // Git Bash and MSYS2) must not move sb elsewhere.
    if env.windows {
        if let Some(appdata) = &env.appdata {
            return PathBuf::from(appdata).join("SilverBullet");
        }
    }
    config_dir_from(env.xdg.as_deref(), &env.home)
}

/// Returns the registry directory: `$SB_CONFIG_DIR`, `%APPDATA%\SilverBullet`
/// on Windows, else `$XDG_CONFIG_HOME/silverbullet` or `~/.config/silverbullet`.
pub fn config_dir() -> PathBuf {
    let env = ConfigEnv::current();
    let dir = config_dir_for(&env);
    if env.windows && env.sb_config_dir.is_none() {
        static MOVED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
        MOVED.get_or_init(|| {
            let old = config_dir_from(None, &env.home);
            match migrate_legacy_dir(&old, &dir) {
                Ok(true) => eprintln!("Moved sb configuration to {}", dir.display()),
                Ok(false) => {}
                Err(e) => eprintln!("Could not move sb configuration to {}: {e}", dir.display()),
            }
        });
    }
    dir
}

const LEGACY_MARKER: &str = ".sb-legacy-imported";

/// Bring spaces from a previous registry location (once). When the new
/// registry already exists (e.g. SilverBullet Desktop created it), legacy
/// remote spaces are added to it; folder spaces belong to Desktop and are
/// left out. Secrets are re-encrypted for the new key, which is never
/// replaced. The old files stay in place as a backup.
pub fn migrate_legacy_dir(old: &Path, new: &Path) -> Result<bool, String> {
    if !old.join("config.json").is_file() || new.join(LEGACY_MARKER).exists() {
        return Ok(false);
    }
    let _lock = lock(new)?;
    if new.join(LEGACY_MARKER).exists() {
        return Ok(false);
    }
    let fresh = !new.join("config.json").exists();
    let legacy = load_from(old)?;
    let old_key = read_key(old)?;
    let new_key = match read_key(new)? {
        Some(key) => key,
        None => match old_key {
            Some(key) => {
                write_private(&new.join("key"), &key)
                    .map_err(|e| format!("writing {}: {e}", new.join("key").display()))?;
                key
            }
            None => crypto::load_or_create_key(new).map_err(|e| e.to_string())?,
        },
    };
    let mut cfg = load_from(new)?;
    for mut space in legacy.spaces {
        if (!fresh && !space.folder_path.is_empty()) || cfg.spaces.iter().any(|s| s.id == space.id)
        {
            continue;
        }
        if old_key != Some(new_key) && !reencrypt(&mut space.auth, old_key.as_ref(), &new_key) {
            eprintln!(
                "Saved credentials for space {:?} could not be moved; run `sb space login {}` or add it again.",
                space.name, space.name
            );
            space.auth = AuthConfig {
                method: String::new(),
                ..Default::default()
            };
        }
        let taken = |name: &str| cfg.spaces.iter().any(|s| s.name == name);
        if taken(&space.name) {
            space.name = (2..)
                .map(|n| format!("{}-{n}", space.name))
                .find(|candidate| !taken(candidate))
                .expect("an unused suffix exists");
        }
        cfg.spaces.push(space);
    }
    save_to(new, &cfg)?;
    write_private(&new.join(LEGACY_MARKER), b"")
        .map_err(|e| format!("writing {}: {e}", new.join(LEGACY_MARKER).display()))?;
    Ok(true)
}

fn read_key(dir: &Path) -> Result<Option<[u8; crypto::KEY_LEN]>, String> {
    match std::fs::read(dir.join("key")) {
        Ok(bytes) => bytes
            .try_into()
            .map(Some)
            .map_err(|_| format!("{} is not a valid key", dir.join("key").display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("reading {}: {e}", dir.join("key").display())),
    }
}

/// Re-encrypt every stored secret from `from` to `to`; false if any fails.
fn reencrypt(
    auth: &mut AuthConfig,
    from: Option<&[u8; crypto::KEY_LEN]>,
    to: &[u8; crypto::KEY_LEN],
) -> bool {
    for field in [
        &mut auth.encrypted_token,
        &mut auth.encrypted_password,
        &mut auth.encrypted_refresh_token,
    ] {
        if field.is_empty() {
            continue;
        }
        let Some(plain) = from.and_then(|key| crypto::decrypt_with_key(key, field).ok()) else {
            return false;
        };
        let Ok(cipher) = crypto::encrypt_with_key(to, &plain) else {
            return false;
        };
        *field = cipher;
    }
    true
}

/// Returns `config_dir()/config.json`.
pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

fn home_dir() -> String {
    // HOME env var is the standard on unix; on Windows USERPROFILE is the
    // equivalent. Fall back to an empty string (producing a relative path)
    // when neither is set — callers should always have one of these set.
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

/// Load config from `dir/config.json`.
///
/// If the file does not exist, returns `Ok(Config { spaces: [] })`.
/// Parse errors are returned as `Err`.
pub fn load_from(dir: &Path) -> Result<Config, String> {
    let path = dir.join("config.json");
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Config { spaces: vec![] });
        }
        Err(e) => return Err(format!("reading config {}: {e}", path.display())),
    };
    serde_json::from_slice(&data).map_err(|e| format!("parsing config: {e}"))
}

/// Load config from the default `config_dir()`.
pub fn load() -> Result<Config, String> {
    load_from(&config_dir())
}

/// Serialize and write `cfg` to `dir/config.json` (pretty JSON, 2-space
/// indent, trailing newline, mode 0600 on unix, dir mode 0700).
pub fn save_to(dir: &Path, cfg: &Config) -> Result<(), String> {
    create_dir_private(dir)?;

    let path = dir.join("config.json");
    let mut value = match std::fs::read(&path) {
        Ok(data) => serde_json::from_slice::<Value>(&data)
            .map_err(|e| format!("parsing existing config: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(format!("reading existing config: {e}")),
    };
    let object = value
        .as_object_mut()
        .ok_or("existing config must be an object")?;
    object.insert(
        "spaces".into(),
        serde_json::to_value(&cfg.spaces).map_err(|e| format!("serializing spaces: {e}"))?,
    );
    let mut data =
        serde_json::to_vec_pretty(&value).map_err(|e| format!("serializing config: {e}"))?;
    data.push(b'\n');

    write_private(&path, &data).map_err(|e| format!("writing config {}: {e}", path.display()))
}

/// Save config to the default `config_dir()`.
pub fn save(cfg: &Config) -> Result<(), String> {
    save_to(&config_dir(), cfg)
}

/// Resolve a space by optional name.
///
/// * `Some(name)` — find by name; error if not found.
/// * `None` — return the sole space; error if zero or more than one.
pub fn resolve_space<'a>(cfg: &'a Config, name: Option<&str>) -> Result<&'a SpaceConfig, String> {
    // Registered folders are canonical paths; canonicalize the cwd to match
    // (e.g. /tmp vs /private/tmp on macOS).
    let cwd = std::env::current_dir()
        .ok()
        .map(|cwd| std::fs::canonicalize(&cwd).unwrap_or(cwd));
    resolve_space_at(cfg, name, cwd.as_deref())
}

/// Single-file and built-in entries that SilverBullet Desktop keeps in the
/// registry; they are never selected implicitly.
pub fn is_hidden(space: &SpaceConfig) -> bool {
    space.extra.get("ephemeral").is_some_and(|v| !v.is_null())
        || space.extra.get("builtin") == Some(&Value::Bool(true))
}

/// Strip Windows' `\\?\` verbatim prefix that `canonicalize` adds.
pub fn strip_verbatim(path: &str) -> &str {
    path.strip_prefix(r"\\?\").unwrap_or(path)
}

/// Whether `path` is `folder` or lies inside it. Windows paths compare without
/// their verbatim prefix and case-insensitively.
pub fn folder_contains(folder: &str, path: &str, windows: bool) -> bool {
    let normalize = |p: &str| {
        if windows {
            strip_verbatim(p).replace('/', "\\").to_lowercase()
        } else {
            p.to_string()
        }
    };
    let separator = if windows { '\\' } else { '/' };
    let folder = normalize(folder);
    let folder = folder.trim_end_matches(separator);
    let path = normalize(path);
    path == folder
        || path
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with(separator))
}

/// Like [`resolve_space`], but without a name the folder space containing `cwd`
/// is chosen first (the most specific folder wins).
pub fn resolve_space_at<'a>(
    cfg: &'a Config,
    name: Option<&str>,
    cwd: Option<&Path>,
) -> Result<&'a SpaceConfig, String> {
    if name.is_none() {
        if let Some(cwd) = cwd {
            let cwd = cwd.to_string_lossy();
            let containing = cfg
                .spaces
                .iter()
                .filter(|s| {
                    !is_hidden(s)
                        && !s.folder_path.is_empty()
                        && folder_contains(&s.folder_path, &cwd, cfg!(windows))
                })
                .max_by_key(|s| Path::new(&s.folder_path).components().count());
            if let Some(space) = containing {
                return Ok(space);
            }
        }
    }
    if let Some(n) = name {
        cfg.spaces
            .iter()
            .find(|s| s.name == n && !is_hidden(s))
            .or_else(|| cfg.spaces.iter().find(|s| s.name == n))
            .ok_or_else(|| format!("space \"{n}\" not found"))
    } else {
        let visible: Vec<&SpaceConfig> = cfg.spaces.iter().filter(|s| !is_hidden(s)).collect();
        match visible.len() {
            1 => Ok(visible[0]),
            0 => Err("no spaces configured; use 'space add' or pass --url".to_string()),
            _ => Err("multiple spaces configured; use -s <name> to select one".to_string()),
        }
    }
}

/// Generate a random UUID v4 string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn create_dir_private(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .map_err(|e| format!("creating config dir {}: {e}", dir.display()))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("creating config dir {}: {e}", dir.display()))
    }
}

pub fn lock(dir: &Path) -> Result<std::fs::File, String> {
    create_dir_private(dir)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(dir.join("config.lock"))
        .map_err(|e| format!("opening config lock: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err("timed out waiting for config lock; retry the command".into());
            }
            Err(e) => return Err(format!("locking config: {e}")),
        }
    }
}

fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    file.write_all(data)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_space_fields_survive_round_trip() {
        let json = r#"{"spaces":[{"id":"x","name":"work","url":"https://x","auth":{"method":"none"},"appOnlyField":42}]}"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        let out = serde_json::to_string(&cfg).unwrap();
        assert!(out.contains("appOnlyField"), "appOnlyField must survive");
        assert!(out.contains("42"), "value 42 must survive");
    }

    #[test]
    fn save_preserves_unrelated_folder_environment_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        std::fs::write(&path, r#"{"spaces":[{"id":"folder","name":"sample","folderPath":"/notes","auth":{"method":"none"},"env":{"indexPage":"Home","revisions":{"enabled":true},"futureOption":42}}]}"#).unwrap();
        let mut cfg = load_from(tmp.path()).unwrap();
        cfg.spaces.push(SpaceConfig {
            id: "remote".into(),
            name: "remote".into(),
            ..Default::default()
        });
        save_to(tmp.path(), &cfg).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(
            saved["spaces"][0]["env"]["revisions"],
            serde_json::json!({"enabled":true})
        );
        assert_eq!(saved["spaces"][0]["env"]["futureOption"], 42);
        assert_eq!(saved["spaces"][0]["env"]["indexPage"], "Home");
    }

    #[test]
    fn save_rejects_nonobject_existing_config_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        for json in ["null", "42", "true", "[]", r#""text""#] {
            std::fs::write(&path, json).unwrap();
            assert!(save_to(tmp.path(), &Config::default()).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
        }
    }

    #[test]
    fn unknown_auth_fields_survive_round_trip() {
        let cfg: Config = serde_json::from_str(r#"{"spaces":[{"id":"x","name":"sample","auth":{"method":"browser","futureField":42,"encryptedRefreshToken":"cipher","expiresAt":123}}]}"#).unwrap();
        let value = serde_json::to_value(cfg).unwrap();
        assert_eq!(value["spaces"][0]["auth"]["futureField"], 42);
        assert_eq!(
            value["spaces"][0]["auth"]["encryptedRefreshToken"],
            "cipher"
        );
        assert_eq!(value["spaces"][0]["auth"]["expiresAt"], 123);
    }

    #[test]
    fn save_preserves_top_level_fields_and_rejects_invalid_existing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        std::fs::write(&path, r#"{"spaces":[],"appSetting":42}"#).unwrap();
        save_to(tmp.path(), &Config::default()).unwrap();
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["appSetting"], 42);
        std::fs::write(&path, "invalid").unwrap();
        assert!(save_to(tmp.path(), &Config::default()).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "invalid");
    }

    #[cfg(unix)]
    #[test]
    fn save_atomically_replaces_existing_file_with_private_permissions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        std::fs::write(&path, r#"{"spaces":[]}"#).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let inode = std::fs::metadata(&path).unwrap().ino();
        save_to(tmp.path(), &Config::default()).unwrap();
        let meta = std::fs::metadata(path).unwrap();
        assert_ne!(meta.ino(), inode);
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn lock_serializes_config_transactions() {
        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), &Config::default()).unwrap();
        std::thread::scope(|scope| {
            for index in 0..4 {
                let dir = tmp.path();
                scope.spawn(move || {
                    let _lock = lock(dir).unwrap();
                    let mut cfg = load_from(dir).unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    cfg.spaces.push(SpaceConfig {
                        name: format!("sample-{index}"),
                        ..Default::default()
                    });
                    save_to(dir, &cfg).unwrap();
                });
            }
        });
        assert_eq!(load_from(tmp.path()).unwrap().spaces.len(), 4);
    }

    #[test]
    fn empty_extra_emits_no_stray_fields() {
        let space = SpaceConfig {
            id: "id1".into(),
            name: "s1".into(),
            url: "https://x".into(),
            auth: AuthConfig {
                method: "none".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let out = serde_json::to_string(&space).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let obj = v.as_object().unwrap();
        for key in obj.keys() {
            assert!(
                ["id", "name", "url", "auth"].contains(&key.as_str()),
                "unexpected key: {key}"
            );
        }
    }

    #[test]
    fn load_save_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    id: "test-id-1".into(),
                    name: "work".into(),
                    url: "https://work.example.com".into(),
                    auth: AuthConfig {
                        method: "token".into(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                SpaceConfig {
                    id: "test-id-2".into(),
                    name: "personal".into(),
                    url: "https://personal.example.com".into(),
                    auth: AuthConfig {
                        method: "none".into(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ],
        };

        save_to(dir, &cfg).unwrap();
        let loaded = load_from(dir).unwrap();

        assert_eq!(loaded.spaces.len(), 2);
        assert_eq!(loaded.spaces[0].id, "test-id-1");
        assert_eq!(loaded.spaces[0].name, "work");
        assert_eq!(loaded.spaces[0].url, "https://work.example.com");
        assert_eq!(loaded.spaces[0].auth.method, "token");
        assert_eq!(loaded.spaces[1].id, "test-id-2");
        assert_eq!(loaded.spaces[1].name, "personal");
    }

    #[test]
    fn load_missing_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let loaded = load_from(tmp.path()).unwrap();
        assert!(loaded.spaces.is_empty());
    }

    #[test]
    fn unknown_fields_survive_load_save_round_trip_via_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        let json = r#"{
  "spaces": [
    {
      "id": "abc-123",
      "name": "my-notes",
      "folderPath": "/home/user/notes",
      "preferredPort": 3010,
      "auth": { "method": "none" },
      "sync": { "enabled": true, "remoteUrl": "https://remote.example.com" },
      "lastOpened": 1711526400000,
      "customAppField": "should-survive"
    }
  ]
}"#;

        std::fs::write(dir.join("config.json"), json).unwrap();
        let mut cfg = load_from(dir).unwrap();

        assert_eq!(cfg.spaces[0].id, "abc-123");
        assert_eq!(cfg.spaces[0].name, "my-notes");
        assert_eq!(cfg.spaces[0].folder_path, "/home/user/notes");
        assert_eq!(cfg.spaces[0].auth.method, "none");

        cfg.spaces[0].name = "renamed-notes".into();

        save_to(dir, &cfg).unwrap();
        let out_data = std::fs::read_to_string(dir.join("config.json")).unwrap();
        let out: serde_json::Value = serde_json::from_str(&out_data).unwrap();

        let space0 = &out["spaces"][0];
        assert_eq!(space0["name"], "renamed-notes");
        assert_eq!(space0["preferredPort"], 3010);
        assert_eq!(space0["customAppField"], "should-survive");
        assert!(space0.get("sync").is_some(), "sync field must survive");
        assert!(
            space0.get("lastOpened").is_some(),
            "lastOpened must survive"
        );
    }

    #[test]
    fn config_dir_from_uses_xdg_when_set() {
        let d = config_dir_from(Some("/custom/xdg"), "/home/user");
        assert_eq!(d, PathBuf::from("/custom/xdg/silverbullet"));
    }

    #[test]
    fn config_dir_from_falls_back_to_home() {
        let d = config_dir_from(None, "/home/user");
        assert_eq!(d, PathBuf::from("/home/user/.config/silverbullet"));
    }

    #[test]
    fn config_dir_from_empty_xdg_falls_back_to_home() {
        let d = config_dir_from(Some(""), "/home/user");
        assert_eq!(d, PathBuf::from("/home/user/.config/silverbullet"));
    }

    fn env(windows: bool) -> ConfigEnv {
        ConfigEnv {
            sb_config_dir: None,
            xdg: None,
            appdata: Some("/appdata".into()),
            home: "/home/user".into(),
            windows,
        }
    }

    #[test]
    fn explicit_config_dir_wins_on_every_platform() {
        for windows in [false, true] {
            let mut e = env(windows);
            e.sb_config_dir = Some("/isolated/config".into());
            e.xdg = Some("/custom/xdg".into());
            assert_eq!(config_dir_for(&e), PathBuf::from("/isolated/config"));
        }
    }

    #[test]
    fn windows_uses_appdata() {
        assert_eq!(
            config_dir_for(&env(true)),
            PathBuf::from("/appdata").join("SilverBullet")
        );
    }

    #[test]
    fn windows_ignores_xdg_so_desktop_and_sb_agree() {
        let mut e = env(true);
        e.xdg = Some("/custom/xdg".into());
        assert_eq!(
            config_dir_for(&e),
            PathBuf::from("/appdata").join("SilverBullet")
        );
    }

    #[test]
    fn windows_folder_matching_ignores_verbatim_prefix_and_case() {
        assert!(folder_contains(r"\\?\C:\Notes", r"C:\notes\Daily", true));
        assert!(folder_contains(r"C:\Notes", r"\\?\c:\NOTES", true));
        assert!(!folder_contains(r"C:\Notes", r"C:\NotesX", true));
        assert!(folder_contains("/a/b", "/a/b/c", false));
        assert!(!folder_contains("/a/b", "/a/bc", false));
        assert!(!folder_contains("/a/B", "/a/b", false));
    }

    #[test]
    fn hidden_spaces_do_not_count_for_the_implicit_default() {
        let mut single = folder("harbor", "/tmp/harbor");
        single.extra.insert(
            "ephemeral".into(),
            serde_json::json!({"entryFile": "Harbor.md"}),
        );
        let mut builtin = folder("help", "/tmp/help");
        builtin.extra.insert("builtin".into(), Value::Bool(true));
        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    name: "notes".into(),
                    url: "https://notes.example.com".into(),
                    ..Default::default()
                },
                single,
                builtin,
            ],
        };
        assert_eq!(resolve_space_at(&cfg, None, None).unwrap().name, "notes");
        assert_eq!(
            resolve_space_at(&cfg, None, Some(Path::new("/tmp/harbor")))
                .unwrap()
                .name,
            "notes"
        );
    }

    #[test]
    fn unix_uses_xdg_then_home() {
        assert_eq!(
            config_dir_for(&env(false)),
            PathBuf::from("/home/user/.config/silverbullet")
        );
        let mut e = env(false);
        e.xdg = Some("/custom/xdg".into());
        assert_eq!(
            config_dir_for(&e),
            PathBuf::from("/custom/xdg/silverbullet")
        );
    }

    #[test]
    fn legacy_dir_is_copied_once_and_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("old");
        let new = tmp.path().join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("config.json"), r#"{"spaces":[]}"#).unwrap();
        std::fs::write(old.join("key"), [7u8; 32]).unwrap();
        assert!(migrate_legacy_dir(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("key")).unwrap(), vec![7u8; 32]);
        assert!(old.join("config.json").exists());
        std::fs::write(old.join("config.json"), r#"{"spaces":[{"bogus":1}]}"#).unwrap();
        assert!(!migrate_legacy_dir(&old, &new).unwrap());
        assert!(load_from(&new).unwrap().spaces.is_empty());
    }

    fn registry(dir: &Path, json: serde_json::Value, key: Option<[u8; 32]>) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("config.json"), serde_json::to_vec(&json).unwrap()).unwrap();
        if let Some(key) = key {
            std::fs::write(dir.join("key"), key).unwrap();
        }
    }

    #[test]
    fn legacy_remote_spaces_join_an_existing_registry_under_its_key() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        let token = crypto::encrypt_with_key(&[1; 32], "sample-token").unwrap();
        registry(
            &old,
            serde_json::json!({"spaces": [
                {"id": "b", "name": "notes", "url": "https://notes.example.com", "auth": {"method": "token", "encryptedToken": token}},
                {"id": "c", "name": "legacy", "folderPath": "/tmp/legacy", "auth": {"method": "none"}}
            ]}),
            Some([1; 32]),
        );
        registry(
            &new,
            serde_json::json!({"spaces": [{"id": "a", "name": "notes", "folderPath": "/tmp/notes", "auth": {"method": "none"}}]}),
            Some([2; 32]),
        );
        assert!(migrate_legacy_dir(&old, &new).unwrap());
        let cfg = load_from(&new).unwrap();
        let names: Vec<&str> = cfg.spaces.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["notes", "notes-2"]);
        let moved = &cfg.spaces[1].auth.encrypted_token;
        assert_eq!(
            crypto::decrypt_with_key(&[2; 32], moved).unwrap(),
            "sample-token"
        );
        assert_eq!(std::fs::read(new.join("key")).unwrap(), vec![2u8; 32]);
        assert!(!migrate_legacy_dir(&old, &new).unwrap(), "runs once");
        assert_eq!(load_from(&new).unwrap().spaces.len(), 2);
    }

    #[test]
    fn legacy_copy_never_replaces_an_existing_key() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        let token = crypto::encrypt_with_key(&[1; 32], "sample-token").unwrap();
        registry(
            &old,
            serde_json::json!({"spaces": [{"id": "b", "name": "notes", "url": "https://notes.example.com", "auth": {"method": "token", "encryptedToken": token}}]}),
            Some([1; 32]),
        );
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join("key"), [2u8; 32]).unwrap();
        assert!(migrate_legacy_dir(&old, &new).unwrap());
        let cfg = load_from(&new).unwrap();
        assert_eq!(
            crypto::decrypt_with_key(&[2; 32], &cfg.spaces[0].auth.encrypted_token).unwrap(),
            "sample-token"
        );
        assert_eq!(std::fs::read(new.join("key")).unwrap(), vec![2u8; 32]);
    }

    #[test]
    fn legacy_dir_absent_is_a_no_op() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!migrate_legacy_dir(&tmp.path().join("old"), &tmp.path().join("new")).unwrap());
        assert!(!tmp.path().join("new").exists());
    }

    fn folder(name: &str, path: &str) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder_path: path.into(),
            ..Default::default()
        }
    }

    #[test]
    fn cwd_selects_the_most_specific_folder_space() {
        let cfg = Config {
            spaces: vec![folder("outer", "/a"), folder("inner", "/a/b")],
        };
        let at = |cwd: &str| {
            resolve_space_at(&cfg, None, Some(Path::new(cwd)))
                .map(|s| s.name.clone())
                .unwrap_or_default()
        };
        assert_eq!(at("/a/b/c"), "inner");
        assert_eq!(at("/a/b"), "inner");
        assert_eq!(at("/a/x"), "outer");
        assert_eq!(at("/a/bc"), "outer");
    }

    #[test]
    fn explicit_name_beats_cwd() {
        let cfg = Config {
            spaces: vec![folder("outer", "/a"), folder("inner", "/a/b")],
        };
        let s = resolve_space_at(&cfg, Some("outer"), Some(Path::new("/a/b"))).unwrap();
        assert_eq!(s.name, "outer");
    }

    #[test]
    fn unmatched_cwd_falls_back_to_the_only_space_or_errors() {
        let one = Config {
            spaces: vec![folder("only", "/a")],
        };
        assert_eq!(
            resolve_space_at(&one, None, Some(Path::new("/z")))
                .unwrap()
                .name,
            "only"
        );
        let two = Config {
            spaces: vec![folder("x", "/a"), folder("y", "/b")],
        };
        let err = resolve_space_at(&two, None, Some(Path::new("/z"))).unwrap_err();
        assert!(err.contains("multiple spaces"), "{err}");
    }

    #[test]
    fn resolve_space_by_name() {
        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    name: "alpha".into(),
                    url: "https://alpha.example.com".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    name: "beta".into(),
                    url: "https://beta.example.com".into(),
                    ..Default::default()
                },
            ],
        };
        let s = resolve_space(&cfg, Some("beta")).unwrap();
        assert_eq!(s.name, "beta");
        assert_eq!(s.url, "https://beta.example.com");
    }

    #[test]
    fn resolve_space_by_name_not_found() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                name: "alpha".into(),
                ..Default::default()
            }],
        };
        let err = resolve_space(&cfg, Some("nonexistent")).unwrap_err();
        assert!(err.contains("not found"), "error was: {err}");
    }

    #[test]
    fn resolve_space_single_default() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                name: "only".into(),
                url: "https://only.example.com".into(),
                ..Default::default()
            }],
        };
        let s = resolve_space(&cfg, None).unwrap();
        assert_eq!(s.name, "only");
    }

    #[test]
    fn resolve_space_multiple_no_name_errors() {
        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    name: "alpha".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    name: "beta".into(),
                    ..Default::default()
                },
            ],
        };
        let err = resolve_space(&cfg, None).unwrap_err();
        assert!(err.contains("multiple spaces"), "error was: {err}");
    }

    #[test]
    fn resolve_space_empty_errors() {
        let cfg = Config { spaces: vec![] };
        let err = resolve_space(&cfg, None).unwrap_err();
        assert!(err.contains("no spaces configured"), "error was: {err}");
    }

    #[test]
    fn new_uuid_is_unique_and_correct_length() {
        let id1 = new_uuid();
        let id2 = new_uuid();
        assert_ne!(id1, id2);
        assert_eq!(
            id1.len(),
            36,
            "UUID length should be 36 (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
        );
    }

    #[cfg(unix)]
    #[test]
    fn config_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let cfg = Config { spaces: vec![] };
        save_to(tmp.path(), &cfg).unwrap();

        let file_mode = std::fs::metadata(tmp.path().join("config.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(file_mode, 0o600, "config.json must be mode 0600");
    }

    #[test]
    fn auth_config_camel_case_fields() {
        let auth = AuthConfig {
            method: "password".into(),
            encrypted_token: String::new(),
            username: "alice".into(),
            encrypted_password: "enc123".into(),
            ..Default::default()
        };
        let v: serde_json::Value = serde_json::to_value(&auth).unwrap();
        assert!(
            v.get("encryptedPassword").is_some(),
            "must use encryptedPassword"
        );
        assert!(
            v.get("encryptedToken").is_none(),
            "empty encryptedToken must be omitted"
        );
    }

    #[test]
    fn space_env_camel_case_and_omit() {
        let env = SpaceEnv {
            index_page: "Home".into(),
            read_only: false,
            shell_backend: String::new(),
            ..Default::default()
        };
        let v: serde_json::Value = serde_json::to_value(&env).unwrap();
        assert!(v.get("indexPage").is_some());
        assert!(
            v.get("readOnly").is_none(),
            "false readOnly must be omitted"
        );
        assert!(
            v.get("shellBackend").is_none(),
            "empty shellBackend must be omitted"
        );
    }

    #[test]
    fn space_config_folder_path_camel_case() {
        let s = SpaceConfig {
            id: "1".into(),
            name: "local".into(),
            folder_path: "/notes".into(),
            auth: AuthConfig {
                method: "none".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let v: serde_json::Value = serde_json::to_value(&s).unwrap();
        assert!(v.get("folderPath").is_some(), "must use folderPath");
        assert!(v.get("url").is_none(), "empty url must be omitted");
    }

    #[test]
    fn save_produces_pretty_json_with_trailing_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let cfg = Config {
            spaces: vec![SpaceConfig {
                id: "1".into(),
                name: "x".into(),
                auth: AuthConfig {
                    method: "none".into(),
                    ..Default::default()
                },
                ..Default::default()
            }],
        };
        save_to(tmp.path(), &cfg).unwrap();
        let raw = std::fs::read_to_string(tmp.path().join("config.json")).unwrap();
        assert!(raw.ends_with('\n'), "must end with newline");
        assert!(raw.contains("  "), "must be indented (pretty)");
    }
}
