//! Persistent MCP grants: one per connected app, holding what the user
//! consented to and the refresh-token generation. Refresh tokens carry no
//! `aud`, so the grant records the resource they were issued for.

use std::collections::{BTreeMap, HashMap};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::tokens::REFRESH_TTL_SECS;

const FILE_NAME: &str = ".silverbullet.mcp-grants.json";
const MAX_GRANTS: usize = 10_000;
/// Live grants one user may hold. `create` refuses past it with
/// [`io::ErrorKind::QuotaExceeded`] rather than evicting an older app.
pub const MAX_GRANTS_PER_USER: usize = 50;
/// A client that lost the response to a refresh may retry with the token it
/// still holds; within this window that is not treated as theft.
const REUSE_GRACE_SECS: u64 = 30;
const TOUCH_PERSIST_SECS: u64 = 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientKind {
    Cimd,
    Dcr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub username: String,
    pub client_id: String,
    pub client_name: String,
    pub client_kind: ClientKind,
    pub verified_host: Option<String>,
    pub redirect_host: String,
    pub resource: String,
    pub spaces: Vec<String>,
    pub scope: String,
    pub access: String,
    pub credential_version: Option<String>,
    pub created_at: u64,
    pub last_used_at: u64,
    pub expires_at: u64,
    pub refresh_gen: u64,
    pub rotated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewGrant {
    pub username: String,
    pub client_id: String,
    pub client_name: String,
    pub client_kind: ClientKind,
    pub verified_host: Option<String>,
    pub redirect_host: String,
    pub resource: String,
    pub spaces: Vec<String>,
    pub scope: String,
    pub access: String,
    pub credential_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotateError {
    Unknown,
    Reused,
}

struct State {
    grants: BTreeMap<String, Grant>,
    persisted_last_used: HashMap<String, u64>,
}

impl State {
    fn new(grants: BTreeMap<String, Grant>) -> Self {
        let mut state = Self {
            grants,
            persisted_last_used: HashMap::new(),
        };
        state.mark_persisted();
        state
    }

    fn mark_persisted(&mut self) {
        self.persisted_last_used = self
            .grants
            .iter()
            .map(|(id, grant)| (id.clone(), grant.last_used_at))
            .collect();
    }
}

pub struct GrantStore {
    path: PathBuf,
    state: Mutex<Option<State>>,
    writes: AtomicUsize,
}

impl GrantStore {
    pub fn load(root: &Path) -> io::Result<Self> {
        let path = root.join(FILE_NAME);
        let mut grants: BTreeMap<String, Grant> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error),
        };
        let now = now_secs();
        grants.retain(|_, grant| grant.expires_at > now);
        persist(&path, &grants)?;
        Ok(Self {
            path,
            state: Mutex::new(Some(State::new(grants))),
            writes: AtomicUsize::new(1),
        })
    }

    /// A new grant for the same user, client and resource replaces the
    /// earlier one, so signing an app in again leaves one connection and the
    /// old tokens stop working.
    pub fn create(&self, grant: NewGrant, now: u64) -> io::Result<Grant> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
        let id: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let grant = Grant {
            id: id.clone(),
            username: grant.username,
            client_id: grant.client_id,
            client_name: grant.client_name,
            client_kind: grant.client_kind,
            verified_host: grant.verified_host,
            redirect_host: grant.redirect_host,
            resource: grant.resource,
            spaces: grant.spaces,
            scope: grant.scope,
            access: grant.access,
            credential_version: grant.credential_version,
            created_at: now,
            last_used_at: 0,
            expires_at: now + REFRESH_TTL_SECS,
            refresh_gen: 0,
            rotated_at: now,
        };
        self.mutate(now, |grants| {
            grants.retain(|_, existing| !same_app(existing, &grant));
            if user_grant_count(grants, &grant.username) >= MAX_GRANTS_PER_USER {
                return Err(io::Error::new(
                    io::ErrorKind::QuotaExceeded,
                    "too many connected apps for this user",
                ));
            }
            if grants.len() >= MAX_GRANTS {
                return Err(io::Error::other("MCP grant limit exceeded"));
            }
            grants.insert(id, grant.clone());
            Ok((grant, true))
        })
    }

    /// Whether `create` would accept a new grant for this user under the
    /// per-user cap, counting the one it would replace as gone.
    pub fn has_room_for(&self, username: &str, client_id: &str, resource: &str, now: u64) -> bool {
        let replaced = |grant: &Grant| grant.client_id == client_id && grant.resource == resource;
        self.live(now, |grant| grant.username == username && !replaced(grant))
            .len()
            < MAX_GRANTS_PER_USER
    }

    pub fn get_live(&self, id: &str, now: u64) -> Option<Grant> {
        let guard = self.state.lock().ok()?;
        let grant = guard.as_ref()?.grants.get(id)?;
        (grant.expires_at > now).then(|| grant.clone())
    }

    /// Redeems refresh generation `presented_gen`. `Ok` carries the grant at
    /// its current generation, for which the caller issues a new pair.
    pub fn rotate(&self, id: &str, presented_gen: u64, now: u64) -> Result<Grant, RotateError> {
        let outcome = self.mutate(now, |grants| {
            let Some(grant) = grants.get_mut(id) else {
                return Ok((Err(RotateError::Unknown), false));
            };
            if presented_gen == grant.refresh_gen {
                grant.refresh_gen += 1;
                grant.rotated_at = now;
                grant.last_used_at = now;
                grant.expires_at = now + REFRESH_TTL_SECS;
                return Ok((Ok(grant.clone()), true));
            }
            let previous = grant.refresh_gen.checked_sub(1) == Some(presented_gen);
            if previous && now.saturating_sub(grant.rotated_at) <= REUSE_GRACE_SECS {
                return Ok((Ok(grant.clone()), false));
            }
            grants.remove(id);
            Ok((Err(RotateError::Reused), true))
        });
        outcome.unwrap_or(Err(RotateError::Unknown))
    }

    pub fn touch(&self, id: &str, now: u64) {
        let Ok(mut guard) = self.state.lock() else {
            return;
        };
        let Some(state) = guard.as_mut() else {
            return;
        };
        let Some(grant) = state.grants.get_mut(id) else {
            return;
        };
        grant.last_used_at = grant.last_used_at.max(now);
        let persisted = state.persisted_last_used.get(id).copied().unwrap_or(0);
        if now.saturating_sub(persisted) <= TOUCH_PERSIST_SECS {
            return;
        }
        match persist(&self.path, &state.grants) {
            Ok(()) => {
                self.writes.fetch_add(1, Ordering::Relaxed);
                state.mark_persisted();
            }
            Err(error) => tracing::warn!("could not record MCP grant use: {error}"),
        }
    }

    pub fn revoke(&self, id: &str) -> io::Result<bool> {
        self.mutate(now_secs(), |grants| {
            let removed = grants.remove(id).is_some();
            Ok((removed, removed))
        })
    }

    pub fn revoke_for_user(&self, username: &str) -> io::Result<usize> {
        self.mutate(now_secs(), |grants| {
            let before = grants.len();
            grants.retain(|_, grant| grant.username != username);
            let removed = before - grants.len();
            Ok((removed, removed > 0))
        })
    }

    pub fn list_for_user(&self, username: &str) -> Vec<Grant> {
        self.live(now_secs(), |grant| grant.username == username)
    }

    pub fn list_all(&self) -> Vec<Grant> {
        self.live(now_secs(), |_| true)
    }

    pub fn has_live_grant_for_client(&self, client_id: &str, now: u64) -> bool {
        !self
            .live(now, |grant| grant.client_id == client_id)
            .is_empty()
    }

    fn live(&self, now: u64, keep: impl Fn(&Grant) -> bool) -> Vec<Grant> {
        let Ok(guard) = self.state.lock() else {
            return Vec::new();
        };
        let Some(state) = guard.as_ref() else {
            return Vec::new();
        };
        state
            .grants
            .values()
            .filter(|grant| grant.expires_at > now && keep(grant))
            .cloned()
            .collect()
    }

    /// Applies `change` to a copy; the bool says whether it must be written.
    /// A failed write disables the store, so a revocation that did not reach
    /// disk cannot be undone by a restart while the old state keeps serving.
    fn mutate<R>(
        &self,
        now: u64,
        change: impl FnOnce(&mut BTreeMap<String, Grant>) -> io::Result<(R, bool)>,
    ) -> io::Result<R> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| io::Error::other("MCP grant store unavailable"))?;
        let state = guard
            .as_mut()
            .ok_or_else(|| io::Error::other("MCP grant store unavailable"))?;
        let mut updated = state.grants.clone();
        updated.retain(|_, grant| grant.expires_at > now);
        let (result, dirty) = change(&mut updated)?;
        if dirty {
            if let Err(error) = persist(&self.path, &updated) {
                *guard = None;
                return Err(error);
            }
            self.writes.fetch_add(1, Ordering::Relaxed);
            *state = State::new(updated);
        }
        Ok(result)
    }

    #[cfg(test)]
    fn writes(&self) -> usize {
        self.writes.load(Ordering::Relaxed)
    }
}

