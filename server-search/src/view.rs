//! The storage view index backends read a space through: what storage
//! lists, with reads of hidden paths refused.

use std::collections::HashMap;
use std::sync::Arc;

use silverbullet_server_common::space::GitignoreMatcher;
use silverbullet_server_common::SpacePrimitives;

use crate::{FileStamp, SpaceView};

/// Exposes what storage exposes: listing and reads go through `SpacePrimitives`.
/// Storage lists no dot paths, control files or `SB_SPACE_IGNORE` matches but
/// would read the first and last, so reads check them here.
pub struct SpaceSearchView {
    space: Arc<dyn SpacePrimitives>,
    /// The space's `SB_SPACE_IGNORE` rules, fixed for the instance's lifetime.
    ignore: GitignoreMatcher,
}

impl SpaceSearchView {
    pub fn new(space: Arc<dyn SpacePrimitives>, ignore: GitignoreMatcher) -> Self {
        Self { space, ignore }
    }

    /// Dot paths and ignore matches; control files are refused by the
    /// storage stack's own filter. Anything that isn't a plain relative path
    /// (empty, rooted, backslashes, empty components) counts as hidden too,
    /// and is refused before the ignore matcher, which panics on paths
    /// outside its root.
    fn hidden(&self, path: &str) -> bool {
        let malformed = path.is_empty() || path.starts_with('/') || path.contains('\\');
        malformed
            || path
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.'))
            || self.ignore.is_ignored(path, false)
    }
}

impl SpaceView for SpaceSearchView {
    /// A size storage reports as negative becomes 0; compare `modified` as well.
    /// `None` when listing fails.
    fn list_meta(&self) -> Option<HashMap<String, FileStamp>> {
        let files = match self.space.fetch_file_list() {
            Ok(files) => files,
            Err(error) => {
                tracing::warn!("search: listing the space failed: {error}");
                return None;
            }
        };
        let meta = files
            .into_iter()
            .map(|f| {
                let stamp = FileStamp {
                    modified: f.last_modified,
                    size: u64::try_from(f.size).unwrap_or(0),
                };
                (f.name, stamp)
            })
            .collect();
        Some(meta)
    }

    /// `None` for a hidden path, so a change event for one reads as a delete.
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if self.hidden(path) {
            return None;
        }
        self.space.read_file(path).ok().map(|(data, _)| data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server_common::space::DiskSpacePrimitives;

    fn disk_view(files: &[(&str, &str)], ignore: &str) -> (tempfile::TempDir, SpaceSearchView) {
        let dir = tempfile::tempdir().unwrap();
        for (name, body) in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        let disk = DiskSpacePrimitives::new(dir.path(), ignore).unwrap();
        let matcher = disk.gitignore_matcher();
        (dir, SpaceSearchView::new(Arc::new(disk), matcher))
    }

    #[test]
    fn list_meta_stamps_only_visible_files_with_storage_metadata() {
        let (_dir, view) = disk_view(
            &[
                ("Fern.md", "fern fronds\n"),
                ("notes/Moss.md", "moss"),
                (".hidden.md", "dot"),
                (".trash/Old.md", "old"),
                ("private/Payroll.md", "salary"),
            ],
            "private/",
        );
        let meta = view.list_meta().unwrap();
        let mut names: Vec<_> = meta.keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["Fern.md", "notes/Moss.md"]);
        let storage = view.space.get_file_meta("Fern.md").unwrap();
        assert_eq!(
            meta["Fern.md"],
            FileStamp {
                modified: storage.last_modified,
                size: 12,
            }
        );
        assert!(meta["Fern.md"].modified > 0);
        assert_eq!(meta["notes/Moss.md"].size, 4);
    }

    #[test]
    fn reads_return_whole_files_and_refuse_dot_paths_and_ignored_files() {
        let (_dir, view) = disk_view(
            &[
                ("Fern.md", "fern fronds\n"),
                (".hidden.md", "dot"),
                (".trash/Old.md", "old"),
                ("notes/.draft.md", "draft"),
                ("private/Payroll.md", "salary"),
                ("private/deep/Bonus.md", "bonus"),
                ("Secret.md", "secret"),
            ],
            "private/\nSecret.md",
        );
        assert_eq!(view.read("Fern.md").as_deref(), Some(&b"fern fronds\n"[..]));
        for hidden in [
            ".hidden.md",
            ".trash/Old.md",
            "notes/.draft.md",
            "private/Payroll.md",
            "private/deep/Bonus.md",
            "Secret.md",
            "",
            "/Fern.md",
            "../Fern.md",
            "notes/../Fern.md",
            "./Fern.md",
            "notes//Fern.md",
            "notes\\..\\Fern.md",
            ".trash\\Old.md",
        ] {
            assert_eq!(view.read(hidden), None, "{hidden}");
        }
        assert_eq!(view.read("Missing.md"), None);
    }
}
