//! `SyncWorker::caught_up`: waits for every feed event received before the
//! call, and gives up at the deadline.

use super::*;
use crate::test_support::Unblock;

/// Real time: the worker's reads block in `spawn_blocking`, which keeps a
/// paused clock from advancing.
#[tokio::test(flavor = "multi_thread")]
async fn caught_up_waits_for_pending_events() {
    let view = TestView::with(&[("Garden.md", "tomatoes")]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    space.settled(1).await;
    assert!(
        space.worker.caught_up(std::time::Instant::now()).await,
        "nothing pending"
    );

    let paused = view.blocked();
    view.write("Garden.md", "basil");
    space.send(Some("Garden.md"));
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    assert!(!space.worker.caught_up(deadline).await, "while paused");

    let waiting = space
        .worker
        .caught_up(std::time::Instant::now() + Duration::from_secs(2));
    drop(paused);
    assert!(waiting.await, "after it resumes");
    assert_eq!(space.word("basil"), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_up_times_out() {
    let view = TestView::with(&[("Garden.md", "tomatoes")]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    space.settled(1).await;

    let _paused = view.blocked();
    view.write("Garden.md", "basil");
    space.send(Some("Garden.md"));
    let started = std::time::Instant::now();
    let caught_up = space
        .worker
        .caught_up(started + Duration::from_millis(300))
        .await;
    assert!(!caught_up);
    let waited = started.elapsed();
    assert!(waited >= Duration::from_millis(300), "{waited:?}");
    assert!(waited < Duration::from_secs(2), "{waited:?}");
}

/// A change arriving while the worker applies an earlier one is still in the
/// feed, not yet taken, when `caught_up` is called: it is waited for too.
#[tokio::test(flavor = "multi_thread")]
async fn caught_up_counts_events_queued_behind_a_busy_worker() {
    let view = TestView::with(&[("Garden.md", "tomatoes"), ("Kitchen.md", "bread")]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    space.settled(1).await;

    let paused = view.blocked();
    view.write("Garden.md", "basil");
    space.send(Some("Garden.md"));
    // Past the debounce: the worker is stuck reading Garden.md.
    tokio::time::sleep(DEBOUNCE * 2).await;
    view.write("Kitchen.md", "rye");
    space.send(Some("Kitchen.md"));
    let waiting = space
        .worker
        .caught_up(std::time::Instant::now() + Duration::from_secs(10));
    drop(paused);
    assert!(waiting.await);
    assert_eq!(space.word("basil"), 1);
    assert_eq!(space.word("rye"), 1);
}

/// An event received after the call is not waited for, even while the
/// worker is stuck applying it.
#[tokio::test(flavor = "multi_thread")]
async fn caught_up_ignores_events_received_after_the_call() {
    let view = TestView::with(&[("Garden.md", "tomatoes"), ("Pages/Kitchen.md", "bread")]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    space.settled(1).await;

    let paused = view.blocked();
    view.write("Garden.md", "basil");
    space.send(Some("Garden.md"));
    tokio::time::sleep(DEBOUNCE * 2).await;
    let waiting = space
        .worker
        .caught_up(std::time::Instant::now() + Duration::from_secs(5));
    view.write("Pages/Kitchen.md", "rye");
    space.send(Some("Pages/Kitchen.md"));
    drop(paused);
    // Reads under `Pages/` block again from now on.
    view.block_from.store(1, Ordering::SeqCst);
    let _held = Unblock(view.clone());
    let started = std::time::Instant::now();
    assert!(waiting.await);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(space.word("basil"), 1);
    assert_eq!(space.word("rye"), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_up_of_a_stopped_worker_is_false_at_once() {
    let view = TestView::with(&[("Garden.md", "tomatoes")]);
    let mut space = Space::start(view.clone(), IndexStore::open(Location::Memory));
    space.ready().await;
    let _paused = view.blocked();
    space.send(Some("Garden.md"));
    let waiting = space
        .worker
        .caught_up(std::time::Instant::now() + Duration::from_secs(5));
    let started = std::time::Instant::now();
    drop(space);
    assert!(!waiting.await);
    assert!(started.elapsed() < Duration::from_secs(1));
}
