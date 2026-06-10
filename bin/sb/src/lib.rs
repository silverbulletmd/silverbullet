//! The SilverBullet `sb` command-line client.

/// Version string injected at build time from `public_version.ts` (see build.rs).
pub const VERSION: &str = env!("SB_VERSION");

pub mod api;
pub mod cli;
pub mod commands;
pub mod config;
pub mod conn;
pub mod output;
pub mod run;

// Credential crypto lives in server-common so the desktop App and this CLI
// share one implementation of the on-disk format; re-exported here so
// `crate::crypto` keeps working.
pub use silverbullet_server_common::crypto;
