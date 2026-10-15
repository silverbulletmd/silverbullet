//! The full-text index store: one Tantivy index per space, on disk under
//! `<space dir>/fulltext-v3/` or in RAM.
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

use super::analysis::register_tokenizers;
use super::schema::{document, schema, Fields};
use crate::error::SearchError;
use crate::index::{
    Change, FileStamp, IndexSink, Location, Opened, SinkError, SinkLimits, WhileReconciling,
};
use crate::job::FAILED_MESSAGE;
use crate::IndexKind;

/// The store's write errors are the sink errors (the name its tests use).
#[cfg(test)]
pub(crate) use crate::index::SinkError as StoreError;

/// Name of the index directory inside the space's search directory. Bump it
/// when the schema or analyzers change, so old indexes are rebuilt.
pub const SCHEMA_DIR: &str = "fulltext-v3";
/// Indexing memory budget of the (single-threaded) writer.
pub const WRITER_MEMORY: usize = 32_000_000;
/// Marker written after the first successful commit.
const VERSION_FILE: &str = "version.json";
/// How long `open` keeps retrying a disk index that is temporarily unusable
/// (about one batch commit of another instance) before falling back to RAM.
pub const OPEN_RETRY: Duration = Duration::from_secs(5);
const OPEN_RETRY_SLEEP: Duration = Duration::from_millis(200);
/// Consecutive [`FaultKind::Suspect`] attempts before they count as corruption.
const SUSPECT_TRIES: u32 = 3;
/// Doc store blocks cached while reading stamps.
const STORE_CACHE_BLOCKS: usize = 10;

/// Pages per commit. Each disk commit has a fixed cost, so changes are
/// coalesced into batches of up to this many.
pub const BATCH_PAGES: usize = 1000;
/// Page text per commit: a batch is cut once its texts reach this many bytes,
/// so one batch holds at most this plus one page (`MAX_FILE_BYTES`).
pub const BATCH_BYTES: u64 = 64 * 1024 * 1024;
/// Reconciles that change more than [`BATCH_PAGES`] pages that may run at
/// once, server-wide.
pub const INDEX_BUILDS: usize = 1;

static BUILD_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(INDEX_BUILDS);

