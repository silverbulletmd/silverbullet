//! The server's semantic search: one inference worker, and per space id a
//! [`SemanticSink`] that outlives instance rebuilds. Each attach runs its
//! own sync worker over the space's current storage view.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLockReadGuard};
use std::time::Duration;

use tokio::sync::OnceCell;
use tokio::task::JoinHandle;

use super::catalog::ModelSpec;
use super::download::{DownloadError, DownloadState, ModelStore};
#[cfg(any(test, feature = "test-model"))]
use super::embed::Embedder;
use super::index::VectorIndex;
use super::inference::Inference;
use super::sink::SemanticSink;
use crate::sync::SyncWorker;
use crate::{
    ChangeFeed, IndexKind, IndexReport, IndexState, IndexStats, Location, SearchError, SpaceView,
};

pub use super::sink::passage_head;

/// How long a failed model download waits before it resumes.
pub const DOWNLOAD_RETRY: Duration = Duration::from_secs(60);

/// Space id → its sink, opened once and shared by every attach.
struct SinkCell {
    location: Location,
    sink: OnceCell<Arc<SemanticSink>>,
    /// Set by [`SinkCell::forget`]. A sink whose open finishes afterwards is
    /// closed before anything runs on it.
    forgotten: Mutex<bool>,
}

impl SinkCell {
    fn new(location: Location) -> Arc<SinkCell> {
        Arc::new(SinkCell {
            location,
            sink: OnceCell::new(),
            forgotten: Mutex::new(false),
        })
    }

    /// Closes the sink, and one still opening once its open finishes: no
    /// sink of this cell writes its file after this returns. Blocks for a
    /// save in flight.
    fn forget(&self) {
        *self.forgotten.lock().unwrap_or_else(|e| e.into_inner()) = true;
        if let Some(sink) = self.sink.get() {
            sink.close();
        }
    }

    /// Whether `sink` (this cell's, open) may run; closes it when the cell
    /// was forgotten. The sink is set before this reads the flag, and
    /// [`SinkCell::forget`] sets the flag before it reads the sink, so one of
    /// them closes it.
    fn keep(&self, sink: &SemanticSink) -> bool {
        let forgotten = *self.forgotten.lock().unwrap_or_else(|e| e.into_inner());
        if forgotten {
            sink.close();
        }
        !forgotten
    }
}

/// Closes `cell` off the caller's thread (it may block for a save in
/// flight): on the runtime's blocking pool when there is one.
fn close_in_background(cell: Arc<SinkCell>) {
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => drop(runtime.spawn_blocking(move || cell.forget())),
        Err(_) => drop(std::thread::spawn(move || cell.forget())),
    }
}

pub struct SemanticService {
    inference: Arc<Inference>,
    sinks: Mutex<HashMap<String, Arc<SinkCell>>>,
    /// Held by the space that waits for the model: one download and one
    /// retry clock for the server, however many spaces attach.
    download: Arc<tokio::sync::Mutex<()>>,
    /// Opens a space's sink; [`SemanticSink::open`] but in tests.
    opener: SinkOpener,
}

/// Opens a space's sink at its location (blocking, see [`SemanticSink::open`]).
pub(crate) type SinkOpener = Arc<dyn Fn(&Location, Arc<Inference>) -> SemanticSink + Send + Sync>;

impl SemanticService {
    fn new(inference: Arc<Inference>) -> SemanticService {
        SemanticService {
            inference,
            sinks: Mutex::default(),
            download: Arc::default(),
            opener: Arc::new(SemanticSink::open),
        }
    }

    /// The service for `spec`, its model files under `models_dir`
    /// (`<data>/search/models`), inferring on `threads` threads
    /// (`inference::THREADS` on a server).
    pub fn start(spec: ModelSpec, models_dir: PathBuf, threads: usize) -> Arc<SemanticService> {
        SemanticService::start_on(spec, ModelStore::new(models_dir), threads)
    }

