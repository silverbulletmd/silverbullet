//! Unix-only walk tests for `DiskSpacePrimitives`; see `disk.rs`.

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
    symlink("a.md", dir.path().join("b.md")).unwrap();
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
    symlink("sub", dir.path().join("link")).unwrap();
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
    symlink(dir.path().join("d"), dir.path().join("d/loop")).unwrap();
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
    let outside = tempdir().unwrap();
    std::fs::create_dir(outside.path().join("shared")).unwrap();
    std::fs::write(outside.path().join("shared/doc.md"), b"shared doc").unwrap();

    let dir = tempdir().unwrap();
    let sp = DiskSpacePrimitives::new(dir.path(), "").unwrap();
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
