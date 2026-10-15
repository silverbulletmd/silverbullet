//! Debug builds only: the e2e harness's tiny model (M2R27). The harness
//! writes `test-tiny`'s files with their sizes and hashes to
//! `$SB_SEARCH_TEST_MODEL_DIR/spec.json` and serves them from
//! `$SB_SEARCH_TEST_MODEL_URL`. The server binary calls [`install`] at
//! start and its service factory [`store`]; the catalog and the semantic
//! service know nothing of it. Release builds don't contain this module.

use super::catalog::{self, test_tiny, ModelSpec};
use super::download::ModelStore;

const ID: &str = "test-tiny";

/// Offers `test-tiny` ([`catalog::offer`]) when the harness wrote its
/// spec; otherwise nothing.
pub fn install() {
    if let Some(spec) = std::env::var_os("SB_SEARCH_TEST_MODEL_DIR")
        .and_then(|dir| read_spec(std::path::Path::new(&dir)))
    {
        catalog::offer(spec);
    }
}

/// `models`, downloading `spec`'s files from the harness's server instead
/// of Hugging Face when it serves them (`test-tiny` only).
pub fn store(spec: &ModelSpec, models: ModelStore) -> ModelStore {
    match std::env::var("SB_SEARCH_TEST_MODEL_URL") {
        Ok(base) if spec.id == ID => models.with_base_url(base),
        _ => models,
    }
}

/// `test-tiny` with the sizes and hashes in `<dir>/spec.json`; `None` when
/// the file is missing or doesn't name every file.
fn read_spec(dir: &std::path::Path) -> Option<ModelSpec> {
    #[derive(serde::Deserialize)]
    struct File {
        name: String,
        size: u64,
        sha256: String,
    }
    #[derive(serde::Deserialize)]
    struct Spec {
        files: Vec<File>,
    }
    let raw = std::fs::read(dir.join("spec.json")).ok()?;
    let written: Spec = serde_json::from_slice(&raw).ok()?;
    let mut spec = test_tiny();
    for file in &mut spec.files {
        let found = written.files.iter().find(|f| f.name == file.name)?;
        file.size = found.size;
        file.sha256 = found.sha256.clone();
    }
    Some(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spec_file_names_the_tiny_models_files() {
        let dir = tempfile::tempdir().unwrap();
        let spec = crate::semantic::test_model::write_tiny_model(dir.path(), 7);
        let files: Vec<_> = spec
            .files
            .iter()
            .map(|f| serde_json::json!({"name": f.name, "size": f.size, "sha256": f.sha256}))
            .collect();
        let json = serde_json::json!({ "files": files }).to_string();
        std::fs::write(dir.path().join("spec.json"), json).unwrap();
        assert_eq!(read_spec(dir.path()), Some(spec));
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_spec(empty.path()), None);
    }
}
