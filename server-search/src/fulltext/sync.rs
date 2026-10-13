//! Keeps a space's full-text index in step with storage.
//!
//! One worker task per space. It starts with a reconcile (storage's listing
//! against the stamps in the index), then applies the change feed, debounced
//! and coalesced per path, and reconciles again on a `None` event (a lagged
//! feed) and every [`RECONCILE_EVERY`]. Every change re-reads the file when it
//! is applied, so whatever order events arrive in, the index ends up with the
//! content storage had at the last read, and a path storage no longer exposes
//! is deleted. A failed listing never deletes anything.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, watch, Semaphore, SemaphorePermit};
use tokio::task::JoinHandle;
use tokio::time::{sleep, sleep_until, Instant};
use tokio_util::sync::CancellationToken;

use super::store::{Change, IndexStore, Opened, StoreError};
use crate::backend::{FileStamp, SpaceView};
use crate::limits::MAX_FILE_BYTES;

/// Pages per commit. Each disk commit has a fixed cost, so changes are
/// coalesced into batches of up to this many.
pub const BATCH_PAGES: usize = 1000;
/// Page text per commit: a batch is cut once its texts reach this many bytes,
/// so one batch holds at most this plus one page ([`MAX_FILE_BYTES`]).
pub const BATCH_BYTES: u64 = 64 * 1024 * 1024;
/// How long change events are collected after the first one before they are
/// applied. A fixed window (not reset by later events), so steady autosaves
/// still reach the index every half second.
pub const DEBOUNCE: Duration = Duration::from_millis(500);
/// Full reconcile interval, for changes the feed missed (edits made outside
/// the server, dropped events).
pub const RECONCILE_EVERY: Duration = Duration::from_secs(10 * 60);
/// Reconciles that change more than [`BATCH_PAGES`] pages that may run at
/// once, server-wide.
pub const INDEX_BUILDS: usize = 1;
/// How often a commit refused with [`StoreError::LockBusy`] is retried (the
/// batch is re-read each time), for up to [`RETRY_LATER`].
const LOCK_RETRY_EVERY: Duration = Duration::from_secs(1);
/// After giving up (lock busy that long, a failed write, a failed listing):
/// the changes are dropped and a full reconcile runs this much later.
const RETRY_LATER: Duration = Duration::from_secs(30);
/// What [`SyncState::Failed`] says; the details go to the server log only.
const FAILED_MESSAGE: &str = "The full-text index can't be updated";

static BUILD_SLOTS: Semaphore = Semaphore::const_new(INDEX_BUILDS);

/// Paths (space-relative, as storage names them) that may have changed;
/// `None` = "rescan everything" (e.g. a lagged feed).
pub type ChangeFeed = mpsc::UnboundedReceiver<Option<String>>;

#[derive(Debug, Clone, PartialEq)]
pub enum SyncState {
    /// The first reconcile, or one that changes more than [`BATCH_PAGES`]
    /// pages, is running: `done` of `total` changed pages are committed.
    Building {
        done: u64,
        total: u64,
    },
    Ready,
    /// Changes couldn't be committed; a reconcile follows, and the next
    /// successful commit clears it.
    Failed(String),
}

/// What the "index ready" log line reports, after the initial build and after
/// a reconcile that changed more than [`BATCH_PAGES`] pages.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexStats {
    /// Pages in the index.
    pub pages: u64,
    /// The index's size ([`IndexStore::size_bytes`]).
    pub bytes: u64,
    pub memory: bool,
    /// How long the reconcile took, listing included.
    pub elapsed: Duration,
    /// Pages left out because they are over [`MAX_FILE_BYTES`] or not UTF-8.
    pub skipped: u64,
    /// The reconcile updated an existing index (one reused from disk, or a
    /// large change after the first build) instead of building a new one.
    pub caught_up: bool,
}

impl IndexStats {
    /// `Search index ready (space "<name>"): 1,482 pages, 3.1 MB on disk,
    /// built in 2.4 s` (`caught up in` when [`IndexStats::caught_up`]) and,
    /// with skipped pages, `, skipped 2 (too large or not UTF-8)`.
    pub fn line(&self, name: &str) -> String {
        let mut line = format!(
            "Search index ready (space \"{name}\"): {}, {} {}, {} in {:.1} s",
            pages(self.pages),
            human_bytes(self.bytes),
            if self.memory { "in memory" } else { "on disk" },
            if self.caught_up { "caught up" } else { "built" },
            self.elapsed.as_secs_f64()
        );
        if self.skipped > 0 {
            line.push_str(&format!(
                ", skipped {} (too large or not UTF-8)",
                thousands(self.skipped)
            ));
        }
        line
    }
}

/// The startup line: how the store was opened and, when reused, its pages.
pub fn opened_line(name: &str, opened: Opened, pages_in_index: u64) -> String {
    let how = match opened {
        Opened::Reused => format!("reusing on-disk index, {}", pages(pages_in_index)),
        Opened::Fresh => "building from scratch".to_string(),
        Opened::Memory => "in memory, building".to_string(),
    };
    format!("Search index (space \"{name}\"): {how}")
}

/// `1 page`, `1,482 pages`.
fn pages(n: u64) -> String {
    let unit = if n == 1 { "page" } else { "pages" };
    format!("{} {unit}", thousands(n))
}

