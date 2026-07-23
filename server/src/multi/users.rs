//! The `users.json` model: account name -> password hash, admin flag, API
//! tokens. Passwords are argon2id PHC strings; tokens are 256-bit random
//! values stored as hex SHA-256 (high-entropy, so a fast hash is safe and
//! lets us verify per-request).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const USERS_FILE: &str = "users.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEntry {
    /// Hex SHA-256 of the plaintext token.
    pub token_hash: String,
    /// RFC 3339-ish creation timestamp (informational).
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEntry {
    /// argon2id PHC string.
    pub password_hash: String,
    #[serde(default)]
    pub admin: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tokens: BTreeMap<String, TokenEntry>,
    /// Fields written by newer versions, preserved verbatim.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct UsersConfig {
    pub users: BTreeMap<String, UserEntry>,
}

impl UsersConfig {
    pub fn from_json(src: &str) -> Result<Self, String> {
        let users: BTreeMap<String, UserEntry> =
            serde_json::from_str(src).map_err(|e| format!("invalid users.json: {e}"))?;
        Ok(Self { users })
    }

    pub fn to_json_string(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.users).map_err(|e| e.to_string())
    }

    /// Read from `path`. `Ok(None)` when the file does not exist (that absence
    /// is a meaningful boot-detection state); malformed content is a hard error.
    pub fn load(path: &Path) -> Result<Option<Self>, String> {
        match std::fs::read_to_string(path) {
            Ok(src) => Self::from_json(&src).map(Some),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("could not read {}: {e}", path.display())),
        }
    }

    /// Atomic persist, 0600 on unix (same pattern as `MultiConfig::save`).
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let json = self.to_json_string()?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)
            .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)) {
                tracing::warn!("could not set 0600 on {}: {e}", tmp.display());
            }
        }
        std::fs::rename(&tmp, path)
            .map_err(|e| format!("could not persist {}: {e}", path.display()))
    }
}

/// Live, mutable, persisted account store. Every mutation validates, persists
/// atomically, then updates the in-memory state (mirrors `MultiManager`).
pub struct UserStore {
    path: PathBuf,
    state: RwLock<UsersConfig>,
}

