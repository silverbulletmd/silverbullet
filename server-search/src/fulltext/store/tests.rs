use super::*;
use crate::IndexSink;
use tantivy::collector::Count;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;

/// Under `cfg(test)`, `open_existing` panics when this file is in the
/// index directory (dot name: not counted as an index file).
pub(super) const PANIC_ON_OPEN: &str = ".sb-test-panic-on-open";

/// A retry window for tests that expect the RAM fallback.
const SHORT: Duration = Duration::from_millis(300);

fn stamp(modified: i64) -> FileStamp {
    FileStamp { modified, size: 10 }
}

fn upsert(path: &str, text: &str, modified: i64) -> Change {
    Change::Upsert {
        path: path.into(),
        text: text.into(),
        stamp: stamp(modified),
    }
}

/// Pages whose unstemmed body contains `word`.
fn count(store: &IndexStore, word: &str) -> usize {
    let q = TermQuery::new(
        Term::from_field_text(store.fields().body_raw, word),
        IndexRecordOption::Basic,
    );
    store.searcher().search(&q, &Count).unwrap()
}

fn disk(base: &Path) -> IndexStore {
    IndexStore::open(Location::Disk(base.to_path_buf()))
}

fn seeded(base: &Path) -> IndexStore {
    let store = disk(base);
    assert!(!store.is_memory());
    store
        .apply(&[
            upsert("Garden.md", "tomatoes and basil", 1),
            upsert("Kitchen.md", "bread and butter", 2),
        ])
        .unwrap();
    store
}

fn segment_files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            let name = p.file_name().unwrap().to_string_lossy();
            !name.starts_with('.') && name != "meta.json" && name != VERSION_FILE
        })
        .collect()
}

#[test]
fn stamps_survive_reopen() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    assert_eq!(read_version(&dir).unwrap(), Version::Current);
    let store = disk(tmp.path());
    assert!(!store.is_memory());
    let stamps = store.stamps();
    assert_eq!(stamps.len(), 2);
    assert_eq!(stamps["Garden.md"], stamp(1));
    assert_eq!(stamps["Kitchen.md"], stamp(2));
    assert_eq!(count(&store, "basil"), 1);
}

#[test]
fn opened_says_reused_fresh_or_memory_with_pages_and_size() {
    let tmp = tempfile::tempdir().unwrap();
    let fresh = disk(tmp.path());
    assert_eq!(fresh.opened(), Opened::Fresh);
    assert_eq!(fresh.pages(), 0);
    drop(fresh);
    drop(seeded(tmp.path()));
    let reused = disk(tmp.path());
    assert_eq!(reused.opened(), Opened::Reused);
    assert_eq!(reused.pages(), 2);
    let on_disk: u64 = fs::read_dir(tmp.path().join(SCHEMA_DIR))
        .unwrap()
        .map(|e| e.unwrap().metadata().unwrap().len())
        .sum();
    assert!(on_disk > 0);
    assert_eq!(reused.size_bytes(), on_disk);

    let memory = IndexStore::open(Location::Memory);
    assert_eq!(memory.opened(), Opened::Memory);
    memory.apply(&[upsert("A.md", "alpha", 1)]).unwrap();
    assert_eq!(memory.pages(), 1);
    assert!(memory.size_bytes() > 0);
}

#[test]
fn upsert_replaces_and_delete_removes() {
    let tmp = tempfile::tempdir().unwrap();
    let store = seeded(tmp.path());
    store
        .apply(&[upsert("Garden.md", "tomatoes and parsley", 5)])
        .unwrap();
    assert_eq!(count(&store, "basil"), 0);
    assert_eq!(count(&store, "parsley"), 1);
    assert_eq!(count(&store, "tomatoes"), 1);
    assert_eq!(store.stamps()["Garden.md"], stamp(5));

    store
        .apply(&[Change::Delete {
            path: "Garden.md".into(),
        }])
        .unwrap();
    assert_eq!(count(&store, "tomatoes"), 0);
    let stamps = store.stamps();
    assert_eq!(stamps.len(), 1);
    assert!(stamps.contains_key("Kitchen.md"));
}

#[test]
fn same_path_twice_in_one_batch_keeps_the_last() {
    let tmp = tempfile::tempdir().unwrap();
    let store = disk(tmp.path());
    store
        .apply(&[
            upsert("A.md", "first version", 1),
            upsert("A.md", "second version", 2),
        ])
        .unwrap();
    assert_eq!(count(&store, "first"), 0);
    assert_eq!(count(&store, "second"), 1);
    assert_eq!(store.stamps()["A.md"], stamp(2));
}

