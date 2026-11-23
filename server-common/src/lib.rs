//! Shared building blocks for the SilverBullet server and CLI: the
//! `SpacePrimitives` storage abstraction, its implementations, and the
//! associated data types.

pub mod crypto;
pub mod git_starting_point;
pub mod http_client;
pub mod reconcile;
pub mod revision;
pub mod space;
pub mod starter_kits;
pub mod types;
pub mod upgrade;

pub use types::{BootConfig, FileMeta, RevisionsMode, SpaceError, SpacePrimitives};

pub mod page;
