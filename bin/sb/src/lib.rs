//! The SilverBullet `sb` command-line client.

/// Version string injected at build time from `version.json` (see build.rs).
pub const VERSION: &str = env!("SB_VERSION");

pub mod api;
pub mod browser_credentials;
pub mod cli;
pub mod commands;
pub mod config;
pub mod conn;
pub mod device_auth;
pub mod fs_api;
pub mod fs_cli;
pub mod fs_edit;
mod fs_listing;
pub mod output;
pub mod run;

pub use silverbullet_server_common::crypto;
