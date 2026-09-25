use std::collections::BTreeMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};

const FILE_NAME: &str = ".silverbullet.browser-sessions.json";
const MAX_SESSIONS: usize = 10_000;

#[derive(Clone, Serialize, Deserialize)]
struct BrowserSession {
    username: String,
    provider: Option<String>,
    created_at: u64,
    expires_at: u64,
}

pub struct BrowserSessions {
    path: PathBuf,
    sessions: Mutex<Option<BTreeMap<String, BrowserSession>>>,
}

impl BrowserSessions {
    pub fn load(root: &Path) -> io::Result<Self> {
        let path = root.join(FILE_NAME);
        let mut sessions: BTreeMap<String, BrowserSession> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error),
        };
        sessions.retain(|_, session| session.expires_at > now_secs());
        if sessions.len() > MAX_SESSIONS {
            return Err(io::Error::other("browser session limit exceeded"));
        }
        persist(&path, &sessions)?;
        Ok(Self {
            path,
            sessions: Mutex::new(Some(sessions)),
        })
    }

    pub fn issue(
        &self,
        username: &str,
        provider: Option<&str>,
        expires_at: u64,
    ) -> io::Result<String> {
        let now = now_secs();
        if username.is_empty() || expires_at <= now {
            return Err(io::Error::other("invalid browser session"));
        }
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
        let id = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        self.mutate(|sessions| {
            if sessions.len() >= MAX_SESSIONS {
                return Err(io::Error::other("browser session limit exceeded"));
            }
            sessions.insert(
                id.clone(),
                BrowserSession {
                    username: username.into(),
                    provider: provider.map(str::to_string),
                    created_at: now,
                    expires_at,
                },
            );
            Ok(())
        })?;
        Ok(id)
    }

    pub fn is_active(&self, id: &str, username: &str) -> bool {
        self.expires_at(id, username).is_some()
    }

    pub fn expires_at(&self, id: &str, username: &str) -> Option<u64> {
        let guard = self.sessions.lock().ok()?;
        let session = guard.as_ref()?.get(id)?;
        (session.username == username && session.expires_at > now_secs())
            .then_some(session.expires_at)
    }

    pub fn revoke(&self, id: &str) -> io::Result<()> {
        self.mutate(|sessions| {
            sessions.remove(id);
            Ok(())
        })
    }

    pub fn revoke_provider(&self, provider: &str) -> io::Result<()> {
        self.mutate(|sessions| {
            sessions.retain(|_, session| session.provider.as_deref() != Some(provider));
            Ok(())
        })
    }

    fn mutate(
        &self,
        change: impl FnOnce(&mut BTreeMap<String, BrowserSession>) -> io::Result<()>,
    ) -> io::Result<()> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| io::Error::other("browser session store unavailable"))?;
        let mut updated = guard
            .as_ref()
            .ok_or_else(|| io::Error::other("browser session store unavailable"))?
            .clone();
        updated.retain(|_, session| session.expires_at > now_secs());
        change(&mut updated)?;
        if let Err(error) = persist(&self.path, &updated) {
            *guard = None;
            return Err(error);
        }
        *guard = Some(updated);
        Ok(())
    }
}

