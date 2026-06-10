//! Shared building blocks for the SilverBullet server and CLI: the
//! `SpacePrimitives` storage abstraction, its implementations, and the
//! associated data types.

pub mod crypto;
pub mod space;
pub mod types;

pub use types::{BootConfig, FileMeta, SpaceError, SpacePrimitives};
