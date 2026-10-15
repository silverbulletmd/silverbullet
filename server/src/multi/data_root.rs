//! The multi-user data root's own layout: the server's directories a space
//! rooted there must not see, and the space folders that would overlap them.
//! One list ([`DATA_ROOT_DIRS`]) serves all three users: the control-file
//! filter, the data-root watcher's ignore rules and the folder check. One
//! predicate ([`reserved_dir`]) serves the filter and the folder check; the
//! watcher's ignore rules use only the list.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};

use crate::multi::config::MultiConfig;
use crate::multi::instance::resolve_folder;
use crate::multi::setup::canonicalize_best_effort;
use crate::multi::validate::FieldError;
use crate::search::SEARCH_DIR;

/// The data root's own top-level directories, which [`ServerControlFileFilter`]
/// hides from a space rooted there.
pub(crate) const DATA_ROOT_DIRS: [&str; 4] =
    ["git-keys", "git-drafts", "git-connections", SEARCH_DIR];

/// The reserved directory that `name`, one top-level path component, names:
/// compared ASCII case-insensitively, as case-insensitive filesystems do.
pub(crate) fn reserved_dir(name: &str) -> Option<&'static str> {
    DATA_ROOT_DIRS
        .into_iter()
        .find(|dir| dir.eq_ignore_ascii_case(name))
}

/// `space_ignore` plus the reserved directories, anchored at the top and
/// matched case-insensitively like [`reserved_dir`]. The watcher only takes
/// ignore text, so the predicate is spelled out as globs, here next to it.
pub(crate) fn watcher_ignore(space_ignore: &str) -> String {
    let mut ignore = space_ignore.to_string();
    for dir in DATA_ROOT_DIRS {
        let pattern: String = dir
            .chars()
            .map(|c| {
                if c.is_ascii_alphabetic() {
                    format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
                } else {
                    c.to_string()
                }
            })
            .collect();
        ignore.push_str(&format!("\n/{pattern}/"));
    }
    ignore
}

/// Whether a space rooted at the data root must not see `path`: a reserved
/// directory, or one of the server's control files at the top.
pub(crate) fn reserved(path: &str) -> bool {
    let mut components = Path::new(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => name.to_str(),
            Component::CurDir => None,
            _ => Some(""),
        });
    let Some(name) = components.next() else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    let name = name.as_str();
    let provider_temp = name
        .strip_prefix("authentication.")
        .and_then(|name| name.strip_suffix(".tmp"))
        .is_some_and(|name| !name.is_empty());
    let browser_sessions_temp = name
        .strip_prefix(".silverbullet.browser-sessions.")
        .and_then(|name| name.strip_suffix(".tmp"))
        .is_some_and(|name| !name.is_empty());
    reserved_dir(name).is_some()
        || components.next().is_none()
            && (matches!(
                name,
                "users.json"
                    | "users.json.tmp"
                    | "spaces.json"
                    | "spaces.json.tmp"
                    | "server.json"
                    | "server.json.tmp"
                    | "authentication.json"
                    | ".silverbullet.browser-sessions.json"
                    | crate::auth::MULTI_AUTH_FILE_NAME
            ) || provider_temp
                || browser_sessions_temp)
}

/// Prevent a space deliberately rooted at the multi-space data directory from
/// reading or mutating the server's account, routing, and session state.
pub(crate) struct ServerControlFileFilter {
    inner: Box<dyn SpacePrimitives>,
}

impl ServerControlFileFilter {
    pub(crate) fn new(inner: Box<dyn SpacePrimitives>) -> Self {
        Self { inner }
    }
}

impl SpacePrimitives for ServerControlFileFilter {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let mut files = self.inner.fetch_file_list()?;
        files.retain(|file| !reserved(&file.name));
        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        if reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.get_file_meta(path)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        if reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.read_file(path)
    }

    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        if reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.read_file_range(path, start, length)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        if reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.write_file(path, data, meta)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        if reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.delete_file(path)
    }
}

