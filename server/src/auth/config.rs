/// Authentication configuration, derived from environment variables. The
/// absence of a username means authentication is disabled (open server).
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub user: String,
    pub pass: String,
    pub pass_hash: Option<String>,
    pub auth_token: String,
    pub lockout_limit: u32,
    pub lockout_time_secs: u64,
    pub remember_me_hours: u64,
}

/// Error parsing the `SB_USER` value.
#[derive(Debug)]
pub struct AuthConfigError(pub String);

impl std::fmt::Display for AuthConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for AuthConfigError {}

impl AuthConfig {
    /// Build from the process environment: `SB_USER` (`user:pass`),
    /// `SB_AUTH_TOKEN`, `SB_LOCKOUT_LIMIT`, `SB_LOCKOUT_TIME`,
    /// `SB_REMEMBER_ME_HOURS`. Returns `Ok(None)` when `SB_USER` is unset.
    pub fn from_env() -> Result<Option<Self>, AuthConfigError> {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Self::try_parse(
            get("SB_USER").as_deref(),
            get("SB_AUTH_TOKEN").as_deref(),
            get("SB_LOCKOUT_LIMIT").as_deref(),
            get("SB_LOCKOUT_TIME").as_deref(),
            get("SB_REMEMBER_ME_HOURS").as_deref(),
        )
    }

    /// Fallible parse used by `from_env` and tests.
    pub fn try_parse(
        user: Option<&str>,
        token: Option<&str>,
        lockout_limit: Option<&str>,
        lockout_time: Option<&str>,
        remember_me: Option<&str>,
    ) -> Result<Option<Self>, AuthConfigError> {
        let Some(user_pass) = user else {
            return Ok(None);
        };
        let (u, p) = user_pass
            .split_once(':')
            .ok_or_else(|| AuthConfigError("SB_USER must be in the format user:pass".into()))?;
        Ok(Some(Self {
            user: u.to_string(),
            pass: p.to_string(),
            pass_hash: None,
            auth_token: token.unwrap_or("").to_string(),
            lockout_limit: lockout_limit.and_then(|v| v.parse().ok()).unwrap_or(10),
            lockout_time_secs: lockout_time.and_then(|v| v.parse().ok()).unwrap_or(60),
            remember_me_hours: remember_me.and_then(|v| v.parse().ok()).unwrap_or(168),
        }))
    }

    /// Infallible test helper: panics on a malformed `user`.
    #[cfg(test)]
    pub fn parse(
        user: Option<&str>,
        token: Option<&str>,
        lockout_limit: Option<&str>,
        lockout_time: Option<&str>,
        remember_me: Option<&str>,
    ) -> Option<Self> {
        Self::try_parse(user, token, lockout_limit, lockout_time, remember_me).unwrap()
    }

