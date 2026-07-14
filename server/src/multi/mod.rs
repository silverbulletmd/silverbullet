//! Multi-space server mode: N spaces served from one process, each bound to a
//! URL prefix, hostname, or dedicated port, configured via `spaces.json` and
//! managed through the `/.admin` UI. See docs/Multi-Space Mode.md.

pub mod admin_api;
pub mod config;
pub mod dispatch;
pub mod instance;
pub mod listeners;
pub mod manager;
pub mod registry;
pub mod validate;