/// Why `folder` can't be the folder of space `id` on data root `root`: it
/// contains the data folder, or equals, lies inside or contains one of the
/// data folder's reserved directories (`search`, `git-keys`, ...). Compared
/// case-insensitively, both lexically and on canonical paths (so a symlink
/// into a reserved directory counts). The data root itself is fine:
/// [`ServerControlFileFilter`] hides these directories from a space rooted there.
pub(crate) fn folder_conflict(root: &Path, id: &str, folder: &str) -> Option<String> {
    let canonical_root = canonicalize_best_effort(root);
    // Applying `..` first: `canonicalize_best_effort` drops it from a missing tail.
    let canonical_folder = canonicalize_best_effort(&normalize_lexically(&resolve_folder(
        &canonical_root,
        id,
        folder,
    )));
    let pairs = [
        (root.to_path_buf(), resolve_folder(root, id, folder)),
        (canonical_root, canonical_folder),
    ];
    first_overlap(pairs, |overlap| match overlap {
        Overlap::Same => None,
        Overlap::Contains => {
            Some("a space cannot contain the data folder; choose a separate space folder".into())
        }
        Overlap::Inside(first) => {
            let dir = reserved_dir(&first)?;
            Some(format!(
                "folder overlaps the server's {dir:?} folder in the data folder; choose a separate space folder"
            ))
        }
    })
}

/// Every space of `spaces` whose folder can't be served (see
/// [`folder_conflict`]), by id, with the reason. Boot skips these spaces;
/// admin changes refuse a new one.
pub(crate) fn folder_conflicts(root: &Path, spaces: &MultiConfig) -> BTreeMap<String, String> {
    spaces
        .spaces
        .iter()
        .filter_map(|(id, space)| Some((id.clone(), folder_conflict(root, id, &space.folder)?)))
        .collect()
}

/// `conflicts` (see [`folder_conflicts`]) as the `<id>.folder` errors an API
/// change returns.
pub(crate) fn folder_errors(conflicts: BTreeMap<String, String>) -> Vec<FieldError> {
    conflicts
        .into_iter()
        .map(|(id, message)| FieldError {
            field: format!("{id}.folder"),
            message,
        })
        .collect()
}

/// Why `search_dir` can't hold a single-space server's search files
/// (`SB_SEARCH_DIR`) for the space in `space_folder`: it is that folder,
/// lies inside it (the index would index itself and write into the space)
/// or contains it. Compared as [`folder_conflict`] compares: lexically and
/// on canonical paths, case-insensitively.
pub fn search_dir_conflict(space_folder: &Path, search_dir: &Path) -> Option<String> {
    let pairs = [
        (
            normalize_lexically(space_folder),
            normalize_lexically(search_dir),
        ),
        (
            canonicalize_best_effort(space_folder),
            canonicalize_best_effort(&normalize_lexically(search_dir)),
        ),
    ];
    first_overlap(pairs, |overlap| {
        let what = match overlap {
            Overlap::Same => "is the space folder",
            Overlap::Inside(_) => "is inside the space folder",
            Overlap::Contains => "contains the space folder",
        };
        Some(format!("it {what}; choose a folder outside the space"))
    })
}

/// How a path lies relative to a base folder.
enum Overlap {
    Same,
    /// Inside it, under its child with this (lowercased) name.
    Inside(String),
    /// It contains the base.
    Contains,
}

/// How `path` lies relative to `base`, compared component by component,
/// case-insensitively; `None` when neither contains the other.
fn overlap(base: &Path, path: &Path) -> Option<Overlap> {
    let (base, path) = (lowercase_components(base), lowercase_components(path));
    if path == base {
        Some(Overlap::Same)
    } else if let Some(rest) = path.strip_prefix(base.as_slice()) {
        Some(Overlap::Inside(rest[0].clone()))
    } else if base.starts_with(&path) {
        Some(Overlap::Contains)
    } else {
        None
    }
}

/// The first message `judge` gives an overlap of the `(base, path)` pairs
/// (the lexical pair, then the canonical one).
fn first_overlap(
    pairs: [(PathBuf, PathBuf); 2],
    judge: impl Fn(Overlap) -> Option<String>,
) -> Option<String> {
    pairs
        .into_iter()
        .find_map(|(base, path)| judge(overlap(&base, &path)?))
}

/// `path` with `.` dropped and `..` applied lexically.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir
                if matches!(out.components().next_back(), Some(Component::Normal(_))) =>
            {
                out.pop();
            }
            Component::ParentDir if out.has_root() => {}
            other => out.push(other),
        }
    }
    out
}

/// [`normalize_lexically`]'s components, lowercased, with a drive prefix
/// treated as an anchor like the root (see [`drop_dot_dot_at_anchor`]).
fn lowercase_components(path: &Path) -> Vec<String> {
    drop_dot_dot_at_anchor(normalize_lexically(path).components().map(|c| {
        (
            matches!(c, Component::Prefix(_) | Component::RootDir),
            c.as_os_str().to_string_lossy().to_lowercase(),
        )
    }))
}

