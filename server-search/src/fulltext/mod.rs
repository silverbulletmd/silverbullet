//! Full-text backend built on Tantivy (pure Rust).
//!
//! - `schema`: the index model, one document per page.
//! - `analysis`: analyzers and language detection, on `tokenizer` (letter
//!   and digit runs, CJK text as bigrams) and `script`.
//! - `query` and `passage`: query plans, and passages with highlights.
//! - `store`: the index on disk or in RAM, an [`crate::IndexSink`] the
//!   crate's sync worker keeps in step with storage.
//! - `backend`: [`FullTextBackend`], which ties them together.

mod analysis;
mod backend;
mod normalize;
mod passage;
mod query;
mod schema;
mod script;
pub(crate) mod store;
mod tokenizer;
mod words;

pub use backend::{FullTextBackend, Ranking};
pub(crate) use script::is_cjk_letter;
pub use store::{SCHEMA_DIR, WRITER_MEMORY};
