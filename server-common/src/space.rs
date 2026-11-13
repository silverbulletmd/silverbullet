//! `SpacePrimitives` implementations and composition wrappers.

pub mod case;
pub mod conditional;
pub mod config_migration;
pub mod disk;
pub mod embed;
pub mod http;
pub mod legacy_repositories;
pub mod readonly;

pub use conditional::{ConditionalSpacePrimitives, WritePrecondition};
pub use config_migration::{migrate_config_page, ConfigMigration};
pub use disk::{DiskSpacePrimitives, GitignoreMatcher};
pub use embed::{
    bundled_repositories, layer_perm, EmptySpacePrimitives, FallthroughSpacePrimitives,
    ReadOnlyDirSpacePrimitives, BUNDLED_COPY_ON_WRITE,
};
pub use http::HttpSpacePrimitives;
pub use legacy_repositories::remove_legacy_repository_pages;
pub use readonly::ReadOnlySpacePrimitives;

#[cfg(any(test, feature = "testing"))]
pub mod memory;
#[cfg(any(test, feature = "testing"))]
pub use memory::MemorySpacePrimitives;

/// Shared conformance suite every writable `SpacePrimitives` impl can run.
#[cfg(any(test, feature = "testing"))]
pub mod conformance;
