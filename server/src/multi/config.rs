//! The `spaces.json` model: a flat map of generated GUID -> space config.
//! Serialized with keys in stable name order; unknown fields are preserved
//! verbatim so older servers don't destroy newer config.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// One space's binding to the outside world. Exactly one variant; the
/// `untagged` representation matches the spec's `{"prefix": "/x"}` /
/// `{"host": "..."}` shapes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Binding {
    Prefix { prefix: String },
    Host { host: String },
}

// A hand-written `Deserialize` (rather than `#[serde(untagged)]` + derive) so we
// can reject *composite* objects like `{"prefix": "/a", "host": "a.test"}` and
// unknown keys outright. A derived untagged enum would silently pick the first
// matching variant and drop the extra fields.
impl<'de> Deserialize<'de> for Binding {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Repr {
            #[serde(default)]
            prefix: Option<String>,
            #[serde(default)]
            host: Option<String>,
        }
        let repr = Repr::deserialize(deserializer)?;
        match (repr.prefix, repr.host) {
            (Some(prefix), None) => Ok(Binding::Prefix { prefix }),
            (None, Some(host)) => Ok(Binding::Host { host }),
            _ => Err(serde::de::Error::custom(
                "binding must have exactly one of `prefix` or `host`",
            )),
        }
    }
}

/// Per-space authentication. `Inherit` (default) accepts the admin credentials.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(tag = "mode")]
pub enum SpaceAuth {
    #[default]
    #[serde(rename = "inherit")]
    Inherit,
    #[serde(rename = "custom", rename_all = "camelCase")]
    Custom {
        user: String,
        /// argon2id PHC string; empty until the first password is set.
        #[serde(default)]
        pass_hash: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        auth_token: String,
        #[serde(default = "default_lockout_limit")]
        lockout_limit: u32,
        #[serde(default = "default_lockout_time")]
        lockout_time: u64,
        #[serde(default = "default_remember_me_hours")]
        remember_me_hours: u64,
    },
    #[serde(rename = "none")]
    None,
}

fn default_lockout_limit() -> u32 {
    10
}
fn default_lockout_time() -> u64 {
    60
}
fn default_remember_me_hours() -> u64 {
    168
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShellSettings {
    pub enabled: bool,
    #[serde(default)]
    pub whitelist: Vec<String>,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            whitelist: vec![],
        }
    }
}

fn default_index_page() -> String {
    "index".into()
}
fn default_theme_color() -> String {
    "#e1e1e1".into()
}
fn default_description() -> String {
    "Powerful and programmable note taking app".into()
}

/// A single space's full configuration — parity with the single-space `SB_*`
/// env surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceConfig {
    pub name: String,
    /// Relative paths resolve against the server root. Empty = default
    /// (`spaces/<id>` under the root), filled in on create.
    #[serde(default)]
    pub folder: String,
    pub binding: Binding,
    #[serde(default)]
    pub auth: SpaceAuth,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub shell: ShellSettings,
    #[serde(default)]
    pub runtime_api: bool,
    #[serde(default = "default_index_page")]
    pub index_page: String,
    #[serde(default = "default_description")]
    pub description: String,
    #[serde(default = "default_theme_color")]
    pub theme_color: String,
    #[serde(default)]
    pub head_html: String,
    #[serde(default)]
    pub space_ignore: String,
    #[serde(default)]
    pub log_push: bool,
    /// Fields written by newer versions, preserved verbatim.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// The whole `spaces.json`: GUID -> config.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MultiConfig {
    pub spaces: HashMap<String, SpaceConfig>,
}

impl MultiConfig {
    pub fn from_json(src: &str) -> Result<Self, String> {
        let spaces: HashMap<String, SpaceConfig> =
            serde_json::from_str(src).map_err(|e| format!("invalid spaces.json: {e}"))?;
        Ok(Self { spaces })
    }

