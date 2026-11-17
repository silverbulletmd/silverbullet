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
    /// Idle window this session slides by. `0` on records written before
    /// sessions slid: they use the configured default.
    #[serde(default)]
    idle_secs: u64,
    /// Signed in on a shared computer: no persistent cookie, nothing kept
    /// on the device.
    #[serde(default)]
    shared: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionInfo {
    pub expires_at: u64,
    pub idle_secs: u64,
    pub shared: bool,
}

/// Longest a session goes without being extended: a tenth of its idle
/// window, at most a day, so active sessions write the store about once a
/// day.
pub(crate) fn renewal_interval(idle_secs: u64) -> u64 {
    (idle_secs / 10).min(86_400)
}

pub struct BrowserSessions {
    /// `None`: kept in memory only, lost on restart.
    path: Option<PathBuf>,
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
            path: Some(path),
            sessions: Mutex::new(Some(sessions)),
        })
    }

    pub fn in_memory() -> Self {
        Self {
            path: None,
            sessions: Mutex::new(Some(BTreeMap::new())),
        }
    }

    pub fn issue(
        &self,
        username: &str,
        provider: Option<&str>,
        idle_secs: u64,
        shared: bool,
    ) -> io::Result<String> {
        let now = now_secs();
        if username.is_empty() || idle_secs == 0 {
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
                    expires_at: now.saturating_add(idle_secs),
                    idle_secs,
                    shared,
                },
            );
            Ok(())
        })?;
        Ok(id)
    }

    pub fn is_active(&self, id: &str, username: &str) -> bool {
        self.info(id, username).is_some()
    }

    pub fn info(&self, id: &str, username: &str) -> Option<SessionInfo> {
        let guard = self.sessions.lock().ok()?;
        active(guard.as_ref()?, id, username, now_secs())
    }

    /// Slides an active session to `now + idle`, at most once per
    /// [`renewal_interval`]. `Ok(None)` when nothing was due or the session
    /// isn't active. A failed write leaves every session as it was.
    pub fn renew(
        &self,
        id: &str,
        username: &str,
        default_idle_secs: u64,
    ) -> io::Result<Option<SessionInfo>> {
        let now = now_secs();
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| io::Error::other("browser session store unavailable"))?;
        let current = guard
            .as_ref()
            .ok_or_else(|| io::Error::other("browser session store unavailable"))?;
        let Some(info) = active(current, id, username, now) else {
            return Ok(None);
        };
        let idle = if info.idle_secs == 0 {
            default_idle_secs
        } else {
            info.idle_secs
        };
        if idle == 0 || info.expires_at + renewal_interval(idle) > now.saturating_add(idle) {
            return Ok(None);
        }
        let mut updated = current.clone();
        updated.retain(|_, session| session.expires_at > now);
        let session = updated
            .get_mut(id)
            .ok_or_else(|| io::Error::other("browser session vanished"))?;
        session.expires_at = now.saturating_add(idle);
        session.idle_secs = idle;
        let renewed = SessionInfo {
            expires_at: session.expires_at,
            idle_secs: idle,
            shared: session.shared,
        };
        if let Some(path) = &self.path {
            persist(path, &updated)?;
        }
        *guard = Some(updated);
        Ok(Some(renewed))
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
        if let Some(path) = &self.path {
            if let Err(error) = persist(path, &updated) {
                *guard = None;
                return Err(error);
            }
        }
        *guard = Some(updated);
        Ok(())
    }
}

#[cfg(test)]
impl BrowserSessions {
    /// Moves a session's expiry `secs` into the past, as if it had last been
    /// extended that long ago.
    pub(crate) fn backdate_for_test(&self, id: &str, secs: u64) {
        let mut guard = self.sessions.lock().unwrap();
        let session = guard.as_mut().unwrap().get_mut(id).unwrap();
        session.expires_at -= secs;
    }
}

