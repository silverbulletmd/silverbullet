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
//! Unknown per-space fields (added by the App layer) survive load→save
//! round-trips via a flattened [`serde_json::Map`] on [`SpaceConfig`].
//!
//! The file is written with 2-space JSON indentation + trailing newline, mode
//! 0600 (unix), directory mode 0700 (unix).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/// Authentication credentials for a space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AuthConfig {
    /// `"token"`, `"password"`, or `"none"`.
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
}

fn is_false(b: &bool) -> bool {
    !b
}

/// A configured SilverBullet space.
///
/// Unknown JSON fields (added by the App layer) are preserved in `extra` and
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
    /// Preserves any App-specific fields that Core does not model.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Top-level config structure: a list of spaces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Config {
    pub spaces: Vec<SpaceConfig>,
}

// ---------------------------------------------------------------------------
// Directory / path helpers
// ---------------------------------------------------------------------------

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

/// Returns `$XDG_CONFIG_HOME/silverbullet` if set, else `~/.config/silverbullet`.
pub fn config_dir() -> PathBuf {
    let xdg = std::env::var("XDG_CONFIG_HOME").ok();
    let home = home_dir();
    config_dir_from(xdg.as_deref(), &home)
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

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

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
    // Ensure dir exists with 0700.
    create_dir_private(dir)?;

    let path = dir.join("config.json");
    let mut data =
        serde_json::to_vec_pretty(cfg).map_err(|e| format!("serializing config: {e}"))?;
    data.push(b'\n');

    write_private(&path, &data).map_err(|e| format!("writing config {}: {e}", path.display()))
}

/// Save config to the default `config_dir()`.
pub fn save(cfg: &Config) -> Result<(), String> {
    save_to(&config_dir(), cfg)
}

// ---------------------------------------------------------------------------
// Space resolution
// ---------------------------------------------------------------------------

/// Resolve a space by optional name.
///
/// * `Some(name)` — find by name; error if not found.
/// * `None` — return the sole space; error if zero or more than one.
pub fn resolve_space<'a>(cfg: &'a Config, name: Option<&str>) -> Result<&'a SpaceConfig, String> {
    if let Some(n) = name {
        cfg.spaces
            .iter()
            .find(|s| s.name == n)
            .ok_or_else(|| format!("space \"{n}\" not found"))
    } else {
        match cfg.spaces.len() {
            1 => Ok(&cfg.spaces[0]),
            0 => Err("no spaces configured; use 'space add' or pass --url".to_string()),
            _ => Err("multiple spaces configured; use -s <name> to select one".to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// UUID
// ---------------------------------------------------------------------------

/// Generate a random UUID v4 string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Private file-write helpers (mirror crypto.rs patterns)
// ---------------------------------------------------------------------------

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

fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(data)
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, data)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Unknown field preservation (round-trip)
    // -----------------------------------------------------------------------

    #[test]
    fn unknown_space_fields_survive_round_trip() {
        let json = r#"{"spaces":[{"id":"x","name":"work","url":"https://x","auth":{"method":"none"},"appOnlyField":42}]}"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        let out = serde_json::to_string(&cfg).unwrap();
        assert!(out.contains("appOnlyField"), "appOnlyField must survive");
        assert!(out.contains("42"), "value 42 must survive");
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
        // Should only have the known fields we set.
        for key in obj.keys() {
            assert!(
                ["id", "name", "url", "auth"].contains(&key.as_str()),
                "unexpected key: {key}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Load / save round-trip via tempdir (no env mutation)
    // -----------------------------------------------------------------------

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

        // Core fields read correctly
        assert_eq!(cfg.spaces[0].id, "abc-123");
        assert_eq!(cfg.spaces[0].name, "my-notes");
        assert_eq!(cfg.spaces[0].folder_path, "/home/user/notes");
        assert_eq!(cfg.spaces[0].auth.method, "none");

        // Modify a Core field
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

    // -----------------------------------------------------------------------
    // config_dir_from (pure, no env mutation)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // resolve_space
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // new_uuid
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // File permissions (unix only)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // JSON field naming (camelCase, omitempty)
    // -----------------------------------------------------------------------

    #[test]
    fn auth_config_camel_case_fields() {
        let auth = AuthConfig {
            method: "password".into(),
            encrypted_token: String::new(),
            username: "alice".into(),
            encrypted_password: "enc123".into(),
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

    // -----------------------------------------------------------------------
    // Pretty-print + trailing newline
    // -----------------------------------------------------------------------

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
