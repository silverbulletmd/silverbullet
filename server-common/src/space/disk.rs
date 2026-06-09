use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ignore::gitignore::GitignoreBuilder;
use walkdir::WalkDir;

use crate::types::{FileMeta, SpaceError, SpacePrimitives};

/// Filesystem-backed SpacePrimitives over a space folder on disk.
pub struct DiskSpacePrimitives {
    root_path: PathBuf,
    gitignore_patterns: String,
}

impl DiskSpacePrimitives {
    pub fn new(root_path: impl AsRef<Path>, gitignore: &str) -> Result<Self, SpaceError> {
        let root = root_path.as_ref().canonicalize().map_err(|e| {
            SpaceError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("failed to resolve root path: {e}"),
            ))
        })?;

        if !root.is_dir() {
            return Err(SpaceError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no such directory",
            )));
        }

        Ok(Self {
            root_path: root,
            gitignore_patterns: gitignore.to_string(),
        })
    }

    /// Resolve a request path to an absolute filesystem path under the space
    /// root, enforcing *lexical* containment only: absolute paths and `..`
    /// components are rejected so the request string itself can't escape the
    /// space.
    ///
    /// Symlinks are deliberately NOT resolved or blocked: linking an external
    /// file or folder into a space (e.g. `~/notes/shared -> /shared/docs`) is a
    /// supported workflow, so the OS follows symlinks on read/write as usual.
    pub fn safe_path(&self, path: &str) -> Result<PathBuf, SpaceError> {
        let clean = Path::new(path);

        // Reject absolute paths.
        if clean.is_absolute() {
            return Err(SpaceError::PathOutsideRoot);
        }

        // Reject any `..` component — lexical traversal in the request itself.
        for component in clean.components() {
            if matches!(component, std::path::Component::ParentDir) {
                return Err(SpaceError::PathOutsideRoot);
            }
        }

        Ok(self.root_path.join(clean))
    }

    /// Convert an absolute path back to a relative forward-slash path.
    fn path_to_filename(&self, full_path: &Path) -> String {
        let rel = full_path.strip_prefix(&self.root_path).unwrap_or(full_path);
        rel.to_string_lossy().replace('\\', "/")
    }

    /// Build FileMeta from filesystem metadata.
    fn file_info_to_meta(&self, name: &str, metadata: &fs::Metadata) -> FileMeta {
        // `created()` reads btime, which is unavailable on NFS, many SMB/CIFS
        // mounts, tmpfs, and overlayfs (statx reports it unsupported). Fall back
        // to mtime there so `created` is a sane non-zero value rather than the
        // 1970 epoch. (`modified()` is `st_mtime`, present on every real FS.)
        let created = metadata
            .created()
            .ok()
            .or_else(|| metadata.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let last_modified = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        FileMeta {
            name: name.to_string(),
            created,
            last_modified,
            content_type: lookup_content_type(name),
            size: metadata.len() as i64,
            perm: "rw".to_string(),
        }
    }

    /// Build a gitignore matcher combining the configured space-ignore
    /// patterns with any `.gitignore` file in the space root.
    fn build_gitignore(&self) -> Option<ignore::gitignore::Gitignore> {
        let mut builder = GitignoreBuilder::new(&self.root_path);
        let mut has_pattern = false;
        for line in self.gitignore_patterns.lines() {
            let line = line.trim();
            if !line.is_empty() {
                let _ = builder.add_line(None, line);
                has_pattern = true;
            }
        }
        let dot_gitignore = self.root_path.join(".gitignore");
        if dot_gitignore.is_file() && builder.add(&dot_gitignore).is_none() {
            has_pattern = true;
        }
        if !has_pattern {
            return None;
        }
        builder.build().ok()
    }

    /// Remove empty parent directories up to (but not including) root_path.
    fn clean_orphaned(&self, deleted_file: &Path) {
        let mut current = deleted_file.parent().map(Path::to_path_buf);
        while let Some(dir) = current {
            if dir == self.root_path || !dir.starts_with(&self.root_path) {
                break;
            }
            if fs::remove_dir(&dir).is_err() {
                // Directory not empty or other error — stop
                break;
            }
            current = dir.parent().map(Path::to_path_buf);
        }
    }
}

