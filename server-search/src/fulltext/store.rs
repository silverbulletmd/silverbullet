//! The full-text index store: one Tantivy index per space, on disk under
//! `<space dir>/fulltext-v2/` or in RAM.
//!
//! The disk index heals itself. A directory whose `version.json` names another
//! schema or Tantivy version, that has segment files but no `version.json`, or
//! whose index is definitely damaged is deleted and rebuilt empty, but only
//! while holding the writer lock, so a live instance's index is never wiped.
//! Temporary trouble is retried for a few seconds; a directory that stays
//! unusable gives a RAM store and one warning, so a broken index never stops
//! the space.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tantivy::directory::error::LockError;
use tantivy::directory::{Directory, MmapDirectory, INDEX_WRITER_LOCK};
use tantivy::schema::Value;
use tantivy::{
    Index, IndexReader, IndexWriter, ReloadPolicy, Searcher, TantivyDocument, TantivyError, Term,
};

use super::query::FAILED_MESSAGE;
use super::{document, register_tokenizers, schema, Fields};
use crate::backend::FileStamp;
use crate::error::SearchError;

/// Name of the index directory inside the space's search directory. Bump it
/// when the schema or analyzers change, so old indexes are rebuilt.
pub const SCHEMA_DIR: &str = "fulltext-v2";
/// Indexing memory budget of the (single-threaded) writer.
pub const WRITER_MEMORY: usize = 32_000_000;
/// Marker written after the first successful commit.
const VERSION_FILE: &str = "version.json";
/// How long `open` keeps retrying a disk index that is temporarily unusable
/// (about one batch commit of another instance) before falling back to RAM.
pub const OPEN_RETRY: Duration = Duration::from_secs(5);
const OPEN_RETRY_SLEEP: Duration = Duration::from_millis(200);
/// Consecutive [`Fault::Suspect`] attempts before they count as corruption.
const SUSPECT_TRIES: u32 = 3;
/// Doc store blocks cached while reading stamps.
const STORE_CACHE_BLOCKS: usize = 10;

pub enum Location {
    /// The space's search directory (`.../<space-id>`); the store adds
    /// [`SCHEMA_DIR`].
    Disk(PathBuf),
    Memory,
}

/// How [`IndexStore::open`] found the index, for the startup log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opened {
    /// A valid disk index from an earlier run.
    Reused,
    /// A disk index created empty (none yet, or the old one was rebuilt).
    Fresh,
    /// A RAM index (asked for, or the disk fallback).
    Memory,
}

