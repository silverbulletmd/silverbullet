use crate::auth::authorizer::{AuthContext, RequestAuthorizer};
use crate::auth::config::constant_time_eq;

/// Wraps an inner authorizer, additionally accepting any request that carries
/// `?token=<headless_token>` in its query string (constant-time compared). This
/// lets the headless browser page authenticate via the URL the server hands it.
pub struct HeadlessTokenAuthorizer {
    inner: Box<dyn RequestAuthorizer>,
    token: String,
}

impl HeadlessTokenAuthorizer {
    pub fn new(inner: Box<dyn RequestAuthorizer>, token: String) -> Self {
        Self { inner, token }
    }

    fn query_token_matches(&self, query: Option<&str>) -> bool {
        if self.token.is_empty() {
            return false;
        }
        let Some(q) = query else { return false };
        for pair in q.split('&') {
            if let Some(v) = pair.strip_prefix("token=") {
                if constant_time_eq(v.as_bytes(), self.token.as_bytes()) {
                    return true;
                }
            }
        }
        false
    }
}

impl RequestAuthorizer for HeadlessTokenAuthorizer {
    fn is_authorized(&self, ctx: &AuthContext) -> bool {
        self.query_token_matches(ctx.query) || self.inner.is_authorized(ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, Method};

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn is_authorized(&self, _ctx: &AuthContext) -> bool {
            false
        }
    }
    struct AllowAll;
    impl RequestAuthorizer for AllowAll {
        fn is_authorized(&self, _ctx: &AuthContext) -> bool {
            true
        }
    }

    fn ctx<'a>(query: Option<&'a str>, headers: &'a HeaderMap) -> AuthContext<'a> {
        AuthContext {
            method: &Method::GET,
            path: "/",
            query,
            headers,
        }
    }

    #[test]
    fn accepts_matching_query_token() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(Box::new(DenyAll), "secret".into());
        assert!(a.is_authorized(&ctx(Some("headless=1&token=secret"), &h)));
        assert!(a.is_authorized(&ctx(Some("token=secret"), &h)));
    }

    #[test]
    fn rejects_wrong_or_missing_token() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(Box::new(DenyAll), "secret".into());
        assert!(!a.is_authorized(&ctx(Some("headless=1&token=wrong"), &h)));
        assert!(!a.is_authorized(&ctx(Some("token=secretX"), &h)));
        assert!(!a.is_authorized(&ctx(None, &h)));
    }

    #[test]
    fn empty_token_never_matches_query() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(Box::new(DenyAll), String::new());
        assert!(!a.is_authorized(&ctx(Some("token="), &h)));
    }

    #[test]
    fn falls_through_to_inner_when_token_absent() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(Box::new(AllowAll), "secret".into());
        // No token, but inner allows → authorized.
        assert!(a.is_authorized(&ctx(None, &h)));
    }
}
