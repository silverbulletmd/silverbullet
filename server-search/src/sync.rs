//! Keeps a space's index (any [`IndexSink`]) in step with storage.
//!
//! One worker task per space and sink. It starts with a reconcile (storage's
//! listing against the stamps in the index), then applies the change feed,
//! debounced and coalesced per path, and reconciles again on
//! [`FeedEvent::Rescan`] (a lagged feed) and every [`RECONCILE_EVERY`]. Every
//! change re-reads the file when it is applied, so whatever order events
//! arrive in, the index ends up with the content storage had at the last read,
//! and a path storage no longer exposes is deleted. A failed listing never
//! deletes anything.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{watch, Semaphore, SemaphorePermit};
use tokio::task::JoinHandle;
use tokio::time::{sleep, sleep_until, Instant};
use tokio_util::sync::CancellationToken;

use crate::backend::SpaceView;
use crate::index::{
    is_page, page_text, Change, ChangeFeed, FeedEvent, FileStamp, IndexSink, SinkError, SinkLimits,
    Unindexable, WhileReconciling,
};
use crate::limits::MAX_FILE_BYTES;
use crate::stats::{pages, IndexStats};
use crate::{IndexKind, IndexReport, IndexState, Progress};

/// How long change events are collected after the first one before they are
/// applied. A fixed window (not reset by later events), so steady autosaves
/// still reach the index every half second.
pub const DEBOUNCE: Duration = Duration::from_millis(500);
/// Full reconcile interval, for changes the feed missed (edits made outside
/// the server, dropped events).
pub const RECONCILE_EVERY: Duration = Duration::from_secs(10 * 60);
/// How often an apply refused with [`SinkError::LockBusy`] is retried (the
/// batch is re-read each time), for up to [`RETRY_LATER`].
const LOCK_RETRY_EVERY: Duration = Duration::from_secs(1);
/// After giving up (lock busy that long, a failed write, a failed listing):
/// the changes are dropped and a full reconcile runs this much later.
const RETRY_LATER: Duration = Duration::from_secs(30);

/// The worker's own state; [`WorkerStatus::state`] is what the dashboard
/// and queries see of it.
#[derive(Debug, Clone, PartialEq)]
pub enum SyncState {
    /// The first reconcile, or one that changes more than the sink's
    /// `batch_pages`, is running: `done` of `total` changed pages are committed.
    /// An index that stays usable ([`WhileReconciling::StayReady`]) reports
    /// this for a build only (see [`WorkerStatus::catch_up`]).
    Building {
        done: u64,
        total: u64,
    },
    Ready,
    /// Changes couldn't be committed; a reconcile follows, and the next
    /// successful commit clears it.
    Failed(String),
}

/// Where a worker is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// This worker's first reconcile, building the index: the sink wasn't
    /// built once when the worker started.
    FirstBuild,
    /// This worker's first reconcile, over an index built once (reused from
    /// disk, or built by another worker of the sink).
    Reopened,
    /// This worker's first reconcile finished.
    Built,
    /// A rebuild's reconcile is due or running (after [`IndexSink::reset`]):
    /// every listed page is re-read, whatever its stamp.
    Rebuilding,
}

impl Phase {
    /// The index held the whole space once and isn't being rebuilt: this
    /// worker's first reconcile finished or, before it did, the sink says so
    /// ([`IndexSink::built_once`]).
    fn built_once(self, sink: &dyn IndexSink) -> bool {
        match self {
            Phase::Built => true,
            Phase::Rebuilding => false,
            Phase::FirstBuild | Phase::Reopened => sink.built_once(),
        }
    }

    /// Queries keep answering from the index while a reconcile runs: it was
    /// built once and its sink stays ready while reconciling
    /// ([`WhileReconciling::StayReady`]). Its state then stays as it is, a
    /// large reconcile reports its progress as `catch_up` and takes no build
    /// slot.
    fn stays_usable(self, limits: &SinkLimits, sink: &dyn IndexSink) -> bool {
        limits.while_reconciling == WhileReconciling::StayReady && self.built_once(sink)
    }
}