pub enum Change {
    Upsert {
        path: String,
        text: String,
        stamp: FileStamp,
    },
    Delete {
        path: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Another writer (usually another instance of the same space) holds the
    /// index lock.
    #[error("the index is locked by another writer")]
    LockBusy,
    /// Details for the server log only; they can name files.
    #[error("index write failed: {0}")]
    Failed(String),
}

impl From<StoreError> for SearchError {
    fn from(e: StoreError) -> SearchError {
        match e {
            StoreError::LockBusy => SearchError::Busy,
            StoreError::Failed(detail) => {
                tracing::warn!("full-text index write failed: {detail}");
                SearchError::Failed(FAILED_MESSAGE.into())
            }
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
struct VersionFile {
    schema: String,
    tantivy: String,
}

fn current_version() -> VersionFile {
    VersionFile {
        schema: SCHEMA_DIR.into(),
        tantivy: env_tantivy_version(),
    }
}

fn env_tantivy_version() -> String {
    // `tantivy::version()` only implements Display as "tantivy vX.Y.Z, index_format vN".
    let full = tantivy::version().to_string();
    full.strip_prefix("tantivy v")
        .and_then(|rest| rest.split(',').next())
        .unwrap_or(&full)
        .to_string()
}

pub struct IndexStore {
    index: Index,
    reader: IndexReader,
    fields: Fields,
    /// The index directory (with [`SCHEMA_DIR`]); `None` for RAM.
    dir: Option<PathBuf>,
    /// Whether `version.json` is known to be on disk.
    versioned: AtomicBool,
    opened: Opened,
    /// Serializes this store's own writers, so only other stores see `LockBusy`.
    writing: Mutex<()>,
}

/// Every index the store uses goes through here, so none lacks the
/// custom tokenizers.
fn ready(index: Index) -> Index {
    register_tokenizers(&index);
    index
}

fn reader(index: &Index) -> tantivy::Result<IndexReader> {
    index
        .reader_builder()
        // Also picks up another instance's commits on the same directory;
        // `apply` still reloads explicitly so its own changes are visible on
        // return.
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
}

#[cfg(unix)]
fn create_dirs(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
}

#[cfg(not(unix))]
fn create_dirs(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)
}

/// What `version.json` says.
#[derive(Debug, PartialEq, Eq)]
enum Version {
    Missing,
    Current,
    /// Another schema or Tantivy version, or not parseable: rebuild.
    Other(String),
}

/// Reads `version.json`. IO errors other than "not found" are returned, so
/// that a transient read failure is retried rather than taken for a mismatch.
fn read_version(dir: &Path) -> io::Result<Version> {
    let bytes = match fs::read(dir.join(VERSION_FILE)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Version::Missing),
        Err(e) => return Err(e),
    };
    Ok(match serde_json::from_slice::<VersionFile>(&bytes) {
        Ok(v) if v == current_version() => Version::Current,
        Ok(v) => Version::Other(format!(
            "it was built for {} with Tantivy {}",
            v.schema, v.tantivy
        )),
        Err(_) => Version::Other("its version.json is unreadable".into()),
    })
}

fn write_version(dir: &Path) -> io::Result<()> {
    let tmp = dir.join(format!("{VERSION_FILE}.tmp"));
    let json = serde_json::to_vec(&current_version()).map_err(io::Error::other)?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, dir.join(VERSION_FILE))
}

/// Why one attempt to open the disk index failed.
#[derive(Debug)]
enum Fault {
    /// Definitely damaged or foreign: rebuild.
    Corrupt(String),
    /// Looks damaged but can also be a race, e.g. a segment the other
    /// instance's garbage collection removed between our reads: retry, and
    /// rebuild only when it persists for [`SUSPECT_TRIES`] attempts.
    Suspect(String),
    /// Temporary or not about the index contents (lock held, a concurrent
    /// create, EMFILE): retry, never delete.
    Transient(String),
    /// The directory can't be used at all (permission denied, read-only file
    /// system, a file in the way): RAM at once, never delete.
    Unusable(String),
}

impl Fault {
    fn why(&self) -> &str {
        match self {
            Fault::Corrupt(w) | Fault::Suspect(w) | Fault::Transient(w) | Fault::Unusable(w) => w,
        }
    }
}

fn io_fault(what: &str, e: &io::Error) -> Fault {
    match e.kind() {
        io::ErrorKind::PermissionDenied
        | io::ErrorKind::ReadOnlyFilesystem
        | io::ErrorKind::NotADirectory
        | io::ErrorKind::IsADirectory => Fault::Unusable(format!("{what}: {e}")),
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => {
            Fault::Corrupt(format!("{what}: {e}"))
        }
        io::ErrorKind::NotFound => Fault::Suspect(format!("{what}: {e}")),
        _ => Fault::Transient(format!("{what}: {e}")),
    }
}

fn classify(what: &str, e: &TantivyError) -> Fault {
    use tantivy::directory::error::{OpenDirectoryError, OpenReadError, OpenWriteError};
    match e {
        TantivyError::DataCorruption(_)
        | TantivyError::IncompatibleIndex(_)
        | TantivyError::SchemaError(_)
        | TantivyError::DeserializeError(_)
        | TantivyError::OpenReadError(OpenReadError::IncompatibleIndex(_)) => {
            Fault::Corrupt(format!("{what}: {e}"))
        }
        TantivyError::OpenReadError(OpenReadError::FileDoesNotExist(_)) => {
            Fault::Suspect(format!("{what}: {e}"))
        }
        TantivyError::OpenReadError(OpenReadError::IoError { io_error, .. })
        | TantivyError::OpenWriteError(OpenWriteError::IoError { io_error, .. })
        | TantivyError::OpenDirectoryError(OpenDirectoryError::IoError { io_error, .. })
        | TantivyError::LockFailure(LockError::IoError(io_error), _)
        | TantivyError::IoError(io_error) => io_fault(what, io_error),
        TantivyError::OpenDirectoryError(OpenDirectoryError::NotADirectory(_)) => {
            Fault::Unusable(format!("{what}: {e}"))
        }
        _ => Fault::Transient(format!("{what}: {e}")),
    }
}

/// Opens the existing index in `dir`.
///
/// `validate_checksum` only covers files listed in `.managed.json`; opening
/// the reader still catches missing segment files and most damage when that
/// list was lost, so the checksum is defence in depth, not the only check.
fn open_existing(dir: &Path) -> Result<(Index, IndexReader), Fault> {
    #[cfg(test)]
    if dir.join(tests::PANIC_ON_OPEN).exists() {
        panic!("test: corrupt index that makes Tantivy panic");
    }
    let index = ready(Index::open_in_dir(dir).map_err(|e| classify("open", &e))?);
    if index.schema() != schema().0 {
        return Err(Fault::Corrupt("schema differs".into()));
    }
    let damaged = index
        .validate_checksum()
        .map_err(|e| classify("checksum validation", &e))?;
    if !damaged.is_empty() {
        return Err(Fault::Corrupt(format!("{} damaged file(s)", damaged.len())));
    }
    let reader = reader(&index).map_err(|e| classify("reader", &e))?;
    Ok((index, reader))
}

/// A failed `version.json` read: the directory being unusable, or something
/// to retry, but never a reason to rebuild.
fn version_fault(e: &io::Error) -> Fault {
    match io_fault("read version.json", e) {
        f @ Fault::Unusable(_) => f,
        other => Fault::Transient(other.why().to_string()),
    }
}

/// What the directory's contents call for.
enum Plan {
    /// `version.json` is current, or there is an index without segments.
    Reuse,
    /// Nothing there yet.
    Create,
    Rebuild(String),
}

fn plan(dir: &Path) -> Result<Plan, Fault> {
    let entries = fs::read_dir(dir).map_err(|e| io_fault("list", &e))?;
    let mut has_meta = false;
    let mut has_segments = false;
    for entry in entries {
        let entry = entry.map_err(|e| io_fault("list", &e))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "meta.json" {
            has_meta = true;
        } else if name != VERSION_FILE && !name.starts_with('.') {
            has_segments = true;
        }
    }
    let version = read_version(dir).map_err(|e| version_fault(&e))?;
    Ok(match version {
        Version::Current => Plan::Reuse,
        Version::Other(why) => Plan::Rebuild(why),
        Version::Missing if has_segments => {
            Plan::Rebuild("it has index files but no version.json".into())
        }
        // An index created but never committed to; the schema check vets it.
        Version::Missing if has_meta => Plan::Reuse,
        Version::Missing => Plan::Create,
    })
}

/// What [`create`] does with the directory's current contents.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Wipe {
    /// Nothing there to delete.
    No,
    /// Delete: the index was found damaged.
    Damaged,
    /// Delete because of its `version.json` (missing, foreign or unreadable),
    /// unless it became current meanwhile.
    Unversioned,
}

