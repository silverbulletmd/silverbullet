//! The `users.json` model: account name -> login method, admin flag, API
//! tokens. Local passwords are argon2id PHC strings; tokens are 256-bit random
//! values stored as hex SHA-256 (high-entropy, so a fast hash is safe and
//! lets us verify per-request).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::oidc::identity::VerifiedIdentity;
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
pub struct SsoIdentity {
    pub issuer: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoAccount {
    pub provider_id: String,
    pub expected_email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<SsoIdentity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LoginMethod {
    Local,
    Sso,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SsoAdmissionError {
    #[error("identity is missing a usable email address")]
    MissingEmail,
    #[error("identity email is not verified")]
    EmailNotVerified,
    #[error("identity email is invalid")]
    InvalidEmail,
    #[error("identity issuer or subject is invalid")]
    InvalidIdentity,
    #[error("account has not been provisioned")]
    NotProvisioned,
    #[error("identity is associated with a different provider")]
    WrongProvider,
    #[error("account is disabled")]
    Disabled,
    #[error("could not persist identity binding: {0}")]
    Store(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sso: Option<SsoAccount>,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tokens: BTreeMap<String, TokenEntry>,
    #[serde(default)]
    pub session_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_generation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_login: Option<String>,
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
        let config = Self { users };
        config.validate()?;
        Ok(config)
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
        self.validate()?;
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
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("could not persist {}: {e}", path.display()));
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        let mut enrollments = BTreeSet::new();
        let mut identities = BTreeSet::new();
        for (name, user) in &self.users {
            match (&user.password_hash, &user.sso) {
                (Some(_), None) | (None, Some(_)) => {}
                (None, None) => return Err(format!("user {name:?} has no login method")),
                (Some(_), Some(_)) => {
                    return Err(format!("user {name:?} has conflicting login methods"));
                }
            }
            let Some(sso) = &user.sso else {
                continue;
            };
            if sso.provider_id.trim().is_empty() {
                return Err(format!("user {name:?} has an invalid SSO provider"));
            }
            let email = normalize_sso_email(&sso.expected_email)
                .map_err(|e| format!("user {name:?} has {e}"))?;
            if !enrollments.insert((sso.provider_id.clone(), email)) {
                return Err("duplicate SSO enrollment".into());
            }
            if let Some(identity) = &sso.identity {
                if identity.issuer.trim().is_empty() || identity.subject.trim().is_empty() {
                    return Err(format!("user {name:?} has an invalid SSO identity"));
                }
                if !identities.insert((identity.issuer.clone(), identity.subject.clone())) {
                    return Err("duplicate SSO identity".into());
                }
            }
        }
        Ok(())
    }
}

fn normalize_sso_email(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.contains(char::is_whitespace) {
        return Err("invalid SSO enrollment email".into());
    }
    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if local.is_empty() || domain.is_empty() || parts.next().is_some() {
        return Err("invalid SSO enrollment email".into());
    }
    Ok(format!("{local}@{}", domain.to_lowercase()))
}

impl UserEntry {
    pub fn login_method(&self) -> LoginMethod {
        if self.sso.is_some() {
            LoginMethod::Sso
        } else {
            LoginMethod::Local
        }
    }

    fn credential_version(&self, username: &str) -> String {
        let mut h = Sha256::new();
        h.update(username.as_bytes());
        h.update([0]);
        h.update(self.password_hash.as_deref().unwrap_or_default().as_bytes());
        h.update([0]);
        h.update(self.session_epoch.to_string().as_bytes());
        if let Some(generation) = &self.account_generation {
            h.update([0]);
            h.update(generation.as_bytes());
        }
        hex(&h.finalize())
    }

    fn is_usable_local_admin(&self) -> bool {
        self.admin && !self.disabled && self.password_hash.is_some()
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
    getrandom::fill(&mut bytes).expect("OS RNG must be available");
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
            Some(u) if !u.disabled => u
                .password_hash
                .as_deref()
                .is_some_and(|hash| crate::auth::password::verify_password(password, hash)),
            _ => {
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

    pub fn record_login(&self, username: &str) -> Result<(), String> {
        self.mutate(|config| {
            let user = config
                .users
                .get_mut(username)
                .filter(|user| !user.disabled)
                .ok_or_else(|| "Account is unavailable".to_string())?;
            user.last_login = Some(now_rfc3339());
            Ok(())
        })
    }

    pub fn is_admin(&self, username: &str) -> bool {
        self.read()
            .users
            .get(username)
            .is_some_and(|u| u.admin && !u.disabled)
    }

    pub fn user_exists(&self, username: &str) -> bool {
        self.read().users.get(username).is_some_and(|u| !u.disabled)
    }

    pub fn is_enabled(&self, username: &str) -> bool {
        self.user_exists(username)
    }

    pub fn login_method(&self, username: &str) -> Option<LoginMethod> {
        self.read().users.get(username).map(UserEntry::login_method)
    }

    pub fn sso_account(&self, username: &str) -> Option<SsoAccount> {
        self.read().users.get(username)?.sso.clone()
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
        if user.disabled {
            return None;
        }
        Some(user.credential_version(username))
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
        self.resolve_token_identity(token)
            .map(|(username, _)| username)
    }

    pub fn resolve_token_identity(&self, token: &str) -> Option<(String, String)> {
        let want = hash_token(token);
        let guard = self.read();
        for (name, user) in &guard.users {
            if user.disabled {
                continue;
            }
            if user.tokens.values().any(|t| {
                crate::auth::config::constant_time_eq(t.token_hash.as_bytes(), want.as_bytes())
            }) {
                return Some((name.clone(), user.credential_version(name)));
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
                    password_hash: Some(password_hash),
                    sso: None,
                    admin,
                    disabled: false,
                    full_name: profile.full_name.clone(),
                    email: profile.email.clone(),
                    tokens: BTreeMap::new(),
                    session_epoch: 0,
                    account_generation: Some(uuid::Uuid::new_v4().to_string()),
                    last_login: None,
                    extra: Default::default(),
                },
            );
            Ok(())
        })
    }

    pub fn create_sso_user(
        &self,
        name: &str,
        provider_id: &str,
        expected_email: &str,
        admin: bool,
        profile: Profile,
    ) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.contains(':') || name.contains('/') {
            return Err("invalid username".into());
        }
        let provider_id = provider_id.trim();
        if provider_id.is_empty() {
            return Err("invalid SSO provider".into());
        }
        let expected_email = normalize_sso_email(expected_email)?;
        self.mutate(|c| {
            if c.users.contains_key(name) {
                return Err(format!("user {name:?} already exists"));
            }
            if c.users.values().any(|user| {
                user.sso.as_ref().is_some_and(|sso| {
                    sso.provider_id == provider_id
                        && normalize_sso_email(&sso.expected_email)
                            .is_ok_and(|email| email == expected_email)
                })
            }) {
                return Err("SSO enrollment already exists".into());
            }
            c.users.insert(
                name.to_string(),
                UserEntry {
                    password_hash: None,
                    sso: Some(SsoAccount {
                        provider_id: provider_id.to_string(),
                        expected_email: expected_email.clone(),
                        identity: None,
                    }),
                    admin,
                    disabled: false,
                    full_name: profile.full_name.clone(),
                    email: profile.email.clone(),
                    tokens: BTreeMap::new(),
                    session_epoch: 0,
                    account_generation: Some(uuid::Uuid::new_v4().to_string()),
                    last_login: None,
                    extra: Default::default(),
                },
            );
            Ok(())
        })
    }

    pub fn resolve_or_bind_sso(
        &self,
        provider_id: &str,
        identity: &VerifiedIdentity,
    ) -> Result<String, SsoAdmissionError> {
        if provider_id.trim().is_empty()
            || identity.issuer.trim().is_empty()
            || identity.subject.trim().is_empty()
        {
            return Err(SsoAdmissionError::InvalidIdentity);
        }
        {
            let guard = self.read();
            if let Some(result) = resolve_bound_identity(&guard, provider_id, identity) {
                return result;
            }
        }
        let email = identity
            .email
            .as_deref()
            .ok_or(SsoAdmissionError::MissingEmail)?;
        if !identity.email_verified {
            return Err(SsoAdmissionError::EmailNotVerified);
        }
        let email = normalize_sso_email(email).map_err(|_| SsoAdmissionError::InvalidEmail)?;

        let mut guard = self.state.write().expect("user store lock poisoned");
        if let Some(result) = resolve_bound_identity(&guard, provider_id, identity) {
            return result;
        }
        let mut next = guard.clone();
        let matched = next.users.iter().find_map(|(name, user)| {
            let sso = user.sso.as_ref()?;
            (sso.provider_id == provider_id
                && sso.identity.is_none()
                && normalize_sso_email(&sso.expected_email).is_ok_and(|want| want == email))
            .then(|| (name.clone(), user.disabled))
        });
        let Some((username, disabled)) = matched else {
            return Err(SsoAdmissionError::NotProvisioned);
        };
        if disabled {
            return Err(SsoAdmissionError::Disabled);
        }
        next.users
            .get_mut(&username)
            .and_then(|user| user.sso.as_mut())
            .expect("matched SSO account must still exist")
            .identity = Some(SsoIdentity {
            issuer: identity.issuer.clone(),
            subject: identity.subject.clone(),
        });
        next.save(&self.path).map_err(SsoAdmissionError::Store)?;
        *guard = next;
        Ok(username)
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
            if entry.is_usable_local_admin()
                && c.users
                    .values()
                    .filter(|u| u.is_usable_local_admin())
                    .count()
                    == 1
            {
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
        {
            let guard = self.read();
            let entry = guard
                .users
                .get(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            if entry.sso.is_some() {
                return Err("SSO accounts do not have local passwords".into());
            }
        }
        let password_hash = crate::auth::password::hash_password(password)?;
        self.mutate(|c| {
            let entry = c
                .users
                .get_mut(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            if entry.sso.is_some() {
                return Err("SSO accounts do not have local passwords".into());
            }
            entry.password_hash = Some(password_hash);
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
                let is_last_admin = c.users.get(name).is_some_and(|u| u.is_usable_local_admin())
                    && c.users
                        .values()
                        .filter(|u| u.is_usable_local_admin())
                        .count()
                        == 1;
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

    pub fn set_disabled(&self, name: &str, disabled: bool) -> Result<(), String> {
        self.mutate(|c| {
            let entry = c
                .users
                .get(name)
                .ok_or_else(|| format!("no such user {name:?}"))?;
            if disabled
                && entry.is_usable_local_admin()
                && c.users
                    .values()
                    .filter(|u| u.is_usable_local_admin())
                    .count()
                    == 1
            {
                return Err("cannot disable the last admin".into());
            }
            let entry = c
                .users
                .get_mut(name)
                .expect("checked account must still exist");
            if disabled && !entry.disabled {
                entry.account_generation = Some(uuid::Uuid::new_v4().to_string());
            }
            entry.disabled = disabled;
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
            if u.disabled {
                return Err("account is disabled".into());
            }
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
        "disabled": user.disabled,
        "loginMethod": user.login_method(),
        "lastLogin": user.last_login,
        "fullName": user.full_name,
        "email": user.email,
        "sso": user.sso,
        "tokens": tokens,
    })
}

fn resolve_bound_identity(
    config: &UsersConfig,
    provider_id: &str,
    identity: &VerifiedIdentity,
) -> Option<Result<String, SsoAdmissionError>> {
    config.users.iter().find_map(|(name, user)| {
        let sso = user.sso.as_ref()?;
        let bound = sso.identity.as_ref()?;
        if bound.issuer != identity.issuer || bound.subject != identity.subject {
            return None;
        }
        Some(if sso.provider_id != provider_id {
            Err(SsoAdmissionError::WrongProvider)
        } else if user.disabled {
            Err(SsoAdmissionError::Disabled)
        } else {
            Ok(name.clone())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::oidc::identity::VerifiedIdentity;

    fn store(dir: &std::path::Path) -> std::sync::Arc<UserStore> {
        let s = UserStore::create_empty(dir).unwrap();
        s.create_user("ada", "hunter22", true, Profile::default())
            .unwrap();
        s
    }

    #[test]
    fn last_login_tracks_local_and_sso_sessions_and_survives_restart() {
        use crate::auth::{Authenticator, LockoutTimer, LoginManager};
        use crate::multi::access::AnyUserAuth;
        use std::sync::Arc;

        let dir = tempfile::tempdir().unwrap();
        let users = store(dir.path());
        users
            .create_sso_user(
                "reader",
                "work",
                "reader@example.test",
                false,
                Profile::default(),
            )
            .unwrap();
        let version = users.credential_version("ada");
        let login = LoginManager::new(
            Arc::new(Authenticator::from_secret_bytes(vec![1; 32], "test".into())),
            Arc::new(AnyUserAuth {
                store: users.clone(),
            }),
            24,
            LockoutTimer::from_config(60, 5),
            String::new(),
        );
        assert!(users.list()["ada"]["lastLogin"].is_null());
        assert!(!login.authorize("ada", "incorrect"));
        assert!(users.list()["ada"]["lastLogin"].is_null());
        let (jwt, _) = login.issue_session("ada", false).unwrap();
        let timestamp = users.list()["ada"]["lastLogin"].clone();
        assert!(timestamp.as_str().is_some_and(|value| value.ends_with('Z')));
        assert!(login.verify_browser_session(&jwt).is_some());
        assert_eq!(users.list()["ada"]["lastLogin"], timestamp);
        assert_eq!(users.credential_version("ada"), version);
        login
            .issue_provider_session("reader", false, "work")
            .unwrap();
        assert!(users.list()["reader"]["lastLogin"].is_string());
        let reopened = UserStore::open(dir.path()).unwrap().unwrap();
        assert_eq!(reopened.list()["ada"]["lastLogin"], timestamp);
        assert_eq!(
            reopened.list()["reader"]["lastLogin"],
            users.list()["reader"]["lastLogin"]
        );
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
        let raw = std::fs::read_to_string(dir.path().join("users.json")).unwrap();
        assert!(!raw.contains("hunter22"));
        assert!(raw.contains("$argon2id$"));
        let s2 = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(s2.verify_password("ada", "hunter22"));
    }

    #[test]
    fn user_exists_is_true_for_any_known_account() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        assert!(s.user_exists("ada"));
        assert!(!s.user_exists("ghost"));
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
        s.set_admin("ada", false).unwrap();
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

    fn verified_identity(subject: &str, email: Option<&str>) -> VerifiedIdentity {
        VerifiedIdentity {
            issuer: "https://identity.example.test".into(),
            subject: subject.into(),
            email: email.map(str::to_string),
            email_verified: true,
            full_name: Some("Morgan Example".into()),
            hosted_domain: None,
        }
    }

    #[test]
    fn legacy_local_account_json_loads_with_local_defaults() {
        let legacy = r#"{"morgan":{"passwordHash":"$argon2id$x","admin":true}}"#;
        let config = UsersConfig::from_json(legacy).unwrap();
        let user = &config.users["morgan"];
        assert_eq!(user.password_hash.as_deref(), Some("$argon2id$x"));
        assert_eq!(user.sso, None);
        assert!(!user.disabled);
        assert_eq!(serde_json::json!(user.login_method()), "local");
        assert_eq!(serde_json::json!(LoginMethod::Sso), "sso");
    }

    #[test]
    fn account_json_rejects_missing_or_conflicting_login_methods() {
        assert!(UsersConfig::from_json(r#"{"morgan":{}}"#).is_err());
        assert!(UsersConfig::from_json(
            r#"{"morgan":{"passwordHash":"hash","sso":{"providerId":"work","expectedEmail":"morgan@example.test"}}}"#,
        )
        .is_err());
    }

    #[test]
    fn creates_pending_sso_account_without_local_password() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan-notes",
            "work",
            " Morgan@Example.TEST ",
            false,
            Profile::default(),
        )
        .unwrap();

        assert!(!s.verify_password("morgan-notes", "anything"));
        assert!(s.set_password("morgan-notes", "secret").is_err());
        let raw = std::fs::read_to_string(dir.path().join(USERS_FILE)).unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(persisted["morgan-notes"].get("passwordHash").is_none());
        assert_eq!(s.get("morgan-notes").unwrap()["loginMethod"], "sso");
        assert_eq!(
            s.get("morgan-notes").unwrap()["sso"]["expectedEmail"],
            "Morgan@example.test"
        );
    }

    #[test]
    fn duplicate_pending_sso_email_uses_exact_localpart_and_insensitive_domain() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "Morgan@Example.TEST",
            false,
            Profile::default(),
        )
        .unwrap();
        assert!(s
            .create_sso_user(
                "morgan-two",
                "work",
                "Morgan@example.test",
                false,
                Profile::default(),
            )
            .is_err());
        s.create_sso_user(
            "upper-local",
            "work",
            "MORGAN@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        s.create_sso_user(
            "plus-local",
            "work",
            "Morgan+notes@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
    }

    #[test]
    fn malformed_sso_enrollment_emails_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        for (name, email) in [
            ("empty", ""),
            ("missing-at", "morgan.example.test"),
            ("missing-local", "@example.test"),
            ("missing-domain", "morgan@"),
            ("two-at", "morgan@example@test"),
            ("space", "mor gan@example.test"),
        ] {
            assert!(
                s.create_sso_user(name, "work", email, false, Profile::default())
                    .is_err(),
                "accepted {email:?}"
            );
        }
    }

    #[test]
    fn first_sso_login_binds_and_repeated_login_resolves_by_subject() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan-notes",
            "work",
            "Morgan@Example.TEST",
            false,
            Profile::default(),
        )
        .unwrap();
        let identity = verified_identity("subject-1", Some("Morgan@example.test"));

        assert_eq!(
            s.resolve_or_bind_sso("work", &identity).unwrap(),
            "morgan-notes"
        );
        let mut changed_email = identity.clone();
        changed_email.email = Some("new-address@elsewhere.test".into());
        changed_email.email_verified = false;
        assert_eq!(
            s.resolve_or_bind_sso("work", &changed_email).unwrap(),
            "morgan-notes"
        );

        let reopened = UserStore::open(dir.path()).unwrap().unwrap();
        assert_eq!(
            reopened
                .resolve_or_bind_sso("work", &changed_email)
                .unwrap(),
            "morgan-notes"
        );
    }

    #[test]
    fn first_sso_login_requires_a_verified_provisioned_email() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        let before = std::fs::read(dir.path().join(USERS_FILE)).unwrap();

        let missing = verified_identity("missing", None);
        assert_eq!(
            s.resolve_or_bind_sso("work", &missing),
            Err(SsoAdmissionError::MissingEmail)
        );
        let mut unverified = verified_identity("unverified", Some("morgan@example.test"));
        unverified.email_verified = false;
        assert_eq!(
            s.resolve_or_bind_sso("work", &unverified),
            Err(SsoAdmissionError::EmailNotVerified)
        );
        assert_eq!(
            s.resolve_or_bind_sso(
                "other-provider",
                &verified_identity("wrong-provider", Some("morgan@example.test"))
            ),
            Err(SsoAdmissionError::NotProvisioned)
        );
        assert_eq!(before, std::fs::read(dir.path().join(USERS_FILE)).unwrap());
    }

    #[test]
    fn matching_local_profile_email_never_links_the_local_account() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.set_profile(
            "ada",
            Profile {
                full_name: None,
                email: Some("morgan@example.test".into()),
            },
        )
        .unwrap();
        assert_eq!(
            s.resolve_or_bind_sso(
                "work",
                &verified_identity("subject-1", Some("morgan@example.test"))
            ),
            Err(SsoAdmissionError::NotProvisioned)
        );
        assert!(s.verify_password("ada", "hunter22"));
    }

    #[test]
    fn competing_first_bindings_allow_only_one_subject() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut joins = Vec::new();
        for subject in ["subject-1", "subject-2"] {
            let s = s.clone();
            let barrier = barrier.clone();
            joins.push(std::thread::spawn(move || {
                let identity = verified_identity(subject, Some("morgan@example.test"));
                barrier.wait();
                s.resolve_or_bind_sso("work", &identity)
            }));
        }
        barrier.wait();
        let results: Vec<_> = joins.into_iter().map(|j| j.join().unwrap()).collect();
        assert_eq!(
            results.iter().filter(|r| r.is_ok()).count(),
            1,
            "{results:?}"
        );
        assert_eq!(
            results
                .iter()
                .filter(|r| **r == Err(SsoAdmissionError::NotProvisioned))
                .count(),
            1,
            "{results:?}"
        );
    }

    #[test]
    fn a_bound_identity_cannot_transfer_to_another_provider_or_account() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        s.create_sso_user(
            "morgan-new",
            "replacement",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        let identity = verified_identity("subject-1", Some("morgan@example.test"));
        s.resolve_or_bind_sso("work", &identity).unwrap();

        assert_eq!(
            s.resolve_or_bind_sso("replacement", &identity),
            Err(SsoAdmissionError::WrongProvider)
        );
        assert_eq!(s.sso_account("morgan-new").unwrap().identity, None);
    }

    #[test]
    fn disabled_sso_account_cannot_bind_or_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        let identity = verified_identity("subject-1", Some("morgan@example.test"));
        s.set_disabled("morgan", true).unwrap();
        assert_eq!(
            s.resolve_or_bind_sso("work", &identity),
            Err(SsoAdmissionError::Disabled)
        );
        assert_eq!(s.sso_account("morgan").unwrap().identity, None);

        s.set_disabled("morgan", false).unwrap();
        s.resolve_or_bind_sso("work", &identity).unwrap();
        s.set_disabled("morgan", true).unwrap();
        assert_eq!(
            s.resolve_or_bind_sso("work", &identity),
            Err(SsoAdmissionError::Disabled)
        );
    }

    #[test]
    fn failed_binding_persistence_leaves_memory_and_disk_without_the_identity() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "morgan",
            "work",
            "morgan@example.test",
            false,
            Profile::default(),
        )
        .unwrap();
        let users_path = dir.path().join(USERS_FILE);
        std::fs::remove_file(&users_path).unwrap();
        std::fs::create_dir(&users_path).unwrap();

        let result = s.resolve_or_bind_sso(
            "work",
            &verified_identity("subject-1", Some("morgan@example.test")),
        );
        assert!(matches!(result, Err(SsoAdmissionError::Store(_))));
        assert_eq!(s.sso_account("morgan").unwrap().identity, None);
        assert!(!dir.path().join("users.json.tmp").exists());
        assert!(users_path.is_dir());
    }

    #[test]
    fn disabled_accounts_reject_every_stored_credential() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_user("morgan", "secret", false, Profile::default())
            .unwrap();
        let token = s.create_token("morgan", "device").unwrap();
        let version = s.credential_version("morgan").unwrap();
        s.set_disabled("morgan", true).unwrap();

        assert!(!s.user_exists("morgan"));
        assert!(!s.verify_password("morgan", "secret"));
        assert_eq!(s.resolve_token(&token), None);
        assert_eq!(s.credential_version("morgan"), None);
        assert!(!s.session_is_current("morgan", Some(&version)));
    }

    #[test]
    fn cannot_remove_demote_or_disable_the_last_usable_local_admin() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path());
        s.create_sso_user(
            "sso-admin",
            "work",
            "admin@example.test",
            true,
            Profile::default(),
        )
        .unwrap();