fn persist(path: &Path, sessions: &BTreeMap<String, BrowserSession>) -> io::Result<()> {
    let bytes = serde_json::to_vec(sessions).map_err(io::Error::other)?;
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
                .ok_or_else(|| io::Error::other("missing session directory"))?,
        )?
        .sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub fn logout_allowed(headers: &axum::http::HeaderMap) -> bool {
    if let Some(value) = headers.get("sec-fetch-site") {
        if !matches!(value.to_str().ok(), Some("same-origin" | "none")) {
            return false;
        }
    }
    let scheme = if crate::auth::is_secure_request(headers) {
        "https"
    } else {
        "http"
    };
    let expected = format!("{scheme}://{}", crate::auth::request_host(headers));
    if let Some(origin) = headers.get(axum::http::header::ORIGIN) {
        if !origin
            .to_str()
            .is_ok_and(|origin| origin.eq_ignore_ascii_case(&expected))
        {
            return false;
        }
    }
    if let Some(referer) = headers.get(axum::http::header::REFERER) {
        let valid = referer
            .to_str()
            .ok()
            .and_then(|value| reqwest::Url::parse(value).ok())
            .is_some_and(|url| {
                url.origin()
                    .ascii_serialization()
                    .eq_ignore_ascii_case(&expected)
            });
        if !valid {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    fn future() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600
    }

    #[test]
    fn revocation_survives_restart_and_preserves_other_sessions() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let first = sessions.issue("river", None, future()).unwrap();
        let second = sessions.issue("river", None, future()).unwrap();
        assert_ne!(first, second);
        sessions.revoke(&first).unwrap();
        let restored = BrowserSessions::load(dir.path()).unwrap();
        assert!(!restored.is_active(&first, "river"));
        assert!(restored.is_active(&second, "river"));
    }

    #[test]
    fn provider_revocation_leaves_local_and_other_provider_sessions() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let local = sessions.issue("river", None, future()).unwrap();
        let sso = sessions.issue("sky", Some("work"), future()).unwrap();
        let other = sessions.issue("cloud", Some("other"), future()).unwrap();
        sessions.revoke_provider("work").unwrap();
        assert!(!sessions.is_active(&sso, "sky"));
        assert!(sessions.is_active(&local, "river"));
        assert!(sessions.is_active(&other, "cloud"));
    }

    #[test]
    fn sessions_reject_unknown_ids_wrong_users_and_expiry() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let id = sessions.issue("river", None, future()).unwrap();
        assert!(!sessions.is_active("unknown", "river"));
        assert!(!sessions.is_active(&id, "cloud"));
        assert!(sessions.issue("river", None, 1).is_err());
    }
    #[test]
    fn corrupt_store_fails_closed() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"invalid json").unwrap();
        assert!(BrowserSessions::load(dir.path()).is_err());
    }

    #[test]
    fn failed_revocation_disables_validation_and_issuance() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let id = sessions.issue("river", None, future()).unwrap();
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        std::fs::create_dir(dir.path().join(FILE_NAME)).unwrap();
        assert!(sessions.revoke(&id).is_err());
        assert!(!sessions.is_active(&id, "river"));
        assert!(sessions.issue("cloud", None, future()).is_err());
    }

    #[test]
    fn reload_removes_expired_records_and_keeps_private_permissions() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join(FILE_NAME),
            r#"{"expired":{"username":"river","provider":null,"created_at":1,"expires_at":2}}"#,
        )
        .unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        assert!(!sessions.is_active("expired", "river"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(),
            "{}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.path().join(FILE_NAME))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn session_store_is_bounded_without_evicting_active_sessions() {
        let dir = tempdir().unwrap();
        let records: BTreeMap<_, _> = (0..MAX_SESSIONS)
            .map(|i| {
                (
                    i.to_string(),
                    BrowserSession {
                        username: "river".into(),
                        provider: None,
                        created_at: 1,
                        expires_at: future(),
                    },
                )
            })
            .collect();
        std::fs::write(
            dir.path().join(FILE_NAME),
            serde_json::to_vec(&records).unwrap(),
        )
        .unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        assert!(sessions.issue("river", None, future()).is_err());
        assert!(sessions.is_active("0", "river"));
    }

    #[test]
    fn concurrent_revocation_is_visible_after_it_returns() {
        let dir = tempdir().unwrap();
        let sessions = std::sync::Arc::new(BrowserSessions::load(dir.path()).unwrap());
        let id = sessions.issue("river", None, future()).unwrap();
        let second = sessions.clone();
        let revoked = id.clone();
        let thread = std::thread::spawn(move || second.revoke(&revoked).unwrap());
        let _ = sessions.is_active(&id, "river");
        thread.join().unwrap();
        assert!(!sessions.is_active(&id, "river"));
    }
}
