//! In-memory `SpacePrimitives` for tests in this crate and downstream crates.
//! Enabled via the `testing` feature.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::types::{FileMeta, SpaceError, SpacePrimitives};

#[derive(Default)]
pub struct MemorySpacePrimitives {
    files: Mutex<HashMap<String, (Vec<u8>, FileMeta)>>,
}

impl MemorySpacePrimitives {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SpacePrimitives for MemorySpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        Ok(self
            .files
            .lock()
            .unwrap()
            .values()
            .map(|(_, m)| m.clone())
            .collect())
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.files
            .lock()
            .unwrap()
            .get(path)
            .map(|(_, m)| m.clone())
            .ok_or(SpaceError::NotFound)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.files
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .ok_or(SpaceError::NotFound)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let now = chrono::Utc::now().timestamp_millis();
        let meta = FileMeta {
            name: path.to_string(),
            created: meta.map(|m| m.created).unwrap_or(now),
            last_modified: meta.map(|m| m.last_modified).unwrap_or(now),
            content_type: mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string(),
            size: data.len() as i64,
            perm: "rw".to_string(),
        };
        self.files
            .lock()
            .unwrap()
            .insert(path.to_string(), (data.to_vec(), meta.clone()));
        Ok(meta)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        self.files
            .lock()
            .unwrap()
            .remove(path)
            .map(|_| ())
            .ok_or(SpaceError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SpacePrimitives;

    #[test]
    fn roundtrip() {
        let sp = MemorySpacePrimitives::new();
        sp.write_file("a.md", b"x", None).unwrap();
        let (data, meta) = sp.read_file("a.md").unwrap();
        assert_eq!(data, b"x");
        assert_eq!(meta.name, "a.md");
        assert_eq!(meta.size, 1);
        assert_eq!(sp.fetch_file_list().unwrap().len(), 1);
        sp.delete_file("a.md").unwrap();
        assert!(matches!(
            sp.read_file("a.md"),
            Err(crate::types::SpaceError::NotFound)
        ));
    }

    #[test]
    fn passes_read_write_conformance() {
        let sp = MemorySpacePrimitives::new();
        crate::space::conformance::run_read_write_conformance(&sp);
    }
}
