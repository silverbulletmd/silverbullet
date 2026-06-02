use std::path::{Path, PathBuf};
use std::time::SystemTime;

use walkdir::WalkDir;

use super::disk::lookup_content_type;
use crate::types::{FileMeta, SpaceError, SpacePrimitives};

/// Compile-time build timestamp (unix millis), injected by build.rs.
/// Used as the constant lastModified for every file in this read-only space.
const BUILD_TIMESTAMP_MILLIS_STR: &str = env!("SB_BUILD_TIMESTAMP_MILLIS");

fn build_timestamp_millis() -> i64 {
    // The `unwrap_or(1)` is paranoia: build.rs always emits a valid integer.
    // Crucially we must never return `0`, which Core's `EventedSpacePrimitives`
    // historically treated as "no prior hash" and re-fired file:changed for
    // on every listing — kicking off a reload loop.
    BUILD_TIMESTAMP_MILLIS_STR.parse().unwrap_or(1)
}

/// Read-only SpacePrimitives backed by a directory on disk.
/// Used to serve the client bundle and base_fs.
pub struct ReadOnlyDirSpacePrimitives {
    root_path: PathBuf,
    fixed_mtime: i64,
}

impl ReadOnlyDirSpacePrimitives {
    pub fn new(root_path: impl AsRef<Path>) -> Result<Self, SpaceError> {
        let root = root_path.as_ref().to_path_buf();
        if !root.is_dir() {
            return Err(SpaceError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("no such directory: {}", root.display()),
            )));
        }
        // Use the build timestamp as a fixed mtime for all files: stable per
        // binary, never 0. Previously we read the bundle dir's mtime from
        // disk, but inside a Flatpak (OSTree) mount that's 0, which exposed a
        // client bug (see BUILD_TIMESTAMP_MILLIS_STR docs).
        let fixed_mtime = build_timestamp_millis();
        Ok(Self {
            root_path: root,
            fixed_mtime,
        })
    }

    fn resolve_path(&self, path: &str) -> PathBuf {
        self.root_path.join(path)
    }
}

/// Plug files carry their actual on-disk mtime so Core's manifest cache
/// (keyed by `lastModified`) invalidates whenever a plug is rebuilt. All
/// other files keep the fixed root mtime to avoid re-indexing pages after
/// client-bundle rebuilds.
fn is_plug(path: &str) -> bool {
    path.ends_with(".plug.js")
}

fn file_mtime_millis(metadata: &std::fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

impl SpacePrimitives for ReadOnlyDirSpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let mut files = Vec::new();
        for entry in WalkDir::new(&self.root_path)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_dir() {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(&self.root_path)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            if let Ok(metadata) = entry.metadata() {
                let last_modified = if is_plug(&rel) {
                    file_mtime_millis(&metadata).unwrap_or(self.fixed_mtime)
                } else {
                    self.fixed_mtime
                };
                files.push(FileMeta {
                    name: rel.clone(),
                    created: self.fixed_mtime,
                    last_modified,
                    content_type: lookup_content_type(&rel),
                    size: metadata.len() as i64,
                    perm: "ro".to_string(),
                });
            }
        }
        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        let full = self.resolve_path(path);
        let metadata = std::fs::metadata(&full).map_err(|_| SpaceError::NotFound)?;
        let last_modified = if is_plug(path) {
            file_mtime_millis(&metadata).unwrap_or(self.fixed_mtime)
        } else {
            self.fixed_mtime
        };
        Ok(FileMeta {
            name: path.to_string(),
            created: self.fixed_mtime,
            last_modified,
            content_type: lookup_content_type(path),
            size: metadata.len() as i64,
            perm: "ro".to_string(),
        })
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        let full = self.resolve_path(path);
        let data = std::fs::read(&full).map_err(|_| SpaceError::NotFound)?;
        let meta = self.get_file_meta(path)?;
        Ok((data, meta))
    }

    fn write_file(
        &self,
        path: &str,
        _data: &[u8],
        _meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot write to read-only space: {path}"
        )))
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot delete from read-only space: {path}"
        )))
    }
}

/// Combines two SpacePrimitives: reads from primary first, falls through to secondary.
/// Used to layer base_fs on top of the user's space.
pub struct FallthroughSpacePrimitives {
    primary: Box<dyn SpacePrimitives>,
    fallback: Box<dyn SpacePrimitives>,
}

impl FallthroughSpacePrimitives {
    pub fn new(primary: Box<dyn SpacePrimitives>, fallback: Box<dyn SpacePrimitives>) -> Self {
        Self { primary, fallback }
    }
}

