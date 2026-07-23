//! Authentication core: environment-driven configuration, a brute-force
//! lockout timer, and a JWT issuer/verifier whose signing secret is persisted
//! in `.silverbullet.auth.json` within the space folder. Self-contained — it is
//! configured only from environment variables and that file.

pub mod authenticator;
pub mod authorizer;
pub mod config;
pub mod cookie;
pub mod headless_token;
pub mod jwt_authorizer;
pub mod lockout;
pub mod login;
pub mod password;

pub use authenticator::{Authenticator, AUTH_FILE_NAME, MULTI_AUTH_FILE_NAME};
pub use authorizer::{AuthContext, RequestAuthorizer};
pub use config::AuthConfig;
pub use cookie::{
    auth_cookie_name, cookie_value, is_secure_request, request_host, scoped_auth_cookie_name,
    CookieOptions,
};
pub use headless_token::HeadlessTokenAuthorizer;
pub use jwt_authorizer::JwtAuthorizer;
pub use lockout::LockoutTimer;
pub use login::LoginManager;

/// Verifies a username/password pair against some backing credential store.
/// Lets `LoginManager` drive either the legacy single-user `AuthConfig` or a
/// multi-user `users.json`-backed store, without knowing which.
pub trait Credentials: Send + Sync {
    fn verify(&self, username: &str, password: &str) -> bool;
}

impl Credentials for AuthConfig {
    fn verify(&self, username: &str, password: &str) -> bool {
        self.authorize(username, password)
    }
}
