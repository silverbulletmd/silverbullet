//! Semantic (embedding based) search backend.

pub mod backend;
mod budget;
pub mod catalog;
pub mod chunk;
pub mod download;
#[cfg(debug_assertions)]
pub mod e2e;
pub mod embed;
#[cfg(any(test, feature = "eval"))]
pub mod eval;
mod fs_private;
pub mod index;
pub mod inference;
pub mod lease;
pub mod models;
pub mod service;
pub mod sink;
pub mod size;
pub mod store;
#[cfg(any(test, feature = "test-model"))]
pub mod test_model;
#[cfg(any(test, feature = "test-model"))]
pub mod test_server;

pub use backend::{NaturalCandidates, SemanticBackend};
pub use service::{SemanticService, SemanticSpace};
