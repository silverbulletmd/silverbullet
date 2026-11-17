use axum::http::{HeaderMap, Method};

use crate::auth::access::AccessLevel;

/// The information an authorizer may inspect about an incoming request.
pub struct AuthContext<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub headers: &'a HeaderMap,
}

/// The verified result of an authorization attempt. `grant` is set only by
/// authorizers that carry their own authority, such as a headless or API token,
/// where there is no username for a policy to grade. `None` means "ask the
/// policy".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AuthOutcome {
    pub username: Option<String>,
    pub credential_version: Option<String>,
    pub grant: Option<AccessLevel>,
}

impl AuthOutcome {
    pub fn user(username: String) -> Self {
        Self {
            username: Some(username),
            credential_version: None,
            grant: None,
        }
    }

    pub fn with_version(mut self, version: Option<String>) -> Self {
        self.credential_version = version;
        self
    }

    pub fn anonymous() -> Self {
        Self::default()
    }

    pub fn trusted() -> Self {
        Self {
            username: None,
            credential_version: None,
            grant: Some(AccessLevel::Write),
        }
    }
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
    pub credential_version: Option<String>,
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub level: AccessLevel,
}