/// Creates an empty index in `dir`, first deleting what is there per `wipe`. Holds the writer lock throughout, so it never pulls an index out
/// from under a live writer (another instance mid-batch) and never races
/// another create; when the lock is busy, the caller retries.
fn create(dir: &Path, wipe: Wipe) -> Result<(Index, IndexReader), Fault> {
    let mmap = MmapDirectory::open(dir).map_err(|e| classify("open dir", &e.into()))?;
    let _lock = match mmap.acquire_lock(&INDEX_WRITER_LOCK) {
        Ok(lock) => lock,
        Err(LockError::LockBusy) => {
            return Err(Fault::Transient("another writer holds the lock".into()))
        }
        Err(LockError::IoError(e)) => return Err(io_fault("lock", &e)),
    };
    if wipe != Wipe::No {
        // The other instance may have committed its first batch since we
        // looked: its index is then valid, so look again rather than delete.
        if wipe == Wipe::Unversioned
            && read_version(dir).map_err(|e| version_fault(&e))? == Version::Current
        {
            return Err(Fault::Transient("the index became valid".into()));
        }
        for entry in fs::read_dir(dir).map_err(|e| io_fault("list", &e))? {
            let path = entry.map_err(|e| io_fault("list", &e))?.path();
            if path.file_name() == Some(INDEX_WRITER_LOCK.filepath.as_os_str()) {
                continue;
            }
            let removed = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            removed.map_err(|e| match io_fault("remove", &e) {
                f @ Fault::Unusable(_) => f,
                other => Fault::Transient(other.why().to_string()),
            })?;
        }
    }
    let index = ready(
        Index::create(mmap, schema().0, Default::default()).map_err(|e| {
            match classify("create index", &e) {
                f @ Fault::Unusable(_) => f,
                other => Fault::Transient(other.why().to_string()),
            }
        })?,
    );
    let reader = reader(&index).map_err(|e| classify("reader", &e))?;
    Ok((index, reader))
}

