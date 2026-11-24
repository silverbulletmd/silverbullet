//! In-memory `SpacePrimitives` for tests in this crate and downstream crates.
//! Enabled via the `testing` feature.

use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

use crate::space::conditional::ConditionalSpacePrimitives;
use crate::types::{is_in_folder, parent_folders, FileMeta, Listing, SpaceError, SpacePrimitives};

#[derive(Default)]
pub struct MemorySpacePrimitives {
    files: Mutex<HashMap<String, (Vec<u8>, FileMeta)>>,
    /// Every folder, like a file system's: created by writes and
    /// `create_folder`, removed only by `delete_folder`.
    folders: Mutex<BTreeSet<String>>,
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
        self.folders
            .lock()
            .unwrap()
            .extend(parent_folders(path).map(str::to_string));
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

    fn fetch_listing(&self) -> Result<Listing, SpaceError> {
        Ok(Listing {
            files: self.fetch_file_list()?,
            folders: Some(self.folders.lock().unwrap().iter().cloned().collect()),
        })
    }

    fn create_folder(&self, path: &str) -> Result<(), SpaceError> {
        let path = path.trim_matches('/');
        if path.is_empty() {
            return Err(SpaceError::PathOutsideRoot);
        }
        let mut folders = self.folders.lock().unwrap();
        folders.extend(parent_folders(path).map(str::to_string));
        folders.insert(path.to_string());
        Ok(())
    }

    fn delete_folder(&self, path: &str, recursive: bool) -> Result<(), SpaceError> {
        let path = path.trim_matches('/');
        let mut folders = self.folders.lock().unwrap();
        if !folders.contains(path) {
            return Err(SpaceError::NotFound);
        }
        let mut files = self.files.lock().unwrap();
        if recursive {
            files.retain(|name, _| !is_in_folder(name, path));
            folders.retain(|folder| !is_in_folder(folder, path));
        } else if folders.iter().any(|f| is_in_folder(f, path))
            || files.keys().any(|f| is_in_folder(f, path))
        {
            return Err(SpaceError::FolderNotEmpty);
        }
        folders.remove(path);
        Ok(())
    }
}

/// Unconditional, like any backend without revisions: lets a memory space
/// stand in for a sync remote in tests.
impl ConditionalSpacePrimitives for MemorySpacePrimitives {}

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

    #[test]
    fn passes_folder_conformance() {
        crate::space::conformance::run_folder_conformance(&MemorySpacePrimitives::new());
    }

    #[test]
    fn passes_recursive_folder_delete_conformance() {
        crate::space::conformance::run_recursive_folder_delete_conformance(
            &MemorySpacePrimitives::new(),
        );
    }
}