    /// [`SemanticService::start`] on a prepared store (one that downloads
    /// from elsewhere: the e2e harness's server, a test server).
    pub fn start_on(spec: ModelSpec, models: ModelStore, threads: usize) -> Arc<SemanticService> {
        Arc::new(SemanticService::new(Inference::start(
            spec,
            Arc::new(models),
            threads,
        )))
    }

    /// [`SemanticService::start_on`], inferring on 1 thread.
    #[cfg(any(test, feature = "test-model"))]
    pub fn start_with_store(spec: ModelSpec, models: ModelStore) -> Arc<SemanticService> {
        SemanticService::start_on(spec, models, 1)
    }

    #[cfg(any(test, feature = "test-model"))]
    pub fn with_embedder(embedder: Arc<dyn Embedder>) -> Arc<SemanticService> {
        Arc::new(SemanticService::new(Inference::with_embedder(embedder)))
    }

    pub fn model(&self) -> &ModelSpec {
        self.inference.spec()
    }

    /// The model's download state (`Ready` for an embedder given directly).
    pub fn download_state(&self) -> DownloadState {
        self.inference.model_state()
    }

    /// Downloads the model in the background, as an attach would, without
    /// any space attached: the same download turn and retry clock. Ends when
    /// the files are ready or [`SemanticService::shutdown`] cancels it. Must
    /// be called inside a tokio runtime.
    pub fn prefetch(self: &Arc<Self>) {
        let (inference, download) = (self.inference.clone(), self.download.clone());
        drop(tokio::spawn(async move {
            let _ = wait_for_model(&inference, &download).await;
        }));
    }

    /// Stops the service for good (its model is being replaced): cancels a
    /// running download, keeping its `.partial` for a later resume, stops
    /// the inference worker, and forgets every space's sink without waiting
    /// for a save in flight. Attached spaces fail their next job.
    pub fn shutdown(&self) {
        self.inference.stop();
        let ids: Vec<String> = self
            .sinks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.forget_in_background(&id);
        }
    }

    /// Attaches space `id` (`name` in log lines): shares its sink if one is
    /// kept for `location`, else opens it, then (once the model's files are
    /// ready) runs a sync worker over `view` and `feed`. Dropping the returned
    /// space stops that worker; the sink stays until [`SemanticService::forget`].
    /// Must be called inside a tokio runtime.
    pub fn attach(
        &self,
        id: &str,
        name: &str,
        location: Location,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
    ) -> SemanticSpace {
        let cell = {
            let mut sinks = self.sinks.lock().unwrap_or_else(|e| e.into_inner());
            match sinks.get(id) {
                Some(cell) if cell.location == location => cell.clone(),
                existing => {
                    // The space moved: its old sink is forgotten like a
                    // deleted space's, without waiting here.
                    if let Some(moved) = existing.cloned() {
                        close_in_background(moved);
                    }
                    let cell = SinkCell::new(location);
                    sinks.insert(id.to_string(), cell.clone());
                    cell
                }
            }
        };
        let running = Arc::new(OnceLock::new());
        let rebuild_requested = Arc::new(AtomicBool::new(false));
        let (slot, requested) = (running.clone(), rebuild_requested.clone());
        let (inference, download, name) = (
            self.inference.clone(),
            self.download.clone(),
            name.to_string(),
        );
        let open = self.opener.clone();
        let startup = tokio::spawn(async move {
            let opener = Opener {
                cell,
                inference,
                download,
                name,
                open,
            };
            if let Some(started) = opener.start(view, feed).await {
                let _ = slot.set(started);
                run_pending_rebuild(&slot, &requested);
            }
        });
        SemanticSpace {
            id: id.to_string(),
            inference: self.inference.clone(),
            running,
            rebuild_requested,
            startup,
        }
    }

    /// Forgets space `id`'s in-memory index. Its file stays on disk, and no
    /// sink of the forgotten space writes it again, including one still
    /// opening. Blocks for a save in flight, if any.
    pub fn forget(&self, id: &str) {
        if let Some(cell) = self.release(id) {
            cell.forget();
        }
    }

    /// [`SemanticService::forget`] without waiting for a save in flight: the
    /// space is forgotten at once and its sink closes off the caller's
    /// thread. Attaching `id` again is safe at once: the new sink's open
    /// waits until the old one has let go of the file.
    pub fn forget_in_background(&self, id: &str) {
        if let Some(cell) = self.release(id) {
            close_in_background(cell);
        }
    }

    /// Blocks until no sink holds an index file at `location`, for this or
    /// an earlier model (one closing in the background, too). With `forget`
    /// first, a deleted space's directory can be removed without a late save
    /// recreating it. See [`super::lease::wait_closed_at`].
    pub fn wait_closed(&self, location: &Location) {
        super::lease::wait_closed_at(location);
    }

    /// Takes space `id`'s cell out of the service.
    fn release(&self, id: &str) -> Option<Arc<SinkCell>> {
        self.sinks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id)
    }
}

