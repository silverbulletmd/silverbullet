use super::*;
use crate::fulltext::store::{IndexStore, BATCH_BYTES, BATCH_PAGES, INDEX_BUILDS};
use crate::test_support::TestView;
use crate::{Location, Opened};
use std::sync::atomic::Ordering;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::Mutex;
use tantivy::collector::Count;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;
use tantivy::{IndexWriter, Term};

struct Space {
    store: Arc<IndexStore>,
    feed: tokio::sync::mpsc::UnboundedSender<FeedEvent>,
    sent: u64,
    worker: SyncWorker,
}

impl Space {
    fn start(view: Arc<TestView>, store: IndexStore) -> Space {
        Space::start_with(view, store, own_slots(), BATCH_BYTES)
    }

    /// Like `start`, with batches of `batch_pages` pages so a small space
    /// still builds in several batches.
    fn start_batched(view: Arc<TestView>, store: IndexStore, batch_pages: usize) -> Space {
        Space::start_limits(
            view,
            store,
            limits_of(own_slots(), batch_pages, BATCH_BYTES),
        )
    }

    fn start_with(
        view: Arc<TestView>,
        store: IndexStore,
        slots: &'static Semaphore,
        batch_bytes: u64,
    ) -> Space {
        Space::start_limits(view, store, limits(slots, batch_bytes))
    }

    fn start_limits(view: Arc<TestView>, store: IndexStore, limits: SinkLimits) -> Space {
        let store = Arc::new(store);
        let (feed, rx) = tokio::sync::mpsc::unbounded_channel();
        let worker = SyncWorker::spawn_with("test", store.clone(), view.clone(), rx, limits);
        Space {
            store,
            feed,
            sent: 0,
            worker,
        }
    }

    fn send(&mut self, msg: Option<&str>) {
        self.feed
            .send(msg.map_or(FeedEvent::Rescan, |p| FeedEvent::Changed(p.into())))
            .unwrap();
        self.sent += 1;
    }