    /// A stable hex SHA-256 over the security-relevant fields. Changing any of
    /// them produces a new hash, which invalidates persisted sessions.
    pub fn security_hash(&self) -> String {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        for field in [
            self.user.as_str(),
            self.pass.as_str(),
            self.auth_token.as_str(),
            &self.lockout_limit.to_string(),
            &self.lockout_time_secs.to_string(),
            &self.remember_me_hours.to_string(),
        ] {
            h.update(field.as_bytes());
            h.update([0u8]); // domain separator between fields
        }
        // Only fold `pass_hash` in when it is set, so existing single-space
        // servers (which always have `pass_hash: None`) keep the legacy digest
        // and don't have their persisted sessions invalidated on upgrade. A
        // domain tag distinguishes `None` from `Some("")`.
        if let Some(pass_hash) = &self.pass_hash {
            h.update(b"pass_hash:");
            h.update(pass_hash.as_bytes());
            h.update([0u8]);
        }
        let digest = h.finalize();
        let mut s = String::with_capacity(digest.len() * 2);
        for b in digest {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    /// Whether the supplied credentials match.
    pub fn authorize(&self, user: &str, pass: &str) -> bool {
        let user_ok = constant_time_eq(user.as_bytes(), self.user.as_bytes());
        let pass_ok = match &self.pass_hash {
            Some(hash) => crate::auth::password::verify_password(pass, hash),
            None => constant_time_eq(pass.as_bytes(), self.pass.as_bytes()),
        };
        user_ok & pass_ok
    }
}

/// Length-independent constant-time byte comparison.
pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_pass() {
        let c = AuthConfig::parse(Some("alice:s3cret"), None, None, None, None).unwrap();
        assert_eq!(c.user, "alice");
        assert_eq!(c.pass, "s3cret");
        assert_eq!(c.auth_token, "");
        assert_eq!(c.lockout_limit, 10);
        assert_eq!(c.lockout_time_secs, 60);
        assert_eq!(c.remember_me_hours, 168);
    }

    #[test]
    fn password_may_contain_colons() {
        let c = AuthConfig::parse(Some("bob:a:b:c"), None, None, None, None).unwrap();
        assert_eq!(c.user, "bob");
        assert_eq!(c.pass, "a:b:c");
    }

    #[test]
    fn no_user_means_no_auth() {
        assert!(AuthConfig::parse(None, None, None, None, None).is_none());
    }

    #[test]
    fn token_and_overrides_parsed() {
        let c =
            AuthConfig::parse(Some("u:p"), Some("tok"), Some("5"), Some("30"), Some("48")).unwrap();
        assert_eq!(c.auth_token, "tok");
        assert_eq!(c.lockout_limit, 5);
        assert_eq!(c.lockout_time_secs, 30);
        assert_eq!(c.remember_me_hours, 48);
    }

    #[test]
    fn invalid_user_format_is_error() {
        assert!(AuthConfig::try_parse(Some("nocolon"), None, None, None, None).is_err());
    }

    #[test]
    fn pass_hash_takes_precedence_over_plaintext() {
        let phc = crate::auth::password::hash_password("hunter2").unwrap();
        let mut c = AuthConfig::parse(Some("alice:ignored"), None, None, None, None).unwrap();
        c.pass_hash = Some(phc);
        assert!(c.authorize("alice", "hunter2"));
        assert!(
            !c.authorize("alice", "ignored"),
            "plaintext field must be ignored when hash set"
        );
        assert!(!c.authorize("bob", "hunter2"));
    }

    #[test]
    fn security_hash_changes_when_pass_hash_changes() {
        let mut a = AuthConfig::parse(Some("u:p"), None, None, None, None).unwrap();
        let b = a.clone();
        a.pass_hash = Some(crate::auth::password::hash_password("x").unwrap());
        assert_ne!(a.security_hash(), b.security_hash());
    }

    /// Compute the pre-multi-space (legacy) digest inline: SHA-256 over
    /// user/pass/auth_token/lockout_limit/lockout_time/remember_me, each
    /// followed by a 0u8 separator. Must equal `security_hash()` when
    /// `pass_hash` is `None`, so existing servers keep their session secret.
    fn legacy_digest(c: &AuthConfig) -> String {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        for field in [
            c.user.as_str(),
            c.pass.as_str(),
            c.auth_token.as_str(),
            &c.lockout_limit.to_string(),
            &c.lockout_time_secs.to_string(),
            &c.remember_me_hours.to_string(),
        ] {
            h.update(field.as_bytes());
            h.update([0u8]);
        }
        let digest = h.finalize();
        let mut s = String::with_capacity(digest.len() * 2);
        for b in digest {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    #[test]
    fn security_hash_is_bit_compatible_when_pass_hash_none() {
        let c = AuthConfig::parse(
            Some("alice:s3cret"),
            Some("tok"),
            Some("5"),
            Some("30"),
            Some("48"),
        )
        .unwrap();
        assert!(c.pass_hash.is_none());
        assert_eq!(c.security_hash(), legacy_digest(&c));
    }

    #[test]
    fn security_hash_some_differs_from_none() {
        let none = AuthConfig::parse(Some("u:p"), None, None, None, None).unwrap();
        let mut some = none.clone();
        // Even an empty `Some` must differ from `None` (domain tag).
        some.pass_hash = Some(String::new());
        assert_ne!(some.security_hash(), none.security_hash());
    }
}
