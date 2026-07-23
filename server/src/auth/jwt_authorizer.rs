use std::sync::Arc;

use axum::http::HeaderMap;

use crate::auth::authenticator::{Authenticator, Claims};
use crate::auth::authorizer::{AuthContext, RequestAuthorizer};
use crate::auth::config::constant_time_eq;
use crate::auth::cookie::{cookie_value, request_host, scoped_auth_cookie_name};

/// Additional policy applied after a JWT's signature and expiry validate.
pub type ClaimsFilter = Box<dyn Fn(&Claims) -> bool + Send + Sync>;

/// The standalone server's authorizer: a request is authorized if it carries the
/// configured bearer token (constant-time compared) or a valid session JWT in
/// an auth cookie. Classic single-space servers may scope the cookie to their
/// configured URL prefix; account-managed multi-space servers pass an empty
/// prefix and share `auth_<cleanHost>` across every space.
pub struct JwtAuthorizer {
    authenticator: Arc<Authenticator>,
    /// Optional bearer token (empty disables bearer auth).
    auth_token: String,
    /// URL prefix this authorizer's space is mounted under (cookie scoping).
    url_prefix: String,
    /// Optional filter applied to verified JWT claims. Bearer-token policy is
    /// handled independently by the corresponding token authorizer.
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
            claims_filter: None,
        }
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
            claims_filter: Some(filter),
        }
    }
}

impl RequestAuthorizer for JwtAuthorizer {
    fn is_authorized(&self, ctx: &AuthContext) -> bool {
        if !self.auth_token.is_empty() {
            if let Some(token) = bearer_token(ctx.headers) {
                if constant_time_eq(token.as_bytes(), self.auth_token.as_bytes()) {
                    return true;
                }
            }
        }
        let name = scoped_auth_cookie_name(&request_host(ctx.headers), &self.url_prefix);
        if let Some(cookie) = cookie_value(ctx.headers, &name) {
            if let Ok(claims) = self.authenticator.verify_jwt(&cookie) {
                if let Some(f) = &self.claims_filter {
                    if !f(&claims) {
                        return false;
                    }
                }
                return true;
            }
        }
        false
    }
}

/// Extract the `Authorization: Bearer <token>` value.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
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
}
