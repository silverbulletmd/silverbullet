//! Progress a sink reports while it applies a batch
//! ([`IndexSink::apply_with_progress`]).

use super::*;

/// Reports one page done, then holds the batch until released.
#[derive(Default)]
struct SlowSink {
    pages: Mutex<HashMap<String, FileStamp>>,
    hold: AtomicBool,
}

impl IndexSink for SlowSink {
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
        self.apply_with_progress(changes, &|_| {})
    }
    fn apply_with_progress(
        &self,
        changes: &[Change],
        progress: &dyn Fn(usize),
    ) -> Result<(), SinkError> {
        progress(1);
        while self.hold.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(1));
        }
        let mut pages = self.pages.lock().unwrap();
        for change in changes {
            if let Change::Upsert { path, stamp, .. } = change {
                pages.insert(path.clone(), *stamp);
            }
        }
        Ok(())
    }
    fn measure(&self) -> (u64, u64) {
        (self.pages.lock().unwrap().len() as u64, 0)
    }
    fn is_memory(&self) -> bool {
        true
    }
    fn limits(&self) -> SinkLimits {
        limits(own_slots(), BATCH_BYTES)
    }
}

/// A first build's `Building` count moves while its one batch is applied,
/// before the batch is committed.
#[tokio::test(flavor = "multi_thread")]
async fn a_build_reports_progress_from_inside_a_batch() {
    let sink = Arc::new(SlowSink::default());
    sink.hold.store(true, Ordering::SeqCst);
    let (_feed, rx) = tokio::sync::mpsc::unbounded_channel();
    let worker = SyncWorker::spawn("test", sink.clone(), view_with(3), rx);
    let mut status = worker.status.clone();
    let mid = SyncState::Building { done: 1, total: 3 };
    bounded(status.wait_for(|s| s.sync == mid)).await.unwrap();
    assert!(sink.stamps().is_empty(), "the batch isn't committed yet");
    sink.hold.store(false, Ordering::SeqCst);
    bounded(status.wait_for(|s| s.sync == SyncState::Ready))
        .await
        .unwrap();
    assert_eq!(worker.status().stats.unwrap().pages, 3);
}