/// One attempt at the disk index in `dir`: reused when valid, otherwise
/// (re)built empty. `rebuild_suspect` turns a persistent [`Fault::Suspect`]
/// into a rebuild. Returns whether `version.json` is present and whether the
/// index was reused (not created empty).
fn open_disk(dir: &Path, rebuild_suspect: bool) -> Result<(Index, IndexReader, bool, bool), Fault> {
    if dir.exists() && !dir.is_dir() {
        return Err(Fault::Unusable("a file is in the way".into()));
    }
    create_dirs(dir).map_err(|e| match io_fault("create the directory", &e) {
        // Recursive create reports a file in the way as "already exists".
        _ if e.kind() == io::ErrorKind::AlreadyExists => {
            Fault::Unusable(format!("create the directory: {e}"))
        }
        f @ Fault::Unusable(_) => f,
        other => Fault::Transient(other.why().to_string()),
    })?;
    let (why, wipe) = match plan(dir)? {
        Plan::Create => return create(dir, Wipe::No).map(|(i, r)| (i, r, false, false)),
        Plan::Rebuild(why) => (why, Wipe::Unversioned),
        // Tantivy may panic on some corrupt files instead of returning an
        // error; that counts as suspect, so a persistent panic rebuilds.
        Plan::Reuse => match catch_unwind(AssertUnwindSafe(|| open_existing(dir)))
            .unwrap_or_else(|_| Err(Fault::Suspect("panicked while opening".into())))
        {
            Ok((index, reader)) => {
                let versioned = matches!(read_version(dir), Ok(Version::Current));
                return Ok((index, reader, versioned, true));
            }
            Err(Fault::Corrupt(why)) => (why, Wipe::Damaged),
            Err(Fault::Suspect(why)) if rebuild_suspect => (why, Wipe::Damaged),
            Err(other) => return Err(other),
        },
    };
    let opened = create(dir, wipe)?;
    tracing::warn!("Rebuilt the full-text index in {}: {why}", dir.display());
    Ok((opened.0, opened.1, false, false))
}

impl IndexStore {
    /// Opens or creates the store. A corrupt or foreign-version directory is
    /// deleted and recreated. Temporary trouble (another instance holding the
    /// writer, a concurrent create, IO errors such as EMFILE, files that look
    /// damaged but may be mid-GC) is retried for up to [`OPEN_RETRY`]. A
    /// directory that is definitely unusable (permission denied, read-only,
    /// a file in the way) falls back at once. Either fallback logs one
    /// warning, returns a RAM store and leaves the directory as it is.
    ///
    /// Blocks (file IO, checksums, retry sleeps): async callers run it in
    /// `spawn_blocking`.
    pub fn open(location: Location) -> IndexStore {
        IndexStore::open_within(location, OPEN_RETRY)
    }

    fn open_within(location: Location, retry: Duration) -> IndexStore {
        let Location::Disk(base) = location else {
            return IndexStore::memory();
        };
        let dir = base.join(SCHEMA_DIR);
        let deadline = Instant::now() + retry;
        let mut suspects = 0;
        loop {
            // Last resort for a panic outside `open_existing` (e.g. while
            // creating): retried like any suspect state.
            let attempt = catch_unwind(AssertUnwindSafe(|| {
                open_disk(&dir, suspects >= SUSPECT_TRIES)
            }))
            .unwrap_or_else(|_| Err(Fault::Suspect("panicked while opening".into())));
            let fault = match attempt {
                Ok((index, reader, versioned, reused)) => {
                    return IndexStore {
                        index,
                        reader,
                        fields: schema().1,
                        dir: Some(dir),
                        versioned: AtomicBool::new(versioned),
                        opened: if reused {
                            Opened::Reused
                        } else {
                            Opened::Fresh
                        },
                        writing: Mutex::new(()),
                    }
                }
                Err(fault) => fault,
            };
            if matches!(fault, Fault::Suspect(_)) {
                suspects += 1;
            } else {
                suspects = 0;
            }
            if matches!(fault, Fault::Unusable(_)) || Instant::now() >= deadline {
                tracing::warn!(
                    "Can't use the full-text index directory {} ({}); keeping the index in memory",
                    dir.display(),
                    fault.why()
                );
                return IndexStore::memory();
            }
            tracing::debug!(
                "Full-text index {} not ready ({}); retrying",
                dir.display(),
                fault.why()
            );
            std::thread::sleep(OPEN_RETRY_SLEEP);
        }
    }

