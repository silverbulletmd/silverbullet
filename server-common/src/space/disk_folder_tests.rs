//! Folder tests for `DiskSpacePrimitives`, kept apart from `disk.rs`.

use super::*;
use crate::types::SpacePrimitives;
use tempfile::tempdir;

#[test]
fn passes_folder_conformance() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    crate::space::conformance::run_folder_conformance(&sp);
}

#[test]
fn passes_recursive_folder_delete_conformance() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    crate::space::conformance::run_recursive_folder_delete_conformance(&sp);
}

#[test]
fn a_recursive_delete_takes_hidden_files_and_leaves_linked_folders_intact() {
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("kept.md"), b"x").unwrap();
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    sp.write_file("Repo/Page.md", b"x", None).unwrap();
    std::fs::create_dir_all(dir.path().join("Repo/.git")).unwrap();
    std::fs::write(dir.path().join("Repo/.git/HEAD"), b"x").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), dir.path().join("Repo/Linked")).unwrap();

    sp.delete_folder("Repo", true).unwrap();
    assert!(!dir.path().join("Repo").exists());
    assert!(outside.path().join("kept.md").exists());
}

#[test]
fn listing_skips_hidden_and_ignored_folders_and_keeps_files_in_one_walk() {
    let dir = tempdir().unwrap();
    for folder in [".git/objects", "build", "Empty", "Notes/Deep"] {
        std::fs::create_dir_all(dir.path().join(folder)).unwrap();
    }
    std::fs::write(dir.path().join("Notes/Page.md"), b"x").unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "build/").unwrap();

    let listing = sp.fetch_listing().unwrap();
    assert_eq!(listing.folders.unwrap(), ["Empty", "Notes", "Notes/Deep"]);
    assert_eq!(
        listing
            .files
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>(),
        ["Notes/Page.md"]
    );
}

#[test]
fn folder_operations_stay_inside_the_space() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    for path in ["", "/", "../outside", "a/../../outside"] {
        assert!(
            matches!(sp.create_folder(path), Err(SpaceError::PathOutsideRoot)),
            "create {path:?}"
        );
        assert!(
            matches!(
                sp.delete_folder(path, true),
                Err(SpaceError::PathOutsideRoot)
            ),
            "delete {path:?}"
        );
    }
    assert!(!dir.path().parent().unwrap().join("outside").exists());
}

#[test]
fn a_folder_holding_only_os_metadata_counts_as_empty() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    sp.create_folder("Shown").unwrap();
    for name in [".DS_Store", "Thumbs.db", "desktop.ini"] {
        std::fs::write(dir.path().join("Shown").join(name), b"x").unwrap();
    }
    sp.delete_folder("Shown", false).unwrap();
    assert!(!dir.path().join("Shown").exists());
}

#[test]
fn other_hidden_entries_keep_a_folder_from_being_deleted() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    sp.create_folder("Repo/.git").unwrap();
    sp.create_folder("Dotfile").unwrap();
    for folder in ["Repo", "Dotfile"] {
        std::fs::write(dir.path().join(folder).join(".DS_Store"), b"x").unwrap();
    }
    std::fs::write(dir.path().join("Dotfile/.env"), b"x").unwrap();

    for folder in ["Repo", "Dotfile"] {
        assert!(
            matches!(
                sp.delete_folder(folder, false),
                Err(SpaceError::FolderNotEmpty)
            ),
            "{folder}"
        );
        assert!(
            dir.path().join(folder).join(".DS_Store").exists(),
            "{folder} keeps its metadata"
        );
    }
}

#[test]
fn deleting_a_file_never_deletes_its_folder() {
    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    sp.write_file("a/b/c.md", b"x", None).unwrap();
    sp.delete_file("a/b/c.md").unwrap();
    assert!(dir.path().join("a/b").is_dir());
}