    /// Pretty JSON with keys ordered by space name (then id, for stability
    /// among duplicates). Relies on serde_json's `preserve_order` feature.
    pub fn to_json_string(&self) -> Result<String, String> {
        let mut entries: Vec<(&String, &SpaceConfig)> = self.spaces.iter().collect();
        entries.sort_by(|a, b| (&a.1.name, a.0).cmp(&(&b.1.name, b.0)));
        let mut map = serde_json::Map::new();
        for (id, cfg) in entries {
            let v = serde_json::to_value(cfg).map_err(|e| e.to_string())?;
            map.insert(id.clone(), v);
        }
        serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|e| e.to_string())
    }

    /// Read from `path`. A missing file is an empty config; a malformed file
    /// is a hard error (config is never silently ignored).
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(src) => Self::from_json(&src),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("could not read {}: {e}", path.display())),
        }
    }

    /// Atomically persist: write `<path>.tmp` (0600 on unix), then rename over
    /// `path`.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let json = self.to_json_string()?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)
            .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)) {
                // The file holds secrets; a failure to tighten permissions is
                // worth surfacing, but the save still proceeds.
                tracing::warn!("could not set 0600 on {}: {e}", tmp.display());
            }
        }
        std::fs::rename(&tmp, path)
            .map_err(|e| format!("could not persist {}: {e}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"{
          "id-b": { "name": "Beta", "binding": { "prefix": "/b" } },
          "id-a": {
            "name": "Alpha",
            "folder": "/abs/path",
            "binding": { "host": "a.example.com" },
            "auth": { "mode": "custom", "user": "u", "passHash": "$argon2id$x" },
            "readOnly": true,
            "shell": { "enabled": false, "whitelist": ["git"] },
            "runtimeApi": true,
            "indexPage": "home",
            "futureField": { "nested": 1 }
          }
        }"#
    }

    #[test]
    fn parses_bindings_auth_and_defaults() {
        let c: MultiConfig = MultiConfig::from_json(sample_json()).unwrap();
        let a = &c.spaces["id-a"];
        assert_eq!(a.name, "Alpha");
        assert!(matches!(&a.binding, Binding::Host { host } if host == "a.example.com"));
        assert!(
            matches!(&a.auth, SpaceAuth::Custom { user, pass_hash, .. } if user == "u" && pass_hash == "$argon2id$x")
        );
        assert!(a.read_only);
        assert!(!a.shell.enabled);
        assert_eq!(a.index_page, "home");
        assert_eq!(a.extra["futureField"]["nested"], 1);

        let b = &c.spaces["id-b"];
        assert!(matches!(&b.binding, Binding::Prefix { prefix } if prefix == "/b"));
        assert!(matches!(b.auth, SpaceAuth::Inherit)); // default
        assert!(!b.read_only);
        assert!(b.shell.enabled); // default on
        assert_eq!(b.index_page, "index");
        assert_eq!(b.folder, ""); // empty = resolved elsewhere
    }

    #[test]
    fn round_trip_preserves_unknown_fields_and_orders_by_name() {
        let c = MultiConfig::from_json(sample_json()).unwrap();
        let out = c.to_json_string().unwrap();
        // Alpha sorts before Beta even though the input had Beta first.
        let ia = out.find("\"id-a\"").unwrap();
        let ib = out.find("\"id-b\"").unwrap();
        assert!(ia < ib, "name-sorted: {out}");
        assert!(
            out.contains("futureField"),
            "unknown field preserved: {out}"
        );
        // And it re-parses identically.
        let again = MultiConfig::from_json(&out).unwrap();
        assert_eq!(again.spaces["id-a"].name, "Alpha");
    }

    #[test]
    fn load_missing_file_is_empty_and_save_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("spaces.json");
        let empty = MultiConfig::load(&path).unwrap();
        assert!(empty.spaces.is_empty());

        let c = MultiConfig::from_json(sample_json()).unwrap();
        c.save(&path).unwrap();
        let loaded = MultiConfig::load(&path).unwrap();
        assert_eq!(loaded.spaces.len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "spaces.json must be 0600");
        }
    }

    #[test]
    fn composite_binding_is_rejected() {
        // A `{"prefix": ..., "host": ...}` object is ambiguous: without
        // `deny_unknown_fields` serde's untagged enum would silently pick
        // Prefix and drop the host. It must fail to parse instead.
        let src = r#"{
          "id": {
            "name": "X",
            "binding": { "prefix": "/a", "host": "a.example.com" }
          }
        }"#;
        assert!(
            MultiConfig::from_json(src).is_err(),
            "composite binding must not deserialize"
        );
    }

    #[test]
    fn port_binding_is_rejected() {
        let src = r#"{
          "id": { "name": "X", "binding": { "port": 3001 } }
        }"#;
        let error = MultiConfig::from_json(src).expect_err("port binding must not deserialize");
        assert!(
            error.contains("unknown field `port`, expected `prefix` or `host`"),
            "{error}"
        );
    }

    #[test]
    fn load_malformed_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("spaces.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(MultiConfig::load(&path).is_err());
    }
}