/// What an attach's startup needs: the space's cell, the server's inference
/// worker and download turn.
struct Opener {
    cell: Arc<SinkCell>,
    inference: Arc<Inference>,
    download: Arc<tokio::sync::Mutex<()>>,
    /// The space's name, for log lines.
    name: String,
    open: SinkOpener,
}

impl Opener {
    /// Opens the cell's sink (or shares it), waits for the model's files,
    /// then runs a sync worker over `view` and `feed`. `None` when the space
    /// was forgotten or the download cancelled meanwhile; `Err` when the
    /// sink can't be opened.
    async fn start(
        self,
        view: Arc<dyn SpaceView>,
        feed: ChangeFeed,
    ) -> Option<Result<Running, String>> {
        let Opener {
            cell,
            inference,
            download,
            name,
            open,
        } = self;
        let opened = cell
            .sink
            .get_or_try_init(|| {
                let (location, inference) = (cell.location.clone(), inference.clone());
                async move {
                    // Waits (off the async workers) until no other sink
                    // holds the file: see `SemanticSink::open`.
                    tokio::task::spawn_blocking(move || open(&location, inference))
                        .await
                        .map(Arc::new)
                }
            })
            .await;
        let sink = match opened {
            Ok(sink) => sink.clone(),
            Err(e) => {
                tracing::warn!("Semantic index (space \"{name}\"): can't open it ({e})");
                return Some(Err(IndexKind::Semantic.failed_message().to_string()));
            }
        };
        if !cell.keep(&sink) {
            return None;
        }
        if wait_for_model(&inference, &download).await.is_err() {
            return None;
        }
        // Forgotten while the model downloaded: don't run on a closed sink.
        if !cell.keep(&sink) {
            return None;
        }
        let worker = SyncWorker::spawn(&name, sink.clone(), view, feed);
        Some(Ok(Running { sink, worker }))
    }
}

/// Waits until the model's files are ready, downloading them (one download
/// for the server: `download` is its turn) and retrying a failed download
/// every [`DOWNLOAD_RETRY`]. Only fails when the download was cancelled
/// ([`Inference::stop`]).
async fn wait_for_model(
    inference: &Inference,
    download: &tokio::sync::Mutex<()>,
) -> Result<(), DownloadError> {
    loop {
        let _turn = download.lock().await;
        match inference.wait_ready().await {
            Ok(()) => return Ok(()),
            Err(DownloadError::Cancelled) => return Err(DownloadError::Cancelled),
            Err(e) => {
                tracing::warn!(
                    "Semantic search: downloading {} failed ({e}); retrying in {} s",
                    inference.spec().display_name,
                    DOWNLOAD_RETRY.as_secs()
                );
                // Holding the turn: the next space retries after this wait.
                tokio::select! {
                    _ = inference.stopped() => return Err(DownloadError::Cancelled),
                    _ = tokio::time::sleep(DOWNLOAD_RETRY) => {}
                }
            }
        }
    }
}

struct Running {
    sink: Arc<SemanticSink>,
    worker: SyncWorker,
}