        assert!(s.delete_user("ada").is_err());
        assert!(s.set_admin("ada", false).is_err());
        assert!(s.set_disabled("ada", true).is_err());

        s.create_user("backup", "secret", true, Profile::default())
            .unwrap();
        s.set_disabled("ada", true).unwrap();
        assert!(s.is_admin("backup"));
        assert!(!s.is_admin("ada"));
    }
    #[test]
    fn recreated_sso_account_does_not_accept_the_previous_accounts_session() {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("admin", "local-recovery", true, Profile::default())
            .unwrap();
        store
            .create_sso_user(
                "river",
                "provider",
                "river@example.test",
                false,
                Profile::default(),
            )
            .unwrap();
        let previous = store.credential_version("river").unwrap();
        store.delete_user("river").unwrap();
        store
            .create_sso_user(
                "river",
                "provider",
                "different@example.test",
                false,
                Profile::default(),
            )
            .unwrap();
        assert!(!store.session_is_current("river", Some(&previous)));
        let reopened = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(!reopened.session_is_current("river", Some(&previous)));
    }

    #[test]
    fn reenable_does_not_restore_a_disabled_accounts_old_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("admin", "local-recovery", true, Profile::default())
            .unwrap();
        store
            .create_sso_user(
                "river",
                "provider",
                "river@example.test",
                false,
                Profile::default(),
            )
            .unwrap();
        let previous = store.credential_version("river").unwrap();
        store.set_disabled("river", true).unwrap();
        store.set_disabled("river", false).unwrap();
        assert!(!store.session_is_current("river", Some(&previous)));
    }
}
