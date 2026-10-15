use super::*;
use crate::semantic::index::cosine;
use crate::semantic::test_model::FakeEmbedder;
use crate::semantic::test_server::TestModelServer;
use crate::semantic::{lease, sink};
use crate::test_support::TestView;
use crate::FeedEvent;
use std::sync::atomic::Ordering;
use std::time::Instant;
use tokio::sync::mpsc;

struct Fixture {
    fake: Arc<FakeEmbedder>,
    service: Arc<SemanticService>,
    view: Arc<TestView>,
    feed: mpsc::UnboundedSender<FeedEvent>,
    space: SemanticSpace,
}

fn start(fake: FakeEmbedder, view: Arc<TestView>, location: Location) -> Fixture {
    let fake = Arc::new(fake);
    let service = SemanticService::with_embedder(fake.clone());
    let (feed, rx) = mpsc::unbounded_channel();
    let space = service.attach("notes", "Notes", location, view.clone(), rx);
    Fixture {
        fake,
        service,
        view,
        feed,
        space,
    }
}

async fn until(what: &str, f: impl Fn() -> bool) {
    let started = Instant::now();
    while !f() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "timed out: {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn ready(fx: &Fixture) {
    until("ready", || fx.space.state().is_ready()).await;
}

fn garden() -> Arc<TestView> {
    TestView::with(&[
        (
            "Garden/Basil.md",
            "# Basil\nwater the basil\n\n# Harvest\npick the leaves",
        ),
        (
            "Bike/Puncture.md",
            "# Puncture\npatch the tube of a flat tyre",
        ),
        ("Kitchen/Coffee.md", "grind the beans"),
    ])
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_space_builds_and_reembeds_only_changed_chunks() {
    let fx = start(FakeEmbedder::new(), garden(), Location::Memory);
    ready(&fx).await;
    {
        let index = fx.space.index().unwrap();
        assert_eq!(index.len(), 3);
        assert_eq!(index.get("Garden/Basil.md").unwrap().chunks.len(), 2);
    }
    let embedded = fx.fake.texts.load(Ordering::SeqCst);
    assert_eq!(embedded, 4, "one text per chunk");
    fx.view.write(
        "Garden/Basil.md",
        "# Basil\nwater the basil\n\n# Harvest\npick the flowers",
    );
    fx.feed
        .send(FeedEvent::Changed("Garden/Basil.md".into()))
        .unwrap();
    until("the edit is indexed", || {
        fx.space
            .index()
            .unwrap()
            .get("Garden/Basil.md")
            .unwrap()
            .stamp
            == fx.view.list_meta().unwrap()["Garden/Basil.md"]
    })
    .await;
    assert_eq!(
        fx.fake.texts.load(Ordering::SeqCst),
        embedded + 1,
        "only the changed chunk"
    );
    let page_vector = fx
        .space
        .index()
        .unwrap()
        .get("Garden/Basil.md")
        .unwrap()
        .vector
        .clone();
    assert!(page_vector.is_some());
}

/// Review Focus 1: edits and deletes while a slow build embeds the same
/// pages end up applied exactly once, and nothing deleted comes back.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn edits_and_deletes_during_a_slow_build_end_up_exactly_once() {
    let view = Arc::new(TestView::default());
    for i in 0..80 {
        view.write(
            &format!("Pages/Note {i:02}.md"),
            &format!("common fern word{i}"),
        );
    }
    let fake = FakeEmbedder {
        delay: Duration::from_millis(20),
        ..FakeEmbedder::new()
    };
    let fx = start(fake, view.clone(), Location::Memory);
    until(
        "building",
        || matches!(fx.space.state(), IndexState::Building { done, .. } if done > 0),
    )
    .await;
    view.write("Pages/Note 03.md", "zebra stripes");
    view.remove("Pages/Note 05.md");
    view.write("Pages/Note 79.md", "quokka smiles");
    for path in ["Pages/Note 03.md", "Pages/Note 05.md", "Pages/Note 79.md"] {
        fx.feed.send(FeedEvent::Changed(path.into())).unwrap();
    }
    ready(&fx).await;
    let expected: std::collections::HashMap<_, _> = view.list_meta().unwrap();
    until("caught up", || {
        fx.space.index().unwrap().stamps() == expected
    })
    .await;
    let index = fx.space.index().unwrap();
    assert_eq!(index.len(), 79);
    assert!(index.get("Pages/Note 05.md").is_none(), "never resurrected");
    let zebra = fx.fake.vector(&format!(
        "{}zebra stripes",
        passage_head("Pages/Note 03.md")
    ));
    let chunk = &index.get("Pages/Note 03.md").unwrap().chunks[0];
    assert!(cosine(&zebra, &chunk.vector) > 0.999, "the newest content");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hidden_binary_and_oversized_files_are_never_indexed() {
    let view = TestView::with(&[("Fern.md", "fern fronds"), ("Hidden.md", "secret")]);
    view.hide("Hidden.md");
    view.write_bytes("Bad.md", vec![0xff, 0xfe]);
    view.write_bytes("Photo.png", vec![1, 2, 3]);
    view.write_bytes(
        "Huge.md",
        vec![b'a'; crate::limits::MAX_FILE_BYTES as usize + 1],
    );
    let fx = start(FakeEmbedder::new(), view, Location::Memory);
    ready(&fx).await;
    let index = fx.space.index().unwrap();
    let paths: Vec<&str> = index.iter().map(|(p, _)| p).collect();
    assert_eq!(paths, ["Fern.md"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restart_loads_the_index_without_embedding() {
    let dir = tempfile::tempdir().unwrap();
    let view = garden();
    {
        let fx = start(
            FakeEmbedder::new(),
            view.clone(),
            Location::Disk(dir.path().into()),
        );
        ready(&fx).await;
        let file = dir.path().join("semantic-v1/test-fake.bin");
        until("saved when idle", || file.is_file()).await;
    }
    let fx = start(FakeEmbedder::new(), view, Location::Disk(dir.path().into()));
    ready(&fx).await;
    assert_eq!(fx.space.index().unwrap().len(), 3);
    assert_eq!(
        fx.fake.calls.load(Ordering::SeqCst),
        0,
        "nothing re-embedded"
    );
    // A reused index is ready before the worker's first reconcile finished.
    until("stats", || fx.space.stats().is_some()).await;
    assert!(fx.space.stats().unwrap().caught_up);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attaching_again_shares_the_index_and_forget_drops_it() {
    let fx = start(FakeEmbedder::new(), garden(), Location::Memory);
    ready(&fx).await;
    let embedded = fx.fake.texts.load(Ordering::SeqCst);
    let (_feed, rx) = mpsc::unbounded_channel();
    let again = fx
        .service
        .attach("notes", "Notes", Location::Memory, fx.view.clone(), rx);
    until("ready again", || again.state().is_ready()).await;
    assert_eq!(
        fx.fake.texts.load(Ordering::SeqCst),
        embedded,
        "shared, not rebuilt"
    );
    drop(again);
    fx.service.forget("notes");
    let (_feed, rx) = mpsc::unbounded_channel();
    let fresh = fx
        .service
        .attach("notes", "Notes", Location::Memory, fx.view.clone(), rx);
    until("rebuilt", || fresh.state().is_ready()).await;
    assert_eq!(
        fx.fake.texts.load(Ordering::SeqCst),
        embedded * 2,
        "forgotten, so embedded again"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failing_model_marks_the_space_failed() {
    let fake = FakeEmbedder::new();
    fake.fail.store(true, Ordering::SeqCst);
    let fx = start(fake, garden(), Location::Memory);
    until("failed", || {
        matches!(fx.space.state(), IndexState::Failed { .. })
    })
    .await;
    assert_eq!(
        fx.space.state(),
        IndexState::Failed {
            reason: "The semantic index can't be updated".into()
        }
    );
}

/// Review Focus 5 (the download half): a model that can't be downloaded
/// leaves the space waiting with the download's failure, never ready.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_space_without_its_model_reports_the_download_failure() {
    let dir = tempfile::tempdir().unwrap();
    // Nothing listens on port 9 (discard) on test machines: the request is refused.
    let models =
        ModelStore::new(dir.path().join("models")).with_base_url("http://127.0.0.1:9".into());
    let spec = crate::semantic::test_model::write_tiny_model(&dir.path().join("src"), 7);
    let service = SemanticService::start_with_store(spec, models);
    let (_feed, rx) = mpsc::unbounded_channel();
    let space = service.attach("notes", "Notes", Location::Memory, garden(), rx);
    until("download failed", || {
        matches!(space.state(), IndexState::Failed { .. })
    })
    .await;
    assert!(space.index().is_none() || space.index().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_forgotten_space_never_writes_its_file_again() {
    let dir = tempfile::tempdir().unwrap();
    let fx = start(
        FakeEmbedder::new(),
        garden(),
        Location::Disk(dir.path().into()),
    );
    ready(&fx).await;
    let file = dir.path().join("semantic-v1/test-fake.bin");
    until("saved when idle", || file.is_file()).await;
    fx.service.forget("notes");
    std::fs::remove_dir_all(dir.path().join("semantic-v1")).unwrap();
    fx.view.write("Kitchen/Coffee.md", "grind the beans finer");
    fx.feed
        .send(FeedEvent::Changed("Kitchen/Coffee.md".into()))
        .unwrap();
    until("the edit is applied", || {
        fx.space
            .index()
            .unwrap()
            .get("Kitchen/Coffee.md")
            .unwrap()
            .stamp
            == fx.view.list_meta().unwrap()["Kitchen/Coffee.md"]
    })
    .await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(
        !dir.path().join("semantic-v1").exists(),
        "no late checkpoint"
    );
}

/// Turning a space off and on again: the forget doesn't wait for the
/// old sink to close, the new attach reloads the file instead of
/// re-embedding, and the forgotten sink never writes again.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_background_forget_then_attach_reloads_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let fx = start(
        FakeEmbedder::new(),
        garden(),
        Location::Disk(dir.path().into()),
    );
    ready(&fx).await;
    let file = dir.path().join("semantic-v1/test-fake.bin");
    until("saved when idle", || file.is_file()).await;
    let embedded = fx.fake.texts.load(Ordering::SeqCst);
    fx.service.forget_in_background("notes");
    let (_feed, rx) = mpsc::unbounded_channel();
    let again = fx.service.attach(
        "notes",
        "Notes",
        Location::Disk(dir.path().into()),
        fx.view.clone(),
        rx,
    );
    until("ready again", || again.state().is_ready()).await;
    assert_eq!(
        fx.fake.texts.load(Ordering::SeqCst),
        embedded,
        "reloaded, not re-embedded"
    );
    drop(again);
    fx.service.forget("notes");
    std::fs::remove_dir_all(dir.path().join("semantic-v1")).unwrap();
    fx.view.write("Kitchen/Coffee.md", "grind the beans finer");
    fx.feed
        .send(FeedEvent::Changed("Kitchen/Coffee.md".into()))
        .unwrap();
    until("the edit is applied", || {
        fx.space
            .index()
            .unwrap()
            .get("Kitchen/Coffee.md")
            .unwrap()
            .stamp
            == fx.view.list_meta().unwrap()["Kitchen/Coffee.md"]
    })
    .await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(
        !dir.path().join("semantic-v1").exists(),
        "the first sink, forgotten in the background, never writes"
    );
}

/// A service whose sinks take `save_delay` per checkpoint.
fn slow_saves(fake: Arc<FakeEmbedder>, save_delay: Duration) -> Arc<SemanticService> {
    let mut service = SemanticService::new(Inference::with_embedder(fake));
    service.opener = Arc::new(move |location, inference| {
        SemanticSink::open(location, inference).with_save_delay(save_delay)
    });
    Arc::new(service)
}

/// Opens sinks that take at least `delay` to open.
fn slow_open(delay: Duration) -> SinkOpener {
    Arc::new(move |location, inference| {
        std::thread::sleep(delay);
        SemanticSink::open(location, inference)
    })
}

/// The edit that makes a sink save next, sent to `feed`.
fn edit(view: &TestView, feed: &mpsc::UnboundedSender<FeedEvent>, path: &str, text: &str) {
    view.write(path, text);
    feed.send(FeedEvent::Changed(path.into())).unwrap();
}

struct Attached {
    space: SemanticSpace,
    feed: mpsc::UnboundedSender<FeedEvent>,
}

fn attach_at(service: &SemanticService, view: &Arc<TestView>, dir: &std::path::Path) -> Attached {
    let (feed, rx) = mpsc::unbounded_channel();
    let space = service.attach(
        "notes",
        "Notes",
        Location::Disk(dir.into()),
        view.clone(),
        rx,
    );
    Attached { space, feed }
}

/// A space on disk, built and saved once, with a save of an edit now in
/// flight (it takes `SLOW_SAVE`).
async fn saving(
    service: &SemanticService,
    view: &Arc<TestView>,
    dir: &std::path::Path,
) -> (Attached, PathBuf) {
    let first = attach_at(service, view, dir);
    until("ready", || first.space.state().is_ready()).await;
    let file = dir.join("semantic-v1/test-fake.bin");
    until("saved once", || {
        let count = lease::writers::of(&file);
        count.saves >= 1 && count.now == 0
    })
    .await;
    edit(
        view,
        &first.feed,
        "Kitchen/Coffee.md",
        "grind the beans finer",
    );
    until("a save in flight", || lease::writers::of(&file).now == 1).await;
    (first, file)
}

const SLOW_SAVE: Duration = Duration::from_millis(600);

/// I1 (fix round 1): an open aborted while the old sink's save runs
/// doesn't let the next open in early; one writer at all times.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_aborted_open_never_lets_a_second_writer_in() {
    let dir = tempfile::tempdir().unwrap();
    let service = slow_saves(Arc::new(FakeEmbedder::new()), SLOW_SAVE);
    let view = garden();
    let (_first, file) = saving(&service, &view, dir.path()).await;
    service.forget_in_background("notes");
    let aborted = attach_at(&service, &view, dir.path());
    // Its open is now waiting for the file; dropping aborts it.
    tokio::time::sleep(Duration::from_millis(100)).await;
    drop(aborted);
    let third = attach_at(&service, &view, dir.path());
    until("ready", || third.space.state().is_ready()).await;
    let before = lease::writers::of(&file).saves;
    edit(
        &view,
        &third.feed,
        "Garden/Basil.md",
        "water the basil daily",
    );
    until("the third sink saved", || {
        lease::writers::of(&file).saves > before
    })
    .await;
    assert_eq!(lease::writers::of(&file).most, 1, "one writer at a time");
}

/// I1 (fix round 1): off, on, off, on while a slow save runs.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn off_on_off_on_during_a_slow_save_keeps_one_writer() {
    let dir = tempfile::tempdir().unwrap();
    let service = slow_saves(Arc::new(FakeEmbedder::new()), SLOW_SAVE);
    let view = garden();
    let (_first, file) = saving(&service, &view, dir.path()).await;
    service.forget_in_background("notes");
    let second = attach_at(&service, &view, dir.path());
    service.forget_in_background("notes");
    let fourth = attach_at(&service, &view, dir.path());
    until("ready", || fourth.space.state().is_ready()).await;
    let before = lease::writers::of(&file).saves;
    edit(
        &view,
        &fourth.feed,
        "Garden/Basil.md",
        "water the basil daily",
    );
    until("the last sink saved", || {
        lease::writers::of(&file).saves > before
    })
    .await;
    assert!(
        second.space.index().is_none(),
        "the forgotten one never ran"
    );
    assert_eq!(lease::writers::of(&file).most, 1, "one writer at a time");
}

/// M1 (fix round 1): a delete right after a toggle-off waits for the
/// background close, so its save can't recreate the directory.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deleted_space_directory_is_never_recreated() {
    let dir = tempfile::tempdir().unwrap();
    let service = slow_saves(Arc::new(FakeEmbedder::new()), SLOW_SAVE);
    let view = garden();
    let (first, file) = saving(&service, &view, dir.path()).await;
    service.forget_in_background("notes");
    // The delete: forget (nothing left to forget), wait, remove.
    service.forget("notes");
    service.wait_closed(&Location::Disk(dir.path().into()));
    assert_eq!(lease::writers::of(&file).now, 0, "the save finished first");
    std::fs::remove_dir_all(dir.path().join("semantic-v1")).unwrap();
    edit(
        &view,
        &first.feed,
        "Garden/Basil.md",
        "water the basil daily",
    );
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(
        !dir.path().join("semantic-v1").exists(),
        "no late save recreates it"
    );
}

/// I-2: `forget` while the sink is still opening closes it once the open
/// finishes, so it never writes, and a re-attach has the file alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_space_forgotten_while_its_index_opens_never_writes_it() {
    let dir = tempfile::tempdir().unwrap();
    let fake = Arc::new(FakeEmbedder::new());
    let mut service = SemanticService::new(Inference::with_embedder(fake.clone()));
    service.opener = slow_open(Duration::from_millis(300));
    let service = Arc::new(service);
    let view = garden();
    let location = Location::Disk(dir.path().into());
    let attach = || {
        let (_feed, rx) = mpsc::unbounded_channel();
        service.attach("notes", "Notes", location.clone(), view.clone(), rx)
    };
    let first = attach();
    service.forget("notes");
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(
        !dir.path().join("semantic-v1").exists(),
        "the late open never writes"
    );
    assert!(first.index().is_none(), "no worker on a forgotten sink");
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);

    // Both opens in flight on the same file: only the attached one runs.
    let second = attach();
    service.forget("notes");
    let third = attach();
    until("ready", || third.state().is_ready()).await;
    let file = dir.path().join("semantic-v1/test-fake.bin");
    until("saved when idle", || file.is_file()).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(second.index().is_none() && first.index().is_none());
    assert_eq!(
        fake.texts.load(Ordering::SeqCst),
        4,
        "built once, by one writer"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn moving_a_space_forgets_its_old_sink() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let fx = start(
        FakeEmbedder::new(),
        garden(),
        Location::Disk(a.path().into()),
    );
    ready(&fx).await;
    let file = a.path().join("semantic-v1/test-fake.bin");
    until("saved when idle", || file.is_file()).await;
    let (_feed, rx) = mpsc::unbounded_channel();
    let moved = fx.service.attach(
        "notes",
        "Notes",
        Location::Disk(b.path().into()),
        fx.view.clone(),
        rx,
    );
    until("ready at the new place", || moved.state().is_ready()).await;
    std::fs::remove_dir_all(a.path().join("semantic-v1")).unwrap();
    fx.view.write("Kitchen/Coffee.md", "grind the beans finer");
    fx.feed
        .send(FeedEvent::Changed("Kitchen/Coffee.md".into()))
        .unwrap();
    until("the edit is applied", || {
        fx.space
            .index()
            .unwrap()
            .get("Kitchen/Coffee.md")
            .unwrap()
            .stamp
            == fx.view.list_meta().unwrap()["Kitchen/Coffee.md"]
    })
    .await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(
        !a.path().join("semantic-v1").exists(),
        "the old place is never written"
    );
}

#[test]
fn caps_and_batches_are_the_rulings_values() {
    assert_eq!(
        (sink::MAX_PAGES, sink::MAX_CHUNKS, sink::MAX_PAGE_TEXT),
        (30_000, 150_000, 256 * 1024)
    );
    assert_eq!(
        (sink::BATCH_PAGES, sink::CHECKPOINT_EVERY),
        (32, Duration::from_secs(30))
    );
    assert_eq!(passage_head("Bike/Puncture.md"), "Bike/Puncture\n");
}

/// Review Focus 2: a built index reopened from disk is reset once its
/// worker runs, not reloaded as "rebuilt".
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_before_the_semantic_worker_runs_applies_once_it_does() {
    let dir = tempfile::tempdir().unwrap();
    let location = Location::Disk(dir.path().into());
    let built = start(FakeEmbedder::new(), garden(), location.clone());
    ready(&built).await;
    drop(built.space);
    built.service.forget("notes");

    let fake = Arc::new(FakeEmbedder::new());
    let mut service = SemanticService::new(Inference::with_embedder(fake.clone()));
    service.opener = slow_open(Duration::from_millis(300));
    let (_feed, rx) = mpsc::unbounded_channel();
    let space = service.attach("notes", "Notes", location, garden(), rx);
    assert_eq!(space.state(), IndexState::Starting);
    space.rebuild().unwrap();
    space.rebuild().unwrap();
    assert_eq!(space.report().state, IndexState::Starting);
    until("rebuilt", || {
        space.sink_resets() == 1
            && space.state().is_ready()
            && fake.texts.load(Ordering::SeqCst) == 4
    })
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(space.sink_resets(), 1, "the requested reset ran once");
    assert_eq!(
        fake.texts.load(Ordering::SeqCst),
        4,
        "every chunk embedded again after the reset"
    );
    let report = space.report();
    assert_eq!(report.kind, IndexKind::Semantic);
    assert_eq!(report.pages, Some(3));
    assert!(report.build_secs.is_some());
}

/// A rebuild asked for before a first build runs is satisfied by that
/// build: nothing is embedded twice.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_before_a_first_build_starts_nothing_more() {
    let fake = Arc::new(FakeEmbedder::new());
    let mut service = SemanticService::new(Inference::with_embedder(fake.clone()));
    service.opener = slow_open(Duration::from_millis(300));
    let (_feed, rx) = mpsc::unbounded_channel();
    let space = service.attach("notes", "Notes", Location::Memory, garden(), rx);
    assert_eq!(space.state(), IndexState::Starting);
    space.rebuild().unwrap();
    until("built", || space.state().is_ready()).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(space.sink_resets(), 0, "no reset on top of the first build");
    assert_eq!(fake.texts.load(Ordering::SeqCst), 4, "every chunk once");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuilt_index_on_disk_reopens_finished() {
    let dir = tempfile::tempdir().unwrap();
    let fx = start(
        FakeEmbedder::new(),
        garden(),
        Location::Disk(dir.path().into()),
    );
    ready(&fx).await;
    fx.space.rebuild().unwrap();
    until("rebuilt", || {
        fx.space.sink_resets() == 1
            && fx.space.state().is_ready()
            && fx.fake.texts.load(Ordering::SeqCst) == 8
    })
    .await;
    drop(fx.space);
    fx.service.forget("notes");
    let sink = SemanticSink::open(
        &Location::Disk(dir.path().into()),
        Inference::with_embedder(fx.fake.clone()),
    );
    assert_eq!(sink.opened(), crate::Opened::Reused);
    assert_eq!(sink.read().len(), 3);
}

/// A service downloading the tiny model from a local server.
async fn service_with_test_model_server() -> (Arc<SemanticService>, TestModelServer) {
    let server = TestModelServer::start().await;
    (server.service(), server)
}

/// [`service_with_test_model_server`] with a server whose download never
/// finishes, so it can be cancelled mid-download.
async fn service_with_stalled_test_model_server() -> (Arc<SemanticService>, TestModelServer) {
    let server = TestModelServer::stalled().await;
    (server.service(), server)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn prefetch_downloads_without_any_space_attached() {
    let (service, _server) = service_with_test_model_server().await;
    assert_eq!(service.download_state(), DownloadState::Missing);
    service.prefetch();
    until("ready", || service.download_state() == DownloadState::Ready).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_cancels_a_download_and_keeps_its_partial() {
    let (service, server) = service_with_stalled_test_model_server().await;
    service.prefetch();
    // From the first byte on, the model's `.partial` exists.
    until(
        "downloading",
        || matches!(service.download_state(), DownloadState::Downloading { done, .. } if done > 0),
    )
    .await;
    service.shutdown();
    until("stopped", || {
        !matches!(service.download_state(), DownloadState::Downloading { .. })
    })
    .await;
    assert_eq!(service.download_state(), DownloadState::Missing);
    assert!(server.partial_exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_forgets_every_space() {
    let fx = start(FakeEmbedder::new(), garden(), Location::Memory);
    ready(&fx).await;
    fx.service.shutdown();
    assert!(fx.service.sinks.lock().unwrap().is_empty());
    let (_feed, rx) = mpsc::unbounded_channel();
    let late = fx
        .service
        .attach("notes", "Notes", Location::Memory, fx.view.clone(), rx);
    until("the late attach fails", || {
        matches!(late.state(), IndexState::Failed { .. })
    })
    .await;
}
