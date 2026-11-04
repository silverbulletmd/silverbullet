//! Dynamic Client Registration (RFC 7591) for MCP clients that have no
//! metadata document. Public clients only: there is no secret to issue, so a
//! registration is just a name and the redirect URIs the client will use.
//! Registrations are open to anyone who can reach the server, hence the rate
//! limit, the cap and the garbage collection.

use std::collections::{BTreeMap, HashMap};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::cimd::{clean_name, CimdFetcher, ClientAuth, ClientMetadata};
use super::redirect::redirect_allowed;
use crate::auth::OAuthError;

const FILE_NAME: &str = ".silverbullet.mcp-clients.json";
pub const DCR_PREFIX: &str = "sbdcr_";
const MAX_REDIRECT_URIS: usize = 10;
const MAX_REDIRECT_URI_BYTES: usize = 2048;
const RATE_LIMIT: usize = 20;
const RATE_WINDOW_SECS: u64 = 600;
const MAX_STORED: usize = 1000;
const UNUSED_TTL_SECS: u64 = 7 * 24 * 3600;
const IDLE_TTL_SECS: u64 = 90 * 24 * 3600;
/// `touch` rewrites the file at most this often per registration, except for
/// the first use, which decides between the 7 and 90 day expiry.
const TOUCH_PERSIST_SECS: u64 = 3600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub client_id: String,
    pub client_name: Option<String>,
    pub redirect_uris: Vec<String>,
    pub created_at: u64,
    #[serde(default)]
    pub last_used_at: Option<u64>,
}

impl Registration {
    /// The RFC 7591 §3.2.1 response body.
    pub fn response_json(&self) -> Value {
        let mut body = json!({
            "client_id": self.client_id,
            "client_id_issued_at": self.created_at,
            "redirect_uris": self.redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        });
        if let Some(name) = &self.client_name {
            body["client_name"] = json!(name);
        }
        body
    }
}

struct State {
    registrations: BTreeMap<String, Registration>,
    /// `last_used_at` as last written to disk.
    persisted_use: HashMap<String, Option<u64>>,
}

impl State {
    fn new(registrations: BTreeMap<String, Registration>) -> Self {
        let persisted_use = registrations
            .iter()
            .map(|(id, reg)| (id.clone(), reg.last_used_at))
            .collect();
        Self {
            registrations,
            persisted_use,
        }
    }
}

pub struct ClientRegistry {
    path: PathBuf,
    /// `None` after a failed write: memory and disk may disagree, so the
    /// registry refuses everything until restart.
    state: Mutex<Option<State>>,
}

