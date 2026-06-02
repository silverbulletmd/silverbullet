use axum::http::HeaderMap;

use crate::auth::authenticator::Authenticator;
use crate::auth::authorizer::{AuthContext, RequestAuthorizer};
use crate::auth::config::constant_time_eq;

/// The standalone server's authorizer: a request is authorized if it carries the
/// configured bearer token (constant-time compared) or a valid session JWT in
/// the auth cookie.
pub struct JwtAuthorizer {
    authenticator: Authenticator,
    /// Optional bearer token (empty disables bearer auth).
    auth_token: String,
    cookie_name: String,
}

impl JwtAuthorizer {
    pub fn new(authenticator: Authenticator, auth_token: String, cookie_name: String) -> Self {
        Self {
            authenticator,
            auth_token,
            cookie_name,
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
        if let Some(cookie) = cookie_value(ctx.headers, &self.cookie_name) {
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
        JwtAuthorizer::new(auth, "secret-token".into(), "sb_auth".into())
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
        let a = authz();
        let token = {
            let auth = Authenticator::from_secret_bytes(vec![3u8; 32], "h".into());
            auth.issue_jwt("alice", 3600).unwrap()
        };
        let mut h = HeaderMap::new();
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!("sb_auth={token}; other=1")).unwrap(),
        );
        assert!(a.is_authorized(&ctx(&h)));
    }

    #[test]
    fn rejects_garbage_cookie() {
        let mut h = HeaderMap::new();
        h.insert("cookie", HeaderValue::from_static("sb_auth=not-a-jwt"));
        assert!(!authz().is_authorized(&ctx(&h)));
    }

    #[test]
    fn rejects_no_credentials() {
        let h = HeaderMap::new();
        assert!(!authz().is_authorized(&ctx(&h)));
    }
}
