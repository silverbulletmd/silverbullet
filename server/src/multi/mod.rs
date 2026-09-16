//! Multi-space server mode: N spaces served from one process, each bound to a
//! URL prefix or hostname, configured via `spaces.json` and managed through
//! the `/.dashboard` UI. See docs/Dashboard.md.

pub mod access;
pub mod admin_api;
pub mod config;
pub mod dashboard;
pub mod dispatch;
pub mod git_connection;
pub mod instance;
pub mod manager;
pub mod policy;
pub mod registry;
pub mod server_config;
pub mod setup;
pub mod setup_api;
pub mod users;
pub mod validate;
