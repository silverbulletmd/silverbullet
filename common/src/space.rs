//! `SpacePrimitives` implementations and composition wrappers.

pub mod disk;
pub mod embed;
pub mod http;

pub use disk::DiskSpacePrimitives;
pub use embed::{EmptySpacePrimitives, FallthroughSpacePrimitives, ReadOnlyDirSpacePrimitives};
pub use http::HttpSpacePrimitives;

#[cfg(any(test, feature = "testing"))]
pub mod memory;
#[cfg(any(test, feature = "testing"))]
pub use memory::MemorySpacePrimitives;

/// Shared conformance suite every writable `SpacePrimitives` impl can run.
#[cfg(any(test, feature = "testing"))]
pub mod conformance;
