//! The `users.json` model: account name -> password hash, admin flag, API
//! tokens. Passwords are argon2id PHC strings; tokens are 256-bit random
//! values stored as hex SHA-256 (high-entropy, so a fast hash is safe and
//! lets us verify per-request).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::{clean_email, clean_full_name};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tokens: BTreeMap<String, TokenEntry>,
    #[serde(default)]
    pub session_epoch: u64,
    /// Fields written by newer versions, preserved verbatim.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct UsersConfig {
    pub users: BTreeMap<String, UserEntry>,
}

/// The human identity attached to an account: who commits are attributed to,
/// and what other clients see as a presence label.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Profile {
    pub full_name: Option<String>,
    pub email: Option<String>,
}

impl Profile {
    pub fn parse(full_name: &str, email: &str) -> Result<Profile, String> {
        Ok(Profile {
            full_name: clean_full_name(full_name)?,
            email: clean_email(email)?,
        })
    }
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
    /// hash or the session epoch, so either a password change or an explicit
    /// `bump_session_epoch` call revokes only this user's sessions — the
    /// latter is the only revocation lever for an account with no password
    /// to change (e.g. one that signs in through an external identity
    /// provider).
    pub fn credential_version(&self, username: &str) -> Option<String> {
        let guard = self.read();
        let user = guard.users.get(username)?;
        let mut h = Sha256::new();
        h.update(username.as_bytes());
        h.update([0]);
        h.update(user.password_hash.as_bytes());
        h.update([0]);
        h.update(user.session_epoch.to_string().as_bytes());
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

    pub fn create_user(
        &self,
        name: &str,
        password: &str,
        admin: bool,
        profile: Profile,
    ) -> Result<(), String> {
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
                    full_name: profile.full_name.clone(),
                    email: profile.email.clone(),
                    tokens: BTreeMap::new(),
                    session_epoch: 0,
                    extra: Default::default(),
                },
            );
            Ok(())
        })
    }

    pub fn set_profile(&self, name: &str, profile: Profile) -> Result<(), String> {
        self.mutate(|c| {
            let entry = c
                .users
                .get_mut(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            entry.full_name = profile.full_name.clone();
            entry.email = profile.email.clone();
            Ok(())
        })
    }

    pub fn profile(&self, name: &str) -> Option<Profile> {
        self.read().users.get(name).map(|u| Profile {
            full_name: u.full_name.clone(),
            email: u.email.clone(),
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

    /// Invalidate `name`'s sessions without touching their password —
    /// the admin "sign out everywhere" lever, and the only one available
    /// for an account with no password to change.
    pub fn bump_session_epoch(&self, name: &str) -> Result<(), String> {
        self.mutate(|c| {
            let entry = c
                .users
                .get_mut(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            entry.session_epoch = entry.session_epoch.saturating_add(1);
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
    serde_json::json!({
        "admin": user.admin,
        "fullName": user.full_name,
        "email": user.email,
        "tokens": tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &std::path::Path) -> std::sync::Arc<UserStore> {
        let s = UserStore::create_empty(dir).unwrap();
        s.create_user("ada", "hunter22", true, Profile::default())
            .unwrap();
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
        assert!(s.verify_password("ada", "hunter22"));
        assert!(!s.verify_password("ada", "wrong"));
        assert!(!s.verify_password("nobody", "hunter22"));
        assert!(s.is_admin("ada"));
        // Reload from disk: same result, and no plaintext on disk.
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(!raw.contains("hunter22"));
        assert!(raw.contains("$argon2id$"));
        let s2 = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(s2.verify_password("ada", "hunter22"));
    }

    #[test]
    fn duplicate_username_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s
            .create_user("ada", "pw123456", false, Profile::default())
            .is_err());
    }

    #[test]
    fn empty_password_rejected_on_create_and_set() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        let err = s
            .create_user("nopass", "", false, Profile::default())
            .unwrap_err();
        assert!(err.contains("must not be empty"), "{err}");
        assert!(s.set_password("ada", "").is_err());
        // Any non-empty password is fine — no length floor.
        assert!(s
            .create_user("okuser", "x", false, Profile::default())
            .is_ok());
    }

    #[test]
    fn tokens_roundtrip_and_are_stored_hashed() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        let tok = s.create_token("ada", "provisioning").unwrap();
        assert!(tok.starts_with("sbt_"), "{tok}");
        assert_eq!(s.resolve_token(&tok).as_deref(), Some("ada"));
        assert!(s.resolve_token("sbt_bogus").is_none());
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(!raw.contains(&tok), "plaintext token must not be persisted");
        s.delete_token("ada", "provisioning").unwrap();
        assert!(s.resolve_token(&tok).is_none());
    }

    #[test]
    fn cannot_remove_last_admin() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.delete_user("ada").is_err());
        assert!(s.set_admin("ada", false).is_err());
        s.create_user("other", "pw123456", true, Profile::default())
            .unwrap();
        s.set_admin("ada", false).unwrap(); // now fine
    }

    #[test]
    fn credential_version_changes_on_password() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_user("bob", "pw123456", false, Profile::default())
            .unwrap();
        let a = s.credential_version("bob").unwrap();
        assert!(s.session_is_current("bob", Some(&a)));
        s.set_password("bob", "newpw12345").unwrap();
        assert_ne!(a, s.credential_version("bob").unwrap());
        assert!(!s.session_is_current("bob", Some(&a)));
    }

    #[test]
    fn bumping_the_session_epoch_invalidates_only_that_users_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_user("bob", "pw123456", false, Profile::default())
            .unwrap();
        s.create_user("carol", "pw123456", false, Profile::default())
            .unwrap();
        let bob = s.credential_version("bob").unwrap();
        let carol = s.credential_version("carol").unwrap();

        s.bump_session_epoch("bob").unwrap();
        assert!(!s.session_is_current("bob", Some(&bob)));
        assert!(s.session_is_current("carol", Some(&carol)));
    }

    #[test]
    fn bump_session_epoch_on_missing_user_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.bump_session_epoch("nobody").is_err());
    }

    #[test]
    fn list_redacts_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_token("ada", "t1").unwrap();
        let v = s.list();
        assert_eq!(v["ada"]["admin"], true);
        assert!(v["ada"].get("passwordHash").is_none());
        assert!(v["ada"]["tokens"]["t1"].get("tokenHash").is_none());
        assert!(v["ada"]["tokens"]["t1"].get("createdAt").is_some());
    }

    #[test]
    fn profile_parse_trims_blanks_to_none() {
        assert_eq!(Profile::parse("  ", "").unwrap(), Profile::default());
        assert_eq!(
            Profile::parse(" Ada Lovelace ", " ada@example.org ").unwrap(),
            Profile {
                full_name: Some("Ada Lovelace".into()),
                email: Some("ada@example.org".into()),
            }
        );
    }

    #[test]
    fn profile_parse_rejects_git_ident_breakers() {
        for bad in ["a<b", "a>b", "a\nb", "a\rb"] {
            assert!(Profile::parse(bad, "").is_err(), "name {bad:?}");
            assert!(Profile::parse("", bad).is_err(), "email {bad:?}");
        }
        assert!(Profile::parse("", "ada @example.org").is_err());
        assert!(Profile::parse("Ada Lovelace", "ada@example.org").is_ok());
    }

    #[test]
    fn profile_round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let s = UserStore::create_empty(dir.path()).unwrap();
        let profile = Profile {
            full_name: Some("Ada Lovelace".into()),
            email: Some("ada@example.org".into()),
        };
        s.create_user("ada", "hunter22", true, profile.clone())
            .unwrap();
        assert_eq!(s.profile("ada"), Some(profile.clone()));

        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(raw.contains("\"fullName\""), "{raw}");

        let s2 = UserStore::open(dir.path()).unwrap().unwrap();
        assert_eq!(s2.profile("ada"), Some(profile));

        s2.set_profile("ada", Profile::default()).unwrap();
        assert_eq!(s2.profile("ada"), Some(Profile::default()));
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(
            !raw.contains("fullName"),
            "unset fields must not persist: {raw}"
        );
    }

    #[test]
    fn users_json_without_profile_fields_still_loads() {
        let legacy = r#"{"ada":{"passwordHash":"$argon2id$x","admin":true}}"#;
        let config = UsersConfig::from_json(legacy).unwrap();
        let entry = config.users.get("ada").unwrap();
        assert_eq!(entry.full_name, None);
        assert_eq!(entry.email, None);
    }

    #[test]
    fn a_users_json_written_before_session_epoch_existed_still_loads() {
        let legacy = r#"{"bob":{"passwordHash":"$argon2id$x"}}"#;
        let config = UsersConfig::from_json(legacy).unwrap();
        assert_eq!(config.users["bob"].session_epoch, 0);
    }

    #[test]
    fn set_profile_on_missing_user_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.set_profile("nobody", Profile::default()).is_err());
    }

    #[test]
    fn list_includes_profile_fields() {
        let dir = tempfile::tempdir().unwrap();
        let s = UserStore::create_empty(dir.path()).unwrap();
        s.create_user(
            "ada",
            "hunter22",
            true,
            Profile {
                full_name: Some("Ada Lovelace".into()),
                email: None,
            },
        )
        .unwrap();
        let v = s.list();
        assert_eq!(v["ada"]["fullName"], "Ada Lovelace");
        assert!(v["ada"]["email"].is_null());
    }
}
