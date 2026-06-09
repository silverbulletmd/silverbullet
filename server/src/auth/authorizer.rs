use axum::http::{HeaderMap, Method};

/// The information an authorizer may inspect about an incoming request.
pub struct AuthContext<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
}

/// Pluggable authentication strategy. The router consults this for protected
/// routes only; returning `false` yields a 401. Different deployments provide
/// different implementations (e.g. a standalone server uses JWT/bearer; an
/// embedding application uses its own token scheme).
pub trait RequestAuthorizer: Send + Sync {
    fn is_authorized(&self, ctx: &AuthContext) -> bool;
}
