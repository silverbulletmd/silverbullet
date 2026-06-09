//! Headless-Chrome `ClientTransport` for the standalone SilverBullet server:
//! drives a real browser running the normal client in `?headless` mode so the
//! server can evaluate Space Lua and answer the objects API.

mod config;
mod supervisor;
mod transport;

pub use config::{find_chrome, ChromeConfig};
pub use transport::ChromeTransport;
