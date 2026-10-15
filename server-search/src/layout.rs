//! Where search keeps its files: one root (`<data>/search` on a multi-user
//! server, `<app data>/search` on Desktop) holding `indexes/<space id>/` and
//! `models/<id>@<revision>/`, and the schema directories the index stores
//! create inside a space's directory.

use std::path::{Path, PathBuf};

/// The semantic store's schema directory, named here rather than in the
/// feature-gated `semantic` module so that a build without that feature
/// still treats it as current (and never sweeps it as an old format).
pub(crate) const SEMANTIC_SCHEMA_DIR: &str = "semantic-v1";

/// The schema directories the current index stores write in a space's
/// directory; any other [`is_schema_dir`] name there is an old format.
pub const CURRENT_SCHEMA_DIRS: [&str; 2] = [crate::fulltext::SCHEMA_DIR, SEMANTIC_SCHEMA_DIR];

/// Whether `name` is a directory name an index store creates (or once
/// created) in a space's directory: `fulltext-v*` or `semantic-v*`.
pub fn is_schema_dir(name: &str) -> bool {
    name.starts_with("fulltext-v") || name.starts_with("semantic-v")
}

/// The directory holding everything search stores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchRoot(PathBuf);

impl SearchRoot {
    pub fn new(dir: impl Into<PathBuf>) -> SearchRoot {
        SearchRoot(dir.into())
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// `<root>/indexes`: one directory per space id.
    pub fn indexes(&self) -> PathBuf {
        self.0.join("indexes")
    }

    /// `<root>/models`: one directory per model revision (see
    /// `semantic::catalog::ModelSpec::dir_name`).
    pub fn models(&self) -> PathBuf {
        self.0.join("models")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_root_holds_indexes_and_models() {
        let root = SearchRoot::new("/data/search");
        assert_eq!(root.indexes(), Path::new("/data/search/indexes"));
        assert_eq!(root.models(), Path::new("/data/search/models"));
    }

    #[test]
    fn schema_dirs_are_the_stores_names() {
        for name in CURRENT_SCHEMA_DIRS {
            assert!(is_schema_dir(name), "{name}");
        }
        assert!(is_schema_dir("fulltext-v1") && is_schema_dir("semantic-v0"));
        assert!(!is_schema_dir("notes") && !is_schema_dir("fulltext"));
    }
}
