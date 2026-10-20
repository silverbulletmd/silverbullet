use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use sha2::{Digest, Sha256};

use super::client_id::ClientId;

pub const CODE_TTL_SECS: u64 = 60;

/// The errors of the OAuth endpoints (RFC 6749 §5.2, and RFC 8628 §3.5 for
/// the device flow)
#[derive(Debug, PartialEq, Eq)]
pub enum OAuthError {
    InvalidRequest(&'static str),
    InvalidGrant(&'static str),
    UnauthorizedClient,
    UnsupportedGrantType,
    AuthorizationPending,
    SlowDown,
    ExpiredToken,
    AccessDenied,
}

impl OAuthError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::InvalidGrant(_) => "invalid_grant",
            Self::UnauthorizedClient => "unauthorized_client",
            Self::UnsupportedGrantType => "unsupported_grant_type",
            Self::AuthorizationPending => "authorization_pending",
            Self::SlowDown => "slow_down",
            Self::ExpiredToken => "expired_token",
            Self::AccessDenied => "access_denied",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::InvalidRequest(d) | Self::InvalidGrant(d) => d,
            Self::UnauthorizedClient => "invalid client_id, or not the one the grant was issued to",
            Self::UnsupportedGrantType => "unsupported grant_type",
            Self::AuthorizationPending => "the user has not approved the request yet",
            Self::SlowDown => "too many requests, slow down",
            Self::ExpiredToken => "the device code expired",
            Self::AccessDenied => "the user denied the request",
        }
    }
}

/// RFC 8252 §7.3: a native app's redirect must be loopback over plain HTTP on
/// an ephemeral port. `localhost` is refused because it can resolve to a
/// non-loopback address.
pub fn validate_redirect_uri(uri: &str) -> bool {
    // Reject non-printable redirect URIs here instead of failing later
    // while building the Location header.
    if uri.bytes().any(|b| !(0x21..=0x7e).contains(&b)) {
        return false;
    }
    if uri.contains('#') {
        return false;
    }
    let Some(rest) = uri.strip_prefix("http://127.0.0.1") else {
        return false;
    };
    match rest.split_once('/') {
        Some((port, _)) => port.is_empty() || port.strip_prefix(':').is_some_and(is_port),
        None => false,
    }
}

fn is_port(s: &str) -> bool {
    !s.is_empty() && s.len() <= 5 && s.bytes().all(|b| b.is_ascii_digit())
}