impl SpacePrimitives for DiskSpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let gitignore = self.build_gitignore();
        let mut files = Vec::new();

        let root_path = self.root_path.clone();
        let gi_for_filter = gitignore.clone();
        for entry in WalkDir::new(&self.root_path)
            .follow_links(true)
            .into_iter()
            .filter_entry(move |e| {
                // Skip hidden directories at traversal time
                if e.file_type().is_dir() && e.file_name().to_string_lossy().starts_with('.') {
                    // Allow the root directory itself (which may start with .)
                    return e.depth() == 0;
                }
                // Prune ignored directories so we don't recurse into them
                if let Some(ref gi) = gi_for_filter {
                    if e.depth() > 0 && e.file_type().is_dir() {
                        let rel = e.path().strip_prefix(&root_path).unwrap_or(e.path());
                        if gi.matched(rel, true).is_ignore() {
                            return false;
                        }
                    }
                }
                true
            })
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            // Skip directories
            if entry.file_type().is_dir() {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy();

            // Skip hidden files
            if file_name.starts_with('.') {
                continue;
            }

            let relative = self.path_to_filename(path);

            // Skip files without extensions
            if Path::new(&relative).extension().is_none() {
                continue;
            }

            // Apply gitignore (check the file path and all parent directories)
            if let Some(ref gi) = gitignore {
                if gi.matched_path_or_any_parents(&relative, false).is_ignore() {
                    continue;
                }
            }

            if let Ok(metadata) = entry.metadata() {
                files.push(self.file_info_to_meta(&relative, &metadata));
            }
        }

        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        let local_path = self.safe_path(path)?;
        let metadata = fs::metadata(&local_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound || is_syntax_error(&e) {
                SpaceError::NotFound
            } else {
                SpaceError::Io(e)
            }
        })?;
        Ok(self.file_info_to_meta(path, &metadata))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        let local_path = self.safe_path(path)?;
        let metadata = fs::metadata(&local_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound || is_syntax_error(&e) {
                SpaceError::NotFound
            } else {
                SpaceError::Io(e)
            }
        })?;
        let data = fs::read(&local_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                SpaceError::NotFound
            } else {
                SpaceError::Io(e)
            }
        })?;
        Ok((data, self.file_info_to_meta(path, &metadata)))
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let local_path = self.safe_path(path)?;

        // Ensure parent directory exists
        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| SpaceError::WriteError(format!("{path}: {e}")))?;
        }

        // Write file
        fs::write(&local_path, data).map_err(|e| SpaceError::WriteError(format!("{path}: {e}")))?;

        // Set modification time if provided
        if let Some(m) = meta {
            if m.last_modified > 0 {
                let mtime = filetime::FileTime::from_unix_time(
                    m.last_modified / 1000,
                    ((m.last_modified % 1000) * 1_000_000) as u32,
                );
                let _ = filetime::set_file_mtime(&local_path, mtime);
            }
        }

        self.get_file_meta(path)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        let local_path = self.safe_path(path)?;
        fs::remove_file(&local_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                SpaceError::NotFound
            } else {
                SpaceError::Io(e)
            }
        })?;
        self.clean_orphaned(&local_path);
        Ok(())
    }
}

/// Determine MIME type from file extension.
pub fn lookup_content_type(path: &str) -> String {
    // Custom mappings (override mime_guess defaults)
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "md" => "text/markdown".to_string(),
        "heic" | "heif" => "image/heic".to_string(),
        _ => mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string(),
    }
}

/// Check if an IO error is due to invalid filename syntax (e.g., colons on some OSes).
fn is_syntax_error(err: &std::io::Error) -> bool {
    let msg = err.to_string();
    msg.contains("syntax is incorrect")
        || msg.contains("syntax incorrect")
        || msg.contains("invalid argument")
        || msg.contains("bad file descriptor")
}

#[cfg(test)]
mod plan_tests {
    use super::*;
    use crate::types::SpacePrimitives;
    use tempfile::tempdir;

    #[test]
    fn write_read_list_delete_roundtrip() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();

        sp.write_file("notes/a.md", b"hello", None).unwrap();
        let (data, meta) = sp.read_file("notes/a.md").unwrap();
        assert_eq!(data, b"hello");
        assert_eq!(meta.name, "notes/a.md");

        let list = sp.fetch_file_list().unwrap();
        assert!(list.iter().any(|m| m.name == "notes/a.md"));

        sp.delete_file("notes/a.md").unwrap();
        assert!(matches!(
            sp.read_file("notes/a.md"),
            Err(crate::types::SpaceError::NotFound) | Err(crate::types::SpaceError::Io(_))
        ));
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        assert!(matches!(
            sp.read_file("../escape.md"),
            Err(crate::types::SpaceError::PathOutsideRoot)
        ));
    }

    #[test]
    fn timestamps_are_nonzero() {
        // Guards the `created`/`last_modified` epoch (1970) regression: both must
        // be populated for a freshly written file. On filesystems without btime,
        // `created` comes from the mtime fallback rather than 0.
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        let meta = sp.write_file("a.md", b"x", None).unwrap();
        assert!(meta.last_modified > 0, "last_modified should be set");
        assert!(
            meta.created > 0,
            "created should be set (mtime fallback when btime is unavailable)"
        );
    }

    #[test]
    fn passes_read_write_conformance() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        crate::space::conformance::run_read_write_conformance(&sp);
    }
}