fn active(
    sessions: &BTreeMap<String, BrowserSession>,
    id: &str,
    username: &str,
    now: u64,
) -> Option<SessionInfo> {
    let session = sessions.get(id)?;
    (session.username == username && session.expires_at > now).then_some(SessionInfo {
        expires_at: session.expires_at,
        idle_secs: session.idle_secs,
        shared: session.shared,
    })
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
        let first = sessions.issue("river", None, 3600, false).unwrap();
        let second = sessions.issue("river", None, 3600, false).unwrap();
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
        let local = sessions.issue("river", None, 3600, false).unwrap();
        let sso = sessions.issue("sky", Some("work"), 3600, false).unwrap();
        let other = sessions.issue("cloud", Some("other"), 3600, false).unwrap();
        sessions.revoke_provider("work").unwrap();
        assert!(!sessions.is_active(&sso, "sky"));
        assert!(sessions.is_active(&local, "river"));
        assert!(sessions.is_active(&other, "cloud"));
    }

    #[test]
    fn sessions_reject_unknown_ids_wrong_users_and_expiry() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let id = sessions.issue("river", None, 3600, false).unwrap();
        assert!(!sessions.is_active("unknown", "river"));
        assert!(!sessions.is_active(&id, "cloud"));
        assert!(sessions.issue("river", None, 0, false).is_err());
        assert!(sessions.issue("", None, 3600, false).is_err());
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
        let id = sessions.issue("river", None, 3600, false).unwrap();
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        std::fs::create_dir(dir.path().join(FILE_NAME)).unwrap();
        assert!(sessions.revoke(&id).is_err());
        assert!(!sessions.is_active(&id, "river"));
        assert!(sessions.issue("cloud", None, 3600, false).is_err());
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
                        idle_secs: 3600,
                        shared: false,
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
        assert!(sessions.issue("river", None, 3600, false).is_err());
        assert!(sessions.is_active("0", "river"));
    }

    #[test]
    fn an_in_memory_store_issues_and_revokes_without_files() {
        let sessions = BrowserSessions::in_memory();
        let id = sessions.issue("river", None, 3600, false).unwrap();
        assert!(sessions.is_active(&id, "river"));
        sessions.revoke(&id).unwrap();
        assert!(!sessions.is_active(&id, "river"));
    }

    const DAY: u64 = 86_400;
    const IDLE: u64 = 30 * DAY;

    fn backdate(sessions: &BrowserSessions, id: &str, secs: u64) {
        sessions.backdate_for_test(id, secs);
    }

    #[test]
    fn renew_extends_only_after_the_throttle_interval() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let id = sessions.issue("river", None, IDLE, false).unwrap();
        assert!(sessions.renew(&id, "river", IDLE).unwrap().is_none());
        backdate(&sessions, &id, 2 * DAY);
        let renewed = sessions.renew(&id, "river", IDLE).unwrap().unwrap();
        assert!(renewed.expires_at.abs_diff(now_secs() + IDLE) <= 2);
        assert_eq!(renewed.idle_secs, IDLE);
        assert!(!renewed.shared);
        let restored = BrowserSessions::load(dir.path()).unwrap();
        assert_eq!(
            restored.info(&id, "river").unwrap().expires_at,
            renewed.expires_at
        );
    }

    #[test]
    fn renew_ignores_revoked_and_expired_sessions() {
        let sessions = BrowserSessions::in_memory();
        let id = sessions.issue("river", None, IDLE, false).unwrap();
        backdate(&sessions, &id, 2 * DAY);
        assert!(sessions.renew(&id, "cloud", IDLE).unwrap().is_none());
        sessions.revoke(&id).unwrap();
        assert!(sessions.renew(&id, "river", IDLE).unwrap().is_none());
        let expired = sessions.issue("river", None, 3600, false).unwrap();
        backdate(&sessions, &expired, 3600);
        assert!(sessions.renew(&expired, "river", IDLE).unwrap().is_none());
        assert!(!sessions.is_active(&expired, "river"));
    }

    #[test]
    fn shared_sessions_keep_their_short_window() {
        let sessions = BrowserSessions::in_memory();
        let id = sessions.issue("river", None, 12 * 3600, true).unwrap();
        backdate(&sessions, &id, 2 * 3600);
        let renewed = sessions.renew(&id, "river", IDLE).unwrap().unwrap();
        assert!(renewed.shared);
        assert_eq!(renewed.idle_secs, 12 * 3600);
        assert!(renewed.expires_at.abs_diff(now_secs() + 12 * 3600) <= 2);
    }

    #[test]
    fn legacy_records_without_idle_fields_load_and_renew_with_the_default() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join(FILE_NAME),
            format!(
                r#"{{"legacy":{{"username":"river","provider":null,"created_at":1,"expires_at":{}}}}}"#,
                now_secs() + 3 * DAY
            ),
        )
        .unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let info = sessions.info("legacy", "river").unwrap();
        assert!(!info.shared);
        let renewed = sessions.renew("legacy", "river", IDLE).unwrap().unwrap();
        assert!(renewed.expires_at.abs_diff(now_secs() + IDLE) <= 2);
        assert_eq!(renewed.idle_secs, IDLE);
    }

    #[test]
    fn concurrent_renewals_write_once() {
        let dir = tempdir().unwrap();
        let sessions = std::sync::Arc::new(BrowserSessions::load(dir.path()).unwrap());
        let id = sessions.issue("river", None, IDLE, false).unwrap();
        backdate(&sessions, &id, 2 * DAY);
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let sessions = sessions.clone();
                let id = id.clone();
                std::thread::spawn(move || sessions.renew(&id, "river", IDLE).unwrap().is_some())
            })
            .collect();
        let renewed = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|renewed| *renewed)
            .count();
        assert_eq!(renewed, 1);
    }

    #[test]
    fn a_failed_renewal_persist_keeps_existing_sessions_valid() {
        let dir = tempdir().unwrap();
        let sessions = BrowserSessions::load(dir.path()).unwrap();
        let id = sessions.issue("river", None, IDLE, false).unwrap();
        let other = sessions.issue("cloud", None, IDLE, false).unwrap();
        backdate(&sessions, &id, 2 * DAY);
        let before = sessions.info(&id, "river").unwrap().expires_at;
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        std::fs::create_dir(dir.path().join(FILE_NAME)).unwrap();
        assert!(sessions.renew(&id, "river", IDLE).is_err());
        assert_eq!(sessions.info(&id, "river").unwrap().expires_at, before);
        assert!(sessions.is_active(&other, "cloud"));
    }

    #[test]
    fn concurrent_revocation_is_visible_after_it_returns() {
        let dir = tempdir().unwrap();
        let sessions = std::sync::Arc::new(BrowserSessions::load(dir.path()).unwrap());
        let id = sessions.issue("river", None, 3600, false).unwrap();
        let second = sessions.clone();
        let revoked = id.clone();
        let thread = std::thread::spawn(move || second.revoke(&revoked).unwrap());
        let _ = sessions.is_active(&id, "river");
        thread.join().unwrap();
        assert!(!sessions.is_active(&id, "river"));
    }
}
