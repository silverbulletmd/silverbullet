use std::sync::Arc;

use axum::http::HeaderMap;

use crate::auth::authenticator::Authenticator;
use crate::auth::authorizer::{AuthContext, RequestAuthorizer};
use crate::auth::config::constant_time_eq;
use crate::auth::cookie::{auth_cookie_name, request_host};

/// The standalone server's authorizer: a request is authorized if it carries the
/// configured bearer token (constant-time compared) or a valid session JWT in
/// the host-derived auth cookie (`auth_<cleanHost>`).
pub struct JwtAuthorizer {
    authenticator: Arc<Authenticator>,
    /// Optional bearer token (empty disables bearer auth).
    auth_token: String,
}

impl JwtAuthorizer {
    pub fn new(authenticator: Arc<Authenticator>, auth_token: String) -> Self {
        Self {
            authenticator,
            auth_token,
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
        let name = auth_cookie_name(&request_host(ctx.headers));
        if let Some(cookie) = cookie_value(ctx.headers, &name) {
            if self.authenticator.verify_jwt(&cookie).is_ok() {
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

/// Extract a named cookie value from the `Cookie` header.
fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let header = headers.get("cookie")?.to_str().ok()?;
    for pair in header.split(';') {
        let pair = pair.trim();
        if let Some((k, v)) = pair.split_once('=') {
            if k == name {
                return Some(v.to_string());
            }
        }
    }
    None
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
}
