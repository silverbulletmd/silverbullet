//! Authentication core: environment-driven configuration, a brute-force
//! lockout timer, and a JWT issuer/verifier whose signing secret is persisted
//! in `.silverbullet.auth.json` within the space folder. Self-contained — it is
//! configured only from environment variables and that file.

pub mod authenticator;
pub mod authorizer;
pub mod config;
pub mod jwt_authorizer;
pub mod lockout;

pub use authenticator::Authenticator;
pub use authorizer::{AuthContext, RequestAuthorizer};
pub use config::AuthConfig;
pub use jwt_authorizer::JwtAuthorizer;
pub use lockout::LockoutTimer;