impl SpacePrimitives for FallthroughSpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let mut files = self.primary.fetch_file_list()?;
        let existing: std::collections::HashSet<String> =
            files.iter().map(|f| f.name.clone()).collect();
        let fallback_files = self.fallback.fetch_file_list()?;
        files.extend(
            fallback_files
                .into_iter()
                .filter(|f| !existing.contains(&f.name)),
        );
        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.primary
            .get_file_meta(path)
            .or_else(|_| self.fallback.get_file_meta(path))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.primary
            .read_file(path)
            .or_else(|_| self.fallback.read_file(path))
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        // Reject writes to paths that exist *only* in the read-only fallback
        // (e.g. base_fs or meta layer). If the path also exists in primary —
        // typically a stale shadow from before this guard landed, or a
        // user-edited override — the write is allowed so it overwrites the
        // shadow rather than getting permanently locked.
        if self.primary.get_file_meta(path).is_err() && self.fallback.get_file_meta(path).is_ok() {
            return Err(SpaceError::WriteError(format!(
                "Cannot write file {path}: read-only"
            )));
        }
        self.primary.write_file(path, data, meta)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        // Same read-only enforcement as write_file: only reject when the
        // path exists *only* in the fallback layer.
        if self.primary.get_file_meta(path).is_err() && self.fallback.get_file_meta(path).is_ok() {
            return Err(SpaceError::WriteError(format!(
                "Cannot delete file {path}: read-only"
            )));
        }
        self.primary.delete_file(path)
    }
}

/// A SpacePrimitives that contains no files. Used as a no-op fallback
/// when base_fs is missing.
#[derive(Default)]
pub struct EmptySpacePrimitives;

impl SpacePrimitives for EmptySpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        Ok(Vec::new())
    }
    fn get_file_meta(&self, _path: &str) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::NotFound)
    }
    fn read_file(&self, _path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        Err(SpaceError::NotFound)
    }
    fn write_file(
        &self,
        path: &str,
        _data: &[u8],
        _meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot write file {path}: read-only"
        )))
    }
    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot delete file {path}: read-only"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::disk::DiskSpacePrimitives;
    use tempfile::TempDir;

    fn make_disk(dir: &TempDir) -> Box<dyn SpacePrimitives> {
        Box::new(DiskSpacePrimitives::new(dir.path(), "").unwrap())
    }

    fn make_readonly_with_file(name: &str, contents: &[u8]) -> (TempDir, Box<dyn SpacePrimitives>) {
        let td = TempDir::new().unwrap();
        let full_path = td.path().join(name);
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&full_path, contents).unwrap();
        let p: Box<dyn SpacePrimitives> =
            Box::new(ReadOnlyDirSpacePrimitives::new(td.path()).unwrap());
        (td, p)
    }

    #[test]
    fn fallthrough_write_rejected_when_path_in_fallback() {
        let primary_td = TempDir::new().unwrap();
        let primary = make_disk(&primary_td);
        let (_fallback_td, fallback) = make_readonly_with_file("LIBRARY/foo.md", b"hi");
        let ft = FallthroughSpacePrimitives::new(primary, fallback);

        let err = ft
            .write_file("LIBRARY/foo.md", b"shadow", None)
            .unwrap_err();
        match err {
            SpaceError::WriteError(_) => {}
            other => panic!("expected WriteError, got {other:?}"),
        }
        assert!(!primary_td.path().join("LIBRARY/foo.md").exists());
    }

    #[test]
    fn fallthrough_write_allowed_for_fresh_path() {
        let primary_td = TempDir::new().unwrap();
        let primary = make_disk(&primary_td);
        let (_fallback_td, fallback) = make_readonly_with_file("LIBRARY/foo.md", b"hi");
        let ft = FallthroughSpacePrimitives::new(primary, fallback);

        ft.write_file("fresh.md", b"new", None).unwrap();
        assert!(primary_td.path().join("fresh.md").exists());
    }

    #[test]
    fn fallthrough_write_allowed_when_path_already_in_primary() {
        let primary_td = TempDir::new().unwrap();
        std::fs::write(primary_td.path().join("page.md"), b"v1").unwrap();
        let primary = make_disk(&primary_td);
        let (_fallback_td, fallback) = make_readonly_with_file("LIBRARY/foo.md", b"hi");
        let ft = FallthroughSpacePrimitives::new(primary, fallback);

        ft.write_file("page.md", b"v2", None).unwrap();
        let data = std::fs::read(primary_td.path().join("page.md")).unwrap();
        assert_eq!(data, b"v2");
    }

    #[test]
    fn fallthrough_delete_rejected_when_only_in_fallback() {
        let primary_td = TempDir::new().unwrap();
        let primary = make_disk(&primary_td);
        let (_fallback_td, fallback) = make_readonly_with_file("LIBRARY/foo.md", b"hi");
        let ft = FallthroughSpacePrimitives::new(primary, fallback);

        let err = ft.delete_file("LIBRARY/foo.md").unwrap_err();
        match err {
            SpaceError::WriteError(_) => {}
            other => panic!("expected WriteError, got {other:?}"),
        }
    }

    #[test]
    fn fallthrough_delete_allowed_when_path_in_primary() {
        let primary_td = TempDir::new().unwrap();
        std::fs::write(primary_td.path().join("page.md"), b"v1").unwrap();
        let primary = make_disk(&primary_td);
        let (_fallback_td, fallback) = make_readonly_with_file("LIBRARY/foo.md", b"hi");
        let ft = FallthroughSpacePrimitives::new(primary, fallback);

        ft.delete_file("page.md").unwrap();
        assert!(!primary_td.path().join("page.md").exists());
    }
}
