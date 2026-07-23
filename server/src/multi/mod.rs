//! Multi-space server mode: N spaces served from one process, each bound to a
//! URL prefix or hostname, configured via `spaces.json` and managed through
//! the `/.spaces` UI. See docs/Space Manager.md.

pub mod access;
pub mod admin_api;
pub mod config;
pub mod dispatch;
pub mod instance;
pub mod manager;
pub mod registry;
pub mod setup;
pub mod setup_api;
pub mod space_index;
pub mod users;
pub mod validate;
