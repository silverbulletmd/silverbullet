/// Authentication configuration, derived from environment variables. The
/// absence of a username means authentication is disabled (open server).
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub user: String,
    pub pass: String,
    /// Optional bearer token for programmatic access (empty = none).
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
        let digest = h.finalize();
        let mut s = String::with_capacity(digest.len() * 2);
        for b in digest {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    /// Whether the supplied credentials match.
    pub fn authorize(&self, user: &str, pass: &str) -> bool {
        // Compare both fields in constant time to avoid leaking which differs.
        constant_time_eq(user.as_bytes(), self.user.as_bytes())
            & constant_time_eq(pass.as_bytes(), self.pass.as_bytes())
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
}
