//! The `spaces.json` model: a flat map of generated GUID -> space config.
//! Serialized with keys in stable name order; unknown fields are preserved
//! verbatim so older servers don't destroy newer config.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// One space's binding to the outside world. Exactly one variant; the
/// `untagged` representation matches the spec's `{"prefix": "/x"}` /
/// `{"host": "..."}` / `{"host": "...", "prefix": "/x"}` shapes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Binding {
    Prefix {
        prefix: String,
    },
    Host {
        host: String,
        #[serde(skip_serializing_if = "String::is_empty")]
        prefix: String,
    },
}

// A hand-written `Deserialize` (rather than `#[serde(untagged)]` + derive) keeps
// unknown keys rejected. A derived untagged enum would silently pick the first
// matching variant and drop extra fields.
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
            (prefix, Some(host)) => Ok(Binding::Host {
                host,
                prefix: prefix.unwrap_or_default(),
            }),
            _ => Err(serde::de::Error::custom(
                "binding must have at least one of `prefix` or `host`",
            )),
        }
    }
}

impl Binding {
    pub fn host(&self) -> Option<&str> {
        match self {
            Binding::Prefix { .. } => None,
            Binding::Host { host, .. } => Some(host),
        }
    }

    pub fn prefix(&self) -> &str {
        match self {
            Binding::Prefix { prefix } | Binding::Host { prefix, .. } => prefix,
        }
    }

    pub fn normalize(&mut self) {
        match self {
            Binding::Prefix { prefix } | Binding::Host { prefix, .. } => {
                *prefix = crate::multi::validate::normalize_prefix(prefix);
            }
        }
    }

    pub fn host_scope(&self) -> Option<String> {
        self.host()
            .map(crate::multi::validate::normalize_host_authority)
    }

    pub fn effective_host_scope(&self, primary_host: Option<&str>) -> Option<String> {
        let scope = self.host_scope();
        if scope.as_deref() == primary_host {
            None
        } else {
            scope
        }
    }
}

/// Off unless a config says otherwise, at both the struct and the field level:
/// running arbitrary commands as the server process is the most dangerous thing
/// a space can be handed, and on an `access: write` space it is handed to the
/// public internet.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ShellSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub whitelist: Vec<String>,
}

/// How this space authenticates to its git remote — and, because `Off` is a
/// mode, whether it syncs at all. The admin picks this; it is never derived
/// from whether a key file happens to exist on disk.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitSyncMode {
    #[default]
    Off,
    Key,
    Manual,
}

