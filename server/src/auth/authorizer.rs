use axum::http::{HeaderMap, Method};

/// The information an authorizer may inspect about an incoming request.
pub struct AuthContext<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
}

/// What a successful authorization verified. `username` is `Some` for a
/// verified account -- a JWT cookie session, or an `Authorization: Bearer`
/// API token resolved to a specific user (e.g. `UserTokenAuthorizer`) -- and
/// `None` for an anonymous credential that authorizes without identifying a
/// person (the standalone server's static bearer token, a space's headless
/// token) per constraint 4.
pub struct AuthOutcome {
    pub username: Option<String>,
}

/// Pluggable authentication strategy. The router consults this for protected
/// routes only; returning `None` yields a 401. Different deployments provide
/// different implementations (e.g. a standalone server uses JWT/bearer; an
/// embedding application uses its own token scheme).
pub trait RequestAuthorizer: Send + Sync {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome>;

    /// Convenience for call sites that only need pass/fail, not the verified
    /// identity.
    fn is_authorized(&self, ctx: &AuthContext) -> bool {
        self.authorize(ctx).is_some()
    }
}

/// The verified identity of a protected-route request, threaded through
/// request extensions by `require_authorization`. Best-effort attribution
/// data — `username: None` whenever the request is open, unauthenticated, or
/// authorized by an anonymous credential (static bearer token, headless
/// token); `Some` for a verified account (see `AuthOutcome`).
#[derive(Debug, Clone, Default)]
pub struct Actor {
    pub username: Option<String>,
}