    fn memory() -> IndexStore {
        let (schema, fields) = schema();
        let index = ready(Index::create_in_ram(schema));
        let reader = reader(&index).expect("RAM index reader");
        IndexStore {
            index,
            reader,
            fields,
            dir: None,
            versioned: AtomicBool::new(true),
            opened: Opened::Memory,
            writing: Mutex::new(()),
        }
    }

    pub fn is_memory(&self) -> bool {
        self.dir.is_none()
    }

    pub fn opened(&self) -> Opened {
        self.opened
    }

    /// Pages in the committed index.
    pub fn pages(&self) -> u64 {
        self.reader.searcher().num_docs()
    }

    /// The index's size: the bytes of its directory's files on disk, or
    /// Tantivy's space usage of a RAM index (0 when unknown).
    pub fn size_bytes(&self) -> u64 {
        match &self.dir {
            Some(dir) => fs::read_dir(dir)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok()?.metadata().ok())
                        .filter(|m| m.is_file())
                        .map(|m| m.len())
                        .sum()
                })
                .unwrap_or(0),
            None => self
                .reader
                .searcher()
                .space_usage()
                .map(|u| u.total().get_bytes())
                .unwrap_or(0),
        }
    }

    /// Applies `changes` in one commit (every upsert first deletes its path),
    /// then reloads the reader, so the changes are searchable on return.
    pub fn apply(&self, changes: Vec<Change>) -> Result<(), StoreError> {
        let _guard = self.writing.lock().unwrap_or_else(|e| e.into_inner());
        let mut writer: IndexWriter = match self.index.writer_with_num_threads(1, WRITER_MEMORY) {
            Ok(w) => w,
            Err(TantivyError::LockFailure(LockError::LockBusy, _)) => {
                return Err(StoreError::LockBusy)
            }
            Err(e) => return Err(StoreError::Failed(format!("open writer: {e}"))),
        };
        let fail = |what: &str, e: TantivyError| StoreError::Failed(format!("{what}: {e}"));
        for change in changes {
            match change {
                Change::Upsert { path, text, stamp } => {
                    writer.delete_term(Term::from_field_text(self.fields.path, &path));
                    writer
                        .add_document(document(&self.fields, &path, &text, stamp))
                        .map_err(|e| fail("add document", e))?;
                }
                Change::Delete { path } => {
                    writer.delete_term(Term::from_field_text(self.fields.path, &path));
                }
            }
        }
        writer.commit().map_err(|e| fail("commit", e))?;
        // Written while the writer lock is still held, so another instance
        // waiting to rebuild an unversioned index sees it before it can wipe.
        if let Some(dir) = &self.dir {
            if !self.versioned.load(Ordering::Acquire) {
                match write_version(dir) {
                    Ok(()) => self.versioned.store(true, Ordering::Release),
                    Err(e) => tracing::warn!(
                        "Can't write {} in {}: {e}; the index will be rebuilt on the next start",
                        VERSION_FILE,
                        dir.display()
                    ),
                }
            }
        }
        // Let merges finish before the lock is released; dropping the writer
        // would discard them and leave orphan files.
        if let Err(e) = writer.wait_merging_threads() {
            tracing::warn!("Full-text index merge failed: {e}");
        }
        self.reader.reload().map_err(|e| fail("reload reader", e))
    }

    /// Path → stamp of every page in the committed index.
    pub fn stamps(&self) -> HashMap<String, FileStamp> {
        let searcher = self.reader.searcher();
        let mut out = HashMap::new();
        for segment in searcher.segment_readers() {
            let store = match segment.get_store_reader(STORE_CACHE_BLOCKS) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("Can't read full-text index stamps: {e}");
                    continue;
                }
            };
            for doc in store.iter::<TantivyDocument>(segment.alive_bitset()) {
                let doc = match doc {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::warn!("Can't read a full-text index document: {e}");
                        continue;
                    }
                };
                let path = doc.get_first(self.fields.path).and_then(|v| v.as_str());
                let modified = doc.get_first(self.fields.modified).and_then(|v| v.as_i64());
                let size = doc.get_first(self.fields.size).and_then(|v| v.as_u64());
                if let (Some(path), Some(modified), Some(size)) = (path, modified, size) {
                    out.insert(path.to_string(), FileStamp { modified, size });
                }
            }
        }
        out
    }

    pub fn searcher(&self) -> Searcher {
        self.reader.searcher()
    }

    pub fn index(&self) -> &Index {
        &self.index
    }

    pub fn fields(&self) -> &Fields {
        &self.fields
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            .apply(vec![
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
        memory.apply(vec![upsert("A.md", "alpha", 1)]).unwrap();
        assert_eq!(memory.pages(), 1);
        assert!(memory.size_bytes() > 0);
    }

    #[test]
    fn upsert_replaces_and_delete_removes() {
        let tmp = tempfile::tempdir().unwrap();
        let store = seeded(tmp.path());
        store
            .apply(vec![upsert("Garden.md", "tomatoes and parsley", 5)])
            .unwrap();
        assert_eq!(count(&store, "basil"), 0);
        assert_eq!(count(&store, "parsley"), 1);
        assert_eq!(count(&store, "tomatoes"), 1);
        assert_eq!(store.stamps()["Garden.md"], stamp(5));

        store
            .apply(vec![Change::Delete {
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
            .apply(vec![
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
        store
            .apply(vec![upsert("New.md", "fresh start", 9)])
            .unwrap();
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
        store.apply(vec![upsert("A.md", "alpha", 1)]).unwrap();
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
        store.apply(vec![upsert("A.md", "alpha", 1)]).unwrap();
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
            let err = second.apply(vec![upsert("C.md", "cheese", 3)]).unwrap_err();
            assert!(matches!(err, StoreError::LockBusy), "{err:?}");
        }
        second.apply(vec![upsert("C.md", "cheese", 3)]).unwrap();
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
        second.apply(vec![upsert("A.md", "alpha", 1)]).unwrap();
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
        let emfile = io::Error::from_raw_os_error(24);
        assert!(matches!(io_fault("x", &emfile), Fault::Transient(_)));
        assert!(matches!(version_fault(&emfile), Fault::Transient(_)));
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(io_fault("x", &denied), Fault::Unusable(_)));
        let rofs = io::Error::from(io::ErrorKind::ReadOnlyFilesystem);
        assert!(matches!(io_fault("x", &rofs), Fault::Unusable(_)));
        let gone = io::Error::from(io::ErrorKind::NotFound);
        assert!(matches!(io_fault("x", &gone), Fault::Suspect(_)));
        assert!(matches!(version_fault(&gone), Fault::Transient(_)));
        let bad = io::Error::from(io::ErrorKind::InvalidData);
        assert!(matches!(io_fault("x", &bad), Fault::Corrupt(_)));
        assert!(matches!(version_fault(&bad), Fault::Transient(_)));
    }

    /// M1: another store's commits show up without this store committing.
    #[test]
    fn sees_other_stores_commits() {
        let tmp = tempfile::tempdir().unwrap();
        let a = seeded(tmp.path());
        let b = disk(tmp.path());
        assert_eq!(count(&b, "cheese"), 0);
        a.apply(vec![upsert("C.md", "cheese", 3)]).unwrap();
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
                    .apply(vec![upsert(&format!("P{i}.md"), "some words", round)])
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
                            match store.apply(vec![change()]) {
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
            .apply(vec![
                upsert("Garden.md", "tomatoes and basil", 1),
                upsert("Kitchen.md", "bread and butter", 2),
            ])
            .unwrap();
        assert_eq!(count(&store, "basil"), 1);
        store
            .apply(vec![
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
            assert!(t.get(super::super::RAW_TOKENIZER).is_some());
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
}