impl GitSyncMode {
    pub fn is_off(self) -> bool {
        matches!(self, GitSyncMode::Off)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncConfig {
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub mode: GitSyncMode,
    #[serde(default = "default_pull_interval")]
    pub pull_interval_secs: u64,
}

fn default_pull_interval() -> u64 {
    300
}

impl Default for GitSyncConfig {
    fn default() -> Self {
        GitSyncConfig {
            paused: false,
            mode: GitSyncMode::Off,
            pull_interval_secs: default_pull_interval(),
        }
    }
}

impl GitSyncConfig {
    pub const MIN_PULL_INTERVAL_SECS: u64 = 60;

    pub fn effective_pull_interval(&self) -> Option<std::time::Duration> {
        match self.pull_interval_secs {
            0 => None,
            n => Some(std::time::Duration::from_secs(
                n.max(Self::MIN_PULL_INTERVAL_SECS),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTiming {
    #[serde(default = "default_quiet_secs")]
    pub quiet_secs: u64,
    #[serde(default = "default_max_interval_secs")]
    pub max_interval_secs: u64,
}

fn default_quiet_secs() -> u64 {
    30
}
fn default_max_interval_secs() -> u64 {
    300
}

impl Default for CommitTiming {
    fn default() -> Self {
        CommitTiming {
            quiet_secs: default_quiet_secs(),
            max_interval_secs: default_max_interval_secs(),
        }
    }
}

impl CommitTiming {
    pub const MIN_QUIET_SECS: u64 = 5;
    pub const MIN_MAX_INTERVAL_SECS: u64 = 30;

    pub fn effective(&self) -> (std::time::Duration, std::time::Duration) {
        let quiet = self.quiet_secs.max(Self::MIN_QUIET_SECS);
        let max = self
            .max_interval_secs
            .max(Self::MIN_MAX_INTERVAL_SECS)
            .max(quiet);
        (
            std::time::Duration::from_secs(quiet),
            std::time::Duration::from_secs(max),
        )
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

/// What a visitor with no session may do in this space. `None` is the default
/// and means the space is invisible without an account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpaceAccess {
    #[default]
    None,
    Read,
    Write,
}

/// What one member may do. Absent from `members` means no access at all.
/// Every member predating roles was a writer, and an empty object still is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemberRole {
    Read,
    #[default]
    Write,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberEntry {
    pub role: MemberRole,
    pub runtime_api: bool,
    #[serde(skip)]
    pub(crate) runtime_api_explicit: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl PartialEq for MemberEntry {
    fn eq(&self, other: &Self) -> bool {
        self.role == other.role
            && self.runtime_api == other.runtime_api
            && self.extra == other.extra
    }
}

impl Default for MemberEntry {
    fn default() -> Self {
        Self {
            role: MemberRole::Write,
            runtime_api: true,
            runtime_api_explicit: true,
            extra: Default::default(),
        }
    }
}

impl<'de> Deserialize<'de> for MemberEntry {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Input {
            #[serde(default)]
            role: MemberRole,
            runtime_api: Option<bool>,
            #[serde(flatten)]
            extra: serde_json::Map<String, serde_json::Value>,
        }
        let input = Input::deserialize(deserializer)?;
        Ok(Self {
            role: input.role,
            runtime_api_explicit: input.runtime_api.is_some(),
            runtime_api: input.runtime_api.unwrap_or(input.role == MemberRole::Write),
            extra: input.extra,
        })
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<SpaceAccess>,
    /// Read from files written before `access` existed, never written back.
    /// `normalize` folds it into `access` at load.
    #[serde(default, rename = "public", skip_serializing)]
    pub legacy_public: Option<bool>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub members: BTreeMap<String, MemberEntry>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub shell: ShellSettings,
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
    #[serde(default)]
    pub revisions: silverbullet_server_common::RevisionsMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_sync: Option<GitSyncConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_commit: Option<CommitTiming>,
    /// Fields written by newer versions, preserved verbatim.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl SpaceConfig {
    pub fn access(&self) -> SpaceAccess {
        self.access.unwrap_or_default()
    }

    pub fn git_sync(&self) -> GitSyncConfig {
        self.git_sync.clone().unwrap_or_default()
    }

    pub fn revisions_commit(&self) -> CommitTiming {
        self.revisions_commit.clone().unwrap_or_default()
    }

    pub fn normalize(&mut self) {
        self.binding.normalize();
        if self.access.is_none() {
            self.access = Some(match self.legacy_public {
                Some(true) => SpaceAccess::Write,
                _ => SpaceAccess::None,
            });
        }
        self.legacy_public = None;
        self.extra.remove("runtimeApi");
    }
}

/// The whole `spaces.json`: GUID -> config.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MultiConfig {
    pub spaces: HashMap<String, SpaceConfig>,
}

impl MultiConfig {
    pub fn from_json(src: &str) -> Result<Self, String> {
        let mut spaces: HashMap<String, SpaceConfig> =
            serde_json::from_str(src).map_err(|e| format!("invalid spaces.json: {e}"))?;
        for cfg in spaces.values_mut() {
            cfg.normalize();
        }
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
        use std::io::Write;
        let json = self.to_json_string()?;
        let tmp = path.with_extension("json.tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("could not protect {}: {e}", tmp.display()))?;
        }
        file.write_all(json.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("could not flush {}: {e}", tmp.display()))?;
        drop(file);
        std::fs::rename(&tmp, path)
            .map_err(|e| format!("could not persist {}: {e}", path.display()))?;
        #[cfg(unix)]
        {
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            std::fs::File::open(parent)
                .and_then(|f| f.sync_all())
                .map_err(|e| format!("could not flush {}: {e}", parent.display()))?;
        }
        Ok(())
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
            "readOnly": true,
            "shell": { "enabled": false, "whitelist": ["git"] },
            "runtimeApi": true,
            "indexPage": "home",
            "futureField": { "nested": 1 }
          }
        }"#
    }

    #[test]
    fn member_serialization_does_not_change_configuration_equality() {
        let old: MemberEntry = serde_json::from_str("{}").unwrap();
        let roundtrip: MemberEntry =
            serde_json::from_value(serde_json::to_value(&old).unwrap()).unwrap();
        assert_eq!(old, roundtrip);
    }

    #[test]
    fn member_runtime_defaults_follow_write_and_preserve_opt_out() {
        for (input, enabled) in [
            (r#"{}"#, true),
            (r#"{"role":"write"}"#, true),
            (r#"{"role":"read"}"#, false),
            (r#"{"role":"write","runtimeApi":false}"#, false),
        ] {
            let entry: MemberEntry = serde_json::from_str(input).unwrap();
            let output = serde_json::to_value(entry).unwrap();
            assert_eq!(output["runtimeApi"], enabled, "{input}");
        }
    }

    #[test]
    fn parses_bindings_and_defaults() {
        let c: MultiConfig = MultiConfig::from_json(sample_json()).unwrap();
        let a = &c.spaces["id-a"];
        assert_eq!(a.name, "Alpha");
        assert!(matches!(&a.binding, Binding::Host { host, .. } if host == "a.example.com"));
        assert!(a.read_only);
        assert!(!a.shell.enabled);
        assert_eq!(a.index_page, "home");
        assert_eq!(a.extra["futureField"]["nested"], 1);

        let b = &c.spaces["id-b"];
        assert!(matches!(&b.binding, Binding::Prefix { prefix } if prefix == "/b"));
        assert_eq!(b.access(), SpaceAccess::None);
        assert!(b.members.is_empty());
        assert!(!b.read_only);
        assert!(!b.shell.enabled);
        assert_eq!(b.index_page, "index");
        assert_eq!(b.folder, ""); // empty = resolved elsewhere
    }

    /// Shell commands are the most dangerous capability a space can hand out,
    /// so a config that does not name `shell` must not get one.
    #[test]
    fn shell_stays_off_unless_a_config_explicitly_enables_it() {
        let c = MultiConfig::from_json(
            r#"{
              "quiet": { "name": "Quiet", "binding": { "prefix": "/q" } },
              "loud": {
                "name": "Loud",
                "binding": { "prefix": "/l" },
                "shell": { "enabled": true }
              },
              "partial": {
                "name": "Partial",
                "binding": { "prefix": "/p" },
                "shell": { "whitelist": ["git"] }
              }
            }"#,
        )
        .unwrap();
        assert!(!c.spaces["quiet"].shell.enabled, "absent `shell` means off");
        assert!(c.spaces["loud"].shell.enabled, "explicit true still wins");
        assert!(
            !c.spaces["partial"].shell.enabled,
            "a whitelist without `enabled` does not turn shell on"
        );
    }

    #[test]
    fn round_trip_preserves_unknown_fields_and_orders_by_name() {
        let c = MultiConfig::from_json(sample_json()).unwrap();
        let out = c.to_json_string().unwrap();
        let ia = out.find("\"id-a\"").unwrap();
        let ib = out.find("\"id-b\"").unwrap();
        assert!(ia < ib, "name-sorted: {out}");
        assert!(
            out.contains("futureField"),
            "unknown field preserved: {out}"
        );
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
    fn bindings_parse_hostname_prefix_and_preserve_legacy_serialization() {
        let prefix: Binding = serde_json::from_str(r#"{"prefix":"/legacy"}"#).unwrap();
        assert_eq!(
            serde_json::to_value(prefix).unwrap(),
            serde_json::json!({ "prefix": "/legacy" })
        );

        let host: Binding = serde_json::from_str(r#"{"host":"team.example.com"}"#).unwrap();
        assert!(matches!(
            &host,
            Binding::Host { host, prefix } if host == "team.example.com" && prefix.is_empty()
        ));
        assert_eq!(
            serde_json::to_value(host).unwrap(),
            serde_json::json!({ "host": "team.example.com" })
        );

        let host_with_prefix: Binding =
            serde_json::from_str(r#"{"host":"team.example.com","prefix":"/work"}"#).unwrap();
        assert!(matches!(
            &host_with_prefix,
            Binding::Host { host, prefix } if host == "team.example.com" && prefix == "/work"
        ));
        assert_eq!(
            serde_json::to_value(host_with_prefix).unwrap(),
            serde_json::json!({ "host": "team.example.com", "prefix": "/work" })
        );
    }

    #[test]
    fn normalizes_prefixes_for_every_binding_shape() {
        let mut host: SpaceConfig = serde_json::from_str(
            r#"{"name":"Team","binding":{"host":"team.example.com","prefix":"work/"}}"#,
        )
        .unwrap();
        host.normalize();
        assert!(matches!(
            host.binding,
            Binding::Host { prefix, .. } if prefix == "/work"
        ));

        let mut prefix: SpaceConfig =
            serde_json::from_str(r#"{"name":"Root","binding":{"prefix":"/"}}"#).unwrap();
        prefix.normalize();
        assert!(matches!(
            prefix.binding,
            Binding::Prefix { prefix } if prefix.is_empty()
        ));
    }

    #[test]
    fn binding_accessors_preserve_host_display_spelling_and_normalize_scope() {
        let host = Binding::Host {
            host: "Team.Example.Com.:3000".into(),
            prefix: "/work".into(),
        };
        assert_eq!(host.host(), Some("Team.Example.Com.:3000"));
        assert_eq!(host.prefix(), "/work");
        assert_eq!(host.host_scope(), Some("team.example.com:3000".into()));

        let prefix = Binding::Prefix {
            prefix: "/legacy".into(),
        };
        assert_eq!(prefix.host(), None);
        assert_eq!(prefix.prefix(), "/legacy");
        assert_eq!(prefix.host_scope(), None);
    }

    #[test]
    fn empty_or_unknown_bindings_are_rejected() {
        for source in [r#"{}"#, r#"{"unknown":"value"}"#] {
            let parsed: Result<Binding, _> = serde_json::from_str(source);
            assert!(parsed.is_err(), "{source}");
        }
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

    #[test]
    fn public_members_roundtrip() {
        let src = r#"{
          "id": {
            "name": "X", "binding": { "prefix": "/x" },
            "public": false,
            "members": { "zef": {}, "sam": {"role": "read"} }
          }
        }"#;
        let c = MultiConfig::from_json(src).unwrap();
        let s = &c.spaces["id"];
        assert!(s.members.contains_key("zef"));
        assert_eq!(s.members["sam"].role, MemberRole::Read);
        let out = c.to_json_string().unwrap();
        assert!(out.contains("members"), "{out}");
        // Read-only member roles must survive configuration normalization and saving.
        assert!(!out.contains("\"public\""), "{out}");
        assert!(out.contains("\"role\": \"read\""), "{out}");
    }

    #[test]
    fn legacy_space_runtime_api_is_ignored_and_member_permissions_survive() {
        for legacy in [true, false] {
            let input = serde_json::json!({
                "id": {
                    "name": "Notes", "binding": { "prefix": "/notes" },
                    "runtimeApi": legacy,
                    "members": {
                        "writer": { "role": "write", "runtimeApi": true },
                        "opted-out": { "role": "write", "runtimeApi": false },
                        "reader": { "role": "read" }
                    }
                }
            });
            let config = MultiConfig::from_json(&input.to_string()).unwrap();
            let output: serde_json::Value =
                serde_json::from_str(&config.to_json_string().unwrap()).unwrap();
            assert!(output["id"].get("runtimeApi").is_none());
            assert_eq!(output["id"]["members"]["writer"]["runtimeApi"], true);
            assert_eq!(output["id"]["members"]["opted-out"]["runtimeApi"], false);
            assert_eq!(output["id"]["members"]["reader"]["runtimeApi"], false);
        }
    }

    #[test]
    fn legacy_public_true_becomes_write_access() {
        let mut cfg: SpaceConfig =
            serde_json::from_str(r#"{"name":"W","binding":{"prefix":"/w"},"public":true}"#)
                .unwrap();
        cfg.normalize();
        assert_eq!(cfg.access(), SpaceAccess::Write);
    }

    #[test]
    fn legacy_public_false_and_absent_become_no_access() {
        for body in [
            r#"{"name":"W","binding":{"prefix":"/w"},"public":false}"#,
            r#"{"name":"W","binding":{"prefix":"/w"}}"#,
        ] {
            let mut cfg: SpaceConfig = serde_json::from_str(body).unwrap();
            cfg.normalize();
            assert_eq!(cfg.access(), SpaceAccess::None);
        }
    }

    #[test]
    fn empty_member_object_is_a_writer() {
        let cfg: SpaceConfig =
            serde_json::from_str(r#"{"name":"W","binding":{"prefix":"/w"},"members":{"zef":{}}}"#)
                .unwrap();
        assert_eq!(cfg.members["zef"].role, MemberRole::Write);
    }

    #[test]
    fn roles_round_trip() {
        let cfg: SpaceConfig = serde_json::from_str(
            r#"{"name":"W","binding":{"prefix":"/w"},"access":"read",
                "members":{"sam":{"role":"read"},"zef":{"role":"write"}}}"#,
        )
        .unwrap();
        assert_eq!(cfg.access(), SpaceAccess::Read);
        assert_eq!(cfg.members["sam"].role, MemberRole::Read);
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains(r#""access":"read""#));
        assert!(!text.contains(r#""public""#));
    }

    #[test]
    fn explicit_access_wins_over_legacy_public() {
        let mut cfg: SpaceConfig = serde_json::from_str(
            r#"{"name":"W","binding":{"prefix":"/w"},"access":"none","public":true}"#,
        )
        .unwrap();
        cfg.normalize();
        assert_eq!(cfg.access(), SpaceAccess::None);
    }

    #[test]
    fn an_unknown_role_is_rejected() {
        let parsed: Result<SpaceConfig, _> = serde_json::from_str(
            r#"{"name":"W","binding":{"prefix":"/w"},"members":{"z":{"role":"admin"}}}"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn revisions_round_trips_and_defaults_to_disabled() {
        let c = MultiConfig::from_json(
            r#"{
              "id-managed": { "name": "M", "binding": { "prefix": "/m" }, "revisions": "managed" },
              "id-default": { "name": "D", "binding": { "prefix": "/d" } }
            }"#,
        )
        .unwrap();
        assert_eq!(
            c.spaces["id-managed"].revisions,
            silverbullet_server_common::RevisionsMode::Managed
        );
        assert_eq!(
            c.spaces["id-default"].revisions,
            silverbullet_server_common::RevisionsMode::Disabled
        );

        let out = c.to_json_string().unwrap();
        assert!(out.contains("\"revisions\": \"managed\""), "{out}");
        let again = MultiConfig::from_json(&out).unwrap();
        assert_eq!(
            again.spaces["id-managed"].revisions,
            silverbullet_server_common::RevisionsMode::Managed
        );
    }

    #[test]
    fn git_sync_absent_reads_as_off_and_is_not_written_back() {
        let json = r#"{"a":{"name":"A","binding":{"prefix":"/a"},"revisions":"managed"}}"#;
        let cfg = MultiConfig::from_json(json).unwrap();
        let space = cfg.spaces.get("a").unwrap();
        assert_eq!(space.git_sync().mode, GitSyncMode::Off);
        assert!(!serde_json::to_string(space).unwrap().contains("gitSync"));
    }

    #[test]
    fn git_sync_mode_round_trips_in_lowercase() {
        let json = r#"{"a":{"name":"A","binding":{"prefix":"/a"},"revisions":"managed",
                        "gitSync":{"mode":"manual","pullIntervalSecs":600}}}"#;
        let cfg = MultiConfig::from_json(json).unwrap();
        assert_eq!(cfg.spaces["a"].git_sync().mode, GitSyncMode::Manual);

        let out = serde_json::to_string(&cfg.spaces["a"]).unwrap();
        assert!(out.contains(r#""mode":"manual""#), "{out}");

        let again = MultiConfig::from_json(&serde_json::to_string(&cfg.spaces).unwrap()).unwrap();
        assert_eq!(again.spaces["a"].git_sync().mode, GitSyncMode::Manual);
    }

    #[test]
    fn a_git_sync_block_without_a_mode_is_off() {
        let json = r#"{"a":{"name":"A","binding":{"prefix":"/a"},"revisions":"managed",
                        "gitSync":{"pullIntervalSecs":600}}}"#;
        let cfg = MultiConfig::from_json(json).unwrap();
        assert_eq!(cfg.spaces["a"].git_sync().mode, GitSyncMode::Off);
        assert_eq!(cfg.spaces["a"].git_sync().pull_interval_secs, 600);
    }

    #[test]
    fn pull_interval_is_floored_but_zero_disables_polling() {
        let below = GitSyncConfig {
            paused: false,
            mode: GitSyncMode::Key,
            pull_interval_secs: 5,
        };
        assert_eq!(
            below.effective_pull_interval(),
            Some(std::time::Duration::from_secs(60))
        );

        let normal = GitSyncConfig {
            paused: false,
            mode: GitSyncMode::Key,
            pull_interval_secs: 900,
        };
        assert_eq!(
            normal.effective_pull_interval(),
            Some(std::time::Duration::from_secs(900))
        );

        let never = GitSyncConfig {
            paused: false,
            mode: GitSyncMode::Manual,
            pull_interval_secs: 0,
        };
        assert_eq!(never.effective_pull_interval(), None);
    }

    #[test]
    fn commit_timing_defaults_match_the_existing_constants() {
        let json = r#"{"a":{"name":"A","binding":{"prefix":"/a"},"revisions":"managed"}}"#;
        let cfg = MultiConfig::from_json(json).unwrap();
        let space = cfg.spaces.get("a").unwrap();
        let (quiet, max) = space.revisions_commit().effective();
        assert_eq!(quiet, std::time::Duration::from_secs(30));
        assert_eq!(max, std::time::Duration::from_secs(300));
        assert!(!serde_json::to_string(space)
            .unwrap()
            .contains("revisionsCommit"));
    }

    #[test]
    fn commit_timing_is_clamped_into_coherence() {
        // A zero quiet period would commit mid-keystroke-burst.
        let (quiet, _) = CommitTiming {
            quiet_secs: 0,
            max_interval_secs: 300,
        }
        .effective();
        assert_eq!(quiet, std::time::Duration::from_secs(5));

        // A maximum below the debounce is incoherent; it floors at the quiet period.
        let (quiet, max) = CommitTiming {
            quiet_secs: 120,
            max_interval_secs: 10,
        }
        .effective();
        assert_eq!(quiet, std::time::Duration::from_secs(120));
        assert_eq!(max, std::time::Duration::from_secs(120));

        let (_, max) = CommitTiming {
            quiet_secs: 5,
            max_interval_secs: 1,
        }
        .effective();
        assert_eq!(max, std::time::Duration::from_secs(30));

        let (quiet, max) = CommitTiming {
            quiet_secs: 120,
            max_interval_secs: 900,
        }
        .effective();
        assert_eq!(quiet, std::time::Duration::from_secs(120));
        assert_eq!(max, std::time::Duration::from_secs(900));
    }
}