impl From<SinkError> for SearchError {
    fn from(e: SinkError) -> SearchError {
        match e {
            SinkError::LockBusy => SearchError::Busy,
            SinkError::Failed(detail) => {
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

/// What kind of trouble one attempt to open the disk index met.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultKind {
    /// Definitely damaged or foreign: rebuild.
    Corrupt,
    /// Looks damaged but can also be a race, e.g. a segment the other
    /// instance's garbage collection removed between our reads: retry, and
    /// rebuild only when it persists for [`SUSPECT_TRIES`] attempts.
    Suspect,
    /// Temporary or not about the index contents (lock held, a concurrent
    /// create, EMFILE): retry, never delete.
    Transient,
    /// The directory can't be used at all (permission denied, read-only file
    /// system, a file in the way): RAM at once, never delete.
    Unusable,
}

/// Why one attempt to open the disk index failed.
#[derive(Debug)]
struct Fault {
    kind: FaultKind,
    /// For the server log only: it can name files.
    why: String,
}

impl Fault {
    fn new(kind: FaultKind, why: impl Into<String>) -> Fault {
        Fault {
            kind,
            why: why.into(),
        }
    }

    /// For a step whose failure never calls for a rebuild (reading
    /// `version.json`, creating the directory or the index, removing old
    /// files): an unusable directory stays unusable, anything else is retried.
    fn retry_only(self) -> Fault {
        match self.kind {
            FaultKind::Unusable => self,
            _ => Fault {
                kind: FaultKind::Transient,
                ..self
            },
        }
    }
}

fn io_fault(what: &str, e: &io::Error) -> Fault {
    let kind = match e.kind() {
        io::ErrorKind::PermissionDenied
        | io::ErrorKind::ReadOnlyFilesystem
        | io::ErrorKind::NotADirectory
        | io::ErrorKind::IsADirectory => FaultKind::Unusable,
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => FaultKind::Corrupt,
        io::ErrorKind::NotFound => FaultKind::Suspect,
        _ => FaultKind::Transient,
    };
    Fault::new(kind, format!("{what}: {e}"))
}

fn classify(what: &str, e: &TantivyError) -> Fault {
    use tantivy::directory::error::{OpenDirectoryError, OpenReadError, OpenWriteError};
    let kind = match e {
        TantivyError::DataCorruption(_)
        | TantivyError::IncompatibleIndex(_)
        | TantivyError::SchemaError(_)
        | TantivyError::DeserializeError(_)
        | TantivyError::OpenReadError(OpenReadError::IncompatibleIndex(_)) => FaultKind::Corrupt,
        TantivyError::OpenReadError(OpenReadError::FileDoesNotExist(_)) => FaultKind::Suspect,
        TantivyError::OpenReadError(OpenReadError::IoError { io_error, .. })
        | TantivyError::OpenWriteError(OpenWriteError::IoError { io_error, .. })
        | TantivyError::OpenDirectoryError(OpenDirectoryError::IoError { io_error, .. })
        | TantivyError::LockFailure(LockError::IoError(io_error), _)
        | TantivyError::IoError(io_error) => return io_fault(what, io_error),
        TantivyError::OpenDirectoryError(OpenDirectoryError::NotADirectory(_)) => {
            FaultKind::Unusable
        }
        _ => FaultKind::Transient,
    };
    Fault::new(kind, format!("{what}: {e}"))
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
        return Err(Fault::new(FaultKind::Corrupt, "schema differs"));
    }
    let damaged = index
        .validate_checksum()
        .map_err(|e| classify("checksum validation", &e))?;
    if !damaged.is_empty() {
        return Err(Fault::new(
            FaultKind::Corrupt,
            format!("{} damaged file(s)", damaged.len()),
        ));
    }
    let reader = reader(&index).map_err(|e| classify("reader", &e))?;
    Ok((index, reader))
}

/// A failed `version.json` read: the directory being unusable, or something
/// to retry, but never a reason to rebuild.
fn version_fault(e: &io::Error) -> Fault {
    io_fault("read version.json", e).retry_only()
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
            return Err(Fault::new(
                FaultKind::Transient,
                "another writer holds the lock",
            ))
        }
        Err(LockError::IoError(e)) => return Err(io_fault("lock", &e)),
    };
    if wipe != Wipe::No {
        // The other instance may have committed its first batch since we
        // looked: its index is then valid, so look again rather than delete.
        if wipe == Wipe::Unversioned
            && read_version(dir).map_err(|e| version_fault(&e))? == Version::Current
        {
            return Err(Fault::new(FaultKind::Transient, "the index became valid"));
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
            removed.map_err(|e| io_fault("remove", &e).retry_only())?;
        }
    }
    let index = ready(
        Index::create(mmap, schema().0, Default::default())
            .map_err(|e| classify("create index", &e).retry_only())?,
    );
    let reader = reader(&index).map_err(|e| classify("reader", &e))?;
    Ok((index, reader))
}

/// An open disk index, and how it was found.
struct DiskIndex {
    index: Index,
    reader: IndexReader,
    /// Whether `version.json` is present.
    versioned: bool,
    /// [`Opened::Reused`] or [`Opened::Fresh`].
    opened: Opened,
}

