use std::sync::Arc;

use axum::http::HeaderMap;

use crate::auth::authenticator::{Authenticator, Claims};
use crate::auth::authorizer::{AuthContext, AuthOutcome, RequestAuthorizer};
use crate::auth::config::constant_time_eq;
use crate::auth::cookie::{cookie_value, request_host, scoped_auth_cookie_name};

/// Additional policy applied after a JWT's signature and expiry validate.
pub type ClaimsFilter = Box<dyn Fn(&Claims) -> bool + Send + Sync>;

pub struct JwtAuthorizer {
    authenticator: Arc<Authenticator>,
    /// Optional bearer token (empty disables bearer auth).
    auth_token: String,
    /// URL prefix this authorizer's space is mounted under (cookie scoping).
    url_prefix: String,
    /// Id of the space this authorizer guards, matched against a token's
    /// `space` claim. Empty means "not a space" — the management surfaces —
    /// which no space-scoped token may reach.
    space_id: String,
    claims_filter: Option<ClaimsFilter>,
}

impl JwtAuthorizer {
    pub fn new(authenticator: Arc<Authenticator>, auth_token: String) -> Self {
        Self::with_prefix(authenticator, auth_token, String::new())
    }

    pub fn with_prefix(
        authenticator: Arc<Authenticator>,
        auth_token: String,
        url_prefix: String,
    ) -> Self {
        Self {
            authenticator,
            auth_token,
            url_prefix,
            space_id: String::new(),
            claims_filter: None,
        }
    }

    /// Scope this authorizer to one space, so a token consented for another
    /// space (or for none) is refused.
    pub fn for_space(mut self, space_id: impl Into<String>) -> Self {
        self.space_id = space_id.into();
        self
    }

    /// Like [`Self::with_prefix`], but rejects JWT sessions whose claims don't
    /// pass `filter`. The bearer-token path is unaffected.
    pub fn with_filter(
        authenticator: Arc<Authenticator>,
        auth_token: String,
        url_prefix: String,
        filter: ClaimsFilter,
    ) -> Self {
        Self {
            authenticator,
            auth_token,
            url_prefix,
            space_id: String::new(),
            claims_filter: Some(filter),
        }
    }
}

impl RequestAuthorizer for JwtAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        let bearer = bearer_token(ctx.headers);
        if !self.auth_token.is_empty() {
            if let Some(token) = &bearer {
                if constant_time_eq(token.as_bytes(), self.auth_token.as_bytes()) {
                    return Some(AuthOutcome::trusted());
                }
            }
        }
        let cookie_name = scoped_auth_cookie_name(&request_host(ctx.headers), &self.url_prefix);
        let candidate = cookie_value(ctx.headers, &cookie_name).or(bearer);
        let claims = self.authenticator.verify_jwt(&candidate?).ok()?;
        if claims.token_use.is_some() {
            return None;
        }
        if let Some(space) = &claims.space {
            if *space != self.space_id {
                return None;
            }
        }
        if let Some(f) = &self.claims_filter {
            if !f(&claims) {
                return None;
            }
        }
        Some(AuthOutcome::user(claims.username))
    }
}