/// One attached space: its sink and sync worker once they run.
pub struct SemanticSpace {
    id: String,
    inference: Arc<Inference>,
    /// Set once by the startup: the running sink and worker, or why the
    /// sink couldn't be opened (the details are in the server log).
    running: Arc<OnceLock<Result<Running, String>>>,
    /// A rebuild asked for before the worker ran; the startup runs it once
    /// the worker does.
    rebuild_requested: Arc<AtomicBool>,
    startup: JoinHandle<()>,
}

impl SemanticSpace {
    /// The space's id, as attached.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The index's state: its worker's once it runs (one snapshot, so the
    /// state and its catch-up are of the same moment), else opening, the
    /// model's download, or why it failed.
    pub fn state(&self) -> IndexState {
        match self.running.get() {
            Some(Ok(running)) => running.worker.status().state(),
            Some(Err(reason)) => IndexState::Failed {
                reason: reason.clone(),
            },
            None => match self.inference.model_state() {
                DownloadState::Downloading { done, total } => {
                    IndexState::Downloading { done, total }
                }
                DownloadState::Failed { message } => IndexState::Failed { reason: message },
                DownloadState::Missing | DownloadState::Ready => IndexState::Starting,
            },
        }
    }

    fn running(&self) -> Option<&Running> {
        self.running.get().and_then(|r| r.as_ref().ok())
    }

    /// The index, once the sink is open and its worker runs.
    pub fn index(&self) -> Option<RwLockReadGuard<'_, VectorIndex>> {
        self.running().map(|running| running.sink.read())
    }

    pub fn inference(&self) -> &Arc<Inference> {
        &self.inference
    }

    pub fn stats(&self) -> Option<IndexStats> {
        self.running()
            .and_then(|running| running.worker.status().stats)
    }

    /// Clears the vectors and builds them again as a first build (Natural
    /// answers from Words meanwhile, Related is unavailable). Before the
    /// worker runs (opening, downloading the model), it runs once the worker
    /// does. Does nothing while a rebuild or a first build runs (a first
    /// build reads every page anyway); `Unavailable` when the index couldn't
    /// be opened.
    pub fn rebuild(&self) -> Result<(), SearchError> {
        match self.running.get() {
            Some(Ok(running)) => {
                running.worker.rebuild();
            }
            Some(Err(message)) => return Err(SearchError::Unavailable(message.clone())),
            None => {
                self.rebuild_requested.store(true, Ordering::SeqCst);
                // The startup may have set the worker meanwhile, after its
                // own look at the flag.
                run_pending_rebuild(&self.running, &self.rebuild_requested);
            }
        }
        Ok(())
    }

    /// This index's state ([`SemanticSpace::state`]), pages and size, for
    /// the dashboard.
    pub fn report(&self) -> IndexReport {
        match self.running() {
            Some(running) => running.worker.report(),
            None => IndexReport {
                state: self.state(),
                ..IndexReport::starting(IndexKind::Semantic)
            },
        }
    }

    /// Tests: how often a rebuild reset this space's sink (0 before it runs).
    #[cfg(any(test, feature = "test-model"))]
    pub fn sink_resets(&self) -> usize {
        self.running().map_or(0, |running| running.sink.resets())
    }
}

/// Runs a rebuild asked for before the worker ran, once the worker runs:
/// both the startup (after setting the worker) and `rebuild` (after setting
/// `requested`) call it, and whichever takes the flag runs it.
fn run_pending_rebuild(running: &OnceLock<Result<Running, String>>, requested: &AtomicBool) {
    if let Some(Ok(running)) = running.get() {
        if requested.swap(false, Ordering::SeqCst) {
            running.worker.rebuild();
        }
    }
}

impl Drop for SemanticSpace {
    /// Stops a startup still opening or downloading; the worker stops with
    /// the last reference to it.
    fn drop(&mut self) {
        self.startup.abort();
    }
}

#[cfg(test)]
mod tests;
