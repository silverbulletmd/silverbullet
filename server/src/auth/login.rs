//! The issuing side of the standalone login flow: credential verification,
//! brute-force lockout, session-JWT minting, and the client-encryption salt.
//! Paired with `JwtAuthorizer` (the verifying side) over a shared
//! `Arc<Authenticator>`.

use std::sync::Arc;

use crate::auth::authenticator::Authenticator;
use crate::auth::client_id::ClientId;
use crate::auth::lockout::LockoutTimer;
use crate::auth::Credentials;

/// Normal (non-"remember me") session lifetime: one week, matching the legacy
/// server's `authenticationExpirySeconds`.
pub const SESSION_EXPIRY_SECS: u64 = 60 * 60 * 24 * 7;

type CredentialVersionProvider = Arc<dyn Fn(&str) -> String + Send + Sync>;

pub const DEFAULT_ACCESS_TOKEN_DAYS: u64 = 365;
pub const REFRESH_TOKEN_DAYS: u64 = 730;

/// The access and refresh token issued to a client by any grant
pub struct ClientTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

pub fn access_token_expiry_secs() -> u64 {
    std::env::var("SB_APP_TOKEN_EXPIRY_DAYS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|d| *d > 0)
        .unwrap_or(DEFAULT_ACCESS_TOKEN_DAYS)
        * 24
        * 3600
}

/// Owns the credential verifier, lockout state, and JWT issuer for `/.auth`.
pub struct LoginManager {
    authenticator: Arc<Authenticator>,
    verifier: Arc<dyn Credentials>,
    credential_version: Option<CredentialVersionProvider>,
    remember_me_hours: u64,
    lockout: LockoutTimer,
    host_url_prefix: String,
    session_url_prefix: String,
    /// Id of the space this manager belongs to. Device tokens are stamped with
    /// it and only redeemable against it; empty leaves them unscoped.
    space_id: String,
    auth_codes: crate::auth::oauth::AuthCodeStore,
    device_codes: crate::auth::device::DeviceStore,
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
            space_id: String::new(),
            auth_codes: crate::auth::oauth::AuthCodeStore::new(),
            device_codes: crate::auth::device::DeviceStore::default(),
        }
    }

    /// Add the live account-version provider used by account-managed servers.
    /// The resulting JWT can be revoked per user without rotating the shared
    /// server signing secret.
    pub fn with_credential_version(mut self, provider: CredentialVersionProvider) -> Self {
        self.credential_version = Some(provider);
        self
    }

    /// Name the space whose consent this manager issues device tokens against.
    pub fn for_space(mut self, space_id: impl Into<String>) -> Self {
        self.space_id = space_id.into();
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

    pub fn device_codes(&self) -> &crate::auth::device::DeviceStore {
        &self.device_codes
    }

    pub fn auth_codes(&self) -> &crate::auth::oauth::AuthCodeStore {
        &self.auth_codes
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
        self.issue_session_with_provider(username, remember, None)
    }

    pub fn issue_provider_session(
        &self,
        username: &str,
        remember: bool,
        provider: &str,
    ) -> Result<(String, u64), jsonwebtoken::errors::Error> {
        self.issue_session_with_provider(username, remember, Some(provider))
    }

    fn issue_session_with_provider(
        &self,
        username: &str,
        remember: bool,
        provider: Option<&str>,
    ) -> Result<(String, u64), jsonwebtoken::errors::Error> {
        let secs = if remember {
            self.remember_me_hours.saturating_mul(3600)
        } else {
            SESSION_EXPIRY_SECS
        };
        let version = self
            .credential_version
            .as_ref()
            .map(|provider| provider(username));
        let jwt = self
            .authenticator
            .issue_browser_jwt(username, version, provider, secs)?;
        if let Err(error) = self.verifier.record_login(username) {
            tracing::warn!("Could not persist last login: {error}");
        }
        Ok((jwt, secs))
    }

    pub fn revoke_browser_session(&self, token: &str) -> std::io::Result<()> {
        self.authenticator.revoke_browser_jwt(token)
    }

    pub fn verify_browser_session(
        &self,
        token: &str,
    ) -> Option<crate::auth::authenticator::Claims> {
        let claims = self.authenticator.verify_browser_jwt(token).ok()?;
        let current = self
            .credential_version
            .as_ref()
            .map(|provider| provider(&claims.username));
        if current != claims.credential_version {
            return None;
        }
        Some(claims)
    }

    pub fn issue_tokens(
        &self,
        username: &str,
        client: &ClientId,
    ) -> Result<ClientTokens, jsonwebtoken::errors::Error> {
        let version = self.credential_version.as_ref().map(|p| p(username));
        let expires_in = access_token_expiry_secs();
        let space = self.scoped_space();
        Ok(ClientTokens {
            access_token: self.authenticator.issue_token(
                username,
                version.clone(),
                None,
                space,
                expires_in,
            )?,
            refresh_token: self.authenticator.issue_token(
                username,
                version,
                Some(&client.refresh_token_use()),
                space,
                REFRESH_TOKEN_DAYS * 24 * 3600,
            )?,
            expires_in,
        })
    }

    fn scoped_space(&self) -> Option<&str> {
        Some(self.space_id.as_str()).filter(|s| !s.is_empty())
    }

    /// The username of a refresh token issued to this client, if it is still
    /// valid
    pub fn verify_refresh_token(&self, token: &str, client: &ClientId) -> Option<String> {
        let claims = self.authenticator.verify_jwt(token).ok()?;
        let token_use = client.refresh_token_use();
        if claims.token_use.as_deref() != Some(token_use.as_str()) {
            return None;
        }
        if claims.space.as_deref() != self.scoped_space() {
            return None;
        }
        let current = self
            .credential_version
            .as_ref()
            .map(|p| p(&claims.username));
        if current != claims.credential_version {
            return None;
        }
        Some(claims.username)
    }

    pub fn csrf_token(&self, binding: &str) -> String {
        self.authenticator.csrf_token(binding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(id: &str) -> ClientId {
        ClientId::parse(id).unwrap()
    }
    use crate::auth::config::AuthConfig;

    #[test]
    fn share_client_refresh_token_round_trips() {
        let manager = manager();
        let tokens = manager
            .issue_tokens("u", &client("silverbullet-share"))
            .unwrap();
        assert_eq!(
            manager.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-share")),
            Some("u".into())
        );
        assert_eq!(
            manager.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app")),
            None
        );
    }

    #[test]
    fn cli_and_app_refresh_credentials_are_isolated() {
        let manager = manager();
        let cli = manager
            .issue_tokens("river", &client("silverbullet-cli"))
            .unwrap();
        let app = manager
            .issue_tokens("river", &client("silverbullet-app"))
            .unwrap();
        assert_eq!(
            manager.verify_refresh_token(&cli.refresh_token, &client("silverbullet-cli")),
            Some("river".into())
        );
        assert_eq!(
            manager.verify_refresh_token(&cli.refresh_token, &client("silverbullet-app")),
            None
        );
        assert_eq!(
            manager.verify_refresh_token(&app.refresh_token, &client("silverbullet-cli")),
            None
        );
        assert_eq!(
            manager.verify_refresh_token(&cli.access_token, &client("silverbullet-cli")),
            None
        );
    }

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

    /// The consent screen names one space; the tokens it produces must say so,
    /// and a refresh token from a different space must not be redeemable here.
    #[test]
    fn device_tokens_carry_the_space_they_were_consented_for() {
        let m = manager().for_space("space-a");
        let tokens = m
            .issue_tokens("alice", &client("silverbullet-app"))
            .unwrap();
        for token in [&tokens.access_token, &tokens.refresh_token] {
            let claims = m.authenticator.verify_jwt(token).unwrap();
            assert_eq!(claims.space.as_deref(), Some("space-a"));
        }
        assert_eq!(
            m.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app"))
                .as_deref(),
            Some("alice"),
            "its own space redeems it"
        );

        let elsewhere = manager().for_space("space-b");
        assert_eq!(
            elsewhere.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app")),
            None,
            "another space must not redeem it"
        );
        assert_eq!(
            manager().verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app")),
            None,
            "nor may an unscoped surface"
        );
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

    #[test]
    fn device_tokens_are_distinguishable_and_long_lived() {
        let m = manager();
        let tokens = m
            .issue_tokens("alice", &client("silverbullet-app"))
            .unwrap();
        assert_eq!(tokens.expires_in, 365 * 24 * 3600);

        let access = m.authenticator.verify_jwt(&tokens.access_token).unwrap();
        assert_eq!(access.username, "alice");
        assert_eq!(access.token_use, None);

        let refresh = m.authenticator.verify_jwt(&tokens.refresh_token).unwrap();
        assert_eq!(refresh.token_use.as_deref(), Some("refresh"));
    }

    #[test]
    fn only_a_refresh_token_verifies_as_one() {
        let m = manager();
        let tokens = m
            .issue_tokens("alice", &client("silverbullet-app"))
            .unwrap();
        assert_eq!(
            m.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app"))
                .as_deref(),
            Some("alice")
        );
        assert_eq!(
            m.verify_refresh_token(&tokens.access_token, &client("silverbullet-app")),
            None
        );
        assert_eq!(
            m.verify_refresh_token("not-a-jwt", &client("silverbullet-app")),
            None
        );
    }

    #[test]
    fn a_refresh_token_with_a_stale_credential_version_is_rejected() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let bumps = Arc::new(AtomicUsize::new(0));
        let seen = bumps.clone();
        let m = manager().with_credential_version(Arc::new(move |_u| {
            format!("v{}", seen.load(Ordering::SeqCst))
        }));
        let tokens = m
            .issue_tokens("alice", &client("silverbullet-app"))
            .unwrap();
        assert_eq!(
            m.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app"))
                .as_deref(),
            Some("alice")
        );
        bumps.store(1, Ordering::SeqCst);
        assert_eq!(
            m.verify_refresh_token(&tokens.refresh_token, &client("silverbullet-app")),
            None
        );
    }
}
