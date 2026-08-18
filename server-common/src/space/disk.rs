use std::fs;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ignore::gitignore::GitignoreBuilder;
use walkdir::WalkDir;

use crate::space::case;
use crate::types::{FileMeta, SpaceError, SpacePrimitives};

/// A snapshot of a space's gitignore-style ignore rules, for checking whether
/// paths are visible without rebuilding the matcher on every call. See
/// [`DiskSpacePrimitives::gitignore_matcher`].
pub struct GitignoreMatcher(Option<ignore::gitignore::Gitignore>);

impl GitignoreMatcher {
    /// Whether `relative` (a forward-slash, space-relative path) is excluded,
    /// checking the path and all of its parent directories — the same check
    /// `fetch_file_list` applies to each candidate file.
    pub fn is_ignored(&self, relative: &str, is_dir: bool) -> bool {
        self.0
            .as_ref()
            .is_some_and(|gi| gi.matched_path_or_any_parents(relative, is_dir).is_ignore())
    }
}

/// The "is this a listed space file" rule shared by `fetch_file_list` and
/// `get_file_meta_if_listable`: not a directory, and has a file extension.
fn is_listable_file(is_dir: bool, relative: &str) -> bool {
    !is_dir && Path::new(relative).extension().is_some()
}

/// Filesystem-backed SpacePrimitives over a space folder on disk.
pub struct DiskSpacePrimitives {
    root_path: PathBuf,
    gitignore_patterns: String,
    /// Probed once at construction. When false, every case rule below is
    /// skipped and the backend behaves exactly as it always has.
    case_insensitive: bool,
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
            case_insensitive: case::detect_case_insensitive(&root),
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

    pub fn is_case_insensitive(&self) -> bool {
        self.case_insensitive
    }

    /// Lets tests exercise the case-sensitive path on a case-insensitive host.
    #[cfg(test)]
    pub(crate) fn force_case_insensitive(&mut self, value: bool) {
        self.case_insensitive = value;
    }

    /// Re-case an aliased on-disk entry to match the requested casing. Inert on
    /// case-sensitive filesystems, where a differently cased path simply
    /// doesn't resolve and creating a separate entry is correct.
    fn recase_to_requested(&self, path: &str) {
        if !self.case_insensitive {
            return;
        }
        let rel = Path::new(path);
        if let Ok(Some(actual)) = case::true_relative_path(&self.root_path, rel) {
            if actual.as_path() != rel {
                case::apply_recase(&case::plan_recase(&self.root_path, &actual, rel));
            }
            return;
        }
        // The leaf doesn't exist yet: a plain create, or the create half of a
        // rename whose delete already ran. The parent chain can still be
        // aliased, and without this the write lands inside the old-cased folder.
        let Some(parent) = rel.parent().filter(|p| !p.as_os_str().is_empty()) else {
            return;
        };
        if let Ok(Some(actual)) = case::true_relative_path(&self.root_path, parent) {
            if actual.as_path() != parent {
                case::apply_recase(&case::plan_recase(&self.root_path, &actual, parent));
            }
        }
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

    pub fn gitignore_matcher(&self) -> GitignoreMatcher {
        GitignoreMatcher(self.build_gitignore())
    }

    pub fn get_file_meta_if_listable(&self, path: &str) -> Result<Option<FileMeta>, SpaceError> {
        let local_path = self.safe_path(path)?;
        let metadata = fs::metadata(&local_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound || is_syntax_error(&e) {
                SpaceError::NotFound
            } else {
                SpaceError::Io(e)
            }
        })?;
        if !is_listable_file(metadata.is_dir(), path) {
            return Ok(None);
        }
        if self.is_stale_casing(path)? {
            return Ok(None);
        }
        Ok(Some(self.file_info_to_meta(path, &metadata)))
    }

    fn is_stale_casing(&self, path: &str) -> Result<bool, SpaceError> {
        if !self.case_insensitive {
            return Ok(false);
        }
        match case::true_relative_path(&self.root_path, Path::new(path)) {
            Ok(Some(actual)) => Ok(actual.to_string_lossy().replace('\\', "/") != path),
            Ok(None) => Ok(true),
            Err(e) => Err(SpaceError::Io(e)),
        }
    }