/// What the worker reports, published as one value so a reader never mixes
/// two moments.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkerStatus {
    pub sync: SyncState,
    pub phase: Phase,
    /// A rebuild was asked for ([`SyncWorker::rebuild`]); the worker starts
    /// it ([`Phase::Rebuilding`]) when it is next idle.
    pub rebuild_due: bool,
    /// Whether the last listing of the space failed. The index is then kept
    /// as it is (and, on a fresh start, stays `Building`) until listing works.
    pub listing_failed: bool,
    /// What the last "index ready" line reported; `None` before the first
    /// build finished.
    pub stats: Option<IndexStats>,
    /// How long this worker's last full build (a first build or a rebuild,
    /// not a catch-up) took; kept when a later catch-up replaces `stats`.
    pub last_build: Option<Duration>,
    /// For an index that stays usable ([`Phase::stays_usable`]): the
    /// progress of a reconcile that changes more than `batch_pages` pages (or
    /// of this worker's first reconcile), while `sync` stays as it is.
    pub catch_up: Option<Progress>,
    /// A build is queued behind another space's build for a build slot
    /// ([`SinkLimits::builds`]); `sync` is `Building` with nothing done.
    pub waiting: bool,
}

impl WorkerStatus {
    /// The state as the dashboard and queries see it: a build queued for
    /// its slot is `Waiting`, a catch-up keeps the index `Ready`.
    pub fn state(&self) -> IndexState {
        match &self.sync {
            SyncState::Building { total, .. } if self.waiting => {
                IndexState::Waiting { total: *total }
            }
            SyncState::Building { done, total } => IndexState::Building {
                done: *done,
                total: *total,
            },
            SyncState::Ready => IndexState::Ready {
                catch_up: self.catch_up,
            },
            SyncState::Failed(reason) => IndexState::Failed {
                reason: reason.clone(),
            },
        }
    }

    /// Whether a rebuild asked for now is taken: not while one is due or
    /// running, nor while a first build runs (or waits for a build slot),
    /// which reads every page anyway.
    fn takes_rebuild(&self) -> bool {
        let first_build_running =
            self.phase == Phase::FirstBuild && matches!(self.sync, SyncState::Building { .. });
        !self.rebuild_due && self.phase != Phase::Rebuilding && !first_build_running
    }
}

/// What tests wait for: the worker had nothing left to do after consuming
/// `events` feed messages, finishing `reconciles` reconciles (successful or
/// not) and making `commits` commits.
#[cfg(test)]
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(super) struct Idle {
    pub(super) events: u64,
    pub(super) reconciles: u64,
    pub(super) commits: u64,
}

pub struct SyncWorker {
    handle: JoinHandle<()>,
    cancel: CancellationToken,
    sink: Arc<dyn IndexSink>,
    status: watch::Receiver<WorkerStatus>,
    /// Asks the worker for a rebuild ([`WorkerStatus::rebuild_due`]).
    control: watch::Sender<WorkerStatus>,
    #[cfg(test)]
    idle: watch::Receiver<Idle>,
}

impl SyncWorker {
    /// Spawns the worker on the current tokio runtime: reconcile (list_meta
    /// vs the sink's stamps → upserts for new/changed, deletes for gone), then
    /// apply the feed debounced by [`DEBOUNCE`], a full reconcile on
    /// [`FeedEvent::Rescan`] and every [`RECONCILE_EVERY`]. Reads and applies
    /// run in `spawn_blocking`, in the batches the sink's limits allow.
    /// `name` identifies the space in log lines.
    pub fn spawn(
        name: &str,
        sink: Arc<dyn IndexSink>,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
    ) -> SyncWorker {
        let limits = sink.limits();
        SyncWorker::spawn_with(name, sink, view, feed, limits)
    }

    /// [`SyncWorker::spawn`] with other limits (tests).
    pub(crate) fn spawn_with(
        name: &str,
        sink: Arc<dyn IndexSink>,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
        limits: SinkLimits,
    ) -> SyncWorker {
        let cancel = CancellationToken::new();
        let phase = if sink.built_once() {
            Phase::Reopened
        } else {
            Phase::FirstBuild
        };
        // An index that stays usable answers before this worker's first
        // reconcile.
        let sync = if phase.stays_usable(&limits, sink.as_ref()) {
            SyncState::Ready
        } else {
            SyncState::Building { done: 0, total: 0 }
        };
        let (status_tx, status) = watch::channel(WorkerStatus {
            sync,
            phase,
            rebuild_due: false,
            listing_failed: false,
            stats: None,
            last_build: None,
            catch_up: None,
            waiting: false,
        });
        let control = status_tx.clone();
        #[cfg(test)]
        let (idle_tx, idle) = watch::channel(Idle::default());
        let worker = Worker {
            name: name.into(),
            kind: sink.kind(),
            sink: sink.clone(),
            view,
            cancel: cancel.clone(),
            limits,
            status: status_tx,
            #[cfg(test)]
            idle: idle_tx,
            #[cfg(test)]
            counts: Idle::default(),
            indexed: HashSet::new(),
            pending: BTreeSet::new(),
            rescan: false,
            settled: true,
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
            sink,
            status,
            control,
            #[cfg(test)]
            idle,
        }
    }

