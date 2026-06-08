//! The SilverBullet `sb` command-line client.

/// Version string injected at build time from `public_version.ts` (see build.rs).
pub const VERSION: &str = env!("SB_VERSION");

pub mod api;
pub mod cli;
pub mod commands;
pub mod config;
pub mod conn;
pub mod crypto;
pub mod output;
pub mod run;