/// `1482` → `1,482`.
fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Bytes, KB, MB or GB (1024-based), one decimal above bytes.
fn human_bytes(n: u64) -> String {
    const UNITS: [&str; 3] = ["KB", "MB", "GB"];
    if n < 1024 {
        return format!("{n} B");
    }
    let mut value = n as f64 / 1024.0;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/// What tests wait for: the worker had nothing left to do after consuming
/// `events` feed messages, finishing `reconciles` reconciles (successful or
/// not) and making `commits` commits.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(not(test), allow(dead_code))]
struct Idle {
    events: u64,
    reconciles: u64,
    commits: u64,
}

pub struct SyncWorker {
    handle: JoinHandle<()>,
    cancel: CancellationToken,
    state: watch::Receiver<SyncState>,
    listing: watch::Receiver<bool>,
    stats: watch::Receiver<Option<IndexStats>>,
    #[cfg_attr(not(test), allow(dead_code))]
    idle: watch::Receiver<Idle>,
}

impl SyncWorker {
    /// Spawns the worker on the current tokio runtime: reconcile (list_meta
    /// vs store.stamps → upserts for new/changed, deletes for gone), then
    /// apply the feed debounced by [`DEBOUNCE`], a full reconcile on `None`
    /// and every [`RECONCILE_EVERY`]. Reads and commits run in
    /// `spawn_blocking`. `name` identifies the space in log lines.
    pub fn spawn(
        name: &str,
        store: Arc<IndexStore>,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
    ) -> SyncWorker {
        SyncWorker::spawn_with(name, store, view, feed, &BUILD_SLOTS, BATCH_BYTES)
    }

    /// [`SyncWorker::spawn`] with its own build slots and byte cap (tests).
    fn spawn_with(
        name: &str,
        store: Arc<IndexStore>,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
        slots: &'static Semaphore,
        batch_bytes: u64,
    ) -> SyncWorker {
        let cancel = CancellationToken::new();
        let (state_tx, state) = watch::channel(SyncState::Building { done: 0, total: 0 });
        let (idle_tx, idle) = watch::channel(Idle::default());
        let (listing_tx, listing) = watch::channel(false);
        let (stats_tx, stats) = watch::channel(None);
        let worker = Worker {
            name: name.into(),
            store,
            view,
            cancel: cancel.clone(),
            slots,
            batch_bytes,
            state: state_tx,
            listing: listing_tx,
            stats: stats_tx,
            idle: idle_tx,
            indexed: HashSet::new(),
            pending: BTreeSet::new(),
            rescan: false,
            events: 0,
            reconciles: 0,
            commits: 0,
            built: false,
            unlisted: false,
            skipped: 0,
        };
        let token = cancel.clone();
        let handle = tokio::spawn(async move {
            tokio::select! {
                _ = token.cancelled() => {}
                _ = worker.run(feed) => {}
            }
        });
        SyncWorker {
            handle,
            cancel,
            state,
            listing,
            stats,
            idle,
        }
    }

    pub fn state(&self) -> SyncState {
        self.state.borrow().clone()
    }

    /// Whether the last listing of the space failed. The index is then kept
    /// as it is (and, on a fresh start, stays `Building`) until listing works.
    pub fn listing_failed(&self) -> bool {
        *self.listing.borrow()
    }

    /// What the last "index ready" line reported; `None` before the first
    /// build finished.
    pub fn stats(&self) -> Option<IndexStats> {
        self.stats.borrow().clone()
    }
}

impl Drop for SyncWorker {
    /// Cancels: the task stops at its next await, and a batch being read
    /// stops before its next file.
    fn drop(&mut self) {
        self.cancel.cancel();
        self.handle.abort();
    }
}

/// The result of reading one path: its text and the stamp storage listed
/// before the read, or `None` when it must not be in the index.
type Read = (String, Option<(String, FileStamp)>);

/// One page as [`read_page`] found it.
enum Page {
    Text(String, FileStamp),
    /// Hidden, gone or not a page.
    Absent,
    /// Over [`MAX_FILE_BYTES`] or not UTF-8.
    Skipped,
}

/// Why a batch or reconcile didn't finish.
enum Stop {
    /// Lock busy for [`RETRY_LATER`], a failed write or a panicked task: the
    /// changes are dropped, the state is `Failed` and a reconcile is scheduled.
    GaveUp,
    /// Storage couldn't list the space: nothing is changed, and a reconcile
    /// is scheduled.
    Unlisted,
    Cancelled,
}

struct Worker {
    /// The space, in log lines.
    name: Arc<str>,
    store: Arc<IndexStore>,
    view: Arc<dyn SpaceView>,
    cancel: CancellationToken,
    slots: &'static Semaphore,
    batch_bytes: u64,
    state: watch::Sender<SyncState>,
    /// Whether the last listing failed, for status.
    listing: watch::Sender<bool>,
    stats: watch::Sender<Option<IndexStats>>,
    idle: watch::Sender<Idle>,
    /// Paths this worker believes are in the index: refreshed from the store
    /// on every reconcile, updated on every commit. Only used to skip deletes
    /// of paths that were never indexed.
    indexed: HashSet<String>,
    /// `.md` paths from the feed waiting to be re-read and applied.
    pending: BTreeSet<String>,
    /// A `None` event arrived: reconcile before anything else.
    rescan: bool,
    events: u64,
    reconciles: u64,
    commits: u64,
    /// The first reconcile finished.
    built: bool,
    /// The last listing failed (so the failure is logged once).
    unlisted: bool,
    /// Pages [`read_page`] skipped since the current reconcile started.
    skipped: u64,
}

impl Worker {
    async fn run(mut self, mut feed: ChangeFeed) {
        let mut feed_open = true;
        let mut next_reconcile = Instant::now();
        let mut converge_next = false;
        loop {
            if self.rescan || Instant::now() >= next_reconcile {
                self.rescan = false;
                let converging = std::mem::take(&mut converge_next);
                let outcome = self.reconcile().await;
                self.reconciles += 1;
                next_reconcile = match outcome {
                    // Pages may have changed while a multi-batch reconcile
                    // ran: check once more right away, even without events.
                    // Changes after that wait for the feed or the timer.
                    Ok(commits) if commits > 1 && !converging => {
                        converge_next = true;
                        Instant::now()
                    }
                    Ok(_) => Instant::now() + RECONCILE_EVERY,
                    Err(Stop::GaveUp | Stop::Unlisted) => Instant::now() + RETRY_LATER,
                    Err(Stop::Cancelled) => return,
                };
                continue;
            }
            if !self.pending.is_empty() {
                match self.flush().await {
                    Ok(()) => {}
                    Err(stop @ (Stop::GaveUp | Stop::Unlisted)) => {
                        if matches!(stop, Stop::Unlisted) {
                            // Nothing can be checked without a listing; the
                            // reconcile compares stamps instead.
                            self.pending.clear();
                        }
                        next_reconcile = next_reconcile.min(Instant::now() + RETRY_LATER)
                    }
                    Err(Stop::Cancelled) => return,
                }
                continue;
            }
            self.idle.send_replace(Idle {
                events: self.events,
                reconciles: self.reconciles,
                commits: self.commits,
            });
            tokio::select! {
                msg = feed.recv(), if feed_open => match msg {
                    Some(msg) => {
                        self.take(msg);
                        feed_open = self.debounce(&mut feed).await;
                    }
                    None => feed_open = false,
                },
                _ = sleep_until(next_reconcile) => {}
            }
        }
    }

    fn take(&mut self, msg: Option<String>) {
        self.events += 1;
        match msg {
            None => self.rescan = true,
            // Only Markdown pages are indexed; anything else can't be in the index.
            Some(path) if path.ends_with(".md") => {
                self.pending.insert(path);
            }
            Some(_) => {}
        }
    }

    /// Collects events for [`DEBOUNCE`] after the first one. Returns whether
    /// the feed is still open.
    async fn debounce(&mut self, feed: &mut ChangeFeed) -> bool {
        let until = Instant::now() + DEBOUNCE;
        loop {
            tokio::select! {
                biased;
                _ = sleep_until(until) => return true,
                msg = feed.recv() => match msg {
                    Some(msg) => self.take(msg),
                    None => return false,
                },
            }
        }
    }

    fn publish(&self, state: SyncState) {
        self.state.send_if_modified(|s| {
            let changed = *s != state;
            *s = state;
            changed
        });
    }

    /// Marks the state failed and gives up on the current changes.
    fn gave_up(&self) -> Stop {
        self.publish(SyncState::Failed(FAILED_MESSAGE.into()));
        Stop::GaveUp
    }

    /// The listing, or `Unlisted` (logged once per run of failures).
    fn listed(
        &mut self,
        meta: Option<HashMap<String, FileStamp>>,
    ) -> Result<HashMap<String, FileStamp>, Stop> {
        match meta {
            Some(meta) => {
                self.listing.send_replace(false);
                if std::mem::take(&mut self.unlisted) {
                    tracing::info!("Listing the space works again; updating the full-text index");
                }
                Ok(meta)
            }
            None => {
                self.listing.send_replace(true);
                if !std::mem::replace(&mut self.unlisted, true) {
                    tracing::warn!(
                        "Can't list the space; keeping the full-text index as it is and retrying in {}s",
                        RETRY_LATER.as_secs()
                    );
                }
                Err(Stop::Unlisted)
            }
        }
    }

    /// Compares storage's listing with the index and applies the difference
    /// in batches. Returns how many commits it made.
    async fn reconcile(&mut self) -> Result<u64, Stop> {
        let started = Instant::now();
        let (view, store) = (self.view.clone(), self.store.clone());
        let Some((meta, stamps)) = blocking(move || (view.list_meta(), store.stamps())).await
        else {
            return Err(self.gave_up());
        };
        let meta = self.listed(meta)?;
        self.indexed = stamps.keys().cloned().collect();
        let mut todo: Vec<String> = meta
            .iter()
            .filter(|(path, stamp)| {
                path.ends_with(".md")
                    && stamps.get(*path) != Some(stamp)
                    && (stamp.size <= MAX_FILE_BYTES || stamps.contains_key(*path))
            })
            .map(|(path, _)| path.clone())
            .chain(stamps.keys().filter(|p| !meta.contains_key(*p)).cloned())
            .collect();
        todo.sort();
        // Too large by their listed size and not indexed, so never read;
        // the rest are counted as they are read.
        let unread_large = meta
            .iter()
            .filter(|(path, stamp)| {
                path.ends_with(".md") && stamp.size > MAX_FILE_BYTES && !stamps.contains_key(*path)
            })
            .count() as u64;
        self.skipped = 0;
        let total = todo.len() as u64;
        let large = todo.len() > BATCH_PAGES;
        let progress = !self.built || large;
        if progress {
            self.publish(SyncState::Building { done: 0, total });
        }
        let _slot = if large {
            Some(build_slot(self.slots).await)
        } else {
            None
        };
        let meta = Arc::new(meta);
        let (mut done, mut commits) = (0, 0);
        let mut rest = &todo[..];
        while !rest.is_empty() {
            let batch = &rest[..rest.len().min(BATCH_PAGES)];
            let (consumed, committed) = self.apply_batch(batch, Some(meta.clone())).await?;
            rest = &rest[consumed..];
            done += consumed as u64;
            commits += u64::from(committed);
            if progress {
                self.publish(SyncState::Building { done, total });
            }
        }
        let caught_up = self.built || self.store.opened() == Opened::Reused;
        self.built = true;
        self.publish(SyncState::Ready);
        if progress {
            let store = self.store.clone();
            let measured = blocking(move || (store.pages(), store.size_bytes())).await;
            let (pages, bytes) = measured.unwrap_or_default();
            let stats = IndexStats {
                pages,
                bytes,
                memory: self.store.is_memory(),
                elapsed: started.elapsed(),
                skipped: unread_large + self.skipped,
                caught_up,
            };
            tracing::info!("{}", stats.line(&self.name));
            self.stats.send_replace(Some(stats));
        } else if commits > 0 {
            tracing::debug!(
                "Search index (space \"{}\"): reconciled {} in {} ms",
                self.name,
                pages(total),
                started.elapsed().as_millis()
            );
        }
        Ok(commits)
    }

    /// Applies up to [`BATCH_PAGES`] pending feed paths; those cut off by the
    /// byte cap stay pending.
    async fn flush(&mut self) -> Result<(), Stop> {
        let started = Instant::now();
        let mut batch = Vec::new();
        while batch.len() < BATCH_PAGES {
            match self.pending.pop_first() {
                Some(path) => batch.push(path),
                None => break,
            }
        }
        let (consumed, committed) = self.apply_batch(&batch, None).await?;
        self.pending.extend(batch.drain(consumed..));
        if committed {
            tracing::debug!(
                "Search index (space \"{}\"): updated {} in {} ms",
                self.name,
                pages(consumed as u64),
                started.elapsed().as_millis()
            );
        }
        Ok(())
    }

    /// Reads a prefix of `paths` (at least one, up to the byte cap) with
    /// stamps from `meta` (listed before the reads) or from a fresh listing,
    /// and commits it, deleting only paths that are indexed. While the lock
    /// is busy it waits and re-reads, so only one copy of the texts exists.
    /// Returns how many paths it consumed and whether it committed.
    async fn apply_batch(
        &mut self,
        paths: &[String],
        meta: Option<Arc<HashMap<String, FileStamp>>>,
    ) -> Result<(usize, bool), Stop> {
        let started = Instant::now();
        loop {
            let reads = self.read(paths.to_vec(), meta.clone()).await?;
            let consumed = reads.len();
            let mut marks = Vec::new();
            let mut changes = Vec::new();
            for (path, page) in reads {
                match page {
                    Some((text, stamp)) => {
                        marks.push((path.clone(), true));
                        changes.push(Change::Upsert { path, text, stamp });
                    }
                    None if self.indexed.contains(&path) => {
                        marks.push((path.clone(), false));
                        changes.push(Change::Delete { path });
                    }
                    None => {}
                }
            }
            if changes.is_empty() {
                return Ok((consumed, false));
            }
            let store = self.store.clone();
            let result = blocking(move || store.apply(changes))
                .await
                .unwrap_or_else(|| Err(StoreError::Failed("apply panicked".into())));
            match result {
                Ok(()) => {
                    for (path, present) in marks {
                        if present {
                            self.indexed.insert(path);
                        } else {
                            self.indexed.remove(&path);
                        }
                    }
                    self.commits += 1;
                    if self.built && matches!(*self.state.borrow(), SyncState::Failed(_)) {
                        self.publish(SyncState::Ready);
                    }
                    return Ok((consumed, true));
                }
                Err(StoreError::LockBusy) if started.elapsed() < RETRY_LATER => {
                    tracing::debug!("Full-text index locked by another writer; retrying");
                    sleep(LOCK_RETRY_EVERY).await;
                }
                Err(StoreError::LockBusy) => {
                    tracing::warn!(
                        "Full-text index stayed locked for {}s; reconciling later",
                        RETRY_LATER.as_secs()
                    );
                    return Err(self.gave_up());
                }
                Err(StoreError::Failed(detail)) => {
                    tracing::warn!("Full-text index update failed: {detail}");
                    return Err(self.gave_up());
                }
            }
        }
    }

    /// Reads `paths` in `spawn_blocking` until their texts reach the byte cap.
    async fn read(
        &mut self,
        paths: Vec<String>,
        meta: Option<Arc<HashMap<String, FileStamp>>>,
    ) -> Result<Vec<Read>, Stop> {
        let meta = match meta {
            Some(meta) => meta,
            None => {
                let view = self.view.clone();
                let Some(listed) = blocking(move || view.list_meta()).await else {
                    return Err(self.gave_up());
                };
                Arc::new(self.listed(listed)?)
            }
        };
        let (view, cancel, cap) = (self.view.clone(), self.cancel.clone(), self.batch_bytes);
        let reads = blocking(move || {
            let mut out = Vec::with_capacity(paths.len());
            let (mut bytes, mut skipped) = (0, 0);
            for path in paths {
                if cancel.is_cancelled() {
                    return None;
                }
                if bytes >= cap {
                    break;
                }
                let page = match meta.get(&path) {
                    Some(stamp) => match read_page(view.as_ref(), &path, *stamp) {
                        Page::Text(text, stamp) => {
                            bytes += text.len() as u64;
                            Some((text, stamp))
                        }
                        Page::Skipped => {
                            skipped += 1;
                            None
                        }
                        Page::Absent => None,
                    },
                    None => None,
                };
                out.push((path, page));
            }
            Some((out, skipped))
        })
        .await;
        match reads {
            Some(Some((reads, skipped))) => {
                self.skipped += skipped;
                Ok(reads)
            }
            Some(None) => Err(Stop::Cancelled),
            None => Err(self.gave_up()),
        }
    }
}

/// The page's text, or why it must not be indexed: hidden or gone (`read`
/// is `None`) or not a page, or over [`MAX_FILE_BYTES`] or not UTF-8.
fn read_page(view: &dyn SpaceView, path: &str, stamp: FileStamp) -> Page {
    if !path.ends_with(".md") {
        return Page::Absent;
    }
    if stamp.size > MAX_FILE_BYTES {
        return Page::Skipped;
    }
    let Some(data) = view.read(path) else {
        return Page::Absent;
    };
    if data.len() as u64 > MAX_FILE_BYTES {
        return Page::Skipped;
    }
    match String::from_utf8(data) {
        Ok(text) => Page::Text(text, stamp),
        Err(_) => Page::Skipped,
    }
}

async fn build_slot(slots: &'static Semaphore) -> SemaphorePermit<'static> {
    slots
        .acquire()
        .await
        .expect("the build semaphore is never closed")
}

/// Runs `f` in `spawn_blocking`; `None` when it panicked.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    match tokio::task::spawn_blocking(f).await {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!("Full-text index sync task failed: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::store::Location;
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
    use std::sync::Mutex;
    use tantivy::collector::Count;
    use tantivy::query::TermQuery;
    use tantivy::schema::IndexRecordOption;
    use tantivy::{IndexWriter, Term};

    type Hook = Box<dyn FnMut(&TestView, usize) + Send>;

    /// A space in memory that hides like storage does: hidden paths (dot
    /// paths and anything marked with `hide`, e.g. control files) are neither
    /// listed nor read. Every write gets a fresh `modified`. Counts reads and
    /// can run a hook before the n-th read.
    #[derive(Default)]
    struct TestView {
        files: Mutex<HashMap<String, (Vec<u8>, i64)>>,
        hidden: Mutex<HashSet<String>>,
        clock: AtomicI64,
        reads: Mutex<HashMap<String, usize>>,
        hook: Mutex<Option<Hook>>,
        /// List every size as 0, as storage does when it doesn't know it.
        sizes_unknown: bool,
        /// Every listing reports a fresh `modified` for every file.
        restamp: bool,
        /// Listing fails while set.
        unlistable: AtomicBool,
    }

    impl TestView {
        fn write(&self, path: &str, body: &str) {
            self.write_bytes(path, body.as_bytes().to_vec());
        }

        fn write_bytes(&self, path: &str, data: Vec<u8>) {
            let modified = self.clock.fetch_add(1, Ordering::Relaxed) + 1;
            self.files
                .lock()
                .unwrap()
                .insert(path.into(), (data, modified));
        }

        fn remove(&self, path: &str) {
            self.files.lock().unwrap().remove(path);
        }

        fn hide(&self, path: &str) {
            self.hidden.lock().unwrap().insert(path.into());
        }

        fn is_hidden(&self, path: &str) -> bool {
            path.split('/').any(|part| part.starts_with('.'))
                || self.hidden.lock().unwrap().contains(path)
        }

        fn reads(&self, path: &str) -> usize {
            self.reads.lock().unwrap().get(path).copied().unwrap_or(0)
        }

        fn total_reads(&self) -> usize {
            self.reads.lock().unwrap().values().sum()
        }

        fn reset_reads(&self) {
            self.reads.lock().unwrap().clear();
        }
    }

    impl SpaceView for TestView {
        fn list(&self) -> HashSet<String> {
            self.list_meta().unwrap_or_default().into_keys().collect()
        }

        fn list_meta(&self) -> Option<HashMap<String, FileStamp>> {
            if self.unlistable.load(Ordering::Relaxed) {
                return None;
            }
            let bump = self
                .restamp
                .then(|| self.clock.fetch_add(1, Ordering::Relaxed));
            let files = self.files.lock().unwrap().clone();
            let meta = files
                .into_iter()
                .filter(|(path, _)| !self.is_hidden(path))
                .map(|(path, (data, modified))| {
                    let size = if self.sizes_unknown {
                        0
                    } else {
                        data.len() as u64
                    };
                    let modified = modified + bump.unwrap_or(0) * 1_000_000;
                    (path, FileStamp { modified, size })
                })
                .collect();
            Some(meta)
        }

        fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
            let data = self.read(path)?;
            Some(data[..len.min(data.len())].to_vec())
        }

        fn read(&self, path: &str) -> Option<Vec<u8>> {
            let n = {
                let mut reads = self.reads.lock().unwrap();
                *reads.entry(path.into()).or_default() += 1;
                reads.values().sum::<usize>()
            };
            let hook = self.hook.lock().unwrap().take();
            if let Some(mut hook) = hook {
                hook(self, n);
                *self.hook.lock().unwrap() = Some(hook);
            }
            if self.is_hidden(path) {
                return None;
            }
            self.files
                .lock()
                .unwrap()
                .get(path)
                .map(|(data, _)| data.clone())
        }
    }

    struct Space {
        store: Arc<IndexStore>,
        feed: mpsc::UnboundedSender<Option<String>>,
        sent: u64,
        worker: SyncWorker,
    }

    impl Space {
        fn start(view: Arc<TestView>, store: IndexStore) -> Space {
            Space::start_with(view, store, own_slots(), BATCH_BYTES)
        }

        fn start_with(
            view: Arc<TestView>,
            store: IndexStore,
            slots: &'static Semaphore,
            batch_bytes: u64,
        ) -> Space {
            let store = Arc::new(store);
            let (feed, rx) = mpsc::unbounded_channel();
            let worker =
                SyncWorker::spawn_with("test", store.clone(), view.clone(), rx, slots, batch_bytes);
            Space {
                store,
                feed,
                sent: 0,
                worker,
            }
        }

        fn send(&mut self, msg: Option<&str>) {
            self.feed.send(msg.map(str::to_string)).unwrap();
            self.sent += 1;
        }

        async fn ready(&self) {
            let mut state = self.worker.state.clone();
            let ready = state.wait_for(|s| *s == SyncState::Ready);
            bounded(ready).await.unwrap();
        }

        /// Until every event sent so far and at least `reconciles`
        /// reconciles are fully applied.
        async fn settled(&self, reconciles: u64) {
            let sent = self.sent;
            let mut idle = self.worker.idle.clone();
            let settled = idle.wait_for(|i| i.events >= sent && i.reconciles >= reconciles);
            bounded(settled).await.unwrap();
        }

        fn reconciles(&self) -> u64 {
            self.worker.idle.borrow().reconciles
        }

        fn has_page(&self, path: &str) -> bool {
            hits(&self.store, self.store.fields().path, path) == 1
        }

        fn word(&self, word: &str) -> usize {
            hits(&self.store, self.store.fields().body_raw, word)
        }

        fn paths(&self) -> BTreeSet<String> {
            self.store.stamps().into_keys().collect()
        }
    }

    /// Fails a test that waits too long instead of hanging it: 60 s of real
    /// time, or (under `start_paused`) a few periodic reconciles.
    async fn bounded<F: std::future::Future>(f: F) -> F::Output {
        let limit = if tokio::runtime::Handle::current().runtime_flavor()
            == tokio::runtime::RuntimeFlavor::CurrentThread
        {
            RECONCILE_EVERY * 3
        } else {
            Duration::from_secs(60)
        };
        tokio::time::timeout(limit, f).await.expect("timed out")
    }

    /// Build slots of the test's own, so tests don't queue on the static ones.
    fn own_slots() -> &'static Semaphore {
        Box::leak(Box::new(Semaphore::new(INDEX_BUILDS)))
    }

    fn spawn(store: Arc<IndexStore>, view: Arc<TestView>, feed: ChangeFeed) -> SyncWorker {
        SyncWorker::spawn_with("test", store, view, feed, own_slots(), BATCH_BYTES)
    }

    fn hits(store: &IndexStore, field: tantivy::schema::Field, text: &str) -> usize {
        let q = TermQuery::new(Term::from_field_text(field, text), IndexRecordOption::Basic);
        store.searcher().search(&q, &Count).unwrap()
    }

    fn view_with(pages: usize) -> Arc<TestView> {
        let view = Arc::new(TestView::default());
        for i in 0..pages {
            view.write(&format!("Page {i:04}.md"), &format!("common fern word{i}"));
        }
        view
    }

    fn disk(dir: &std::path::Path) -> IndexStore {
        let store = IndexStore::open(Location::Disk(dir.to_path_buf()));
        assert!(!store.is_memory());
        store
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn initial_build_reports_progress_then_ready() {
        let tmp = tempfile::tempdir().unwrap();
        let space = Space::start(view_with(2500), disk(tmp.path()));
        let mut state = space.worker.state.clone();
        let mut progress = Vec::new();
        loop {
            let s = state.borrow_and_update().clone();
            match s {
                SyncState::Ready => break,
                SyncState::Building { done, total } if done > 0 => {
                    assert_eq!(total, 2500);
                    if progress.last() != Some(&done) {
                        progress.push(done);
                    }
                }
                SyncState::Failed(why) => panic!("failed: {why}"),
                SyncState::Building { .. } => {}
            }
            bounded(state.changed()).await.unwrap();
        }
        assert!(progress.len() >= 2, "progress seen: {progress:?}");
        assert!(progress.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(space.word("fern"), 2500);
        assert_eq!(space.word("word1234"), 1);
        assert_eq!(space.store.stamps().len(), 2500);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_rereads_only_changed_files() {
        let tmp = tempfile::tempdir().unwrap();
        let view = view_with(30);
        let space = Space::start(view.clone(), disk(tmp.path()));
        space.ready().await;
        assert_eq!(view.total_reads(), 30);
        drop(space);

        view.write("Page 0003.md", "common fern edited");
        view.write("Page 0004.md", "common fern word4"); // same size, new stamp
        view.write("New.md", "common fern fresh");
        view.remove("Page 0005.md");
        view.reset_reads();

        let space = Space::start(view.clone(), disk(tmp.path()));
        space.ready().await;
        assert_eq!(view.total_reads(), 3);
        assert_eq!(view.reads("Page 0003.md"), 1);
        assert_eq!(view.reads("Page 0004.md"), 1);
        assert_eq!(view.reads("New.md"), 1);
        assert_eq!(space.word("edited"), 1);
        assert_eq!(space.word("word3"), 0);
        assert!(!space.has_page("Page 0005.md"));
        assert_eq!(space.word("fern"), 30);
    }

    /// Review Focus 1: edits, a delete and a rename while the build runs,
    /// injected between batches without any feed event.
    #[tokio::test(flavor = "multi_thread")]
    async fn changes_during_the_build_end_up_exactly_once() {
        let tmp = tempfile::tempdir().unwrap();
        let view = view_with(2500);
        *view.hook.lock().unwrap() = Some(Box::new(|view, n| {
            if n == BATCH_PAGES + 1 {
                // Already committed in batch 1.
                view.write("Page 0010.md", "common fern rewritten");
                view.remove("Page 0011.md");
                // Not read yet (batch 3).
                view.write("Page 2400.md", "common fern changedlater");
                view.remove("Page 2401.md");
                view.write("Renamed 2401.md", "common fern word2401");
            }
            if n == 2 * BATCH_PAGES + 1 {
                // Batch 2 is committed; its listed stamp is now stale.
                view.write("Page 1500.md", "common fern lastedit");
            }
        }));
        let space = Space::start(view.clone(), disk(tmp.path()));
        space.ready().await;
        space.settled(2).await;
        assert_eq!(space.word("rewritten"), 1);
        assert_eq!(space.word("word10"), 0);
        assert!(!space.has_page("Page 0011.md"));
        assert_eq!(space.word("word11"), 0);
        assert_eq!(space.word("changedlater"), 1);
        assert_eq!(space.word("word2400"), 0);
        assert!(!space.has_page("Page 2401.md"));
        assert!(space.has_page("Renamed 2401.md"));
        assert_eq!(space.word("word2401"), 1);
        assert_eq!(space.word("lastedit"), 1);
        assert_eq!(space.word("word1500"), 0);
        // One document per page, nothing resurrected.
        assert_eq!(space.word("fern"), 2499);
        let paths = space.paths();
        let listed: BTreeSet<String> = view.list().into_iter().collect();
        assert_eq!(paths, listed);
    }

    /// Same, but storage reports each change on the feed while the build runs.
    #[tokio::test(flavor = "multi_thread")]
    async fn feed_events_during_the_build_are_applied_after_it() {
        let view = view_with(1500);
        let (tx, rx) = mpsc::unbounded_channel::<Option<String>>();
        let hook_tx = tx.clone();
        *view.hook.lock().unwrap() = Some(Box::new(move |view, n| {
            if n == 10 {
                view.write("Page 0001.md", "common fern revised");
                view.remove("Page 0002.md");
                for p in ["Page 0001.md", "Page 0002.md"] {
                    hook_tx.send(Some(p.into())).unwrap();
                }
            }
        }));
        let store = Arc::new(IndexStore::open(Location::Memory));
        let worker = spawn(store.clone(), view.clone(), rx);
        let mut idle = worker.idle.clone();
        bounded(idle.wait_for(|i| i.events >= 2 && i.reconciles >= 1))
            .await
            .unwrap();
        drop(tx);
        assert_eq!(hits(&store, store.fields().body_raw, "revised"), 1);
        assert_eq!(hits(&store, store.fields().path, "Page 0002.md"), 0);
        assert_eq!(hits(&store, store.fields().body_raw, "fern"), 1499);
    }

    /// Review Focus 3: whatever storage hides, non-Markdown files, files over
    /// 1 MiB and non-UTF-8 files never reach the index, also via the feed.
    #[tokio::test(start_paused = true)]
    async fn hidden_large_and_binary_files_are_never_indexed() {
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        view.write("Kitchen.md", "bread");
        view.write("Shed.md", "rake");
        view.write(".hidden/Secret.md", "secretword");
        view.write("foo.txt", "plainword");
        view.write_bytes("Big.md", vec![b'a'; 2 * 1024 * 1024]);
        view.write_bytes("Bad.md", vec![0xff, 0xfe, b'x']);
        view.write("CONTROL.md", "controlword");
        view.hide("CONTROL.md");
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        let expected: BTreeSet<String> = ["Garden.md", "Kitchen.md", "Shed.md"]
            .map(String::from)
            .into();
        assert_eq!(space.paths(), expected);

        // Events for every hidden or unindexable file.
        for p in [
            ".hidden/Secret.md",
            "foo.txt",
            "Big.md",
            "Bad.md",
            "CONTROL.md",
        ] {
            space.send(Some(p));
        }
        // Existing pages that become hidden, too large or binary.
        view.hide("Garden.md");
        view.write_bytes("Kitchen.md", vec![b'b'; 2 * 1024 * 1024]);
        view.write_bytes("Shed.md", vec![0xc3, 0x28]);
        for p in ["Garden.md", "Kitchen.md", "Shed.md"] {
            space.send(Some(p));
        }
        space.settled(1).await;
        assert!(space.paths().is_empty());
        for word in [
            "secretword",
            "plainword",
            "controlword",
            "tomatoes",
            "bread",
            "rake",
        ] {
            assert_eq!(space.word(word), 0, "{word}");
        }
        // Over-size files are skipped by their listed size, unread.
        assert_eq!(view.reads("Big.md"), 0);
        assert_eq!(view.reads("Kitchen.md"), 1);

        // A full reconcile doesn't bring any of them back.
        space.send(None);
        space.settled(2).await;
        assert!(space.paths().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn an_unlisted_size_is_checked_after_reading() {
        let view = Arc::new(TestView {
            sizes_unknown: true,
            ..TestView::default()
        });
        view.write("Garden.md", "tomatoes");
        view.write_bytes("Big.md", vec![b'a'; 2 * 1024 * 1024]);
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        assert_eq!(space.paths(), BTreeSet::from(["Garden.md".to_string()]));
        view.write_bytes("Garden.md", vec![b'b'; 2 * 1024 * 1024]);
        space.send(Some("Garden.md"));
        space.settled(1).await;
        assert!(space.paths().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_burst_of_events_applies_one_upsert() {
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        view.reset_reads();
        for i in 0..100 {
            view.write("Garden.md", &format!("tomatoes version{i}"));
            space.send(Some("Garden.md"));
        }
        space.settled(1).await;
        assert_eq!(view.reads("Garden.md"), 1);
        assert_eq!(space.word("version99"), 1);
        assert_eq!(space.word("version98"), 0);
        assert_eq!(space.store.stamps().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn debounce_waits_before_applying() {
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        view.write("Garden.md", "basil");
        space.send(Some("Garden.md"));
        sleep(DEBOUNCE / 2).await;
        assert_eq!(space.word("basil"), 0);
        space.settled(1).await;
        assert_eq!(space.word("basil"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn none_and_the_timer_trigger_a_reconcile() {
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        space.settled(1).await;
        let before = space.reconciles();

        // Changed behind the feed's back; a lagged feed sends `None`.
        view.write("Garden.md", "basil");
        view.write("Kitchen.md", "bread");
        space.send(None);
        space.settled(before + 1).await;
        assert_eq!(space.word("basil"), 1);
        assert_eq!(space.word("bread"), 1);

        // Changed silently again: the periodic reconcile picks it up.
        view.remove("Kitchen.md");
        sleep(RECONCILE_EVERY / 2).await;
        assert!(space.has_page("Kitchen.md"));
        space.settled(before + 2).await;
        assert!(!space.has_page("Kitchen.md"));
    }

    #[tokio::test(start_paused = true)]
    async fn dropping_the_worker_stops_it() {
        let view = view_with(5);
        let store = Arc::new(IndexStore::open(Location::Memory));
        let (feed, rx) = mpsc::unbounded_channel();
        let worker = spawn(store, view.clone(), rx);
        let mut state = worker.state.clone();
        bounded(state.wait_for(|s| *s == SyncState::Ready))
            .await
            .unwrap();
        view.reset_reads();
        drop(worker);
        view.write("Page 0001.md", "changed");
        let _ = feed.send(Some("Page 0001.md".into()));
        let _ = feed.send(None);
        sleep(RECONCILE_EVERY * 2).await;
        assert_eq!(view.total_reads(), 0);
        assert!(feed.is_closed(), "the task ended and dropped the feed");
    }

    #[tokio::test(start_paused = true)]
    async fn a_busy_lock_is_retried_until_the_change_lands() {
        let tmp = tempfile::tempdir().unwrap();
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        let mut space = Space::start(view.clone(), disk(tmp.path()));
        space.ready().await;
        view.reset_reads();

        // Another instance of the same space holds the writer.
        let other = disk(tmp.path());
        let writer: IndexWriter = other
            .index()
            .writer_with_num_threads(1, 15_000_000)
            .unwrap();
        view.write("Garden.md", "basil");
        space.send(Some("Garden.md"));
        sleep(DEBOUNCE + LOCK_RETRY_EVERY * 3).await;
        assert_eq!(space.word("basil"), 0, "applied while locked");
        // Re-read on every attempt (no copies of the batch are kept).
        assert!(view.reads("Garden.md") >= 3, "{}", view.reads("Garden.md"));
        assert_eq!(space.worker.state(), SyncState::Ready);
        drop(writer);

        space.settled(1).await;
        assert_eq!(space.word("basil"), 1);
        assert_eq!(space.word("tomatoes"), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_lock_held_too_long_fails_until_the_next_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let view = Arc::new(TestView::default());
        view.write("Garden.md", "tomatoes");
        let mut space = Space::start(view.clone(), disk(tmp.path()));
        space.ready().await;

        let other = disk(tmp.path());
        let writer: IndexWriter = other
            .index()
            .writer_with_num_threads(1, 15_000_000)
            .unwrap();
        view.write("Garden.md", "basil");
        space.send(Some("Garden.md"));
        let mut state = space.worker.state.clone();
        let failed = state.wait_for(|s| matches!(s, SyncState::Failed(_)));
        bounded(failed).await.unwrap();
        assert_eq!(
            space.worker.state(),
            SyncState::Failed(FAILED_MESSAGE.into())
        );
        drop(writer);

        // The reconcile scheduled after giving up lands the change.
        let before = space.reconciles();
        space.settled(before + 1).await;
        assert_eq!(space.word("basil"), 1);
        assert_eq!(space.worker.state(), SyncState::Ready);
    }

    #[tokio::test(start_paused = true)]
    async fn a_large_reconcile_waits_for_a_build_slot() {
        let view = view_with(BATCH_PAGES + 1);
        let slots = own_slots();
        let slot = build_slot(slots).await;
        let space = Space::start_with(
            view.clone(),
            IndexStore::open(Location::Memory),
            slots,
            BATCH_BYTES,
        );
        let mut state = space.worker.state.clone();
        let building = SyncState::Building {
            done: 0,
            total: 1001,
        };
        bounded(state.wait_for(|s| *s == building)).await.unwrap();
        // Virtual time: the worker can only be waiting for the slot.
        sleep(RECONCILE_EVERY).await;
        assert_eq!(view.total_reads(), 0);
        assert_eq!(space.worker.state(), building);
        drop(slot);
        space.ready().await;
        assert_eq!(space.word("fern"), 1001);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_listing_keeps_the_index() {
        let view = view_with(5);
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        space.settled(1).await;
        let before = space.reconciles();

        view.unlistable.store(true, Ordering::Relaxed);
        view.write("Page 0001.md", "common fern edited");
        view.remove("Page 0002.md");
        space.send(Some("Page 0001.md"));
        space.send(None);
        space.settled(before + 1).await;
        assert_eq!(space.paths().len(), 5, "nothing deleted");
        assert_eq!(space.word("fern"), 5);
        assert_eq!(space.word("edited"), 0);
        assert_eq!(space.worker.state(), SyncState::Ready);
        assert!(space.worker.listing_failed());

        // Retried 30 s later: still failing, still nothing deleted.
        space.settled(before + 2).await;
        assert_eq!(space.paths().len(), 5);

        // Listing works again: the next retry reconciles normally.
        view.unlistable.store(false, Ordering::Relaxed);
        space.settled(before + 3).await;
        assert!(!space.worker.listing_failed());
        assert_eq!(space.word("edited"), 1);
        assert!(!space.has_page("Page 0002.md"));
        assert_eq!(space.paths().len(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn a_listing_failing_from_the_start_keeps_building() {
        let view = view_with(3);
        view.unlistable.store(true, Ordering::Relaxed);
        let space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.settled(1).await;
        assert!(space.worker.listing_failed());
        assert_eq!(
            space.worker.state(),
            SyncState::Building { done: 0, total: 0 }
        );
        assert!(space.paths().is_empty());

        view.unlistable.store(false, Ordering::Relaxed);
        space.ready().await;
        assert!(!space.worker.listing_failed());
        assert_eq!(space.paths().len(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_batch_over_the_byte_cap_is_split() {
        let view = Arc::new(TestView::default());
        for i in 0..10 {
            let body = format!("fern word{i} {}", "x".repeat(290));
            view.write(&format!("Page {i}.md"), &body);
        }
        let mut space = Space::start_with(
            view.clone(),
            IndexStore::open(Location::Memory),
            own_slots(),
            1000,
        );
        space.settled(1).await;
        // Cut once a batch reaches 1000 bytes: 4 + 4 + 2 pages.
        assert_eq!(space.worker.idle.borrow().commits, 3);
        assert_eq!(space.word("fern"), 10);

        // Feed batches too; the rest stays pending and is applied next.
        for i in 0..10 {
            let path = format!("Page {i}.md");
            view.write(&path, &format!("moss word{i} {}", "y".repeat(290)));
            space.send(Some(&path));
        }
        space.settled(1).await;
        assert_eq!(space.worker.idle.borrow().commits, 6);
        assert_eq!(space.word("moss"), 10);
        assert_eq!(space.word("fern"), 0);
        assert_eq!(view.total_reads(), 20);
    }

    #[tokio::test(start_paused = true)]
    async fn the_converge_pass_runs_once() {
        // Every listing restamps every page, so each pass sees all as changed.
        let view = Arc::new(TestView {
            restamp: true,
            ..TestView::default()
        });
        for i in 0..1500 {
            view.write(&format!("Page {i:04}.md"), "common fern");
        }
        let space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.settled(2).await;
        sleep(RECONCILE_EVERY / 2).await;
        assert_eq!(space.reconciles(), 2, "build + one converge pass");
        assert_eq!(view.total_reads(), 3000);
    }

    #[tokio::test(start_paused = true)]
    async fn a_later_large_reconcile_reports_progress() {
        let view = view_with(5);
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        space.ready().await;
        space.settled(1).await;
        for i in 0..BATCH_PAGES + 500 {
            view.write(&format!("More {i:04}.md"), "common fern");
        }
        let mut state = space.worker.state.clone();
        state.borrow_and_update();
        space.send(None);
        let total = (BATCH_PAGES + 500) as u64;
        let building =
            state.wait_for(|s| matches!(s, SyncState::Building { total: t, .. } if *t == total));
        bounded(building).await.unwrap();
        space.ready().await;
        space.settled(2).await;
        assert_eq!(space.word("fern"), 1505);
    }

    /// The stats once they are (again) `Some` and differ from `before`.
    async fn next_stats(space: &Space, before: Option<IndexStats>) -> IndexStats {
        let mut stats = space.worker.stats.clone();
        let changed = stats.wait_for(|s| s.is_some() && *s != before);
        let stats = bounded(changed).await.unwrap().clone();
        stats.unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn stats_after_the_initial_build_count_pages_and_skips() {
        let view = view_with(3);
        view.write_bytes("Bad.md", vec![0xff, 0xfe, b'x']);
        view.write_bytes("Huge.md", vec![b'a'; MAX_FILE_BYTES as usize + 1]);
        view.write("notes.txt", "not a page");
        let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
        let stats = next_stats(&space, None).await;
        assert_eq!(stats.pages, 3);
        assert_eq!(stats.skipped, 2);
        assert!(stats.memory);
        assert!(stats.bytes > 0);
        assert!(!stats.caught_up, "a fresh index is built");

        // Small live updates don't report again.
        view.write("Page 0000.md", "edited fern");
        space.send(Some("Page 0000.md"));
        space.settled(1).await;
        assert_eq!(space.worker.stats(), Some(stats.clone()));

        // A reconcile changing more than a batch does, with the new count.
        for i in 0..BATCH_PAGES + 1 {
            view.write(&format!("More {i:04}.md"), "common fern");
        }
        space.send(None);
        let later = next_stats(&space, Some(stats)).await;
        assert_eq!(later.pages, 3 + BATCH_PAGES as u64 + 1);
        assert_eq!(later.skipped, 2);
        assert!(later.caught_up);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn stats_of_a_reused_disk_index() {
        let tmp = tempfile::tempdir().unwrap();
        let view = view_with(4);
        {
            let space = Space::start(view.clone(), disk(tmp.path()));
            next_stats(&space, None).await;
        }
        let store = disk(tmp.path());
        assert_eq!(store.opened(), Opened::Reused);
        assert_eq!(
            opened_line("Notes", store.opened(), store.pages()),
            "Search index (space \"Notes\"): reusing on-disk index, 4 pages"
        );
        let space = Space::start(view, store);
        let stats = next_stats(&space, None).await;
        assert_eq!(stats.pages, 4);
        assert_eq!(stats.skipped, 0);
        assert!(!stats.memory);
        assert_eq!(stats.bytes, space.store.size_bytes());
        assert!(stats.caught_up);
        assert!(stats.line("Notes").contains(", caught up in "));
    }

    #[test]
    fn log_lines() {
        let stats = IndexStats {
            pages: 1482,
            bytes: 3_250_000,
            memory: false,
            elapsed: Duration::from_millis(2_440),
            skipped: 0,
            caught_up: false,
        };
        assert_eq!(
            stats.line("0f6c"),
            "Search index ready (space \"0f6c\"): 1,482 pages, 3.1 MB on disk, built in 2.4 s"
        );
        let stats = IndexStats {
            pages: 1,
            bytes: 900,
            memory: true,
            elapsed: Duration::from_millis(30),
            skipped: 1234,
            caught_up: false,
        };
        assert_eq!(
            stats.line("notes"),
            "Search index ready (space \"notes\"): 1 page, 900 B in memory, built in 0.0 s, \
             skipped 1,234 (too large or not UTF-8)"
        );
        let stats = IndexStats {
            pages: 2,
            bytes: 2048,
            memory: false,
            elapsed: Duration::from_millis(150),
            skipped: 0,
            caught_up: true,
        };
        assert_eq!(
            stats.line("notes"),
            "Search index ready (space \"notes\"): 2 pages, 2.0 KB on disk, caught up in 0.1 s"
        );
        assert_eq!(
            opened_line("notes", Opened::Fresh, 0),
            "Search index (space \"notes\"): building from scratch"
        );
        assert_eq!(
            opened_line("notes", Opened::Memory, 0),
            "Search index (space \"notes\"): in memory, building"
        );
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1_000), "1,000");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(1024), "1.0 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024 * 1024), "5.0 GB");
        assert_eq!(human_bytes(3 * 1024 * 1024 * 1024 * 1024), "3072.0 GB");
    }
}