    /// The worker's state, listing health and last stats, as one snapshot.
    pub fn status(&self) -> WorkerStatus {
        self.status.borrow().clone()
    }

    /// This index's state, pages and size, for the dashboard.
    pub fn report(&self) -> IndexReport {
        let status = self.status.borrow();
        IndexReport {
            kind: self.sink.kind(),
            state: status.state(),
            pages: status.stats.as_ref().map(|s| s.pages),
            bytes: status.stats.as_ref().map(|s| s.bytes),
            memory: self.sink.is_memory(),
            build_secs: status.last_build.map(|d| d.as_secs_f64()),
        }
    }

    /// Re-reads and re-applies every page, after [`IndexSink::reset`]: a
    /// reconcile that ignores the stamps, reported as a first build. Returns
    /// false (and does nothing) when the worker doesn't take it
    /// ([`WorkerStatus::takes_rebuild`]).
    pub fn rebuild(&self) -> bool {
        self.control.send_if_modified(|s| {
            let takes = s.takes_rebuild();
            if takes {
                s.rebuild_due = true;
            }
            takes
        })
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

/// How a reconcile reports itself, chosen once up front.
#[derive(Clone, Copy)]
enum Pass {
    /// A later reconcile of at most `batch_pages` pages: no progress, and a
    /// debug line when it committed.
    Quiet,
    /// A first build, or a large reconcile of an index that doesn't stay
    /// usable: progress as `Building`, holding a build slot when `slot`
    /// (more than `batch_pages` pages).
    Build { slot: bool },
    /// A large reconcile, or this worker's first one, of an index that stays
    /// usable: progress as `catch_up`, no build slot.
    CatchUp,
}

impl Pass {
    /// The pass of a reconcile in `phase` that changes `large` (more than
    /// `batch_pages`) pages or not, of an index that `stays_usable`.
    fn of(phase: Phase, stays_usable: bool, large: bool) -> Pass {
        match (stays_usable, phase != Phase::Built || large) {
            (_, false) => Pass::Quiet,
            (true, true) => Pass::CatchUp,
            (false, true) => Pass::Build { slot: large },
        }
    }
}

/// What one [`Worker::apply_batch`] did: how many of its paths it consumed,
/// and whether it applied anything.
struct Applied {
    consumed: usize,
    committed: bool,
}

struct Worker {
    /// The space, in log lines.
    name: Arc<str>,
    kind: IndexKind,
    sink: Arc<dyn IndexSink>,
    view: Arc<dyn SpaceView>,
    cancel: CancellationToken,
    limits: SinkLimits,
    status: watch::Sender<WorkerStatus>,
    #[cfg(test)]
    idle: watch::Sender<Idle>,
    #[cfg(test)]
    counts: Idle,
    /// Paths this worker believes are in the index: refreshed from the sink
    /// on every reconcile, updated on every commit. Only used to skip deletes
    /// of paths that were never indexed.
    indexed: HashSet<String>,
    /// `.md` paths from the feed waiting to be re-read and applied.
    pending: BTreeSet<String>,
    /// A rescan was asked for: reconcile before anything else.
    rescan: bool,
    /// The sink was told it is idle since its last apply.
    settled: bool,
    /// Pages [`read_page`] skipped since the current reconcile started.
    skipped: u64,
}

impl Worker {
    async fn run(mut self, mut feed: ChangeFeed) {
        // Wakes the worker for a rebuild asked for while it is idle.
        let mut requests = self.status.subscribe();
        let mut feed_open = true;
        let mut next_reconcile = Instant::now();
        let mut converge_next = false;
        loop {
            if self.rescan || Instant::now() >= next_reconcile {
                self.rescan = false;
                let converging = std::mem::take(&mut converge_next);
                let outcome = self.reconcile().await;
                #[cfg(test)]
                {
                    self.counts.reconciles += 1;
                }
                next_reconcile = match outcome {
                    // Pages may have changed while a multi-batch reconcile
                    // ran: check once more right away, even without events.
                    // Changes after that wait for the feed or the timer.
                    Ok(commits) if commits > 1 && !converging => {
                        converge_next = true;
                        Instant::now()
                    }
                    Ok(_) => Instant::now() + RECONCILE_EVERY,
                    // A rebuild's reconcile stays `Rebuilding` for the retry.
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
            if !self.settled {
                self.settled = true;
                let sink = self.sink.clone();
                blocking(move || sink.settle()).await;
            }
            // A rebuild asked for from now on wakes the select below; one
            // asked for before is started here.
            requests.mark_unchanged();
            if self.start_rebuild().await {
                continue;
            }
            #[cfg(test)]
            self.idle.send_replace(self.counts);
            tokio::select! {
                msg = feed.recv(), if feed_open => match msg {
                    Some(msg) => {
                        self.take(msg);
                        feed_open = self.debounce(&mut feed).await;
                    }
                    None => feed_open = false,
                },
                _ = sleep_until(next_reconcile) => {}
                _ = requests.changed() => {}
            }
        }
    }

    /// Starts a rebuild that is due ([`WorkerStatus::rebuild_due`]): reports
    /// `Building` before the reset (a reset sink answers no query as if it
    /// were ready), resets the sink and asks for the reconcile that re-reads
    /// every page. Returns whether one was due.
    async fn start_rebuild(&mut self) -> bool {
        let started = self.status.send_if_modified(|s| {
            if !s.rebuild_due {
                return false;
            }
            s.rebuild_due = false;
            s.phase = Phase::Rebuilding;
            s.sync = SyncState::Building { done: 0, total: 0 };
            true
        });
        if !started {
            return false;
        }
        let sink = self.sink.clone();
        if blocking(move || sink.reset())
            .await
            .is_none_or(|r| r.is_err())
        {
            // Not reset: still re-read everything, and report it.
            tracing::warn!(
                "{} couldn't be reset for a rebuild",
                self.kind.capitalized()
            );
            self.gave_up();
        }
        self.rescan = true;
        true
    }

    fn take(&mut self, event: FeedEvent) {
        #[cfg(test)]
        {
            self.counts.events += 1;
        }
        match event {
            FeedEvent::Rescan => self.rescan = true,
            // Only Markdown pages are indexed; anything else can't be in the index.
            FeedEvent::Changed(path) if is_page(&path) => {
                self.pending.insert(path);
            }
            FeedEvent::Changed(_) => {}
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
        self.status.send_if_modified(|s| {
            let changed = s.sync != state;
            s.sync = state;
            changed
        });
    }

    fn phase(&self) -> Phase {
        self.status.borrow().phase
    }

    fn stays_usable(&self) -> bool {
        self.phase().stays_usable(&self.limits, self.sink.as_ref())
    }

    fn report(&self, pass: Pass, done: u64, total: u64) {
        report(&self.status, pass, done, total);
    }

    /// A build slot, reported as [`WorkerStatus::waiting`] while another
    /// space's build holds it.
    async fn build_slot(&self) -> SemaphorePermit<'static> {
        if let Ok(slot) = self.limits.builds.try_acquire() {
            return slot;
        }
        self.status
            .send_if_modified(|s| !std::mem::replace(&mut s.waiting, true));
        let slot = build_slot(self.limits.builds).await;
        self.status
            .send_if_modified(|s| std::mem::replace(&mut s.waiting, false));
        slot
    }

    /// Whether the flag changed.
    fn publish_listing_failed(&self, failed: bool) -> bool {
        self.status
            .send_if_modified(|s| std::mem::replace(&mut s.listing_failed, failed) != failed)
    }

    /// Marks the state failed and gives up on the current changes.
    fn gave_up(&self) -> Stop {
        let state = SyncState::Failed(self.kind.failed_message().into());
        self.status.send_if_modified(|s| {
            let changed = s.sync != state || s.catch_up.is_some();
            s.sync = state;
            s.catch_up = None;
            changed
        });
        Stop::GaveUp
    }

    /// The listing, or `Unlisted` (logged once per run of failures).
    fn listed(
        &mut self,
        meta: Option<HashMap<String, FileStamp>>,
    ) -> Result<HashMap<String, FileStamp>, Stop> {
        match meta {
            Some(meta) => {
                if self.publish_listing_failed(false) {
                    tracing::info!(
                        "Listing the space works again; updating the {}",
                        self.kind.noun()
                    );
                }
                Ok(meta)
            }
            None => {
                if self.publish_listing_failed(true) {
                    tracing::warn!(
                        "Can't list the space; keeping the {} as it is and retrying in {}s",
                        self.kind.noun(),
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
        let (view, sink) = (self.view.clone(), self.sink.clone());
        let Some((meta, stamps)) = blocking(move || (view.list_meta(), sink.stamps())).await else {
            return Err(self.gave_up());
        };
        let meta = self.listed(meta)?;
        // One moment for the whole pass: what it reads, how it reports and
        // the stats agree. A rebuild is a first build, whatever the sink held.
        let phase = self.phase();
        let force = phase == Phase::Rebuilding;
        self.indexed = stamps.keys().cloned().collect();
        // Each listed path is classified once: a changed or new page is read,
        // except one too large by its listed size that isn't indexed, which is
        // never read and only counted as skipped (the rest are counted as
        // they are read). Indexed paths storage no longer lists are deleted.
        let mut todo = Vec::new();
        let mut unread_large = 0u64;
        for (path, stamp) in meta.iter() {
            if !is_page(path) || (!force && stamps.get(path) == Some(stamp)) {
                continue;
            }
            if stamp.size > MAX_FILE_BYTES && !stamps.contains_key(path) {
                unread_large += 1;
            } else {
                todo.push(path.clone());
            }
        }
        todo.extend(stamps.keys().filter(|p| !meta.contains_key(*p)).cloned());
        todo.sort();
        self.skipped = 0;
        let total = todo.len() as u64;
        let large = todo.len() > self.limits.batch_pages;
        let built_once = phase.built_once(self.sink.as_ref());
        let pass = Pass::of(
            phase,
            phase.stays_usable(&self.limits, self.sink.as_ref()),
            large,
        );
        self.report(pass, 0, total);
        let _slot = match pass {
            Pass::Build { slot: true } => Some(self.build_slot().await),
            Pass::Build { slot: false } | Pass::Quiet | Pass::CatchUp => None,
        };
        let meta = Arc::new(meta);
        let (mut done, mut commits) = (0, 0);
        let mut rest = &todo[..];
        while !rest.is_empty() {
            let batch = &rest[..rest.len().min(self.limits.batch_pages)];
            let Applied {
                consumed,
                committed,
            } = self
                .apply_batch(batch, Some(meta.clone()), Some((pass, done, total)))
                .await?;
            rest = &rest[consumed..];
            done += consumed as u64;
            commits += u64::from(committed);
            self.report(pass, done, total);
        }
        // A first build, a first reconcile or a rebuild finished.
        if phase != Phase::Built {
            self.status.send_if_modified(|s| {
                let changed = s.phase != Phase::Built;
                s.phase = Phase::Built;
                changed
            });
            let sink = self.sink.clone();
            blocking(move || sink.built()).await;
        }
        if let Pass::Quiet = pass {
            self.publish(SyncState::Ready);
            if commits > 0 {
                tracing::debug!(
                    "{} (space \"{}\"): reconciled {} in {} ms",
                    self.kind.title(),
                    self.name,
                    pages(total),
                    started.elapsed().as_millis()
                );
            }
            return Ok(commits);
        }
        let sink = self.sink.clone();
        let measured = blocking(move || sink.measure()).await;
        let (pages, bytes) = measured.unwrap_or_default();
        let stats = IndexStats {
            pages,
            bytes,
            memory: self.sink.is_memory(),
            elapsed: started.elapsed(),
            skipped: unread_large + self.skipped,
            caught_up: built_once,
        };
        // One write, so a reader never sees `Ready` without the stats.
        let line = stats.line(self.kind, &self.name);
        self.status.send_modify(|s| {
            s.sync = SyncState::Ready;
            if !stats.caught_up {
                s.last_build = Some(stats.elapsed);
            }
            s.stats = Some(stats);
            s.catch_up = None;
        });
        tracing::info!("{line}");
        Ok(commits)
    }

    /// Applies up to the sink's `batch_pages` pending feed paths; those cut
    /// off by the byte cap stay pending.
    async fn flush(&mut self) -> Result<(), Stop> {
        let started = Instant::now();
        let mut batch = Vec::new();
        while batch.len() < self.limits.batch_pages {
            match self.pending.pop_first() {
                Some(path) => batch.push(path),
                None => break,
            }
        }
        let Applied {
            consumed,
            committed,
        } = self.apply_batch(&batch, None, None).await?;
        self.pending.extend(batch.drain(consumed..));
        if committed {
            tracing::debug!(
                "{} (space \"{}\"): updated {} in {} ms",
                self.kind.title(),
                self.name,
                pages(consumed as u64),
                started.elapsed().as_millis()
            );
        }
        Ok(())
    }

    /// Reads a prefix of `paths` (at least one, up to the byte cap) with
    /// stamps from `meta` (listed before the reads) or from a fresh listing,
    /// and applies it, deleting only paths that are indexed. While the lock
    /// is busy it waits and re-reads, so only one copy of the texts exists.
    /// A reconcile passes its `progress` (pass, done before this batch,
    /// total), which the sink advances while it applies.
    async fn apply_batch(
        &mut self,
        paths: &[String],
        meta: Option<Arc<HashMap<String, FileStamp>>>,
        progress: Option<(Pass, u64, u64)>,
    ) -> Result<Applied, Stop> {
        let started = Instant::now();
        loop {
            let reads = self.read(paths.to_vec(), meta.clone()).await?;
            let consumed = reads.len();
            let changes: Vec<Change> = reads
                .into_iter()
                .filter_map(|(path, page)| match page {
                    Some((text, stamp)) => Some(Change::Upsert { path, text, stamp }),
                    None if self.indexed.contains(&path) => Some(Change::Delete { path }),
                    None => None,
                })
                .collect();
            if changes.is_empty() {
                return Ok(Applied {
                    consumed,
                    committed: false,
                });
            }
            let (sink, status) = (self.sink.clone(), self.status.clone());
            let applied = blocking(move || {
                let at = |n: usize| {
                    if let Some((pass, done, total)) = progress {
                        report(&status, pass, done + n as u64, total);
                    }
                };
                let result = sink.apply_with_progress(&changes, &at);
                (changes, result)
            })
            .await;
            let result = match applied {
                Some((changes, Ok(()))) => {
                    for change in changes {
                        match change {
                            Change::Upsert { path, .. } => {
                                self.indexed.insert(path);
                            }
                            Change::Delete { path } => {
                                self.indexed.remove(&path);
                            }
                        }
                    }
                    Ok(())
                }
                Some((_, Err(e))) => Err(e),
                None => Err(SinkError::Failed("apply panicked".into())),
            };
            match result {
                Ok(()) => {
                    #[cfg(test)]
                    {
                        self.counts.commits += 1;
                    }
                    self.settled = false;
                    // A built index, or one that stays usable (also before
                    // this worker's first reconcile finished), recovers at
                    // its next commit.
                    let recovers = self.phase() == Phase::Built || self.stays_usable();
                    if recovers && matches!(self.status.borrow().sync, SyncState::Failed(_)) {
                        self.publish(SyncState::Ready);
                    }
                    return Ok(Applied {
                        consumed,
                        committed: true,
                    });
                }
                Err(SinkError::LockBusy) if started.elapsed() < RETRY_LATER => {
                    tracing::debug!(
                        "{} locked by another writer; retrying",
                        self.kind.capitalized()
                    );
                    sleep(LOCK_RETRY_EVERY).await;
                }
                Err(SinkError::LockBusy) => {
                    tracing::warn!(
                        "{} stayed locked for {}s; reconciling later",
                        self.kind.capitalized(),
                        RETRY_LATER.as_secs()
                    );
                    return Err(self.gave_up());
                }
                Err(SinkError::Failed(detail)) => {
                    tracing::warn!("{} update failed: {detail}", self.kind.capitalized());
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
        let (view, cancel, cap) = (
            self.view.clone(),
            self.cancel.clone(),
            self.limits.batch_bytes,
        );
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

/// A reconcile's progress: as `catch_up` while the index stays usable,
/// as `Building` for a build, not at all for a quiet pass.
fn report(status: &watch::Sender<WorkerStatus>, pass: Pass, done: u64, total: u64) {
    match pass {
        Pass::Quiet => {}
        Pass::Build { .. } => {
            let state = SyncState::Building { done, total };
            status.send_if_modified(|s| std::mem::replace(&mut s.sync, state.clone()) != state);
        }
        Pass::CatchUp => {
            let catch_up = Some(Progress { done, total });
            status.send_if_modified(|s| std::mem::replace(&mut s.catch_up, catch_up) != catch_up);
        }
    }
}

/// The page's text with the stamp storage listed, by [`page_text`].
fn read_page(view: &dyn SpaceView, path: &str, stamp: FileStamp) -> Page {
    match page_text(view, path, Some(stamp.size)) {
        Ok(text) => Page::Text(text, stamp),
        Err(Unindexable::Absent) => Page::Absent,
        Err(Unindexable::Skipped) => Page::Skipped,
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
            tracing::warn!("Search index sync task failed: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests;
