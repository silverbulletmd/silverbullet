use axum::http::HeaderMap;

use crate::auth::authorizer::{AuthContext, AuthOutcome, RequestAuthorizer};
use crate::auth::config::constant_time_eq;
use crate::auth::cookie::cookie_value;

/// Session-cookie name carrying a space's headless token.
///
/// Every space gets its own name. The server-managed browser is shared by all
/// spaces, so all their cookies land in one jar; `Path` scoping alone is
/// ambiguous because a space bound at the root prefix sets `Path=/` and its
/// cookie then rides along on every other space's requests. A per-space name
/// removes any dependence on the browser's cookie ordering.
pub fn headless_cookie_name(space_id: &str) -> String {
    format!("silverbullet_headless_{space_id}")
}

/// Wraps an inner authorizer, additionally accepting any request that carries
/// this space's headless token in its dedicated session cookie.
pub struct HeadlessTokenAuthorizer {
    inner: Box<dyn RequestAuthorizer>,
    cookie_name: String,
    token: String,
}

impl HeadlessTokenAuthorizer {
    pub fn new(inner: Box<dyn RequestAuthorizer>, cookie_name: String, token: String) -> Self {
        Self {
            inner,
            cookie_name,
            token,
        }
    }

    fn cookie_token_matches(&self, headers: &HeaderMap) -> bool {
        if self.token.is_empty() {
            return false;
        }
        match cookie_value(headers, &self.cookie_name) {
            Some(v) => constant_time_eq(v.as_bytes(), self.token.as_bytes()),
            None => false,
        }
    }
}

impl RequestAuthorizer for HeadlessTokenAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        if self.cookie_token_matches(ctx.headers) {
            return Some(AuthOutcome { username: None });
        }
        self.inner.authorize(ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, Method};

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            None
        }
    }
    struct AllowAll;
    impl RequestAuthorizer for AllowAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            Some(AuthOutcome { username: None })
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

    /// The token is cookie-only. A query string carrying the *correct* token
    /// must not authorize anything — otherwise the secret would still be
    /// usable from access logs, `Referer` headers and browser history.
    #[test]
    fn rejects_a_correct_token_in_the_query_string() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(
            Box::new(DenyAll),
            "silverbullet_headless_a".into(),
            "secret".into(),
        );
        assert!(!a.is_authorized(&ctx(Some("headless=1&token=secret"), &h)));
        assert!(!a.is_authorized(&ctx(Some("token=secret"), &h)));
    }

    #[test]
    fn rejects_wrong_or_missing_cookie_token() {
        let mut wrong = HeaderMap::new();
        wrong.insert(
            axum::http::header::COOKIE,
            axum::http::HeaderValue::from_static("silverbullet_headless_a=secretX"),
        );
        let a = HeadlessTokenAuthorizer::new(
            Box::new(DenyAll),
            "silverbullet_headless_a".into(),
            "secret".into(),
        );
        assert!(!a.is_authorized(&ctx(None, &wrong)));
        assert!(!a.is_authorized(&ctx(None, &HeaderMap::new())));
    }

    #[test]
    fn falls_through_to_inner_when_token_absent() {
        let h = HeaderMap::new();
        let a = HeadlessTokenAuthorizer::new(
            Box::new(AllowAll),
            "silverbullet_headless_a".into(),
            "secret".into(),
        );
        // No token, but inner allows → authorized.
        assert!(a.is_authorized(&ctx(None, &h)));
    }

    #[test]
    fn cookie_name_is_per_space() {
        assert_eq!(
            headless_cookie_name("2f6c1e0a-1111-2222-3333-444455556666"),
            "silverbullet_headless_2f6c1e0a-1111-2222-3333-444455556666"
        );
        assert_eq!(
            headless_cookie_name("single"),
            "silverbullet_headless_single"
        );
    }

    #[test]
    fn accepts_matching_cookie_token() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::COOKIE,
            axum::http::HeaderValue::from_static("silverbullet_headless_a=secret"),
        );
        let a = HeadlessTokenAuthorizer::new(
            Box::new(DenyAll),
            "silverbullet_headless_a".into(),
            "secret".into(),
        );
        assert!(a.is_authorized(&ctx(None, &h)));
    }

    /// The whole point of the per-space name: space B's cookie, riding along
    /// because a root-bound space set `Path=/`, must not authorize space A.
    #[test]
    fn rejects_another_spaces_cookie() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::COOKIE,
            axum::http::HeaderValue::from_static(
                "silverbullet_headless_b=b-token; silverbullet_headless_a=a-token",
            ),
        );
        let a = HeadlessTokenAuthorizer::new(
            Box::new(DenyAll),
            "silverbullet_headless_a".into(),
            "b-token".into(),
        );
        assert!(!a.is_authorized(&ctx(None, &h)));
    }

    #[test]
    fn empty_token_never_matches_cookie() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::COOKIE,
            axum::http::HeaderValue::from_static("silverbullet_headless_a="),
        );
        let a = HeadlessTokenAuthorizer::new(
            Box::new(DenyAll),
            "silverbullet_headless_a".into(),
            String::new(),
        );
        assert!(!a.is_authorized(&ctx(None, &h)));
    }
}
