//! The SilverBullet `sb` command-line client.

/// Version string injected at build time from `public_version.ts` (see build.rs).
pub const VERSION: &str = env!("SB_VERSION");

pub mod cli;
pub mod crypto;
