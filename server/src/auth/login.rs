//! The issuing side of the standalone login flow: credential verification,
//! brute-force lockout, session-JWT minting, and the client-encryption salt.
//! Paired with `JwtAuthorizer` (the verifying side) over a shared
//! `Arc<Authenticator>`.

use std::sync::Arc;

use crate::auth::authenticator::Authenticator;
use crate::auth::lockout::LockoutTimer;
use crate::auth::Credentials;

/// Normal (non-"remember me") session lifetime: one week, matching the legacy
/// server's `authenticationExpirySeconds`.
pub const SESSION_EXPIRY_SECS: u64 = 60 * 60 * 24 * 7;

type CredentialVersionProvider = Arc<dyn Fn(&str) -> String + Send + Sync>;

/// Owns the credential verifier, lockout state, and JWT issuer for `/.auth`.
pub struct LoginManager {
    authenticator: Arc<Authenticator>,
    verifier: Arc<dyn Credentials>,
    credential_version: Option<CredentialVersionProvider>,
    remember_me_hours: u64,
    lockout: LockoutTimer,
    host_url_prefix: String,
    session_url_prefix: String,
}

impl LoginManager {
    pub fn new(
        authenticator: Arc<Authenticator>,
        verifier: Arc<dyn Credentials>,
        remember_me_hours: u64,
        lockout: LockoutTimer,
        host_url_prefix: String,
    ) -> Self {
        Self {
            authenticator,
            verifier,
            credential_version: None,
            remember_me_hours,
            lockout,
            session_url_prefix: host_url_prefix.clone(),
            host_url_prefix,
        }
    }

    /// Add the live account-version provider used by account-managed servers.
    /// The resulting JWT can be revoked per user without rotating the shared
    /// server signing secret.
    pub fn with_credential_version(mut self, provider: CredentialVersionProvider) -> Self {
        self.credential_version = Some(provider);
        self
    }

    /// Use one cookie for the entire origin while keeping the login page and
    /// redirects mounted beneath `host_url_prefix`.
    pub fn with_server_wide_session(mut self) -> Self {
        self.session_url_prefix.clear();
        self
    }

    /// Base64 encryption salt for the login page.
    pub fn salt(&self) -> &str {
        self.authenticator.salt()
    }

    /// "Remember me" duration expressed in whole days, for the page label.
    pub fn remember_me_days(&self) -> u64 {
        self.remember_me_hours / 24
    }

    pub fn host_url_prefix(&self) -> &str {
        &self.host_url_prefix
    }

    pub fn session_url_prefix(&self) -> &str {
        &self.session_url_prefix
    }

    pub fn is_locked(&self) -> bool {
        self.lockout.is_locked()
    }

    pub fn record_failure(&self) {
        self.lockout.add_count();
    }

    pub fn authorize(&self, user: &str, pass: &str) -> bool {
        self.verifier.verify(user, pass)
    }

    /// Mint a session JWT for `username`. Returns the token and its lifetime in
    /// seconds (so the caller can match the cookie's `Max-Age`).
    pub fn issue_session(
        &self,
        username: &str,
        remember: bool,
    ) -> Result<(String, u64), jsonwebtoken::errors::Error> {
        let secs = if remember {
            self.remember_me_hours.saturating_mul(3600)
        } else {
            SESSION_EXPIRY_SECS
        };
        let jwt = match &self.credential_version {
            Some(provider) => {
                self.authenticator
                    .issue_jwt_with_version(username, provider(username), secs)?
            }
            None => self.authenticator.issue_jwt(username, secs)?,
        };
        Ok((jwt, secs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::config::AuthConfig;

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
        let remember_me_hours = config.remember_me_hours;
        LoginManager::new(
            auth,
            Arc::new(config),
            remember_me_hours,
            lockout,
            String::new(),
        )
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

    struct FixedCreds;
    impl crate::auth::Credentials for FixedCreds {
        fn verify(&self, u: &str, p: &str) -> bool {
            u == "member" && p == "pw"
        }
    }

    #[test]
    fn login_manager_over_custom_verifier() {
        let auth = Arc::new(Authenticator::from_parts(
            vec![1u8; 32],
            "c2FsdA==".into(),
            "h".into(),
        ));
        let m = LoginManager::new(
            auth,
            Arc::new(FixedCreds),
            48,
            LockoutTimer::from_config(60, 10),
            String::new(),
        );
        assert!(m.authorize("member", "pw"));
        assert!(!m.authorize("member", "no"));
        assert_eq!(m.remember_me_days(), 2);
    }
}