/// One attempt at the disk index in `dir`: reused when valid, otherwise
/// (re)built empty. `rebuild_suspect` turns a persistent suspect fault into
/// a rebuild.
fn open_disk(dir: &Path, rebuild_suspect: bool) -> Result<DiskIndex, Fault> {
    if dir.exists() && !dir.is_dir() {
        return Err(Fault::new(FaultKind::Unusable, "a file is in the way"));
    }
    create_dirs(dir).map_err(|e| {
        // Recursive create reports a file in the way as "already exists".
        if e.kind() == io::ErrorKind::AlreadyExists {
            Fault::new(FaultKind::Unusable, format!("create the directory: {e}"))
        } else {
            io_fault("create the directory", &e).retry_only()
        }
    })?;
    let fresh = |(index, reader): (Index, IndexReader)| DiskIndex {
        index,
        reader,
        versioned: false,
        opened: Opened::Fresh,
    };
    let (why, wipe) = match plan(dir)? {
        Plan::Create => return create(dir, Wipe::No).map(fresh),
        Plan::Rebuild(why) => (why, Wipe::Unversioned),
        // Tantivy may panic on some corrupt files instead of returning an
        // error; that counts as suspect, so a persistent panic rebuilds.
        Plan::Reuse => match catch_unwind(AssertUnwindSafe(|| open_existing(dir)))
            .unwrap_or_else(|_| Err(Fault::new(FaultKind::Suspect, "panicked while opening")))
        {
            Ok((index, reader)) => {
                let versioned = matches!(read_version(dir), Ok(Version::Current));
                return Ok(DiskIndex {
                    index,
                    reader,
                    versioned,
                    opened: Opened::Reused,
                });
            }
            Err(Fault {
                kind: FaultKind::Corrupt,
                why,
            }) => (why, Wipe::Damaged),
            Err(Fault {
                kind: FaultKind::Suspect,
                why,
            }) if rebuild_suspect => (why, Wipe::Damaged),
            Err(other) => return Err(other),
        },
    };
    let rebuilt = create(dir, wipe).map(fresh)?;
    tracing::warn!("Rebuilt the full-text index in {}: {why}", dir.display());
    Ok(rebuilt)
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
            .unwrap_or_else(|_| Err(Fault::new(FaultKind::Suspect, "panicked while opening")));
            let fault = match attempt {
                Ok(disk) => {
                    return IndexStore {
                        index: disk.index,
                        reader: disk.reader,
                        fields: schema().1,
                        dir: Some(dir),
                        versioned: AtomicBool::new(disk.versioned),
                        opened: disk.opened,
                        writing: Mutex::new(()),
                    }
                }
                Err(fault) => fault,
            };
            if fault.kind == FaultKind::Suspect {
                suspects += 1;
            } else {
                suspects = 0;
            }
            if fault.kind == FaultKind::Unusable || Instant::now() >= deadline {
                tracing::warn!(
                    "Can't use the full-text index directory {} ({}); keeping the index in memory",
                    dir.display(),
                    fault.why
                );
                return IndexStore::memory();
            }
            tracing::debug!(
                "Full-text index {} not ready ({}); retrying",
                dir.display(),
                fault.why
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

impl IndexSink for IndexStore {
    fn kind(&self) -> IndexKind {
        IndexKind::FullText
    }

    /// Only a reused index was built before this worker; the worker knows
    /// its own first build.
    fn built_once(&self) -> bool {
        self.opened == Opened::Reused
    }

    /// Path → stamp of every page in the committed index.
    fn stamps(&self) -> HashMap<String, FileStamp> {
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

    /// Applies `changes` in one commit (every upsert first deletes its path),
    /// then reloads the reader, so the changes are searchable on return.
    fn apply(&self, changes: &[Change]) -> Result<(), SinkError> {
        let _guard = self.writing.lock().unwrap_or_else(|e| e.into_inner());
        let mut writer: IndexWriter = match self.index.writer_with_num_threads(1, WRITER_MEMORY) {
            Ok(w) => w,
            Err(TantivyError::LockFailure(LockError::LockBusy, _)) => {
                return Err(SinkError::LockBusy)
            }
            Err(e) => return Err(SinkError::Failed(format!("open writer: {e}"))),
        };
        let fail = |what: &str, e: TantivyError| SinkError::Failed(format!("{what}: {e}"));
        for change in changes {
            match change {
                Change::Upsert { path, text, stamp } => {
                    writer.delete_term(Term::from_field_text(self.fields.path, path));
                    writer
                        .add_document(document(&self.fields, path, text, *stamp))
                        .map_err(|e| fail("add document", e))?;
                }
                Change::Delete { path } => {
                    writer.delete_term(Term::from_field_text(self.fields.path, path));
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

    fn measure(&self) -> (u64, u64) {
        (self.pages(), self.size_bytes())
    }

    fn is_memory(&self) -> bool {
        IndexStore::is_memory(self)
    }

    fn limits(&self) -> SinkLimits {
        SinkLimits {
            batch_pages: BATCH_PAGES,
            batch_bytes: BATCH_BYTES,
            builds: &BUILD_SLOTS,
            while_reconciling: WhileReconciling::ReportBuilding,
        }
    }
}

#[cfg(test)]
mod tests;
