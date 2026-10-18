//! [`SyncWorker::rebuild`].

use super::*;

/// A feed that never sends anything.
fn closed_feed() -> ChangeFeed {
    tokio::sync::mpsc::unbounded_channel().1
}

/// Until the worker is idle and `Ready`, with no rebuild pending or running.
async fn until_ready(worker: &SyncWorker) {
    let mut idle = worker.idle.clone();
    idle.wait_for(|_| {
        let s = worker.status();
        !s.rebuild_due && s.phase != Phase::Rebuilding && s.sync == SyncState::Ready
    })
    .await
    .unwrap();
}

/// Until the worker publishes a status `f` accepts.
async fn until_status(worker: &SyncWorker, f: impl Fn(&WorkerStatus) -> bool) {
    let mut status = worker.status.clone();
    status.wait_for(|s| f(s)).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_rebuild_reapplies_every_page_with_unchanged_stamps() {
    let view = view_with(3);
    let sink = Arc::new(RecordingSink::default());
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view.clone(),
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    bounded(until_ready(&worker)).await;
    sink.clear_applied();
    view.reset_reads();

    assert!(worker.rebuild());
    bounded(until_ready(&worker)).await;

    assert_eq!(sink.resets(), 1);
    assert_eq!(
        sink.upserted_paths().len(),
        3,
        "every page re-read although stamps match"
    );
    assert_eq!(view.total_reads(), 3);
    let status = worker.status();
    assert!(!status.stats.unwrap().caught_up, "a rebuild is a build");
    assert!(status.last_build.is_some());
}

#[tokio::test(start_paused = true)]
async fn a_rebuild_also_drops_pages_storage_no_longer_lists() {
    let view = view_with(3);
    let sink = Arc::new(RecordingSink::default());
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view.clone(),
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    bounded(until_ready(&worker)).await;
    view.remove("Page 0001.md");
    assert!(worker.rebuild());
    bounded(until_ready(&worker)).await;
    assert_eq!(
        sink.stamps().into_keys().collect::<BTreeSet<_>>(),
        BTreeSet::from(["Page 0000.md".to_string(), "Page 0002.md".to_string()])
    );
}

#[tokio::test(start_paused = true)]
async fn a_second_rebuild_while_one_runs_starts_nothing() {
    let view = view_with(3);
    let sink = Arc::new(RecordingSink::default().with_apply_delay(Duration::from_millis(50)));
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view,
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    bounded(until_ready(&worker)).await;

    assert!(worker.rebuild());
    assert!(!worker.rebuild(), "already rebuilding");
    bounded(until_status(&worker, |s| {
        matches!(s.sync, SyncState::Building { .. })
    }))
    .await;
    assert!(!worker.rebuild(), "still rebuilding");
    bounded(until_ready(&worker)).await;
    assert_eq!(sink.resets(), 1);
    assert!(worker.rebuild(), "a finished rebuild can run again");
    bounded(until_ready(&worker)).await;
    assert_eq!(sink.resets(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_rebuild_reports_building_then_ready() {
    let view = view_with(3);
    // Slow enough that `Building` is still published when the test looks:
    // the status channel keeps only the latest value
    let sink = Arc::new(RecordingSink::default().with_apply_delay(Duration::from_millis(50)));
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view,
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    bounded(until_ready(&worker)).await;
    assert!(worker.rebuild());
    bounded(until_status(&worker, |s| {
        matches!(s.sync, SyncState::Building { .. })
    }))
    .await;
    bounded(until_ready(&worker)).await;
    assert_eq!(worker.status().sync, SyncState::Ready);
}

#[tokio::test(start_paused = true)]
async fn a_rebuild_that_gives_up_is_forced_again_at_the_retry() {
    let view = view_with(3);
    let sink = Arc::new(RecordingSink::default());
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view.clone(),
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    bounded(until_ready(&worker)).await;
    sink.clear_applied();
    sink.fail.store(true, Ordering::SeqCst);
    assert!(worker.rebuild());
    bounded(until_status(&worker, |s| {
        matches!(s.sync, SyncState::Failed(_))
    }))
    .await;
    assert!(!worker.rebuild(), "still pending");
    sink.fail.store(false, Ordering::SeqCst);
    bounded(until_ready(&worker)).await;
    assert_eq!(sink.resets(), 1);
    assert_eq!(
        sink.upserted_paths().len(),
        3,
        "the retry re-read every page"
    );
}

#[tokio::test(start_paused = true)]
async fn a_rebuild_during_the_first_build_starts_nothing_more() {
    let view = view_with(3);
    let sink = Arc::new(RecordingSink::default().with_apply_delay(Duration::from_millis(50)));
    let worker = SyncWorker::spawn_with(
        "garden",
        sink.clone(),
        view.clone(),
        closed_feed(),
        limits(own_slots(), u64::MAX),
    );
    assert!(matches!(worker.status().sync, SyncState::Building { .. }));
    assert!(!worker.rebuild(), "the first build reads every page anyway");
    bounded(until_ready(&worker)).await;
    // Past the debounce and a feed wake-up: nothing else ran.
    tokio::time::sleep(DEBOUNCE * 4).await;
    assert_eq!(sink.resets(), 0, "no reset after the first build");
    assert_eq!(sink.upserted_paths().len(), 3, "every page read once");
    assert_eq!(view.total_reads(), 3);
    assert!(worker.rebuild(), "a built index can be rebuilt");
    bounded(until_ready(&worker)).await;
    assert_eq!(sink.resets(), 1);
}