impl ClientRegistry {
    /// Reads the registry without writing: startup must work on a read-only
    /// data root. A corrupt file is an error, not an empty registry.
    pub fn load(root: &Path) -> io::Result<Self> {
        let path = root.join(FILE_NAME);
        let registrations = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error),
        };
        Ok(Self {
            path,
            state: Mutex::new(Some(State::new(registrations))),
        })
    }

    pub fn register(&self, body: &Value, now: u64) -> Result<Registration, OAuthError> {
        let (client_name, redirect_uris) = parse_registration(body)?;
        let mut guard = self
            .state
            .lock()
            .map_err(|_| OAuthError::TemporarilyUnavailable)?;
        let state = guard.as_mut().ok_or(OAuthError::TemporarilyUnavailable)?;
        let recent = state
            .registrations
            .values()
            .filter(|reg| reg.created_at.saturating_add(RATE_WINDOW_SECS) > now)
            .count();
        if recent >= RATE_LIMIT || state.registrations.len() >= MAX_STORED {
            return Err(OAuthError::TemporarilyUnavailable);
        }
        let registration = Registration {
            client_id: new_id().map_err(|_| OAuthError::TemporarilyUnavailable)?,
            client_name,
            redirect_uris,
            created_at: now,
            last_used_at: None,
        };
        let mut updated = state.registrations.clone();
        updated.insert(registration.client_id.clone(), registration.clone());
        if let Err(error) = persist(&self.path, &updated) {
            tracing::error!("could not store MCP client registration: {error}");
            *guard = None;
            return Err(OAuthError::TemporarilyUnavailable);
        }
        *state = State::new(updated);
        Ok(registration)
    }

    pub fn get(&self, id: &str) -> Option<Registration> {
        let guard = self.state.lock().ok()?;
        guard.as_ref()?.registrations.get(id).cloned()
    }

    pub fn touch(&self, id: &str, now: u64) {
        let Ok(mut guard) = self.state.lock() else {
            return;
        };
        let Some(state) = guard.as_mut() else {
            return;
        };
        let Some(registration) = state.registrations.get_mut(id) else {
            return;
        };
        let used = registration.last_used_at.unwrap_or(0).max(now);
        registration.last_used_at = Some(used);
        let due = match state.persisted_use.get(id).copied().flatten() {
            None => true,
            Some(persisted) => used.saturating_sub(persisted) > TOUCH_PERSIST_SECS,
        };
        if !due {
            return;
        }
        match persist(&self.path, &state.registrations) {
            Ok(()) => {
                state.persisted_use.insert(id.to_string(), Some(used));
            }
            Err(error) => tracing::warn!("could not record MCP client use: {error}"),
        }
    }

    /// Removes registrations that no grant uses and that were never used for 7
    /// days, or idle for 90. Writes only when something was removed.
    /// `has_live_grant` runs under the registry lock; it must not call back in.
    pub fn gc(&self, now: u64, has_live_grant: &dyn Fn(&str) -> bool) {
        let Ok(mut guard) = self.state.lock() else {
            return;
        };
        let Some(state) = guard.as_mut() else {
            return;
        };
        let mut updated = state.registrations.clone();
        updated.retain(|id, reg| {
            let expires = match reg.last_used_at {
                None => reg.created_at.saturating_add(UNUSED_TTL_SECS),
                Some(used) => used.saturating_add(IDLE_TTL_SECS),
            };
            expires > now || has_live_grant(id)
        });
        if updated.len() == state.registrations.len() {
            return;
        }
        if let Err(error) = persist(&self.path, &updated) {
            tracing::error!("could not remove expired MCP client registrations: {error}");
            *guard = None;
            return;
        }
        *state = State::new(updated);
    }
}

fn parse_registration(body: &Value) -> Result<(Option<String>, Vec<String>), OAuthError> {
    let invalid = OAuthError::InvalidClientMetadata;
    let object = body
        .as_object()
        .ok_or(invalid("registration must be a JSON object"))?;

    match object.get("token_endpoint_auth_method") {
        None => {}
        Some(Value::String(method)) if method == "none" => {}
        Some(_) => {
            return Err(invalid(
                "only public clients are supported (auth method none)",
            ))
        }
    }
    check_subset(
        object.get("grant_types"),
        &["authorization_code", "refresh_token"],
        "unsupported grant_types",
    )?;
    check_subset(
        object.get("response_types"),
        &["code"],
        "unsupported response_types",
    )?;

    let client_name = match object.get("client_name") {
        None | Some(Value::Null) => None,
        Some(Value::String(name)) => clean_name(name),
        Some(_) => return Err(invalid("client_name must be a string")),
    };

    let uris = object
        .get("redirect_uris")
        .and_then(Value::as_array)
        .ok_or(OAuthError::InvalidRedirectUri("redirect_uris is required"))?;
    if uris.is_empty() || uris.len() > MAX_REDIRECT_URIS {
        return Err(OAuthError::InvalidRedirectUri(
            "redirect_uris must have 1 to 10 entries",
        ));
    }
    let mut redirect_uris: Vec<String> = Vec::new();
    for uri in uris {
        let uri = uri
            .as_str()
            .filter(|uri| uri.len() <= MAX_REDIRECT_URI_BYTES)
            .ok_or(OAuthError::InvalidRedirectUri(
                "redirect_uris must be strings",
            ))?;
        // https, or loopback http; no fragment or userinfo.
        if !redirect_allowed(uri, &[uri.to_string()]) {
            return Err(OAuthError::InvalidRedirectUri(
                "redirect URIs must be https or loopback http without a fragment",
            ));
        }
        if !redirect_uris.iter().any(|known| known == uri) {
            redirect_uris.push(uri.to_string());
        }
    }
    Ok((client_name, redirect_uris))
}

fn check_subset(
    value: Option<&Value>,
    allowed: &[&str],
    message: &'static str,
) -> Result<(), OAuthError> {
    let Some(value) = value else {
        return Ok(());
    };
    let ok = value.as_array().is_some_and(|items| {
        items
            .iter()
            .all(|item| item.as_str().is_some_and(|s| allowed.contains(&s)))
    });
    if ok {
        Ok(())
    } else {
        Err(OAuthError::InvalidClientMetadata(message))
    }
}