/// Extract the `Authorization: Bearer <token>` value.
fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::authenticator::Authenticator;
    use crate::auth::{AuthContext, RequestAuthorizer};
    use axum::http::{HeaderMap, HeaderValue, Method};

    fn authz() -> JwtAuthorizer {
        let auth = Authenticator::from_secret_bytes(vec![3u8; 32], "h".into());
        JwtAuthorizer::new(std::sync::Arc::new(auth), "secret-token".into())
    }

    fn ctx<'a>(headers: &'a HeaderMap) -> AuthContext<'a> {
        AuthContext {
            method: &Method::GET,
            path: "/.fs",
            query: None,
            headers,
        }
    }

    #[test]
    fn accepts_matching_bearer_token() {
        let mut h = HeaderMap::new();
        h.insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token"),
        );
        assert!(authz().is_authorized(&ctx(&h)));
    }

    /// The env-style shared secret (`SB_AUTH_TOKEN`) has no username, but it
    /// is single-space-owner authority and must grant `Write` rather than
    /// falling back to a policy that would grade "no identity" as anonymous.
    #[test]
    fn matching_bearer_token_grants_trusted_write() {
        let mut h = HeaderMap::new();
        h.insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token"),
        );
        let outcome = authz().authorize(&ctx(&h)).expect("should authorize");
        assert_eq!(outcome.grant, Some(crate::auth::AccessLevel::Write));
    }

    #[test]
    fn rejects_wrong_bearer_token() {
        let mut h = HeaderMap::new();
        h.insert("authorization", HeaderValue::from_static("Bearer nope"));
        assert!(!authz().is_authorized(&ctx(&h)));
    }

    #[test]
    fn accepts_valid_jwt_cookie() {
        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let a = JwtAuthorizer::new(auth, "secret-token".into());
        let mut h = HeaderMap::new();
        h.insert("host", HeaderValue::from_static("localhost"));
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!("auth_localhost={token}; other=1")).unwrap(),
        );
        assert!(a.is_authorized(&ctx(&h)));
    }

    #[test]
    fn rejects_cookie_under_wrong_host_name() {
        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let a = JwtAuthorizer::new(auth, "secret-token".into());
        let mut h = HeaderMap::new();
        h.insert("host", HeaderValue::from_static("localhost"));
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!("auth_other={token}")).unwrap(),
        );
        assert!(!a.is_authorized(&ctx(&h)));
    }

    #[test]
    fn rejects_garbage_cookie() {
        let mut h = HeaderMap::new();
        h.insert("host", HeaderValue::from_static("localhost"));
        h.insert(
            "cookie",
            HeaderValue::from_static("auth_localhost=not-a-jwt"),
        );
        assert!(!authz().is_authorized(&ctx(&h)));
    }

    #[test]
    fn rejects_no_credentials() {
        let h = HeaderMap::new();
        assert!(!authz().is_authorized(&ctx(&h)));
    }

    #[test]
    fn prefixed_authorizer_reads_scoped_cookie_only() {
        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let a = JwtAuthorizer::with_prefix(auth, String::new(), "/work".into());
        // Scoped cookie: accepted.
        let mut h = HeaderMap::new();
        h.insert("host", HeaderValue::from_static("localhost"));
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!("auth_localhost_work={token}")).unwrap(),
        );
        assert!(a.is_authorized(&ctx(&h)));
        // Unscoped cookie: rejected by the prefixed authorizer.
        let mut h2 = HeaderMap::new();
        h2.insert("host", HeaderValue::from_static("localhost"));
        h2.insert(
            "cookie",
            HeaderValue::from_str(&format!("auth_localhost={token}")).unwrap(),
        );
        assert!(!a.is_authorized(&ctx(&h2)));
    }

    #[test]
    fn user_filter_rejects_unlisted_users() {
        let auth = std::sync::Arc::new(crate::auth::Authenticator::from_parts(
            vec![2u8; 32],
            String::new(),
            "h".into(),
        ));
        let jwt_ok = auth.issue_jwt("alice", 3600).unwrap();
        let jwt_bad = auth.issue_jwt("mallory", 3600).unwrap();
        let a = JwtAuthorizer::with_filter(
            auth,
            String::new(),
            String::new(),
            Box::new(|claims| claims.username == "alice"),
        );
        let mk = |jwt: &str| {
            let mut h = HeaderMap::new();
            h.insert("host", HeaderValue::from_static("localhost"));
            h.insert(
                "cookie",
                HeaderValue::from_str(&format!("auth_localhost={jwt}")).unwrap(),
            );
            h
        };
        let h1 = mk(&jwt_ok);
        let h2 = mk(&jwt_bad);
        assert!(a.is_authorized(&ctx(&h1)));
        assert!(!a.is_authorized(&ctx(&h2)));
    }

    #[test]
    fn a_session_jwt_in_the_authorization_header_authorizes_with_its_username() {
        let auth = Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let jwt = auth.issue_token("alice", None, None, None, 600).unwrap();
        let authz = JwtAuthorizer::new(auth, "static-tok".into());

        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {jwt}").parse().unwrap());
        let outcome = authz
            .authorize(&AuthContext {
                method: &Method::GET,
                path: "/.fs",
                query: None,
                headers: &headers,
            })
            .expect("should authorize");
        assert_eq!(outcome.username.as_deref(), Some("alice"));
    }

    #[test]
    fn a_refresh_token_is_not_accepted_as_a_bearer() {
        let auth = Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let refresh = auth
            .issue_token("alice", None, Some("refresh"), None, 600)
            .unwrap();
        let authz = JwtAuthorizer::new(auth, String::new());

        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {refresh}").parse().unwrap(),
        );
        assert!(authz
            .authorize(&AuthContext {
                method: &Method::GET,
                path: "/.fs",
                query: None,
                headers: &headers,
            })
            .is_none());
    }

    /// An OAuth device token names the space its consent was given for. That
    /// name is the whole scope: it must not open any other space, and it must
    /// not stand in for a server-wide session on the management surfaces
    /// (which carry no space of their own).
    #[test]
    fn a_token_bound_to_one_space_opens_only_that_space() {
        let auth = Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let bound = auth
            .issue_token("alice", None, None, Some("space-b"), 600)
            .unwrap();
        let unbound = auth.issue_token("alice", None, None, None, 600).unwrap();

        let space_a = JwtAuthorizer::new(auth.clone(), String::new()).for_space("space-a");
        let space_b = JwtAuthorizer::new(auth.clone(), String::new()).for_space("space-b");
        let server_wide = JwtAuthorizer::new(auth, String::new());

        let bearer = |token: &str| {
            let mut h = HeaderMap::new();
            h.insert("authorization", format!("Bearer {token}").parse().unwrap());
            h
        };

        let hb = bearer(&bound);
        assert!(
            space_b.is_authorized(&ctx(&hb)),
            "the consented space accepts it"
        );
        assert!(
            !space_a.is_authorized(&ctx(&hb)),
            "another space must not accept it"
        );
        assert!(
            !server_wide.is_authorized(&ctx(&hb)),
            "the unscoped management surface must not accept it"
        );

        let hu = bearer(&unbound);
        assert!(
            space_a.is_authorized(&ctx(&hu)) && server_wide.is_authorized(&ctx(&hu)),
            "an ordinary session claims no space and still works everywhere"
        );
    }

    #[test]
    fn the_claims_filter_applies_to_the_bearer_path() {
        let auth = Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let jwt = auth.issue_token("alice", None, None, None, 600).unwrap();
        let authz = JwtAuthorizer::with_filter(
            auth,
            String::new(),
            String::new(),
            Box::new(|c| c.username == "bob"),
        );

        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {jwt}").parse().unwrap());
        assert!(authz
            .authorize(&AuthContext {
                method: &Method::GET,
                path: "/.fs",
                query: None,
                headers: &headers,
            })
            .is_none());
    }

    #[test]
    fn the_static_bearer_token_still_authorizes_anonymously() {
        let auth = Arc::new(Authenticator::from_secret_bytes(vec![3u8; 32], "h".into()));
        let authz = JwtAuthorizer::new(auth, "static-tok".into());
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer static-tok".parse().unwrap());
        let outcome = authz
            .authorize(&AuthContext {
                method: &Method::GET,
                path: "/.fs",
                query: None,
                headers: &headers,
            })
            .expect("should authorize");
        assert_eq!(outcome.username, None);
    }
}
