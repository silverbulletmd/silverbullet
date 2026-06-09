//! The issuing side of the standalone login flow: credential verification,
//! brute-force lockout, session-JWT minting, and the per-space encryption salt.
//! Paired with `JwtAuthorizer` (the verifying side) over a shared
//! `Arc<Authenticator>`.

use std::sync::Arc;

use crate::auth::authenticator::Authenticator;
use crate::auth::config::AuthConfig;
use crate::auth::lockout::LockoutTimer;

/// Normal (non-"remember me") session lifetime: one week, matching the legacy
/// server's `authenticationExpirySeconds`.
pub const SESSION_EXPIRY_SECS: u64 = 60 * 60 * 24 * 7;

/// Owns the credential config, lockout state, and JWT issuer for `/.auth`.
pub struct LoginManager {
    authenticator: Arc<Authenticator>,
    config: AuthConfig,
    lockout: LockoutTimer,
    host_url_prefix: String,
}

impl LoginManager {
    pub fn new(
        authenticator: Arc<Authenticator>,
        config: AuthConfig,
        lockout: LockoutTimer,
        host_url_prefix: String,
    ) -> Self {
        Self {
            authenticator,
            config,
            lockout,
            host_url_prefix,
        }
    }

    /// Base64 encryption salt for the login page.
    pub fn salt(&self) -> &str {
        self.authenticator.salt()
    }

    /// "Remember me" duration expressed in whole days, for the page label.
    pub fn remember_me_days(&self) -> u64 {
        self.config.remember_me_hours / 24
    }

    pub fn host_url_prefix(&self) -> &str {
        &self.host_url_prefix
    }

    pub fn is_locked(&self) -> bool {
        self.lockout.is_locked()
    }

    pub fn record_failure(&self) {
        self.lockout.add_count();
    }

    pub fn authorize(&self, user: &str, pass: &str) -> bool {
        self.config.authorize(user, pass)
    }

    /// Mint a session JWT for `username`. Returns the token and its lifetime in
    /// seconds (so the caller can match the cookie's `Max-Age`).
    pub fn issue_session(
        &self,
        username: &str,
        remember: bool,
    ) -> Result<(String, u64), jsonwebtoken::errors::Error> {
        let secs = if remember {
            self.config.remember_me_hours.saturating_mul(3600)
        } else {
            SESSION_EXPIRY_SECS
        };
        let jwt = self.authenticator.issue_jwt(username, secs)?;
        Ok((jwt, secs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> LoginManager {
        let auth = Arc::new(Authenticator::from_parts(
            vec![1u8; 32],
            "c2FsdHNhbHRzYWx0c2Ex".into(),
            "h".into(),
        ));
        let config =
            AuthConfig::try_parse(Some("alice:s3cret"), Some("tok"), None, None, Some("48"))
                .unwrap()
                .unwrap();
        let lockout = LockoutTimer::from_config(config.lockout_time_secs, config.lockout_limit);
        LoginManager::new(auth, config, lockout, String::new())
    }

    #[test]
    fn authorize_matches_only_correct_credentials() {
        let m = manager();
        assert!(m.authorize("alice", "s3cret"));
        assert!(!m.authorize("alice", "wrong"));
        assert!(!m.authorize("bob", "s3cret"));
    }

    #[test]
    fn remember_me_days_derived_from_hours() {
        assert_eq!(manager().remember_me_days(), 2);
    }

    #[test]
    fn issued_session_verifies_and_respects_remember_me() {
        let m = manager();
        let (jwt, secs) = m.issue_session("alice", false).unwrap();
        assert_eq!(secs, SESSION_EXPIRY_SECS);
        assert_eq!(m.authenticator.verify_jwt(&jwt).unwrap().username, "alice");

        let (_jwt2, secs2) = m.issue_session("alice", true).unwrap();
        assert_eq!(secs2, 48 * 3600);
    }

    #[test]
    fn salt_is_exposed() {
        assert_eq!(manager().salt(), "c2FsdHNhbHRzYWx0c2Ex");
    }
}