    async fn ready(&self) {
        let mut state = self.worker.status.clone();
        let ready = state.wait_for(|s| s.sync == SyncState::Ready);
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

/// The full-text sink's limits with the test's own build slots and byte cap.
fn limits(builds: &'static Semaphore, batch_bytes: u64) -> SinkLimits {
    limits_of(builds, BATCH_PAGES, batch_bytes)
}

fn limits_of(builds: &'static Semaphore, batch_pages: usize, batch_bytes: u64) -> SinkLimits {
    SinkLimits {
        batch_pages,
        batch_bytes,
        builds,
        while_reconciling: WhileReconciling::ReportBuilding,
    }
}

fn spawn(store: Arc<IndexStore>, view: Arc<TestView>, feed: ChangeFeed) -> SyncWorker {
    SyncWorker::spawn_with("test", store, view, feed, limits(own_slots(), BATCH_BYTES))
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
    let space = Space::start_batched(view_with(250), disk(tmp.path()), 50);
    let mut state = space.worker.status.clone();
    let mut progress = Vec::new();
    loop {
        let s = state.borrow_and_update().sync.clone();
        match s {
            SyncState::Ready => break,
            SyncState::Building { done, total } if done > 0 => {
                assert_eq!(total, 250);
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
    assert_eq!(space.word("fern"), 250);
    assert_eq!(space.word("word123"), 1);
    assert_eq!(space.store.stamps().len(), 250);
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
    const BATCH: usize = 50;
    let tmp = tempfile::tempdir().unwrap();
    let view = view_with(200);
    *view.hook.lock().unwrap() = Some(Box::new(|view, n| {
        if n == BATCH + 1 {
            // Already committed in batch 1.
            view.write("Page 0010.md", "common fern rewritten");
            view.remove("Page 0011.md");
            // Not read yet (batch 4).
            view.write("Page 0150.md", "common fern changedlater");
            view.remove("Page 0151.md");
            view.write("Renamed 0151.md", "common fern word151");
        }
        if n == 2 * BATCH + 1 {
            // Batch 2 is committed; its listed stamp is now stale.
            view.write("Page 0075.md", "common fern lastedit");
        }
    }));
    let space = Space::start_batched(view.clone(), disk(tmp.path()), BATCH);
    space.ready().await;
    space.settled(2).await;
    assert_eq!(space.word("rewritten"), 1);
    assert_eq!(space.word("word10"), 0);
    assert!(!space.has_page("Page 0011.md"));
    assert_eq!(space.word("word11"), 0);
    assert_eq!(space.word("changedlater"), 1);
    assert_eq!(space.word("word150"), 0);
    assert!(!space.has_page("Page 0151.md"));
    assert!(space.has_page("Renamed 0151.md"));
    assert_eq!(space.word("word151"), 1);
    assert_eq!(space.word("lastedit"), 1);
    assert_eq!(space.word("word75"), 0);
    // One document per page, nothing resurrected.
    assert_eq!(space.word("fern"), 199);
    let paths = space.paths();
    let listed: BTreeSet<String> = view.list_meta().unwrap().into_keys().collect();
    assert_eq!(paths, listed);
}

/// Same, but storage reports each change on the feed while the build runs.
#[tokio::test(flavor = "multi_thread")]
async fn feed_events_during_the_build_are_applied_after_it() {
    let view = view_with(1500);
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<FeedEvent>();
    let hook_tx = tx.clone();
    *view.hook.lock().unwrap() = Some(Box::new(move |view, n| {
        if n == 10 {
            view.write("Page 0001.md", "common fern revised");
            view.remove("Page 0002.md");
            for p in ["Page 0001.md", "Page 0002.md"] {
                hook_tx.send(FeedEvent::Changed(p.into())).unwrap();
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

/// A reconcile deletes an indexed page that grew past the cap (listed too
/// large, never read), and leaves unchanged pages and never-indexed large
/// ones alone.
#[tokio::test(start_paused = true)]
async fn a_reconcile_drops_an_indexed_page_that_grew_too_large_without_reading_it() {
    let view = Arc::new(TestView::default());
    view.write("Garden.md", "tomatoes");
    view.write("Kitchen.md", "bread");
    view.write_bytes("Huge.md", vec![b'a'; MAX_FILE_BYTES as usize + 1]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    let expected: BTreeSet<String> = ["Garden.md", "Kitchen.md"].map(String::from).into();
    assert_eq!(space.paths(), expected);
    view.write_bytes("Garden.md", vec![b'b'; MAX_FILE_BYTES as usize + 1]);
    view.reset_reads();
    space.send(None);
    space.settled(2).await;
    assert_eq!(space.paths(), BTreeSet::from(["Kitchen.md".to_string()]));
    assert_eq!(view.reads("Garden.md"), 0, "listed too large: not read");
    assert_eq!(view.reads("Huge.md"), 0);
    assert_eq!(view.reads("Kitchen.md"), 0, "unchanged: not read");
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
    let (feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let worker = spawn(store, view.clone(), rx);
    let mut state = worker.status.clone();
    bounded(state.wait_for(|s| s.sync == SyncState::Ready))
        .await
        .unwrap();
    view.reset_reads();
    drop(worker);
    view.write("Page 0001.md", "changed");
    let _ = feed.send(FeedEvent::Changed("Page 0001.md".into()));
    let _ = feed.send(FeedEvent::Rescan);
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
    assert_eq!(space.worker.status().sync, SyncState::Ready);
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
    let mut state = space.worker.status.clone();
    let failed = state.wait_for(|s| matches!(&s.sync, SyncState::Failed(_)));
    bounded(failed).await.unwrap();
    assert_eq!(
        space.worker.status().sync,
        SyncState::Failed(IndexKind::FullText.failed_message().into())
    );
    drop(writer);

    // The reconcile scheduled after giving up lands the change.
    let before = space.reconciles();
    space.settled(before + 1).await;
    assert_eq!(space.word("basil"), 1);
    assert_eq!(space.worker.status().sync, SyncState::Ready);
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
    let mut state = space.worker.status.clone();
    let building = SyncState::Building {
        done: 0,
        total: 1001,
    };
    bounded(state.wait_for(|s| s.sync == building && s.waiting))
        .await
        .unwrap();
    // Virtual time: the worker can only be waiting for the slot.
    sleep(RECONCILE_EVERY).await;
    assert_eq!(view.total_reads(), 0);
    assert_eq!(space.worker.status().sync, building);
    assert!(space.worker.status().waiting);
    drop(slot);
    space.ready().await;
    assert_eq!(space.word("fern"), 1001);
    assert!(!space.worker.status().waiting);
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
    let snapshot = space.worker.status();
    assert_eq!(snapshot.sync, SyncState::Ready, "the index is kept");
    assert!(snapshot.listing_failed);
    assert_eq!(snapshot.stats.map(|s| s.pages), Some(5));

    // Retried 30 s later: still failing, still nothing deleted.
    space.settled(before + 2).await;
    assert_eq!(space.paths().len(), 5);

    // Listing works again: the next retry reconciles normally.
    view.unlistable.store(false, Ordering::Relaxed);
    space.settled(before + 3).await;
    assert!(!space.worker.status().listing_failed);
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
    assert!(space.worker.status().listing_failed);
    assert_eq!(
        space.worker.status().sync,
        SyncState::Building { done: 0, total: 0 }
    );
    assert!(space.paths().is_empty());

    view.unlistable.store(false, Ordering::Relaxed);
    space.ready().await;
    assert!(!space.worker.status().listing_failed);
    assert_eq!(space.paths().len(), 3);
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
    let mut state = space.worker.status.clone();
    state.borrow_and_update();
    space.send(None);
    let total = (BATCH_PAGES + 500) as u64;
    let building =
        state.wait_for(|s| matches!(&s.sync, SyncState::Building { total: t, .. } if *t == total));
    bounded(building).await.unwrap();
    space.ready().await;
    space.settled(2).await;
    assert_eq!(space.word("fern"), 1505);
}

/// A sink of another kind: records what it is given (and its resets, which
/// keep its pages), can be made to fail or to apply slowly.
struct RecordingSink {
    pages: Mutex<HashMap<String, FileStamp>>,
    applies: Mutex<Vec<usize>>,
    upserted: Mutex<Vec<String>>,
    settles: AtomicUsize,
    resets: AtomicUsize,
    fail: AtomicBool,
    apply_delay: Duration,
    builds: &'static Semaphore,
}

impl Default for RecordingSink {
    fn default() -> RecordingSink {
        RecordingSink::new()
    }
}

impl RecordingSink {
    fn new() -> RecordingSink {
        RecordingSink {
            pages: Mutex::default(),
            applies: Mutex::default(),
            upserted: Mutex::default(),
            settles: AtomicUsize::new(0),
            resets: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
            apply_delay: Duration::ZERO,
            builds: own_slots(),
        }
    }

    /// Each apply blocks this long (real time).
    fn with_apply_delay(mut self, delay: Duration) -> RecordingSink {
        self.apply_delay = delay;
        self
    }

    fn clear_applied(&self) {
        self.applies.lock().unwrap().clear();
        self.upserted.lock().unwrap().clear();
    }

    fn upserted_paths(&self) -> Vec<String> {
        self.upserted.lock().unwrap().clone()
    }

    fn resets(&self) -> usize {
        self.resets.load(Ordering::SeqCst)
    }
}

impl IndexSink for RecordingSink {
    fn kind(&self) -> IndexKind {
        IndexKind::Semantic
    }
    fn built_once(&self) -> bool {
        false
    }
    fn stamps(&self) -> HashMap<String, FileStamp> {
        self.pages.lock().unwrap().clone()
    }
    fn apply(&self, changes: &[Change]) -> Result<(), SinkError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(SinkError::Failed("disk full".into()));
        }
        std::thread::sleep(self.apply_delay);
        let mut pages = self.pages.lock().unwrap();
        for change in changes {
            match change {
                Change::Upsert { path, stamp, .. } => {
                    pages.insert(path.clone(), *stamp);
                    self.upserted.lock().unwrap().push(path.clone());
                }
                Change::Delete { path } => {
                    pages.remove(path);
                }
            }
        }
        self.applies.lock().unwrap().push(changes.len());
        Ok(())
    }
    fn measure(&self) -> (u64, u64) {
        (self.pages.lock().unwrap().len() as u64, 0)
    }
    fn is_memory(&self) -> bool {
        true
    }
    fn settle(&self) {
        self.settles.fetch_add(1, Ordering::SeqCst);
    }
    fn reset(&self) -> Result<(), SinkError> {
        self.resets.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn limits(&self) -> SinkLimits {
        SinkLimits {
            batch_pages: 2,
            batch_bytes: BATCH_BYTES,
            builds: self.builds,
            while_reconciling: WhileReconciling::ReportBuilding,
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn any_sink_gets_its_own_batches_and_settles_when_idle() {
    let view = view_with(5);
    let sink = Arc::new(RecordingSink::new());
    let (feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let worker = SyncWorker::spawn("test", sink.clone(), view.clone(), rx);
    let mut idle = worker.idle.clone();
    bounded(idle.wait_for(|i| i.reconciles >= 1)).await.unwrap();
    assert_eq!(worker.status().sync, SyncState::Ready);
    assert_eq!(*sink.applies.lock().unwrap(), [2, 2, 1]);
    assert_eq!(sink.settles.load(Ordering::SeqCst), 1);
    assert_eq!(worker.status().stats.unwrap().pages, 5);

    view.write("Page 0001.md", "changed");
    feed.send(FeedEvent::Changed("Page 0001.md".into()))
        .unwrap();
    bounded(idle.wait_for(|i| i.events >= 1 && i.commits >= 4))
        .await
        .unwrap();
    assert_eq!(*sink.applies.lock().unwrap(), [2, 2, 1, 1]);
    assert_eq!(sink.settles.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failing_sink_reports_its_own_failure() {
    let sink = Arc::new(RecordingSink::new());
    sink.fail.store(true, Ordering::SeqCst);
    let (_feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let worker = SyncWorker::spawn("test", sink, view_with(1), rx);
    let mut state = worker.status.clone();
    bounded(state.wait_for(|s| matches!(s.sync, SyncState::Failed(_))))
        .await
        .unwrap();
    assert_eq!(
        worker.status().sync,
        SyncState::Failed("The semantic index can't be updated".into())
    );
}

/// R3 (M2P16): an instance rebuild runs a second worker over the shared
/// semantic sink. Once a first build of a `Fresh` file finished, that worker
/// starts `Ready`, reports a large change as catch-up, takes no build slot,
/// and logs "caught up".
#[cfg(feature = "semantic")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_second_worker_over_a_built_sink_starts_ready_and_catches_up() {
    use crate::semantic::inference::Inference;
    use crate::semantic::sink::{SemanticSink, BATCH_PAGES as SEMANTIC_BATCH, BUILDS};
    use crate::semantic::test_model::FakeEmbedder;
    use crate::test_support::Unblock;
    let tmp = tempfile::tempdir().unwrap();
    let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
    let sink = Arc::new(SemanticSink::open(
        &Location::Disk(tmp.path().to_path_buf()),
        inference,
    ));
    assert_eq!(sink.opened(), Opened::Fresh);
    let view = view_with(3);
    {
        let (_feed, rx) = tokio::sync::mpsc::unbounded_channel();
        let first = SyncWorker::spawn("test", sink.clone(), view.clone(), rx);
        let mut idle = first.idle.clone();
        bounded(idle.wait_for(|i| i.reconciles >= 1)).await.unwrap();
        assert_eq!(first.status().sync, SyncState::Ready);
        assert!(!first.status().stats.unwrap().caught_up, "a first build");
    }
    let total = SEMANTIC_BATCH + 1;
    for i in 0..total {
        view.write(&format!("Pages/Moss {i:02}.md"), &format!("Moss note {i}."));
    }
    // Another space's build holds the slot; the worker's reads of `Pages/`
    // wait until released.
    let _other_build = BUILDS.acquire().await.unwrap();
    view.block_from.store(1, Ordering::SeqCst);
    let _unblock = Unblock(view.clone());
    let (_feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let second = SyncWorker::spawn("test", sink.clone(), view.clone(), rx);
    assert_eq!(second.status().sync, SyncState::Ready, "no Building flash");
    let mut status = second.status.clone();
    let expected = Some(Progress {
        done: 0,
        total: total as u64,
    });
    bounded(status.wait_for(|s| s.catch_up == expected))
        .await
        .unwrap();
    assert_eq!(second.status().sync, SyncState::Ready);
    view.release();
    let mut idle = second.idle.clone();
    bounded(idle.wait_for(|i| i.reconciles >= 1)).await.unwrap();
    let status = second.status();
    assert_eq!(status.sync, SyncState::Ready);
    assert_eq!(status.catch_up, None);
    let stats = status.stats.unwrap();
    assert_eq!(stats.pages, 3 + total as u64);
    assert!(stats.caught_up);
    assert!(stats
        .line(IndexKind::Semantic, "Notes")
        .contains(", caught up in "));
}

/// A second worker over a finished shared sink that fails a catch-up is
/// `Ready` again at its next commit from the feed, without waiting for the
/// reconcile: the index stays usable.
#[cfg(feature = "semantic")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_second_worker_over_a_built_sink_recovers_at_the_next_commit() {
    use crate::semantic::inference::Inference;
    use crate::semantic::sink::SemanticSink;
    use crate::semantic::test_model::FakeEmbedder;
    let fake = Arc::new(FakeEmbedder::new());
    let inference = Inference::with_embedder(fake.clone());
    let sink = Arc::new(SemanticSink::open(&Location::Memory, inference));
    let view = view_with(3);
    {
        let (_feed, rx) = tokio::sync::mpsc::unbounded_channel();
        let first = SyncWorker::spawn("test", sink.clone(), view.clone(), rx);
        let mut idle = first.idle.clone();
        bounded(idle.wait_for(|i| i.reconciles >= 1)).await.unwrap();
        assert_eq!(first.status().sync, SyncState::Ready);
    }
    fake.fail.store(true, Ordering::SeqCst);
    view.write("Page 0000.md", "edited fern");
    let (feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let second = SyncWorker::spawn("test", sink.clone(), view.clone(), rx);
    let mut idle = second.idle.clone();
    bounded(idle.wait_for(|i| i.reconciles >= 1)).await.unwrap();
    assert!(matches!(second.status().sync, SyncState::Failed(_)));
    fake.fail.store(false, Ordering::SeqCst);
    view.write("Page 0001.md", "edited moss");
    feed.send(FeedEvent::Changed("Page 0001.md".into()))
        .unwrap();
    bounded(idle.wait_for(|i| i.events >= 1 && i.commits >= 1))
        .await
        .unwrap();
    assert_eq!(second.idle.borrow().reconciles, 1, "no reconcile yet");
    assert_eq!(second.status().sync, SyncState::Ready);
}

mod catch_up;
mod progress;
mod rebuild;