fn assert_rebuilt_empty(base: &Path) {
    let store = disk(base);
    assert!(!store.is_memory());
    assert!(store.stamps().is_empty());
    assert_eq!(count(&store, "basil"), 0);
    // And it is usable again.
    store.apply(&[upsert("New.md", "fresh start", 9)]).unwrap();
    drop(store);
    let store = disk(base);
    assert_eq!(store.stamps().len(), 1);
    assert_eq!(count(&store, "fresh"), 1);
}

#[test]
fn truncated_segment_file_rebuilds() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    let files = segment_files(&dir);
    assert!(!files.is_empty());
    for f in files {
        let len = fs::metadata(&f).unwrap().len();
        let file = fs::OpenOptions::new().write(true).open(&f).unwrap();
        file.set_len(len / 2).unwrap();
    }
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn missing_segment_file_rebuilds() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    for f in segment_files(&dir) {
        if f.extension().is_some_and(|e| e == "store") {
            fs::remove_file(f).unwrap();
        }
    }
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn garbage_meta_json_rebuilds() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::write(dir.join("meta.json"), "{\"segments\": [garbage").unwrap();
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn foreign_version_rebuilds() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::write(
        dir.join(VERSION_FILE),
        r#"{"schema": "fulltext-v0", "tantivy": "0.1.0"}"#,
    )
    .unwrap();
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn garbage_version_json_rebuilds() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::write(dir.join(VERSION_FILE), "nope").unwrap();
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn index_files_without_version_json_rebuild() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::remove_file(dir.join(VERSION_FILE)).unwrap();
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn version_json_written_after_first_commit() {
    let tmp = tempfile::tempdir().unwrap();
    let store = disk(tmp.path());
    let dir = tmp.path().join(SCHEMA_DIR);
    assert!(!dir.join(VERSION_FILE).exists());
    store.apply(&[upsert("A.md", "alpha", 1)]).unwrap();
    assert_eq!(read_version(&dir).unwrap(), Version::Current);
}

#[cfg(unix)]
fn running_as_root() -> bool {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() == 0 }
}

#[cfg(unix)]
#[test]
fn dirs_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("space-1");
    let _store = disk(&base);
    for d in [&base, &base.join(SCHEMA_DIR)] {
        let mode = fs::metadata(d).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "{}", d.display());
    }
}

#[cfg(unix)]
#[test]
fn unwritable_parent_gives_memory_store() {
    use std::os::unix::fs::PermissionsExt;
    if running_as_root() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let parent = tmp.path().join("indexes");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o500)).unwrap();
    let started = Instant::now();
    let store = disk(&parent.join("space-1"));
    let took = started.elapsed();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(store.is_memory());
    assert!(
        took < Duration::from_secs(1),
        "N4: no retry wait, took {took:?}"
    );
    store.apply(&[upsert("A.md", "alpha", 1)]).unwrap();
    assert_eq!(count(&store, "alpha"), 1);
}

#[test]
fn second_store_is_lock_busy_while_first_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let first = seeded(tmp.path());
    let second = disk(tmp.path());
    assert!(!second.is_memory());
    assert_eq!(second.stamps().len(), 2);
    {
        // The first store mid-apply: it holds the writer lock.
        let _held: IndexWriter = first
            .index()
            .writer_with_num_threads(1, WRITER_MEMORY)
            .unwrap();
        let err = second.apply(&[upsert("C.md", "cheese", 3)]).unwrap_err();
        assert!(matches!(err, StoreError::LockBusy), "{err:?}");
    }
    second.apply(&[upsert("C.md", "cheese", 3)]).unwrap();
    assert_eq!(count(&second, "cheese"), 1);
    assert_eq!(second.stamps().len(), 3);
}

#[test]
fn rebuild_never_wipes_a_locked_index() {
    let tmp = tempfile::tempdir().unwrap();
    let first = seeded(tmp.path());
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::remove_file(dir.join(VERSION_FILE)).unwrap();
    let _held: IndexWriter = first
        .index()
        .writer_with_num_threads(1, WRITER_MEMORY)
        .unwrap();
    let second = IndexStore::open_within(Location::Disk(tmp.path().into()), SHORT);
    assert!(second.is_memory());
    assert_eq!(count(&first, "basil"), 1);
    assert!(dir.join("meta.json").exists());
    assert!(!segment_files(&dir).is_empty());
}

/// I1: another instance holds the writer during its first batch (index
/// files, no `version.json` yet) and commits within the retry window.
/// The other side follows `apply`'s order: commit, `version.json`, then
/// merges and release (N2).
#[test]
fn open_waits_for_a_first_batch_that_commits() {
    let tmp = tempfile::tempdir().unwrap();
    let first = seeded(tmp.path());
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::remove_file(dir.join(VERSION_FILE)).unwrap();
    let mut writer: IndexWriter = first
        .index()
        .writer_with_num_threads(1, WRITER_MEMORY)
        .unwrap();
    let commit_dir = dir.clone();
    let other = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let f = first.fields();
        writer
            .add_document(document(f, "Late.md", "late batch", stamp(7)))
            .unwrap();
        writer.commit().unwrap();
        write_version(&commit_dir).unwrap();
        writer.wait_merging_threads().unwrap();
    });
    let second = disk(tmp.path());
    other.join().unwrap();
    assert!(!second.is_memory());
    let stamps = second.stamps();
    assert_eq!(stamps.len(), 3, "reused, not rebuilt: {stamps:?}");
    assert_eq!(stamps["Late.md"], stamp(7));
}