/// Tree-walk behavior around symlinks and unreadable directories. Unix-only:
/// relies on `std::os::unix` symlink + permission APIs. Mirrors the behavior of
/// the previous `fastwalk`-based walker (follow symlinks; skip-and-continue on
/// errors; terminate on cycles).
#[cfg(all(test, unix))]
mod unix_walk_tests {
    use super::*;
    use crate::types::SpacePrimitives;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    fn names(sp: &DiskSpacePrimitives) -> Vec<String> {
        let mut v: Vec<String> = sp
            .fetch_file_list()
            .unwrap()
            .into_iter()
            .map(|m| m.name)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn symlink_to_in_space_file_is_listed() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.write_file("a.md", b"hello", None).unwrap();
        symlink("a.md", dir.path().join("b.md")).unwrap(); // b.md -> a.md (in-space)
        let n = names(&sp);
        assert!(n.contains(&"a.md".to_string()));
        assert!(
            n.contains(&"b.md".to_string()),
            "symlink to an in-space file should be followed and listed: {n:?}"
        );
    }

    #[test]
    fn symlink_to_in_space_dir_contents_listed() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.write_file("sub/c.md", b"hi", None).unwrap();
        symlink("sub", dir.path().join("link")).unwrap(); // link -> sub (in-space dir)
        let n = names(&sp);
        assert!(n.contains(&"sub/c.md".to_string()));
        assert!(
            n.contains(&"link/c.md".to_string()),
            "contents under a followed dir-symlink should be listed: {n:?}"
        );
    }

    #[test]
    fn broken_symlink_is_skipped() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.write_file("real.md", b"x", None).unwrap();
        symlink("does-not-exist.md", dir.path().join("dangling.md")).unwrap();
        let n = names(&sp);
        assert!(n.contains(&"real.md".to_string()));
        assert!(
            !n.contains(&"dangling.md".to_string()),
            "a dangling symlink must be skipped, not surfaced or errored: {n:?}"
        );
    }

    #[test]
    fn symlink_loop_terminates() {
        // A directory symlink cycle must not hang the walk; walkdir cuts it via
        // dev/ino loop detection and the non-looping content is still listed.
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        std::fs::create_dir(dir.path().join("d")).unwrap();
        sp.write_file("d/x.md", b"x", None).unwrap();
        symlink(dir.path().join("d"), dir.path().join("d/loop")).unwrap(); // d/loop -> d
        let n = names(&sp);
        assert!(
            n.contains(&"d/x.md".to_string()),
            "walk must terminate and still list non-looping content: {n:?}"
        );
    }

    #[test]
    fn symlink_to_outside_file_is_listed_and_readable() {
        // Linking an external file into a space is supported: it must be both
        // listed and readable (the OS follows the link on read).
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("external.md"), b"external content").unwrap();

        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.write_file("inside.md", b"x", None).unwrap();
        // ext.md -> /outside/external.md (absolute target, outside the space)
        symlink(
            outside.path().join("external.md"),
            dir.path().join("ext.md"),
        )
        .unwrap();

        let n = names(&sp);
        assert!(
            n.contains(&"ext.md".to_string()),
            "an outside-pointing symlink should be listed: {n:?}"
        );

        let (data, _meta) = sp.read_file("ext.md").unwrap();
        assert_eq!(data, b"external content", "must read through the symlink");
    }

    #[test]
    fn symlink_to_outside_dir_contents_listed_and_readable() {
        // Linking an external folder into a space is supported too.
        let outside = tempdir().unwrap();
        std::fs::create_dir(outside.path().join("shared")).unwrap();
        std::fs::write(outside.path().join("shared/doc.md"), b"shared doc").unwrap();

        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        // shared -> /outside/shared (external directory)
        symlink(outside.path().join("shared"), dir.path().join("shared")).unwrap();

        let n = names(&sp);
        assert!(
            n.contains(&"shared/doc.md".to_string()),
            "contents under an external dir-symlink should be listed: {n:?}"
        );

        let (data, _meta) = sp.read_file("shared/doc.md").unwrap();
        assert_eq!(data, b"shared doc");
    }

    #[test]
    fn permission_denied_dir_is_skipped() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.write_file("visible.md", b"x", None).unwrap();
        sp.write_file("secret/hidden.md", b"x", None).unwrap();
        let secret = dir.path().join("secret");
        std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = sp.fetch_file_list();
        // Restore perms before asserting so tempdir cleanup always succeeds.
        let _ = std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o755));

        let list = result.expect("walk must not fail on an unreadable subdirectory");
        let listed: Vec<_> = list.iter().map(|m| m.name.as_str()).collect();
        assert!(
            listed.contains(&"visible.md"),
            "accessible sibling files are still listed: {listed:?}"
        );
        // (When tests run as root, permission bits are ignored and the secret
        // file may appear; we assert only the robust skip-and-continue invariant.)
    }
}
