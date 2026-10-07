//! Headless-Chrome `ClientTransport` for the standalone SilverBullet server:
//! drives a real browser running the normal client in `?headless` mode so the
//! server can evaluate Space Lua and answer the objects API.

mod config;
mod metrics;
mod pool;
mod supervisor;

pub use config::{find_chrome, is_system_browser, ChromeConfig, RuntimeUnavailable, SpacePage};
pub use pool::{ChromePool, SharedChromeTransport};
