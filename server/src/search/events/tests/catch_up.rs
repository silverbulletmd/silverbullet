//! `index_status` through a real watcher and the change feed: a search right
//! after a write sees it.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use silverbullet_server_common::revision::sha256_hex;
use silverbullet_server_common::space::disk::DiskSpacePrimitives;
use silverbullet_server_common::space::GitignoreMatcher;
use silverbullet_server_search::{QueryRequest, RequestCx};

use super::*;
use crate::auth::Actor;
use crate::search::{full_text_backend, Location};
use crate::watcher::{debounce_loop, start_watcher, WatchMode};

fn space(dir: &Path) -> Arc<dyn SpacePrimitives> {
    Arc::new(DiskSpacePrimitives::new(dir, "").unwrap())
}

async fn hits(search: &dyn SearchBackend, word: &str) -> usize {
    let req = QueryRequest {
        query: word.into(),
        mode: None,
        scope: None,
        include: None,
        exclude: None,
        limit: None,
    };
    let cx = RequestCx::unlimited(Duration::from_secs(5));
    search.query(req, cx).await.unwrap().total
}

/// Until the index finds `word` (the first build).
async fn indexed(search: &dyn SearchBackend, word: &str) {
    let until = Instant::now() + Duration::from_secs(10);
    while hits(search, word).await == 0 {
        assert!(Instant::now() < until, "never indexed {word}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn root(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().canonicalize().unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_disk_write_is_searchable_once_the_watcher_caught_up() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    std::fs::write(root.join("Garden.md"), "tomatoes").unwrap();
    let guard = Arc::new(FsGuard::default());
    let watcher = start_watcher(&root, "", WatchMode::Auto, guard.clone()).unwrap();
    let search = full_text_backend(
        "test",
        space(&root),
        GitignoreMatcher::default(),
        Location::Memory,
        watcher.subscribe(),
    );
    indexed(search.as_ref(), "tomatoes").await;
    crate::test_support::wait_for_native_watcher(&guard).await;

    std::fs::write(root.join("Garden.md"), "basil").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    assert_eq!(
        index_status(&guard, search.as_ref(), deadline).await,
        IndexStatus::CaughtUp
    );
    assert_eq!(hits(search.as_ref(), "basil").await, 1);
}

/// A write through the server whose event the watcher sends later than
/// its usual window is still waited for.
#[tokio::test(flavor = "multi_thread")]
async fn a_server_write_is_awaited_until_the_watcher_reports_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    std::fs::write(root.join("Garden.md"), "tomatoes").unwrap();
    let guard = Arc::new(FsGuard::default());
    guard.watched(WatchMode::Auto);
    let (watcher, _) = broadcast::channel(16);
    let (raw, raw_rx) = std::sync::mpsc::channel::<PathBuf>();
    let loop_guard = guard.clone();
    let (loop_root, out) = (root.clone(), watcher.downgrade());
    let validator = DiskSpacePrimitives::new(&root, "").unwrap();
    let watching = std::thread::spawn(move || {
        debounce_loop(
            &loop_root,
            &validator,
            raw_rx,
            out,
            &loop_guard,
            Duration::from_millis(50),
        )
    });
    let search = full_text_backend(
        "test",
        space(&root),
        GitignoreMatcher::default(),
        Location::Memory,
        watcher.subscribe(),
    );
    indexed(search.as_ref(), "tomatoes").await;

    std::fs::write(root.join("Garden.md"), "basil").unwrap();
    guard.record_expected_write(
        "Garden.md",
        &sha256_hex(b"basil"),
        Actor::default(),
        None,
        None,
    );
    let late = Duration::from_millis(500);
    let path = root.join("Garden.md");
    let report = tokio::spawn(async move {
        tokio::time::sleep(late).await;
        raw.send(path).unwrap();
        raw
    });
    let started = Instant::now();
    assert_eq!(
        index_status(&guard, search.as_ref(), started + Duration::from_secs(5)).await,
        IndexStatus::CaughtUp
    );
    assert!(started.elapsed() >= late);
    assert_eq!(hits(search.as_ref(), "basil").await, 1);

    drop(report.await.unwrap());
    drop(watcher);
    watching.join().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_polling_watcher_is_never_caught_up() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    let guard = Arc::new(FsGuard::default());
    let watcher = start_watcher(
        &root,
        "",
        WatchMode::Poll(Duration::from_secs(3600)),
        guard.clone(),
    )
    .unwrap();
    let search = full_text_backend(
        "test",
        space(&root),
        GitignoreMatcher::default(),
        Location::Memory,
        watcher.subscribe(),
    );
    let started = Instant::now();
    assert_eq!(
        index_status(&guard, search.as_ref(), started + Duration::from_secs(5)).await,
        IndexStatus::Polling
    );
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "nothing to wait for"
    );
}

#[tokio::test]
async fn without_a_watcher_there_is_nothing_to_wait_for() {
    let guard = FsGuard::default();
    guard.record_expected_write("Garden.md", "hash", Actor::default(), None, None);
    assert!(guard.forwarding().is_none());
    let (search, _) = crate::search::in_memory_full_text(Arc::new(
        silverbullet_server_common::space::MemorySpacePrimitives::new(),
    ));
    assert_eq!(
        index_status(
            &guard,
            search.as_ref(),
            Instant::now() + Duration::from_secs(5)
        )
        .await,
        IndexStatus::CaughtUp
    );
}
