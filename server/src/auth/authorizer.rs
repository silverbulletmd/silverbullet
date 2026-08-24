use axum::http::{HeaderMap, Method};

/// The information an authorizer may inspect about an incoming request.
pub struct AuthContext<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
}

pub struct AuthOutcome {
    pub username: Option<String>,
}

pub trait RequestAuthorizer: Send + Sync {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome>;

    /// Convenience for call sites that only need pass/fail, not the verified
    /// identity.
    fn is_authorized(&self, ctx: &AuthContext) -> bool {
        self.authorize(ctx).is_some()
    }
}

#[derive(Debug, Clone, Default)]
pub struct Actor {
    pub username: Option<String>,
    pub full_name: Option<String>,
    pub email: Option<String>,
}
