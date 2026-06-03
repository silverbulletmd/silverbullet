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

pub use authenticator::Authenticator;
pub use authorizer::{AuthContext, RequestAuthorizer};
pub use config::AuthConfig;
pub use cookie::{auth_cookie_name, is_secure_request, request_host, CookieOptions};
pub use headless_token::HeadlessTokenAuthorizer;
pub use jwt_authorizer::JwtAuthorizer;
pub use lockout::LockoutTimer;
pub use login::LoginManager;