/// I1: the other writer goes away without committing: rebuilt on disk.
#[test]
fn open_waits_for_a_writer_that_drops() {
    let tmp = tempfile::tempdir().unwrap();
    let first = seeded(tmp.path());
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::remove_file(dir.join(VERSION_FILE)).unwrap();
    let writer: IndexWriter = first
        .index()
        .writer_with_num_threads(1, WRITER_MEMORY)
        .unwrap();
    let other = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        drop(writer);
    });
    let second = disk(tmp.path());
    other.join().unwrap();
    assert!(!second.is_memory());
    assert!(second.stamps().is_empty());
    second.apply(&[upsert("A.md", "alpha", 1)]).unwrap();
    assert_eq!(count(&second, "alpha"), 1);
}

/// I1: two opens racing on an empty directory both end up on disk.
#[test]
fn concurrent_creates_both_use_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().to_path_buf();
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let base = base.clone();
            std::thread::spawn(move || disk(&base).is_memory())
        })
        .collect();
    for h in handles {
        assert!(!h.join().unwrap());
    }
}

/// M3/N4: an unreadable directory is never deleted; RAM at once.
#[cfg(unix)]
#[test]
fn unreadable_dir_is_kept_and_reused_later() {
    use std::os::unix::fs::PermissionsExt;
    if running_as_root() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
    let started = Instant::now();
    let store = disk(tmp.path());
    let took = started.elapsed();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(store.is_memory());
    assert!(took < Duration::from_secs(1), "took {took:?}");
    let store = disk(tmp.path());
    assert!(!store.is_memory());
    assert_eq!(store.stamps().len(), 2);
}

