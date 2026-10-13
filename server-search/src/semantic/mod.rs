//! Semantic (embedding based) search backend.

pub mod catalog;
pub mod chunk;
pub mod download;
pub mod embed;
pub mod models;
#[cfg(any(test, feature = "test-model"))]
pub mod test_model;