fn hash_token(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex(&h.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
    format!("sbt_{}", hex(&bytes))
}

/// Seconds-precision RFC 3339 (UTC) timestamp from `SystemTime`, hand-rolled
/// to avoid pulling in a chrono/humantime dependency for an informational
/// field. Follows the standard civil-from-days algorithm (Howard Hinnant's
/// `civil_from_days`).
fn now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = (secs / 86400) as i64;
    let time_of_day = secs % 86400;
    let (hour, minute, second) = (
        time_of_day / 3600,
        (time_of_day / 60) % 60,
        time_of_day % 60,
    );

    // Howard Hinnant's civil_from_days: days since 1970-01-01 -> (y, m, d).
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

impl UserStore {
    /// Open `<root>/users.json`. `Ok(None)` when absent.
    pub fn open(root: &Path) -> Result<Option<Arc<Self>>, String> {
        let path = root.join(USERS_FILE);
        Ok(UsersConfig::load(&path)?.map(|config| {
            Arc::new(Self {
                path,
                state: RwLock::new(config),
            })
        }))
    }

    /// Create an empty store (file written immediately). Test-only helper:
    /// production provisioning goes through `setup::run_setup`, which writes
    /// `users.json` with the first admin already populated.
    pub fn create_empty(root: &Path) -> Result<Arc<Self>, String> {
        let path = root.join(USERS_FILE);
        let config = UsersConfig::default();
        config.save(&path)?;
        Ok(Arc::new(Self {
            path,
            state: RwLock::new(config),
        }))
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, UsersConfig> {
        self.state.read().expect("user store lock poisoned")
    }

    /// Mutate-validate-persist under the write lock; on persist failure the
    /// in-memory state is left untouched.
    fn mutate(&self, f: impl FnOnce(&mut UsersConfig) -> Result<(), String>) -> Result<(), String> {
        let mut guard = self.state.write().expect("user store lock poisoned");
        let mut next = guard.clone();
        f(&mut next)?;
        next.save(&self.path)?;
        *guard = next;
        Ok(())
    }

    pub fn verify_password(&self, username: &str, password: &str) -> bool {
        let guard = self.read();
        match guard.users.get(username) {
            Some(u) => crate::auth::password::verify_password(password, &u.password_hash),
            None => {
                // Burn comparable time so username probing isn't trivially
                // distinguishable from a wrong password. An empty/malformed
                // PHC string fails to parse before Argon2 even runs, so use a
                // precomputed valid dummy hash to make the None arm actually
                // pay the Argon2 cost.
                static DUMMY_HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
                let dummy = DUMMY_HASH
                    .get_or_init(|| crate::auth::password::hash_password("unused").unwrap());
                let _ = crate::auth::password::verify_password(password, dummy);
                false
            }
        }
    }

    pub fn is_admin(&self, username: &str) -> bool {
        self.read().users.get(username).is_some_and(|u| u.admin)
    }

    pub fn usernames(&self) -> BTreeSet<String> {
        self.read().users.keys().cloned().collect()
    }

    /// Opaque version embedded in a user's JWT. It changes with the password
    /// hash, allowing password changes to revoke only this user's sessions.
    pub fn credential_version(&self, username: &str) -> Option<String> {
        let guard = self.read();
        let user = guard.users.get(username)?;
        let mut h = Sha256::new();
        h.update(username.as_bytes());
        h.update([0]);
        h.update(user.password_hash.as_bytes());
        Some(hex(&h.finalize()))
    }

    pub fn session_is_current(&self, username: &str, version: Option<&str>) -> bool {
        let Some(current) = self.credential_version(username) else {
            return false;
        };
        let Some(version) = version else {
            return false;
        };
        crate::auth::config::constant_time_eq(current.as_bytes(), version.as_bytes())
    }

    /// Bearer token -> owning username.
    pub fn resolve_token(&self, token: &str) -> Option<String> {
        let want = hash_token(token);
        let guard = self.read();
        for (name, user) in &guard.users {
            if user.tokens.values().any(|t| {
                crate::auth::config::constant_time_eq(t.token_hash.as_bytes(), want.as_bytes())
            }) {
                return Some(name.clone());
            }
        }
        None
    }

    pub fn create_user(&self, name: &str, password: &str, admin: bool) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.contains(':') || name.contains('/') {
            return Err("invalid username".into());
        }
        if password.is_empty() {
            return Err("password must not be empty".into());
        }
        let password_hash = crate::auth::password::hash_password(password)?;
        self.mutate(|c| {
            if c.users.contains_key(name) {
                return Err(format!("user {name:?} already exists"));
            }
            c.users.insert(
                name.to_string(),
                UserEntry {
                    password_hash,
                    admin,
                    tokens: BTreeMap::new(),
                    extra: Default::default(),
                },
            );
            Ok(())
        })
    }

    pub fn delete_user(&self, name: &str) -> Result<(), String> {
        self.mutate(|c| {
            let Some(entry) = c.users.get(name) else {
                return Err(format!("no such user {name:?}"));
            };
            if entry.admin && c.users.values().filter(|u| u.admin).count() == 1 {
                return Err("cannot remove the last admin".into());
            }
            c.users.remove(name);
            Ok(())
        })
    }

    pub fn set_password(&self, name: &str, password: &str) -> Result<(), String> {
        if password.is_empty() {
            return Err("password must not be empty".into());
        }
        let password_hash = crate::auth::password::hash_password(password)?;
        self.mutate(|c| {
            let entry = c
                .users
                .get_mut(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            entry.password_hash = password_hash;
            Ok(())
        })
    }

    pub fn set_admin(&self, name: &str, admin: bool) -> Result<(), String> {
        self.mutate(|c| {
            if !admin {
                let is_last_admin = c.users.get(name).is_some_and(|u| u.admin)
                    && c.users.values().filter(|u| u.admin).count() == 1;
                if is_last_admin {
                    return Err("cannot demote the last admin".into());
                }
            }
            let entry = c
                .users
                .get_mut(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            entry.admin = admin;
            Ok(())
        })
    }

    /// Mint a named token for `user`; returns the plaintext exactly once.
    pub fn create_token(&self, user: &str, token_name: &str) -> Result<String, String> {
        let plaintext = generate_token();
        let entry = TokenEntry {
            token_hash: hash_token(&plaintext),
            created_at: now_rfc3339(),
        };
        self.mutate(|c| {
            let u = c
                .users
                .get_mut(user)
                .ok_or_else(|| format!("no such user {user:?}"))?;
            if u.tokens.contains_key(token_name) {
                return Err(format!("token {token_name:?} already exists"));
            }
            u.tokens.insert(token_name.to_string(), entry.clone());
            Ok(())
        })?;
        Ok(plaintext)
    }

    pub fn delete_token(&self, user: &str, token_name: &str) -> Result<(), String> {
        self.mutate(|c| {
            let u = c
                .users
                .get_mut(user)
                .ok_or_else(|| format!("no such user {user:?}"))?;
            u.tokens
                .remove(token_name)
                .map(|_| ())
                .ok_or_else(|| format!("no such token {token_name:?}"))
        })
    }

    /// JSON view for GET /api/users: hashes redacted.
    pub fn list(&self) -> serde_json::Value {
        let guard = self.read();
        let mut out = serde_json::Map::new();
        for (name, u) in &guard.users {
            out.insert(name.clone(), user_json(u));
        }
        serde_json::Value::Object(out)
    }

    /// Redacted JSON view for one account.
    pub fn get(&self, name: &str) -> Option<serde_json::Value> {
        self.read().users.get(name).map(user_json)
    }
}

fn user_json(user: &UserEntry) -> serde_json::Value {
    let tokens: serde_json::Map<String, serde_json::Value> = user
        .tokens
        .iter()
        .map(|(name, token)| {
            (
                name.clone(),
                serde_json::json!({ "createdAt": token.created_at }),
            )
        })
        .collect();
    serde_json::json!({ "admin": user.admin, "tokens": tokens })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &std::path::Path) -> std::sync::Arc<UserStore> {
        let s = UserStore::create_empty(dir).unwrap();
        s.create_user("zef", "hunter22", true).unwrap();
        s
    }

    #[test]
    fn load_missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(UserStore::open(dir.path()).unwrap().is_none());
    }

    #[test]
    fn malformed_json_is_hard_error() {
        assert!(UsersConfig::from_json("not json").is_err());

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(USERS_FILE);
        std::fs::write(&path, "{ not json").unwrap();
        assert!(UsersConfig::load(&path).is_err());
    }

    #[test]
    fn create_user_hashes_password_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.verify_password("zef", "hunter22"));
        assert!(!s.verify_password("zef", "wrong"));
        assert!(!s.verify_password("nobody", "hunter22"));
        assert!(s.is_admin("zef"));
        // Reload from disk: same result, and no plaintext on disk.
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(!raw.contains("hunter22"));
        assert!(raw.contains("$argon2id$"));
        let s2 = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(s2.verify_password("zef", "hunter22"));
    }

    #[test]
    fn duplicate_username_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.create_user("zef", "pw123456", false).is_err());
    }

    #[test]
    fn empty_password_rejected_on_create_and_set() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        let err = s.create_user("nopass", "", false).unwrap_err();
        assert!(err.contains("must not be empty"), "{err}");
        assert!(s.set_password("zef", "").is_err());
        // Any non-empty password is fine — no length floor.
        assert!(s.create_user("okuser", "x", false).is_ok());
    }

    #[test]
    fn tokens_roundtrip_and_are_stored_hashed() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        let tok = s.create_token("zef", "provisioning").unwrap();
        assert!(tok.starts_with("sbt_"), "{tok}");
        assert_eq!(s.resolve_token(&tok).as_deref(), Some("zef"));
        assert!(s.resolve_token("sbt_bogus").is_none());
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(!raw.contains(&tok), "plaintext token must not be persisted");
        s.delete_token("zef", "provisioning").unwrap();
        assert!(s.resolve_token(&tok).is_none());
    }

    #[test]
    fn cannot_remove_last_admin() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.delete_user("zef").is_err());
        assert!(s.set_admin("zef", false).is_err());
        s.create_user("other", "pw123456", true).unwrap();
        s.set_admin("zef", false).unwrap(); // now fine
    }

    #[test]
    fn credential_version_changes_on_password() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_user("bob", "pw123456", false).unwrap();
        let a = s.credential_version("bob").unwrap();
        assert!(s.session_is_current("bob", Some(&a)));
        s.set_password("bob", "newpw12345").unwrap();
        assert_ne!(a, s.credential_version("bob").unwrap());
        assert!(!s.session_is_current("bob", Some(&a)));
    }

    #[test]
    fn list_redacts_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_token("zef", "t1").unwrap();
        let v = s.list();
        assert_eq!(v["zef"]["admin"], true);
        assert!(v["zef"].get("passwordHash").is_none());
        assert!(v["zef"]["tokens"]["t1"].get("tokenHash").is_none());
        assert!(v["zef"]["tokens"]["t1"].get("createdAt").is_some());
    }
}