pub fn challenge_for(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn verify_pkce(challenge: &str, verifier: &str) -> bool {
    if verifier.is_empty() {
        return false;
    }
    crate::auth::config::constant_time_eq(challenge_for(verifier).as_bytes(), challenge.as_bytes())
}

pub struct CodeGrant {
    pub username: String,
    pub code_challenge: String,
    pub redirect_uri: String,
    pub client_id: ClientId,
}

struct StoredGrant {
    grant: CodeGrant,
    issued_at: u64,
}

/// Short-lived authorization codes. In memory only: a code outlives neither the
/// process nor its 60-second TTL, so there is nothing worth persisting.
#[derive(Default)]
pub struct AuthCodeStore {
    entries: Mutex<HashMap<String, StoredGrant>>,
}

impl AuthCodeStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn issue(&self, grant: CodeGrant) -> String {
        self.issue_at(grant, now_secs())
    }

    pub fn issue_at(&self, grant: CodeGrant, now: u64) -> String {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("OS RNG must be available");
        let code: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|_, e| now.saturating_sub(e.issued_at) <= CODE_TTL_SECS);
        entries.insert(
            code.clone(),
            StoredGrant {
                grant,
                issued_at: now,
            },
        );
        code
    }

    pub fn consume(
        &self,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
        client_id: &ClientId,
    ) -> Result<String, OAuthError> {
        self.consume_at(code, verifier, redirect_uri, client_id, now_secs())
    }

    pub fn consume_at(
        &self,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
        client_id: &ClientId,
        now: u64,
    ) -> Result<String, OAuthError> {
        // Removed before it is validated: a code that fails PKCE has been
        // guessed or replayed, and must not survive for a second attempt.
        let stored = self
            .entries
            .lock()
            .unwrap()
            .remove(code)
            .ok_or(OAuthError::InvalidGrant("unknown or already-used code"))?;
        if now.saturating_sub(stored.issued_at) > CODE_TTL_SECS {
            return Err(OAuthError::InvalidGrant("code expired"));
        }
        if &stored.grant.client_id != client_id {
            return Err(OAuthError::UnauthorizedClient);
        }
        if stored.grant.redirect_uri != redirect_uri {
            return Err(OAuthError::InvalidGrant("redirect_uri mismatch"));
        }
        if !verify_pkce(&stored.grant.code_challenge, verifier) {
            return Err(OAuthError::InvalidGrant("PKCE verification failed"));
        }
        Ok(stored.grant.username)
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> ClientId {
        ClientId::parse(crate::auth::client_id::APP).unwrap()
    }

    fn grant() -> CodeGrant {
        CodeGrant {
            username: "alice".into(),
            code_challenge: challenge_for("verifier-abc"),
            redirect_uri: "http://127.0.0.1:51234/cb".into(),
            client_id: app(),
        }
    }

    #[test]
    fn only_loopback_http_redirect_uris_are_accepted() {
        assert!(validate_redirect_uri("http://127.0.0.1:51234/cb"));
        assert!(validate_redirect_uri("http://127.0.0.1:1/"));
        assert!(!validate_redirect_uri("http://localhost:51234/cb"));
        assert!(!validate_redirect_uri("https://127.0.0.1:51234/cb"));
        assert!(!validate_redirect_uri("http://127.0.0.1.evil.com/cb"));
        assert!(!validate_redirect_uri("http://example.com/cb"));
        assert!(!validate_redirect_uri("http://127.0.0.1:51234/cb#frag"));
        assert!(!validate_redirect_uri(""));
        assert!(!validate_redirect_uri("http://127.0.0.1:51234@evil.com/cb"));
        assert!(!validate_redirect_uri(
            "http://127.0.0.1:51234/cb\r\nX-Injected: 1"
        ));
        assert!(!validate_redirect_uri("http://127.0.0.1:51234/c b"));
    }

    #[test]
    fn pkce_accepts_only_the_matching_verifier() {
        let c = challenge_for("verifier-abc");
        assert!(verify_pkce(&c, "verifier-abc"));
        assert!(!verify_pkce(&c, "verifier-abd"));
        assert!(!verify_pkce(&c, ""));
    }

    #[test]
    fn a_code_can_be_redeemed_exactly_once() {
        let store = AuthCodeStore::new();
        let code = store.issue(grant());
        assert_eq!(
            store
                .consume(&code, "verifier-abc", "http://127.0.0.1:51234/cb", &app())
                .unwrap(),
            "alice"
        );
        assert!(store
            .consume(&code, "verifier-abc", "http://127.0.0.1:51234/cb", &app())
            .is_err());
    }

    #[test]
    fn a_code_is_bound_to_its_verifier_redirect_uri_and_client() {
        let store = AuthCodeStore::new();
        let c1 = store.issue(grant());
        assert!(store
            .consume(&c1, "wrong-verifier", "http://127.0.0.1:51234/cb", &app())
            .is_err());
        let c2 = store.issue(grant());
        assert!(store
            .consume(&c2, "verifier-abc", "http://127.0.0.1:9999/cb", &app())
            .is_err());
        let c3 = store.issue(grant());
        assert!(store
            .consume(
                &c3,
                "verifier-abc",
                "http://127.0.0.1:51234/cb",
                &ClientId::parse("someone-else").unwrap()
            )
            .is_err());
    }

    #[test]
    fn a_code_older_than_its_ttl_is_rejected() {
        let store = AuthCodeStore::new();
        let code = store.issue_at(grant(), 1_000);
        assert!(store
            .consume_at(
                &code,
                "verifier-abc",
                "http://127.0.0.1:51234/cb",
                &app(),
                1_000 + CODE_TTL_SECS + 1,
            )
            .is_err());
    }

    #[test]
    fn a_failed_redemption_still_burns_the_code() {
        let store = AuthCodeStore::new();
        let code = store.issue(grant());
        assert!(store
            .consume(&code, "wrong", "http://127.0.0.1:51234/cb", &app())
            .is_err());
        assert!(store
            .consume(&code, "verifier-abc", "http://127.0.0.1:51234/cb", &app())
            .is_err());
    }
}
