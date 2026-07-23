//! The standalone SilverBullet server library. The `silverbullet` binary
//! (`src/main.rs`) is a thin CLI wrapper over this crate.
//!
//! A library target is required so the `tests/smoke.rs` integration test can
//! link against [`server::run`] (integration tests can only reach a crate's lib
//! target, not its `[[bin]]`).

pub mod boot;
pub mod config;
pub mod embed;
pub mod multi;
pub mod server;
pub mod single;

/// The product version, injected at build time from `version.ts`.
pub const VERSION: &str = env!("SB_VERSION");

/// Content seeded into a brand-new empty space's index page
pub const DEFAULT_INDEX_MD: &str = include_str!("../space_template/index.md");
