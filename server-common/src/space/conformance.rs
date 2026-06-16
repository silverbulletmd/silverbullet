//! A reusable conformance suite for **writable** `SpacePrimitives`
//! implementations (disk, in-memory, and — in later crates — the HTTP client
//! against a writable server). It pins the shared contract so implementations
//! can't silently diverge.
//!
//! Run it from an implementation's tests with a FRESH, EMPTY, writable instance:
//!
//! ```ignore
//! let sp = MyWritableSpacePrimitives::new(/* ... */);
//! silverbullet_server_common::space::conformance::run_read_write_conformance(&sp);
//! ```
//!
//! Enabled via the `testing` feature so downstream crates can depend on it.
//! Read-only implementations (e.g. the embedded-asset space) are intentionally
//! out of scope here.

use crate::types::{SpaceError, SpacePrimitives};

/// Run every read-write conformance check against a fresh, empty, writable
/// space. Panics (like an assertion) on the first violated invariant, with a
/// message naming the operation. All checks use disjoint paths under `conf/`,
/// so a single fresh instance can run the whole battery.
pub fn run_read_write_conformance(sp: &dyn SpacePrimitives) {
    write_then_read_roundtrip(sp);
    write_creates_missing_folders(sp);
    get_meta_matches_write(sp);
    missing_file_is_not_found(sp);
    list_reflects_writes_and_deletes(sp);
    overwrite_updates_content_and_size(sp);
    delete_then_read_is_not_found(sp);
    delete_missing_is_not_found(sp);
    binary_content_roundtrips(sp);
    empty_file_roundtrips(sp);
    deep_nested_path_roundtrips(sp);
}

fn write_then_read_roundtrip(sp: &dyn SpacePrimitives) {
    let meta = sp
        .write_file("conf/roundtrip.md", b"hello world", None)
        .expect("write_file should succeed");
    assert_eq!(meta.name, "conf/roundtrip.md", "write: returned meta name");
    assert_eq!(meta.size, 11, "write: returned meta size");
    assert!(
        !meta.content_type.is_empty(),
        "write: content_type populated"
    );

    let (data, rmeta) = sp
        .read_file("conf/roundtrip.md")
        .expect("read_file should succeed");
    assert_eq!(data, b"hello world", "read: returns the written bytes");
    assert_eq!(rmeta.name, "conf/roundtrip.md", "read: meta name");
    assert_eq!(rmeta.size, 11, "read: meta size");
}

/// Writing into a folder that does not exist yet must transparently create the
/// whole folder hierarchy and leave the file readable.
fn write_creates_missing_folders(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/newly/created/deep/file.md", b"deep", None)
        .expect("writing into a not-yet-existing folder should succeed");
    let (data, _) = sp
        .read_file("conf/newly/created/deep/file.md")
        .expect("the file should be readable after creating its parent folders");
    assert_eq!(data, b"deep");
}

fn get_meta_matches_write(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/meta.md", b"12345", None).unwrap();
    let meta = sp
        .get_file_meta("conf/meta.md")
        .expect("get_file_meta on an existing file");
    assert_eq!(meta.name, "conf/meta.md", "get_file_meta: name");
    assert_eq!(meta.size, 5, "get_file_meta: size");
    assert!(
        !meta.content_type.is_empty(),
        "get_file_meta: content_type populated"
    );
}

fn missing_file_is_not_found(sp: &dyn SpacePrimitives) {
    assert!(
        matches!(
            sp.get_file_meta("conf/does-not-exist.md"),
            Err(SpaceError::NotFound)
        ),
        "get_file_meta on a missing file must be NotFound"
    );
    assert!(
        matches!(
            sp.read_file("conf/does-not-exist.md"),
            Err(SpaceError::NotFound)
        ),
        "read_file on a missing file must be NotFound"
    );
}

fn list_reflects_writes_and_deletes(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/list/a.md", b"a", None).unwrap();
    sp.write_file("conf/list/b.md", b"b", None).unwrap();
    let names = list_names(sp);
    assert!(
        names.contains(&"conf/list/a.md".to_string()),
        "list contains a freshly written file: {names:?}"
    );
    assert!(
        names.contains(&"conf/list/b.md".to_string()),
        "list contains a freshly written file: {names:?}"
    );

    sp.delete_file("conf/list/a.md").unwrap();
    let names = list_names(sp);
    assert!(
        !names.contains(&"conf/list/a.md".to_string()),
        "a deleted file disappears from the list: {names:?}"
    );
    assert!(
        names.contains(&"conf/list/b.md".to_string()),
        "an untouched sibling remains listed: {names:?}"
    );
}

fn overwrite_updates_content_and_size(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/over.md", b"first", None).unwrap();
    sp.write_file("conf/over.md", b"second-longer", None)
        .unwrap();
    let (data, meta) = sp.read_file("conf/over.md").unwrap();
    assert_eq!(data, b"second-longer", "overwrite replaces content");
    assert_eq!(meta.size, 13, "overwrite updates reported size");
}

fn delete_then_read_is_not_found(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/del.md", b"x", None).unwrap();
    sp.delete_file("conf/del.md")
        .expect("deleting an existing file should succeed");
    assert!(
        matches!(sp.read_file("conf/del.md"), Err(SpaceError::NotFound)),
        "reading a deleted file must be NotFound"
    );
}

fn delete_missing_is_not_found(sp: &dyn SpacePrimitives) {
    assert!(
        matches!(
            sp.delete_file("conf/never-existed.md"),
            Err(SpaceError::NotFound)
        ),
        "deleting a missing file must be NotFound"
    );
}

fn binary_content_roundtrips(sp: &dyn SpacePrimitives) {
    let bytes: Vec<u8> = (0u8..=255).collect();
    sp.write_file("conf/bin.dat", &bytes, None).unwrap();
    let (data, _) = sp.read_file("conf/bin.dat").unwrap();
    assert_eq!(data, bytes, "binary content must round-trip byte-for-byte");
}

fn empty_file_roundtrips(sp: &dyn SpacePrimitives) {
    sp.write_file("conf/empty.md", b"", None).unwrap();
    let (data, meta) = sp.read_file("conf/empty.md").unwrap();
    assert!(data.is_empty(), "an empty file reads back empty");
    assert_eq!(meta.size, 0, "an empty file has size 0");
}

fn deep_nested_path_roundtrips(sp: &dyn SpacePrimitives) {
    let path = "conf/a/b/c/d/e/deep.md";
    sp.write_file(path, b"nested", None).unwrap();
    let (data, _) = sp.read_file(path).unwrap();
    assert_eq!(data, b"nested");
    assert!(
        list_names(sp).contains(&path.to_string()),
        "a deeply nested file appears in the list"
    );
}

fn list_names(sp: &dyn SpacePrimitives) -> Vec<String> {
    sp.fetch_file_list()
        .expect("fetch_file_list should succeed")
        .into_iter()
        .map(|m| m.name)
        .collect()
}