    /// Build a matcher from the configured space-ignore patterns. A
    /// `.gitignore` file in the space is deliberately *not* consulted: it's an
    /// ordinary space file that happens to be about git, not configuration for
    /// SilverBullet.
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
        if !has_pattern {
            return None;
        }
        builder.build().ok()
    }

    /// Walk every listable, non-ignored file (the same traversal and filters
    /// as `fetch_file_list`), stopping early when `visit` breaks.
    fn walk_listable<T>(
        &self,
        mut visit: impl FnMut(String, &walkdir::DirEntry) -> ControlFlow<T>,
    ) -> Option<T> {
        let matcher = self.gitignore_matcher();

        let root_path = self.root_path.clone();
        let gi_for_filter = matcher.0.clone();
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
            let is_dir = entry.file_type().is_dir();

            // Skip hidden files (hidden directories were already pruned above)
            if !is_dir && entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }

            let relative = self.path_to_filename(path);

            if !is_listable_file(is_dir, &relative) {
                continue;
            }

            // Apply gitignore (check the file path and all parent directories)
            if matcher.is_ignored(&relative, false) {
                continue;
            }

            if let ControlFlow::Break(value) = visit(relative, &entry) {
                return Some(value);
            }
        }
        None
    }

    /// Whether any listed file's name ends with `suffix`, without walking the
    /// whole space: stops at the first match.
    pub fn has_file_with_suffix(&self, suffix: &str) -> bool {
        self.walk_listable(|relative, _| {
            if relative.ends_with(suffix) {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            }
        })
        .is_some()
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
        let mut files = Vec::new();
        self.walk_listable::<()>(|relative, entry| {
            if let Ok(metadata) = entry.metadata() {
                files.push(self.file_info_to_meta(&relative, &metadata));
            }
            ControlFlow::Continue(())
        });
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

        // Without this, a case-insensitive filesystem truncates the aliased
        // entry but keeps its old name, so the rename never lands.
        self.recase_to_requested(path);

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

        // The sync engine emits create and delete as independent, unordered
        // operations, so without this guard a delete addressed to a stale
        // casing destroys the file that now lives under the new casing.
        //
        // Reports success rather than NotFound on purpose: the client's
        // `deleteFile` throws on any non-200 and `syncFile` calls it unguarded,
        // so a 404 here would abort the whole sync round.
        if self.case_insensitive {
            let rel = Path::new(path);
            match case::true_relative_path(&self.root_path, rel) {
                Ok(Some(actual)) if actual.as_path() != rel => return Ok(()),
                Ok(_) => {}
                // Falling through to a real delete here would unlink whatever
                // this path aliases, which may be the file a paired write just
                // re-cased. A failed sync round is recoverable; a lost page is
                // not.
                Err(e) => return Err(SpaceError::Io(e)),
            }
        }

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
    fn has_file_with_suffix_matches_fetch_file_list_semantics() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "ignored.md").unwrap();

        assert!(!sp.has_file_with_suffix(".md"));

        sp.write_file("ignored.md", b"x", None).unwrap();
        sp.write_file(".hidden.md", b"x", None).unwrap();
        assert!(!sp.has_file_with_suffix(".md"));

        sp.write_file("notes/deep/a.md", b"x", None).unwrap();
        assert!(sp.has_file_with_suffix(".md"));
        assert!(!sp.has_file_with_suffix(".txt"));
    }

    #[test]
    fn dot_gitignore_in_the_space_is_not_applied() {
        // Regression (#2074): a `.gitignore` in the space root is a user's git
        // config, not SilverBullet's — only SB_SPACE_IGNORE/spaceIgnore hides
        // files. Its own name still starts with a dot, so it stays unlisted.
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "Library/\n_plug/\n").unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();

        sp.write_file("Library/Std/Config.md", b"x", None).unwrap();
        sp.write_file("_plug/foo.plug.js", b"x", None).unwrap();

        let names: Vec<String> = sp
            .fetch_file_list()
            .unwrap()
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert!(names.contains(&"Library/Std/Config.md".to_string()));
        assert!(names.contains(&"_plug/foo.plug.js".to_string()));
        assert!(!names.contains(&".gitignore".to_string()));
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
    fn write_leaves_an_exact_match_alone() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();

        sp.write_file("Notes/A.md", b"one", None).unwrap();
        sp.write_file("Notes/A.md", b"two", None).unwrap();

        assert_eq!(names(&sp), vec!["Notes/A.md".to_string()]);
        assert_eq!(sp.read_file("Notes/A.md").unwrap().0, b"two");
    }

    /// With the flag off, the backend must behave exactly as it did before this
    /// change — this is what protects Linux servers.
    #[test]
    fn write_does_nothing_special_when_case_sensitive() {
        let dir = tempdir().unwrap();
        let mut sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        sp.force_case_insensitive(false);

        sp.write_file("OldName.md", b"body", None).unwrap();
        sp.write_file("oldname.md", b"body", None).unwrap();

        let mut found = names(&sp);
        found.sort();
        if sp_fs_is_case_insensitive(dir.path()) {
            // Historical behavior: the alias truncates and the name survives.
            assert_eq!(found, vec!["OldName.md".to_string()]);
        } else {
            assert_eq!(
                found,
                vec!["OldName.md".to_string(), "oldname.md".to_string()]
            );
        }
    }

    fn sp_fs_is_case_insensitive(root: &std::path::Path) -> bool {
        crate::space::case::detect_case_insensitive(root)
    }

    #[test]
    fn delete_still_removes_an_exact_match() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();

        sp.write_file("Notes/A.md", b"body", None).unwrap();
        sp.delete_file("Notes/A.md").unwrap();

        assert!(names(&sp).is_empty());
    }

    /// A genuinely missing file must still report NotFound — only a *case
    /// mismatch* is silently ignored.
    #[test]
    fn delete_of_missing_file_still_reports_not_found() {
        let dir = tempdir().unwrap();
        let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();

        assert!(matches!(
            sp.delete_file("nope.md"),
            Err(crate::types::SpaceError::NotFound)
        ));
    }

    /// Tests needing a filesystem that actually aliases casings. Gated to macOS
    /// so they are absent on Linux rather than present and vacuous.
    ///
    /// A case-sensitive APFS volume is possible but opt-in at format time; the
    /// `is_case_insensitive` guard covers that rare case.
    #[cfg(target_os = "macos")]
    mod fs_tests {
        use super::*;

        #[test]
        fn write_recases_an_aliased_file() {
            let dir = tempdir().unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }

            sp.write_file("OldName.md", b"body", None).unwrap();
            sp.write_file("oldname.md", b"body", None).unwrap();

            assert_eq!(names(&sp), vec!["oldname.md".to_string()]);
        }

        #[test]
        fn write_recases_an_aliased_folder() {
            let dir = tempdir().unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }

            sp.write_file("Notes/a.md", b"body", None).unwrap();
            sp.write_file("notes/a.md", b"body", None).unwrap();

            assert_eq!(names(&sp), vec!["notes/a.md".to_string()]);
        }

        /// A re-case that can't be applied must never fail the user's save —
        /// the write still lands through the case-insensitive alias.
        #[test]
        fn write_succeeds_when_recasing_is_skipped() {
            let dir = tempdir().unwrap();
            let outside = tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), dir.path().join("Linked")).unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }
            sp.write_file("Linked/a.md", b"one", None).unwrap();

            sp.write_file("linked/a.md", b"two", None).unwrap();

            // Reads the literal directory entry name rather than doing a
            // case-insensitive path lookup (`.join("Linked").is_symlink()`) —
            // on default APFS that lookup would still resolve to a renamed
            // `linked` entry and pass either way, masking a regression.
            let entries: Vec<String> = std::fs::read_dir(dir.path())
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            assert_eq!(entries, vec!["Linked".to_string()]);
            assert_eq!(sp.read_file("linked/a.md").unwrap().0, b"two");
        }

        /// After a re-case, a delete addressed to the *old* casing must not
        /// touch the file — this is what stops the sync engine's unordered
        /// create/delete pair from destroying the page.
        #[test]
        fn delete_ignores_a_stale_casing() {
            let dir = tempdir().unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }

            sp.write_file("OldName.md", b"body", None).unwrap();
            sp.write_file("oldname.md", b"body", None).unwrap();

            sp.delete_file("OldName.md").unwrap();

            assert_eq!(names(&sp), vec!["oldname.md".to_string()]);
            assert_eq!(sp.read_file("oldname.md").unwrap().0, b"body");
        }

        /// The sync engine iterates the union of changed paths with no ordering
        /// guarantee, so a case-only rename reaches the server as an unordered
        /// create/delete pair. Both orders must end with exactly one file,
        /// under the new casing, with the right content.
        #[test]
        fn sync_pair_converges_create_then_delete() {
            let dir = tempdir().unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }
            sp.write_file("OldName.md", b"body", None).unwrap();

            sp.write_file("oldname.md", b"body", None).unwrap();
            sp.delete_file("OldName.md").unwrap();

            assert_eq!(names(&sp), vec!["oldname.md".to_string()]);
            assert_eq!(sp.read_file("oldname.md").unwrap().0, b"body");
        }

        #[test]
        fn sync_pair_converges_delete_then_create() {
            let dir = tempdir().unwrap();
            let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
            if !sp.is_case_insensitive() {
                return;
            }
            sp.write_file("OldName.md", b"body", None).unwrap();

            sp.delete_file("OldName.md").unwrap();
            sp.write_file("oldname.md", b"body", None).unwrap();

            assert_eq!(names(&sp), vec!["oldname.md".to_string()]);
            assert_eq!(sp.read_file("oldname.md").unwrap().0, b"body");
        }

        /// Same property one level up, which is where the whole-path comparison
        /// matters: the file component matches exactly, only the folder differs.
        #[test]
        fn folder_sync_pair_converges_in_both_orders() {
            for delete_first in [false, true] {
                let dir = tempdir().unwrap();
                let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
                if !sp.is_case_insensitive() {
                    return;
                }
                sp.write_file("Notes/a.md", b"body", None).unwrap();
                sp.write_file("Notes/keep.md", b"keep", None).unwrap();

                if delete_first {
                    sp.delete_file("Notes/a.md").unwrap();
                    sp.write_file("notes/a.md", b"body", None).unwrap();
                } else {
                    sp.write_file("notes/a.md", b"body", None).unwrap();
                    sp.delete_file("Notes/a.md").unwrap();
                }

                assert_eq!(
                    names(&sp),
                    vec!["notes/a.md".to_string(), "notes/keep.md".to_string()],
                    "delete_first={delete_first}"
                );
                assert_eq!(sp.read_file("notes/a.md").unwrap().0, b"body");
            }
        }
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