fn new_id() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("{DCR_PREFIX}{hex}"))
}

fn persist(path: &Path, registrations: &BTreeMap<String, Registration>) -> io::Result<()> {
    let bytes = serde_json::to_vec(registrations).map_err(io::Error::other)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)?;
        #[cfg(unix)]
        std::fs::File::open(
            path.parent()
                .ok_or_else(|| io::Error::other("missing client registry directory"))?,
        )?
        .sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

#[derive(Debug, Clone)]
pub enum McpClient {
    Cimd(Arc<ClientMetadata>),
    Dcr(Registration),
}

impl McpClient {
    pub fn id(&self) -> &str {
        match self {
            Self::Cimd(meta) => &meta.client_id,
            Self::Dcr(reg) => &reg.client_id,
        }
    }

    /// What the consent page calls the app. Self-declared, so only the CIMD
    /// host (which the client does not choose freely) is a fallback.
    pub fn display_name(&self) -> String {
        match self {
            Self::Cimd(meta) => meta
                .client_name
                .clone()
                .unwrap_or_else(|| meta.verified_host.clone()),
            Self::Dcr(reg) => reg
                .client_name
                .clone()
                .unwrap_or_else(|| "Unnamed app".to_string()),
        }
    }

    pub fn redirect_uris(&self) -> &[String] {
        match self {
            Self::Cimd(meta) => &meta.redirect_uris,
            Self::Dcr(reg) => &reg.redirect_uris,
        }
    }

    /// Whether the client authenticates at the token endpoint with client
    /// assertions; DCR clients are always public.
    pub fn uses_private_key_jwt(&self) -> bool {
        matches!(self, Self::Cimd(meta) if matches!(meta.auth, ClientAuth::PrivateKeyJwt { .. }))
    }

    /// The host the metadata document was fetched from; DCR has none.
    pub fn verified_host(&self) -> Option<&str> {
        match self {
            Self::Cimd(meta) => Some(&meta.verified_host),
            Self::Dcr(_) => None,
        }
    }
}

/// Whether `id` names a client metadata document, which resolving fetches.
/// Every place that must not fetch for a signed-out or unchecked request
/// tests this same predicate.
pub fn is_metadata_url(id: &str) -> bool {
    id.starts_with("https://")
}