/// N3: a version.json that can't be read (not a parse failure) is never
/// taken for a mismatch: the index is kept.
#[cfg(unix)]
#[test]
fn unreadable_version_json_keeps_the_index() {
    use std::os::unix::fs::PermissionsExt;
    if running_as_root() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let version = tmp.path().join(SCHEMA_DIR).join(VERSION_FILE);
    fs::set_permissions(&version, fs::Permissions::from_mode(0o000)).unwrap();
    let store = disk(tmp.path());
    fs::set_permissions(&version, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(store.is_memory());
    let store = disk(tmp.path());
    assert!(!store.is_memory());
    assert_eq!(store.stamps().len(), 2);
}

/// N4: a file where the directory should be: RAM at once, file kept.
#[test]
fn file_in_the_way_gives_memory_store_at_once() {
    let tmp = tempfile::tempdir().unwrap();
    let base_file = tmp.path().join("space-file");
    fs::write(&base_file, "x").unwrap();
    let dir_file_base = tmp.path().join("space-2");
    fs::create_dir(&dir_file_base).unwrap();
    fs::write(dir_file_base.join(SCHEMA_DIR), "y").unwrap();
    for base in [&base_file, &dir_file_base] {
        let started = Instant::now();
        let store = disk(base);
        assert!(store.is_memory(), "{}", base.display());
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    assert_eq!(fs::read_to_string(&base_file).unwrap(), "x");
    assert_eq!(
        fs::read_to_string(dir_file_base.join(SCHEMA_DIR)).unwrap(),
        "y"
    );
}

/// N1: an index that makes Tantivy panic on open is rebuilt after
/// [`SUSPECT_TRIES`] attempts instead of ending in RAM.
#[test]
fn index_that_panics_on_open_is_rebuilt() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let dir = tmp.path().join(SCHEMA_DIR);
    fs::write(dir.join(PANIC_ON_OPEN), "").unwrap();
    let started = Instant::now();
    let store = disk(tmp.path());
    assert!(!store.is_memory());
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(store.stamps().is_empty());
    assert!(!dir.join(PANIC_ON_OPEN).exists());
    drop(store);
    assert_rebuilt_empty(tmp.path());
}

#[test]
fn io_errors_are_classified() {
    let kinds = |e: io::Error| (io_fault("x", &e).kind, version_fault(&e).kind);
    assert_eq!(
        kinds(io::Error::from_raw_os_error(24)),
        (FaultKind::Transient, FaultKind::Transient)
    );
    assert_eq!(
        kinds(io::Error::from(io::ErrorKind::PermissionDenied)),
        (FaultKind::Unusable, FaultKind::Unusable)
    );
    assert_eq!(
        io_fault("x", &io::Error::from(io::ErrorKind::ReadOnlyFilesystem)).kind,
        FaultKind::Unusable
    );
    assert_eq!(
        kinds(io::Error::from(io::ErrorKind::NotFound)),
        (FaultKind::Suspect, FaultKind::Transient)
    );
    assert_eq!(
        kinds(io::Error::from(io::ErrorKind::InvalidData)),
        (FaultKind::Corrupt, FaultKind::Transient)
    );
}

#[test]
fn retry_only_keeps_unusable_and_demotes_the_rest() {
    for kind in [FaultKind::Corrupt, FaultKind::Suspect, FaultKind::Transient] {
        assert_eq!(
            Fault::new(kind, "x").retry_only().kind,
            FaultKind::Transient
        );
    }
    let fault = Fault::new(FaultKind::Unusable, "denied").retry_only();
    assert_eq!(
        (fault.kind, fault.why.as_str()),
        (FaultKind::Unusable, "denied")
    );
}

/// M1: another store's commits show up without this store committing.
#[test]
fn sees_other_stores_commits() {
    let tmp = tempfile::tempdir().unwrap();
    let a = seeded(tmp.path());
    let b = disk(tmp.path());
    assert_eq!(count(&b, "cheese"), 0);
    a.apply(&[upsert("C.md", "cheese", 3)]).unwrap();
    let deadline = Instant::now() + Duration::from_millis(1500);
    while count(&b, "cheese") == 0 {
        assert!(Instant::now() < deadline, "b never saw a's commit");
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(b.stamps().len(), 3);
}

/// M2: merges finish, so many small batches don't pile up segments.
#[test]
fn segment_count_stays_bounded() {
    // RAM keeps it fast; merging works the same as on disk.
    let store = IndexStore::open(Location::Memory);
    for round in 0..3 {
        for i in 0..20 {
            store
                .apply(&[upsert(&format!("P{i}.md"), "some words", round)])
                .unwrap();
        }
    }
    assert_eq!(store.stamps().len(), 20);
    let segments = store.searcher().segment_readers().len();
    assert!(segments <= 8, "{segments} segments");
}

/// M5: two stores on one directory racing real `apply` calls.
#[test]
fn racing_applies_on_two_stores_both_land() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    let stores = [
        std::sync::Arc::new(disk(tmp.path())),
        std::sync::Arc::new(disk(tmp.path())),
    ];
    let handles: Vec<_> = stores
        .iter()
        .enumerate()
        .map(|(n, store)| {
            let store = store.clone();
            std::thread::spawn(move || {
                let mut busy = 0;
                for i in 0..10 {
                    let change = || upsert(&format!("S{n}-{i}.md"), "racing", i);
                    loop {
                        match store.apply(&[change()]) {
                            Ok(()) => break,
                            Err(StoreError::LockBusy) => {
                                busy += 1;
                                std::thread::sleep(Duration::from_millis(5));
                            }
                            Err(e) => panic!("{e}"),
                        }
                    }
                }
                busy
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let check = disk(tmp.path());
    let stamps = check.stamps();
    assert_eq!(stamps.len(), 22, "{:?}", stamps.keys());
    assert_eq!(count(&check, "racing"), 20);
}

#[test]
fn memory_store_works_the_same() {
    let store = IndexStore::open(Location::Memory);
    assert!(store.is_memory());
    store
        .apply(&[
            upsert("Garden.md", "tomatoes and basil", 1),
            upsert("Kitchen.md", "bread and butter", 2),
        ])
        .unwrap();
    assert_eq!(count(&store, "basil"), 1);
    store
        .apply(&[
            upsert("Garden.md", "tomatoes and parsley", 3),
            Change::Delete {
                path: "Kitchen.md".into(),
            },
        ])
        .unwrap();
    assert_eq!(count(&store, "basil"), 0);
    assert_eq!(count(&store, "bread"), 0);
    let stamps = store.stamps();
    assert_eq!(stamps.len(), 1);
    assert_eq!(stamps["Garden.md"], stamp(3));
}

#[test]
fn opened_indexes_have_tokenizers() {
    let tmp = tempfile::tempdir().unwrap();
    drop(seeded(tmp.path()));
    for store in [disk(tmp.path()), IndexStore::open(Location::Memory)] {
        let t = store.index().tokenizers();
        assert!(t.get(crate::fulltext::schema::RAW_TOKENIZER).is_some());
        assert!(t.get("stem_nl").is_some());
    }
}

#[test]
fn store_errors_hide_details_from_clients() {
    let e: SearchError = StoreError::Failed("/secret/path/meta.json".into()).into();
    assert_eq!(
        e.to_string(),
        SearchError::Failed(FAILED_MESSAGE.into()).to_string()
    );
    assert!(matches!(
        SearchError::from(StoreError::LockBusy),
        SearchError::Busy
    ));
}