/// `parts` (`(is anchor, component)`) without a `..` directly after the
/// anchor. [`normalize_lexically`] keeps one after a bare Windows drive prefix
/// (`C:..` has no root), but the folder check compares such a folder as the
/// drive itself, so it contains every data folder on that drive.
fn drop_dot_dot_at_anchor(parts: impl IntoIterator<Item = (bool, String)>) -> Vec<String> {
    let mut out = Vec::new();
    let mut at_anchor = false;
    for (anchor, part) in parts {
        if at_anchor && part == ".." {
            continue;
        }
        at_anchor = anchor;
        out.push(part);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server_common::space::{DiskSpacePrimitives, MemorySpacePrimitives};

    #[test]
    fn control_files_are_reserved_case_insensitively() {
        for path in [
            "SERVER.JSON",
            "UsErS.JsOn",
            "AUTHENTICATION.JSON",
            "Git-Keys/private",
        ] {
            assert!(reserved(path), "{path}");
        }
        assert!(!reserved("notes/server.json"));
    }

    #[test]
    fn control_file_filter_delegates_range_reads_for_visible_files() {
        let inner = MemorySpacePrimitives::new();
        inner.write_file("range.bin", b"0123456789", None).unwrap();
        inner
            .write_file("server.json", b"0123456789", None)
            .unwrap();
        let filtered = ServerControlFileFilter::new(Box::new(inner));

        let (data, meta) = filtered.read_file_range("range.bin", 2, 5).unwrap();
        assert_eq!(data, b"23456");
        assert_eq!(meta.size, 10);
        assert!(matches!(
            filtered.read_file_range("server.json", 2, 5),
            Err(SpaceError::NotFound)
        ));
    }

    #[test]
    fn the_search_directory_is_reserved_at_the_data_root() {
        for path in [
            "search",
            "search/indexes/x/fulltext-v2/meta.json",
            "SEARCH/x",
        ] {
            assert!(reserved(path), "{path}");
        }
        for path in ["notes/search/x.md", "search.md", "searches/x.md"] {
            assert!(!reserved(path), "{path}");
        }
    }

    #[test]
    fn folders_overlapping_reserved_data_dirs_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        let inside = |rel: &str| root.join(rel).to_string_lossy().into_owned();
        for folder in [
            "search".to_string(),
            "Search".to_string(),
            "search/indexes".to_string(),
            "Search/indexes".to_string(),
            "SEARCH/indexes/x".to_string(),
            "search/".to_string(),
            "./search".to_string(),
            "spaces/../search".to_string(),
            "git-keys".to_string(),
            "Git-Drafts/nested".to_string(),
            "git-connections".to_string(),
            inside("search"),
            inside("Search/indexes"),
        ] {
            let reason = folder_conflict(&root, "a", &folder).unwrap_or_default();
            assert!(
                reason.contains("folder overlaps the server's"),
                "{folder}: {reason}"
            );
        }
        assert!(folder_conflict(&root, "a", "search")
            .unwrap()
            .contains("\"search\" folder"));
        let parent = dir.path().to_string_lossy().into_owned();
        for folder in ["..", "../", parent.as_str(), "spaces/../.."] {
            let reason = folder_conflict(&root, "a", folder).unwrap_or_default();
            assert!(
                reason.contains("a space cannot contain the data folder"),
                "{folder}: {reason}"
            );
        }
    }

    #[test]
    fn folders_next_to_reserved_data_dirs_have_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        let root_str = root.to_string_lossy().into_owned();
        for folder in [
            ".",
            "",
            "./",
            root_str.as_str(),
            "spaces/search",
            "notes/git-keys",
            "searches",
            "search-notes",
            "search/../notes",
        ] {
            assert_eq!(folder_conflict(&root, "a", folder), None, "{folder}");
        }
    }

    #[test]
    fn the_watcher_ignores_each_reserved_directory_at_the_top() {
        assert_eq!(
            watcher_ignore("*.tmp"),
            "*.tmp\n/[gG][iI][tT]-[kK][eE][yY][sS]/\n/[gG][iI][tT]-[dD][rR][aA][fF][tT][sS]/\
             \n/[gG][iI][tT]-[cC][oO][nN][nN][eE][cC][tT][iI][oO][nN][sS]/\n/[sS][eE][aA][rR][cC][hH]/"
        );
    }

    #[test]
    fn data_root_watcher_ignore_agrees_with_the_control_file_filter() {
        let dir = tempfile::tempdir().unwrap();
        let disk = DiskSpacePrimitives::new(dir.path(), &watcher_ignore("*.tmp")).unwrap();
        let ignore = disk.gitignore_matcher();
        for path in [
            "search/indexes/x/fulltext-v2/meta.json",
            "Search/Saved queries.md",
            "SEARCH/x.md",
            "Git-Keys/private",
            "git-drafts/x.md",
            "GIT-CONNECTIONS/x.json",
        ] {
            assert!(ignore.is_ignored(path, false), "{path}");
            assert!(reserved(path), "{path}");
        }
        for path in [
            "notes/search/x.md",
            "notes/Search/x.md",
            "Projects/git-keys/x.md",
            "search.md",
            "Searches/x.md",
        ] {
            assert!(!ignore.is_ignored(path, false), "{path}");
            assert!(!reserved(path), "{path}");
        }
        assert!(ignore.is_ignored("draft.tmp", false));
    }

    #[test]
    fn lowercase_components_apply_dot_dot_lexically() {
        assert_eq!(
            lowercase_components(Path::new("../../X/./y/..")),
            ["..", "..", "x"]
        );
        assert_eq!(lowercase_components(Path::new("/a/../../B")), ["/", "b"]);
        assert_eq!(lowercase_components(Path::new("./Search/")), ["search"]);
    }

    #[test]
    fn dot_dot_after_a_bare_drive_prefix_stays_at_the_drive() {
        let parts = |items: &[(bool, &str)]| {
            drop_dot_dot_at_anchor(
                items
                    .iter()
                    .map(|&(anchor, part)| (anchor, part.to_string())),
            )
        };
        // `C:..` and `C:..\..`, as `normalize_lexically` leaves them on Windows.
        assert_eq!(parts(&[(true, "c:"), (false, "..")]), ["c:"]);
        assert_eq!(parts(&[(true, "c:"), (false, ".."), (false, "..")]), ["c:"]);
        assert_eq!(
            parts(&[(true, "c:"), (false, ".."), (false, "x")]),
            ["c:", "x"]
        );
        // A relative `..` has no anchor and stays.
        assert_eq!(parts(&[(false, ".."), (false, "x")]), ["..", "x"]);
    }

    #[cfg(windows)]
    #[test]
    fn a_bare_drive_parent_folder_contains_the_data_folder() {
        let reason = folder_conflict(Path::new(r"C:\data"), "a", "C:..").unwrap_or_default();
        assert!(
            reason.contains("a space cannot contain the data folder"),
            "{reason}"
        );
    }

    fn spaces_with_folder(folder: &str) -> MultiConfig {
        let mut spaces = MultiConfig::default();
        spaces.spaces.insert(
            "space".into(),
            serde_json::from_value(serde_json::json!({
                "name":"Notes", "binding":{"host":"notes.example.test"}, "folder": folder
            }))
            .unwrap(),
        );
        spaces
    }

    #[test]
    fn folder_conflicts_name_each_conflicting_space_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("server");
        std::fs::create_dir_all(root.join("search/indexes")).unwrap();
        std::fs::create_dir_all(root.join("git-keys")).unwrap();
        let outside = dir.path().to_string_lossy().into_owned();
        let absolute = root.join("search").to_string_lossy().into_owned();
        for folder in [
            "search",
            "Search",
            "search/indexes",
            "SEARCH/Indexes",
            "search/indexes/new-space",
            "git-keys",
            "Git-Drafts",
            "..",
            absolute.as_str(),
            outside.as_str(),
        ] {
            let conflicts = folder_conflicts(&root, &spaces_with_folder(folder));
            assert_eq!(conflicts.keys().collect::<Vec<_>>(), ["space"], "{folder}");
            assert_eq!(
                folder_errors(conflicts)[0].field,
                "space.folder",
                "{folder}"
            );
        }
        for folder in [".", "", "spaces/search", "searches"] {
            assert!(
                folder_conflicts(&root, &spaces_with_folder(folder)).is_empty(),
                "{folder}"
            );
        }
    }

    #[test]
    fn a_search_dir_must_lie_outside_the_space_folder() {
        let dir = tempfile::tempdir().unwrap();
        let space = dir.path().join("Orchard");
        std::fs::create_dir_all(&space).unwrap();
        assert_eq!(
            search_dir_conflict(&space, &dir.path().join("orchard-search")),
            None
        );
        assert!(search_dir_conflict(&space, &space).is_some(), "same folder");
        assert!(
            search_dir_conflict(&space, &space.join("search")).is_some(),
            "inside"
        );
        assert!(
            search_dir_conflict(&space, dir.path()).is_some(),
            "contains the space"
        );
        assert!(
            search_dir_conflict(&space, &dir.path().join("ORCHARD/search")).is_some(),
            "case"
        );
        #[cfg(unix)]
        {
            let link = dir.path().join("link-to-orchard");
            std::os::unix::fs::symlink(&space, &link).unwrap();
            assert!(
                search_dir_conflict(&space, &link.join("idx")).is_some(),
                "symlink"
            );
        }
    }
}