/// Legacy labels (`silverbullet-cli`, ...) are not MCP clients.
pub async fn resolve_client(
    id: &str,
    registry: &ClientRegistry,
    cimd: &CimdFetcher,
) -> Result<McpClient, OAuthError> {
    if id.starts_with(DCR_PREFIX) {
        registry
            .get(id)
            .map(McpClient::Dcr)
            .ok_or(OAuthError::UnauthorizedClient)
    } else if is_metadata_url(id) {
        cimd.fetch(id).await.map(McpClient::Cimd)
    } else {
        Err(OAuthError::UnauthorizedClient)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const NOW: u64 = 1_800_000_000;
    const DAY: u64 = 86_400;

    fn body(uri: &str) -> Value {
        json!({"redirect_uris": [uri], "client_name": "Example"})
    }

    fn registry() -> (tempfile::TempDir, ClientRegistry) {
        let dir = tempdir().unwrap();
        let registry = ClientRegistry::load(dir.path()).unwrap();
        (dir, registry)
    }

    fn register_ok(registry: &ClientRegistry, now: u64) -> Registration {
        registry
            .register(&body("https://app.example/cb"), now)
            .unwrap()
    }

    #[test]
    fn register_issues_sbdcr_id_and_persists() {
        let (dir, registry) = registry();
        let reg = registry
            .register(
                &json!({
                    "redirect_uris": ["https://app.example/cb", "https://app.example/cb"],
                    "client_name": "  Ex\u{202E}ample  ",
                    "token_endpoint_auth_method": "none",
                    "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"],
                }),
                NOW,
            )
            .unwrap();
        let hex = reg.client_id.strip_prefix("sbdcr_").unwrap();
        assert_eq!(hex.len(), 32);
        assert!(hex.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_eq!(reg.client_name.as_deref(), Some("Example"));
        assert_eq!(reg.redirect_uris, vec!["https://app.example/cb"]);
        let response = reg.response_json();
        assert_eq!(response["client_id"], reg.client_id.as_str());
        assert_eq!(response["client_id_issued_at"], NOW);
        assert_eq!(response["token_endpoint_auth_method"], "none");
        assert!(response.get("client_secret").is_none());

        let reloaded = ClientRegistry::load(dir.path()).unwrap();
        assert_eq!(reloaded.get(&reg.client_id), Some(reg));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(FILE_NAME))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn register_truncates_long_names() {
        let (_dir, registry) = registry();
        let reg = registry
            .register(
                &json!({"redirect_uris": ["https://a.example/cb"], "client_name": "x".repeat(300)}),
                NOW,
            )
            .unwrap();
        assert_eq!(reg.client_name.unwrap().chars().count(), 100);
    }

    #[test]
    fn register_rejects_confidential_client() {
        let (_dir, registry) = registry();
        for method in [
            json!("client_secret_basic"),
            json!("client_secret_post"),
            json!("private_key_jwt"),
            json!(5),
        ] {
            let result = registry.register(
                &json!({"redirect_uris": ["https://a.example/cb"], "token_endpoint_auth_method": method}),
                NOW,
            );
            assert!(
                matches!(result, Err(OAuthError::InvalidClientMetadata(_))),
                "{method}"
            );
        }
    }

    #[test]
    fn register_rejects_unsupported_grant_and_response_types() {
        let (_dir, registry) = registry();
        for (key, value) in [
            ("grant_types", json!(["implicit"])),
            ("grant_types", json!(["authorization_code", "password"])),
            ("grant_types", json!("authorization_code")),
            ("response_types", json!(["token"])),
        ] {
            let mut doc = json!({"redirect_uris": ["https://a.example/cb"]});
            doc[key] = value;
            assert!(
                matches!(
                    registry.register(&doc, NOW),
                    Err(OAuthError::InvalidClientMetadata(_))
                ),
                "{doc}"
            );
        }
    }

    #[test]
    fn register_rejects_custom_scheme_redirect() {
        let (_dir, registry) = registry();
        let result = registry.register(&body("com.example.app:/cb"), NOW);
        assert!(matches!(result, Err(OAuthError::InvalidRedirectUri(_))));
    }

    #[test]
    fn register_rejects_plain_http_non_loopback() {
        let (_dir, registry) = registry();
        for uri in [
            "http://app.example/cb",
            "http://10.0.0.1/cb",
            "https://app.example/cb#frag",
            "https://user:pw@app.example/cb",
            "not a url",
        ] {
            let result = registry.register(&body(uri), NOW);
            assert!(
                matches!(result, Err(OAuthError::InvalidRedirectUri(_))),
                "{uri}"
            );
        }
    }

    #[test]
    fn register_accepts_localhost_loopback() {
        let (_dir, registry) = registry();
        for uri in [
            "http://localhost:8123/callback",
            "http://127.0.0.1:8123/cb",
            "http://[::1]:8123/cb",
        ] {
            assert!(registry.register(&body(uri), NOW).is_ok(), "{uri}");
        }
    }

    #[test]
    fn register_checks_redirect_uri_count_and_shape() {
        let (_dir, registry) = registry();
        let eleven: Vec<String> = (0..11).map(|i| format!("https://a.example/{i}")).collect();
        let ten: Vec<String> = (0..10).map(|i| format!("https://a.example/{i}")).collect();
        for doc in [
            json!({"redirect_uris": []}),
            json!({"client_name": "x"}),
            json!({"redirect_uris": "https://a.example/cb"}),
            json!({"redirect_uris": [5]}),
            json!({"redirect_uris": eleven}),
        ] {
            assert!(
                matches!(
                    registry.register(&doc, NOW),
                    Err(OAuthError::InvalidRedirectUri(_))
                ),
                "{doc}"
            );
        }
        assert!(registry
            .register(&json!({"redirect_uris": ten}), NOW)
            .is_ok());
        assert!(matches!(
            registry.register(&json!([1]), NOW),
            Err(OAuthError::InvalidClientMetadata(_))
        ));
    }

    #[test]
    fn register_rate_limited_after_20_in_10_minutes() {
        let (_dir, registry) = registry();
        for i in 0..20 {
            register_ok(&registry, NOW + i);
        }
        assert_eq!(
            registry.register(&body("https://app.example/cb"), NOW + 30),
            Err(OAuthError::TemporarilyUnavailable)
        );
        assert!(registry
            .register(&body("https://app.example/cb"), NOW + 599)
            .is_err());
        assert!(registry
            .register(&body("https://app.example/cb"), NOW + 601)
            .is_ok());
    }

    #[test]
    fn rate_limit_survives_restart() {
        let (dir, registry) = registry();
        for i in 0..20 {
            register_ok(&registry, NOW + i);
        }
        let reloaded = ClientRegistry::load(dir.path()).unwrap();
        assert!(reloaded
            .register(&body("https://app.example/cb"), NOW + 30)
            .is_err());
    }

    fn seed(dir: &Path, count: usize, created_at: u64) {
        let registrations: BTreeMap<String, Registration> = (0..count)
            .map(|i| {
                let id = format!("{DCR_PREFIX}{i:032x}");
                (
                    id.clone(),
                    Registration {
                        client_id: id,
                        client_name: None,
                        redirect_uris: vec!["https://a.example/cb".into()],
                        created_at,
                        last_used_at: None,
                    },
                )
            })
            .collect();
        std::fs::write(
            dir.join(FILE_NAME),
            serde_json::to_vec(&registrations).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn register_refused_past_1000_stored() {
        let dir = tempdir().unwrap();
        seed(dir.path(), MAX_STORED - 1, NOW - DAY);
        let registry = ClientRegistry::load(dir.path()).unwrap();
        // The 1000th still fits; the 1001st does not. The seeded entries are
        // old enough that the rate limit is not what refuses it.
        register_ok(&registry, NOW);
        assert_eq!(
            registry.register(&body("https://app.example/cb"), NOW + 1),
            Err(OAuthError::TemporarilyUnavailable)
        );
        registry.gc(NOW + 8 * DAY, &|_| false);
        assert!(registry
            .register(&body("https://app.example/cb"), NOW + 8 * DAY)
            .is_ok());
    }

    #[test]
    fn gc_removes_never_used_after_7_days_and_idle_after_90_days_but_keeps_live_grants() {
        let (dir, registry) = registry();
        let never_used = register_ok(&registry, NOW);
        let used = register_ok(&registry, NOW + 1);
        let granted = register_ok(&registry, NOW + 2);
        let fresh = register_ok(&registry, NOW + 3 * DAY);
        registry.touch(&used.client_id, NOW + DAY);
        let live = |id: &str| id == granted.client_id;

        registry.gc(NOW + 7 * DAY - 1, &live);
        assert!(registry.get(&never_used.client_id).is_some());

        registry.gc(NOW + 7 * DAY, &live);
        assert!(registry.get(&never_used.client_id).is_none());
        assert!(registry.get(&used.client_id).is_some(), "used: 90 day rule");
        assert!(registry.get(&granted.client_id).is_some(), "live grant");
        assert!(registry.get(&fresh.client_id).is_some());

        let reloaded = ClientRegistry::load(dir.path()).unwrap();
        assert!(reloaded.get(&never_used.client_id).is_none());
        assert!(reloaded.get(&used.client_id).is_some());

        registry.gc(NOW + DAY + 90 * DAY - 1, &live);
        assert!(registry.get(&used.client_id).is_some());
        registry.gc(NOW + DAY + 90 * DAY, &live);
        assert!(registry.get(&used.client_id).is_none());
        assert!(registry.get(&granted.client_id).is_some());
        assert!(registry.get(&fresh.client_id).is_none());

        let reloaded = ClientRegistry::load(dir.path()).unwrap();
        assert!(reloaded.get(&used.client_id).is_none());
        assert!(reloaded.get(&granted.client_id).is_some());

        registry.gc(NOW + 200 * DAY, &|_| false);
        assert!(registry.get(&granted.client_id).is_none());
    }

    #[test]
    fn gc_does_not_write_when_nothing_expired() {
        let (dir, registry) = registry();
        let reg = register_ok(&registry, NOW);
        let path = dir.path().join(FILE_NAME);
        std::fs::remove_file(&path).unwrap();
        registry.gc(NOW + 1, &|_| false);
        assert!(!path.exists());
        assert!(registry.get(&reg.client_id).is_some());
    }

    #[test]
    fn touch_persists_first_use_then_at_most_hourly() {
        let (dir, registry) = registry();
        let reg = register_ok(&registry, NOW);
        let stored = |dir: &Path| {
            ClientRegistry::load(dir)
                .unwrap()
                .get(&reg.client_id)
                .unwrap()
                .last_used_at
        };
        registry.touch(&reg.client_id, NOW + 10);
        assert_eq!(stored(dir.path()), Some(NOW + 10));
        registry.touch(&reg.client_id, NOW + 20);
        assert_eq!(
            registry.get(&reg.client_id).unwrap().last_used_at,
            Some(NOW + 20)
        );
        assert_eq!(stored(dir.path()), Some(NOW + 10));
        let later = NOW + 10 + TOUCH_PERSIST_SECS + 1;
        registry.touch(&reg.client_id, later);
        assert_eq!(stored(dir.path()), Some(later));
        registry.touch("sbdcr_unknown", NOW);
    }

    #[test]
    fn load_does_not_write() {
        let dir = tempdir().unwrap();
        seed(dir.path(), 2, NOW);
        let path = dir.path().join(FILE_NAME);
        let before = std::fs::read(&path).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        ClientRegistry::load(dir.path()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            modified
        );
        let empty = tempdir().unwrap();
        ClientRegistry::load(empty.path()).unwrap();
        assert!(!empty.path().join(FILE_NAME).exists());
    }

    #[test]
    fn corrupt_store_fails_to_load_and_is_left_alone() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(ClientRegistry::load(dir.path()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ not json");
    }

    #[cfg(unix)]
    #[test]
    fn failed_write_fails_closed() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, registry) = registry();
        let kept = register_ok(&registry, NOW);
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        // Root ignores directory modes; skip rather than pass for the wrong reason.
        if std::fs::File::create(dir.path().join("probe")).is_ok() {
            std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
            return;
        }
        let result = registry.register(&body("https://app.example/cb"), NOW + 700);
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(result, Err(OAuthError::TemporarilyUnavailable));
        assert!(registry.get(&kept.client_id).is_none());
        assert!(registry
            .register(&body("https://app.example/cb"), NOW + 1400)
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn load_works_on_a_read_only_root() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        seed(dir.path(), 1, NOW);
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let result = ClientRegistry::load(dir.path());
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result
            .unwrap()
            .get(&format!("{DCR_PREFIX}{:032x}", 0))
            .is_some());
    }

    #[tokio::test]
    async fn resolve_client_routes_by_shape() {
        let (_dir, registry) = registry();
        let cimd = CimdFetcher::new();
        for id in [
            "silverbullet-cli",
            "silverbullet-app",
            "http://client.example/m",
            "sbdcr_",
            "sbdcr_00000000000000000000000000000000",
        ] {
            assert_eq!(
                resolve_client(id, &registry, &cimd).await.err(),
                Some(OAuthError::UnauthorizedClient),
                "{id}"
            );
        }
        let reg = register_ok(&registry, NOW);
        let client = resolve_client(&reg.client_id, &registry, &cimd)
            .await
            .unwrap();
        assert_eq!(client.id(), reg.client_id);
        assert_eq!(client.display_name(), "Example");
        assert_eq!(client.redirect_uris(), ["https://app.example/cb"]);
        assert_eq!(client.verified_host(), None);
        // An https id reaches the CIMD fetcher, whose fetch failure is not
        // the UnauthorizedClient the shape check gives other ids.
        let result = resolve_client("https://client.invalid/m", &registry, &cimd).await;
        assert!(matches!(result, Err(OAuthError::InvalidClientMetadata(_))));
    }

    #[test]
    fn display_name_falls_back() {
        let dcr = McpClient::Dcr(Registration {
            client_id: "sbdcr_x".into(),
            client_name: None,
            redirect_uris: vec![],
            created_at: 0,
            last_used_at: None,
        });
        assert_eq!(dcr.display_name(), "Unnamed app");
        let cimd = McpClient::Cimd(Arc::new(ClientMetadata {
            client_id: "https://c.example/m".into(),
            client_name: None,
            logo_uri: None,
            redirect_uris: vec![],
            verified_host: "c.example".into(),
            auth: ClientAuth::None,
        }));
        assert_eq!(cimd.display_name(), "c.example");
        assert_eq!(cimd.verified_host(), Some("c.example"));
    }
}