fn same_app(a: &Grant, b: &Grant) -> bool {
    a.username == b.username && a.client_id == b.client_id && a.resource == b.resource
}

fn user_grant_count(grants: &BTreeMap<String, Grant>, username: &str) -> usize {
    grants
        .values()
        .filter(|grant| grant.username == username)
        .count()
}

fn persist(path: &Path, grants: &BTreeMap<String, Grant>) -> io::Result<()> {
    let bytes = serde_json::to_vec(grants).map_err(io::Error::other)?;
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
                .ok_or_else(|| io::Error::other("missing grant directory"))?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn new_grant(username: &str) -> NewGrant {
        NewGrant {
            username: username.into(),
            client_id: "https://notes-client.example.test/client.json".into(),
            client_name: "Notes Client".into(),
            client_kind: ClientKind::Cimd,
            verified_host: Some("notes-client.example.test".into()),
            redirect_host: "localhost".into(),
            resource: "https://notes.example.test/.mcp".into(),
            spaces: vec!["space-1".into()],
            scope: "mcp".into(),
            access: "write".into(),
            credential_version: Some("v1".into()),
        }
    }

    #[test]
    fn create_get_and_reload() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        assert_eq!(grant.id.len(), 32);
        assert!(grant.id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(grant.refresh_gen, 0);
        assert_eq!(grant.expires_at, now + REFRESH_TTL_SECS);
        assert_eq!(grant.resource, "https://notes.example.test/.mcp");
        assert_eq!(store.get_live(&grant.id, now), Some(grant.clone()));
        let restored = GrantStore::load(dir.path()).unwrap();
        assert_eq!(restored.get_live(&grant.id, now), Some(grant));
        let text = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text.contains("\"clientKind\":\"cimd\""));
        assert!(text.contains("\"refreshGen\":0"));
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
    fn rotate_advances_generation_and_slides_expiry() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        let later = now + 1000;
        let rotated = store.rotate(&grant.id, 0, later).unwrap();
        assert_eq!(rotated.refresh_gen, 1);
        assert_eq!(rotated.rotated_at, later);
        assert_eq!(rotated.expires_at, later + 7_776_000);
        let restored = GrantStore::load(dir.path()).unwrap();
        assert_eq!(restored.get_live(&grant.id, later).unwrap().refresh_gen, 1);
    }

    #[test]
    fn previous_generation_within_grace_is_accepted_without_revoking() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        store.rotate(&grant.id, 0, now + 10).unwrap();
        let retried = store.rotate(&grant.id, 0, now + 40).unwrap();
        assert_eq!(retried.refresh_gen, 1);
        assert_eq!(retried.rotated_at, now + 10);
        assert!(store.get_live(&grant.id, now + 40).is_some());
        assert_eq!(store.rotate(&grant.id, 1, now + 41).unwrap().refresh_gen, 2);
    }

    #[test]
    fn previous_generation_after_grace_revokes() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        store.rotate(&grant.id, 0, now + 10).unwrap();
        assert!(matches!(
            store.rotate(&grant.id, 0, now + 41),
            Err(RotateError::Reused)
        ));
        assert!(store.get_live(&grant.id, now + 41).is_none());
        assert!(matches!(
            store.rotate(&grant.id, 1, now + 42),
            Err(RotateError::Unknown)
        ));
        let restored = GrantStore::load(dir.path()).unwrap();
        assert!(restored.get_live(&grant.id, now + 42).is_none());
    }

    #[test]
    fn older_generation_revokes_immediately() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        store.rotate(&grant.id, 0, now + 1).unwrap();
        store.rotate(&grant.id, 1, now + 2).unwrap();
        assert!(matches!(
            store.rotate(&grant.id, 0, now + 3),
            Err(RotateError::Reused)
        ));
        assert!(store.get_live(&grant.id, now + 3).is_none());

        let other = store.create(new_grant("river"), now).unwrap();
        assert!(matches!(
            store.rotate(&other.id, 5, now + 1),
            Err(RotateError::Reused)
        ));
        assert!(store.get_live(&other.id, now + 1).is_none());
        assert!(matches!(
            store.rotate("missing", 0, now),
            Err(RotateError::Unknown)
        ));
    }

    #[test]
    fn expired_grant_is_not_live() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        assert!(store.get_live(&grant.id, grant.expires_at - 1).is_some());
        assert!(store.get_live(&grant.id, grant.expires_at).is_none());
        assert!(!store.has_live_grant_for_client(&grant.client_id, grant.expires_at));
        assert!(store.has_live_grant_for_client(&grant.client_id, now));
        assert!(matches!(
            store.rotate(&grant.id, 0, grant.expires_at),
            Err(RotateError::Unknown)
        ));

        let mut stale = grant.clone();
        stale.id = "0".repeat(32);
        stale.expires_at = 2;
        let records = BTreeMap::from([(stale.id.clone(), stale)]);
        std::fs::write(
            dir.path().join(FILE_NAME),
            serde_json::to_vec(&records).unwrap(),
        )
        .unwrap();
        let restored = GrantStore::load(dir.path()).unwrap();
        assert!(restored.list_all().is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(),
            "{}"
        );
    }

    #[test]
    fn touch_persists_at_most_hourly() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let grant = store.create(new_grant("river"), now).unwrap();
        let writes = store.writes();
        // The first use is always recorded.
        store.touch(&grant.id, now + 60);
        assert_eq!(store.writes(), writes + 1);
        assert_eq!(
            store.get_live(&grant.id, now + 60).unwrap().last_used_at,
            now + 60
        );
        store.touch(&grant.id, now + 3660);
        assert_eq!(store.writes(), writes + 1);
        let restored = GrantStore::load(dir.path()).unwrap();
        assert_eq!(
            restored.get_live(&grant.id, now).unwrap().last_used_at,
            now + 60
        );
        store.touch(&grant.id, now + 3661);
        assert_eq!(store.writes(), writes + 2);
        let restored = GrantStore::load(dir.path()).unwrap();
        assert_eq!(
            restored.get_live(&grant.id, now).unwrap().last_used_at,
            now + 3661
        );
        store.touch(&grant.id, now + 3700);
        store.touch("missing", now + 9000);
        assert_eq!(store.writes(), writes + 2);
    }

    #[test]
    fn revoke_for_user_removes_only_theirs() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let first = store.create(new_grant("river"), now).unwrap();
        let second = store
            .create(
                NewGrant {
                    client_id: "https://other-client.example.test/client.json".into(),
                    ..new_grant("river")
                },
                now,
            )
            .unwrap();
        let other = store.create(new_grant("sky"), now).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(store.list_for_user("river").len(), 2);
        assert_eq!(store.revoke_for_user("river").unwrap(), 2);
        assert!(store.list_for_user("river").is_empty());
        assert_eq!(store.list_all(), vec![other.clone()]);
        assert!(store.revoke(&other.id).unwrap());
        assert!(!store.revoke(&other.id).unwrap());
        let restored = GrantStore::load(dir.path()).unwrap();
        assert!(restored.list_all().is_empty());
    }

    #[test]
    fn new_grant_has_never_been_used() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let grant = store.create(new_grant("river"), now_secs()).unwrap();
        assert_eq!(grant.last_used_at, 0);
    }

    #[test]
    fn create_replaces_the_same_apps_grant() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let first = store.create(new_grant("river"), now).unwrap();
        let other_resource = store
            .create(
                NewGrant {
                    resource: "https://other.example.test/.mcp".into(),
                    ..new_grant("river")
                },
                now,
            )
            .unwrap();
        let other_client = store
            .create(
                NewGrant {
                    client_id: "https://other-client.example.test/client.json".into(),
                    ..new_grant("river")
                },
                now,
            )
            .unwrap();
        let other_user = store.create(new_grant("sky"), now).unwrap();
        let second = store.create(new_grant("river"), now + 5).unwrap();
        assert_ne!(first.id, second.id);
        assert!(store.get_live(&first.id, now + 5).is_none());
        for kept in [&second, &other_resource, &other_client, &other_user] {
            assert!(store.get_live(&kept.id, now + 5).is_some());
        }
        assert_eq!(store.list_for_user("river").len(), 3);
        let restored = GrantStore::load(dir.path()).unwrap();
        assert!(restored.get_live(&first.id, now + 5).is_none());
    }

    #[test]
    fn create_is_capped_per_user() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let client = |i: usize| format!("https://client-{i}.example.test/client.json");
        let for_client = |i: usize| NewGrant {
            client_id: client(i),
            ..new_grant("river")
        };
        for i in 0..MAX_GRANTS_PER_USER {
            store.create(for_client(i), now).unwrap();
        }
        let resource = "https://notes.example.test/.mcp";
        assert!(!store.has_room_for("river", &client(MAX_GRANTS_PER_USER), resource, now));
        let refused = store
            .create(for_client(MAX_GRANTS_PER_USER), now)
            .unwrap_err();
        assert_eq!(refused.kind(), io::ErrorKind::QuotaExceeded);
        assert_eq!(store.list_for_user("river").len(), MAX_GRANTS_PER_USER);
        // Re-consenting an app already connected replaces it, so it still fits.
        assert!(store.has_room_for("river", &client(0), resource, now));
        store.create(for_client(0), now).unwrap();
        assert_eq!(store.list_for_user("river").len(), MAX_GRANTS_PER_USER);
        assert!(store.has_room_for("sky", &client(0), resource, now));
        store.create(new_grant("sky"), now).unwrap();
    }

    #[test]
    fn create_is_capped() {
        let dir = tempdir().unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        let now = now_secs();
        let template = store.create(new_grant("river"), now).unwrap();
        let records: BTreeMap<_, _> = (0..MAX_GRANTS)
            .map(|i| {
                let id = format!("{i:032x}");
                (
                    id.clone(),
                    Grant {
                        id,
                        username: format!("user-{i}"),
                        ..template.clone()
                    },
                )
            })
            .collect();
        std::fs::write(
            dir.path().join(FILE_NAME),
            serde_json::to_vec(&records).unwrap(),
        )
        .unwrap();
        let store = GrantStore::load(dir.path()).unwrap();
        assert!(store.create(new_grant("river"), now).is_err());
        assert!(store.get_live(&format!("{:032x}", 0), now).is_some());
    }

    #[test]
    fn corrupt_store_fails_closed() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"invalid json").unwrap();
        assert!(GrantStore::load(dir.path()).is_err());
    }
}
