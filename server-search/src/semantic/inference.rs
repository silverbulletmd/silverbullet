//! The server's one embedding worker. A dedicated thread runs the model for
//! every space: query embeddings first, indexing work in small jobs between
//! them. The model loads on first use and is dropped after [`IDLE_UNLOAD`]
//! without work.

use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::catalog::ModelSpec;
use super::download::{DownloadError, DownloadState, ModelStore};
use super::embed::{CandleEmbedder, EmbedKind, Embedder};
use crate::{limits, RequestCx, SearchError};

/// Inference threads (rayon) of the model.
pub const THREADS: usize = 2;
/// How long the model stays loaded without work.
pub const IDLE_UNLOAD: Duration = Duration::from_secs(300);
/// Passages per indexing job: a query waits behind at most one such job.
pub const INDEX_TEXTS: usize = 16;
/// The variable candle sizes its own thread pool from.
const CANDLE_THREADS: &str = "CANDLE_NUM_THREADS";
const NOT_DOWNLOADED: &str = "The search model isn't downloaded yet";
const STOPPED: &str = "Semantic search stopped";
/// A job panicked (or the worker dropped it); the job's caller gets this.
const JOB_FAILED: &str = "A semantic search job failed";

/// Loads the model; called on the worker thread.
type Loader = Box<dyn Fn() -> Result<Arc<dyn Embedder>, String> + Send + Sync>;
type IndexJob = Box<dyn FnOnce(Result<&dyn Embedder, &str>) + Send>;

struct QueryJob {
    text: String,
    cancel: CancellationToken,
    reply: oneshot::Sender<Result<Vec<f32>, String>>,
}

#[derive(Default)]
struct Queue {
    queries: VecDeque<QueryJob>,
    index: VecDeque<IndexJob>,
    stop: bool,
    /// While the worker is parked on the condvar: whether it holds a loaded
    /// model (so its wait is the timed idle wait). Tests synchronise on it.
    #[cfg(test)]
    parked: Option<bool>,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
    loader: Loader,
    idle: Duration,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn model(&self, slot: &mut Option<Arc<dyn Embedder>>) -> Result<Arc<dyn Embedder>, String> {
        if let Some(model) = slot {
            return Ok(model.clone());
        }
        let model = (self.loader)()?;
        *slot = Some(model.clone());
        Ok(model)
    }
}

enum Job {
    Query(QueryJob),
    Index(IndexJob),
}

/// What the worker does next.
enum Next {
    Run(Job),
    Unload,
    Stop,
}

pub struct Inference {
    spec: ModelSpec,
    models: Option<Arc<ModelStore>>,
    shared: Arc<Shared>,
    stop: CancellationToken,
}

impl Inference {
    /// The worker for `spec`, loading it from `models` on first use with
    /// `threads` inference threads. Nothing is downloaded until
    /// [`Inference::wait_ready`].
    pub fn start(spec: ModelSpec, models: Arc<ModelStore>, threads: usize) -> Arc<Inference> {
        if std::env::var_os(CANDLE_THREADS).is_none() {
            tracing::warn!(
                "Semantic search: {CANDLE_THREADS} isn't set (limit_candle_threads didn't run at startup), so candle's own thread pool isn't capped at {THREADS} threads"
            );
        }
        let (load_spec, load_models) = (spec.clone(), models.clone());
        let loader: Loader = Box::new(move || {
            if !load_models.is_ready(&load_spec) {
                return Err(NOT_DOWNLOADED.to_string());
            }
            warn_if_low_memory(&load_spec);
            let started = Instant::now();
            let dir = load_models.dir(&load_spec);
            let model = CandleEmbedder::load(load_spec.clone(), &dir, threads).map_err(|e| {
                tracing::warn!(
                    "Semantic search: can't load {}: {e}",
                    load_spec.display_name
                );
                format!("The search model can't be loaded: {e}")
            })?;
            tracing::info!(
                "Semantic search: loaded {} in {:.1} s",
                load_spec.display_name,
                started.elapsed().as_secs_f64()
            );
            Ok(Arc::new(model) as Arc<dyn Embedder>)
        });
        Inference::spawn(spec, Some(models), loader, IDLE_UNLOAD)
    }

    /// A worker that always uses `embedder` (tests, the eval's fake runs).
    #[cfg(any(test, feature = "test-model"))]
    pub fn with_embedder(embedder: Arc<dyn Embedder>) -> Arc<Inference> {
        let spec = embedder.spec().clone();
        Inference::spawn(
            spec,
            None,
            Box::new(move || Ok(embedder.clone())),
            IDLE_UNLOAD,
        )
    }

    #[cfg(test)]
    fn with_loader(spec: ModelSpec, loader: Loader, idle: Duration) -> Arc<Inference> {
        Inference::spawn(spec, None, loader, idle)
    }

    fn spawn(
        spec: ModelSpec,
        models: Option<Arc<ModelStore>>,
        loader: Loader,
        idle: Duration,
    ) -> Arc<Inference> {
        let shared = Arc::new(Shared {
            queue: Mutex::default(),
            wake: Condvar::new(),
            loader,
            idle,
        });
        let worker = shared.clone();
        if let Err(e) = std::thread::Builder::new()
            .name("sb-semantic".into())
            .spawn(move || work(worker))
        {
            tracing::warn!("Semantic search: can't start its worker thread ({e})");
            shared.lock().stop = true;
        }
        Arc::new(Inference {
            spec,
            models,
            shared,
            stop: CancellationToken::new(),
        })
    }

    pub fn spec(&self) -> &ModelSpec {
        &self.spec
    }

    /// The model's download state; `Ready` without a store (an embedder
    /// given directly).
    pub fn model_state(&self) -> DownloadState {
        match &self.models {
            Some(models) => models.state(&self.spec),
            None => DownloadState::Ready,
        }
    }

    /// Stops the worker and cancels a running download (its `.partial`
    /// stays for a later resume). Jobs queued afterwards fail with
    /// "stopped"; a running job finishes on its own.
    pub fn stop(&self) {
        self.stop.cancel();
        self.shared.lock().stop = true;
        self.shared.wake.notify_all();
    }

    /// Resolves once [`Inference::stop`] ran (or the worker was dropped).
    pub async fn stopped(&self) {
        self.stop.cancelled().await;
    }

    /// Downloads the model when it is missing (resuming a partial download)
    /// and returns once its files are verified. Concurrent callers share one
    /// download (the store serialises them).
    pub async fn wait_ready(&self) -> Result<(), DownloadError> {
        match &self.models {
            None => Ok(()),
            Some(models) => models.ensure(&self.spec, &self.stop).await.map(|_| ()),
        }
    }

    /// The query's vector. Waits behind at most one index job; `Busy` when
    /// [`limits::MAX_QUERY_EMBEDS`] embeds already wait or at the request's
    /// deadline, `Cancelled` when the request is (its job is then skipped).
    pub async fn embed_query(&self, text: &str, cx: &RequestCx) -> Result<Vec<f32>, SearchError> {
        if cx.cancel.is_cancelled() {
            return Err(SearchError::Cancelled);
        }
        let (reply, answer) = oneshot::channel();
        let cancel = cx.cancel.child_token();
        {
            let mut queue = self.shared.lock();
            if queue.stop {
                return Err(SearchError::Unavailable(STOPPED.into()));
            }
            // Superseded queries the worker would skip don't hold a place.
            queue.queries.retain(|q| !q.cancel.is_cancelled());
            if queue.queries.len() >= limits::MAX_QUERY_EMBEDS {
                return Err(SearchError::Busy);
            }
            queue.queries.push_back(QueryJob {
                text: text.to_string(),
                cancel: cancel.clone(),
                reply,
            });
        }
        self.shared.wake.notify_one();
        // However this returns (or is dropped), a job that hasn't started is skipped.
        let _skip = cancel.drop_guard();
        tokio::select! {
            biased;
            _ = cx.cancel.cancelled() => Err(SearchError::Cancelled),
            answer = answer => match answer {
                Ok(Ok(vector)) => Ok(vector),
                Ok(Err(message)) => Err(SearchError::Unavailable(message)),
                // The job panicked: its reply was dropped by the unwind.
                Err(_) => Err(SearchError::Unavailable(JOB_FAILED.into())),
            },
            _ = tokio::time::sleep_until(cx.deadline) => Err(SearchError::Busy),
        }
    }

    /// Runs `job` on the worker with the loaded model and returns its result.
    /// Blocks the calling thread (a sync worker's `spawn_blocking` thread).
    pub fn run_index<R: Send + 'static>(
        &self,
        job: impl FnOnce(&dyn Embedder) -> R + Send + 'static,
    ) -> Result<R, String> {
        let (reply, answer) = std::sync::mpsc::sync_channel(1);
        let job: IndexJob = Box::new(move |model| {
            let _ = reply.send(model.map(job).map_err(str::to_string));
        });
        {
            let mut queue = self.shared.lock();
            if queue.stop {
                return Err(STOPPED.into());
            }
            queue.index.push_back(job);
        }
        self.shared.wake.notify_one();
        // A panicking job drops `reply` while unwinding.
        answer.recv().unwrap_or_else(|_| Err(JOB_FAILED.into()))
    }

    /// Waiting (query, index) jobs.
    #[cfg(test)]
    fn queued(&self) -> (usize, usize) {
        let queue = self.shared.lock();
        (queue.queries.len(), queue.index.len())
    }
}

impl Drop for Inference {
    /// Stops the worker without waiting for it: a running job finishes on its
    /// own, then the thread exits and drops the model.
    fn drop(&mut self) {
        self.stop();
    }
}

/// The next thing to do. Unloading is decided under the queue lock with both
/// queues empty, so a job queued at the idle deadline always finds the model.
fn next(shared: &Shared, loaded: bool, idle_since: Instant) -> Next {
    let mut queue = shared.lock();
    loop {
        if queue.stop {
            return Next::Stop;
        }
        if let Some(query) = queue.queries.pop_front() {
            return Next::Run(Job::Query(query));
        }
        if let Some(index) = queue.index.pop_front() {
            return Next::Run(Job::Index(index));
        }
        let left = shared.idle.saturating_sub(idle_since.elapsed());
        if loaded && left.is_zero() {
            return Next::Unload;
        }
        #[cfg(test)]
        {
            queue.parked = Some(loaded);
        }
        queue = if loaded {
            shared
                .wake
                .wait_timeout(queue, left)
                .unwrap_or_else(|e| e.into_inner())
                .0
        } else {
            shared.wake.wait(queue).unwrap_or_else(|e| e.into_inner())
        };
        #[cfg(test)]
        {
            queue.parked = None;
        }
    }
}

fn work(shared: Arc<Shared>) {
    let mut model: Option<Arc<dyn Embedder>> = None;
    let mut idle_since = Instant::now();
    loop {
        let job = match next(&shared, model.is_some(), idle_since) {
            Next::Stop => return,
            Next::Unload => {
                // Dropped outside the queue lock.
                model = None;
                tracing::debug!("Semantic search: unloaded the model after an idle period");
                continue;
            }
            Next::Run(job) => job,
        };
        let ran = catch_unwind(AssertUnwindSafe(|| match job {
            Job::Query(query) => {
                if query.cancel.is_cancelled() {
                    return;
                }
                let result = shared.model(&mut model).and_then(|m| {
                    m.embed(&[&query.text], EmbedKind::Query)
                        .map_err(|e| e.to_string())?
                        .pop()
                        .ok_or_else(|| "the model returned no vector".to_string())
                });
                let _ = query.reply.send(result);
            }
            Job::Index(job) => match shared.model(&mut model) {
                Ok(m) => job(Ok(m.as_ref())),
                Err(e) => job(Err(&e)),
            },
        }));
        if ran.is_err() {
            tracing::warn!("Semantic search: a job panicked; reloading the model next time");
            model = None;
        }
        idle_since = Instant::now();
    }
}

/// Caps candle's own thread pool at [`THREADS`], unless the operator set
/// `CANDLE_NUM_THREADS`. candle runs elementwise ops (GELU, softmax, adds,
/// layer norm) on a global pool of spinning threads sized to the machine
/// (its performance cores, or physical cores − 1), not to [`THREADS`]; only
/// matmuls run on the embedder's rayon pool. Call it first thing in `main`,
/// before any runtime or other thread starts: it sets a process environment
/// variable, which candle reads once, at its first elementwise op.
pub fn limit_candle_threads() {
    if let Some(value) = candle_threads(std::env::var_os(CANDLE_THREADS)) {
        std::env::set_var(CANDLE_THREADS, value);
    }
}

/// What [`limit_candle_threads`] sets, given the variable's current value.
fn candle_threads(current: Option<std::ffi::OsString>) -> Option<String> {
    current
        .filter(|value| !value.is_empty())
        .is_none()
        .then(|| THREADS.to_string())
}

/// Warns, never refuses, when the host reports less available memory than the model needs.
fn warn_if_low_memory(spec: &ModelSpec) {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let available = system.available_memory();
    if available > 0 && available < spec.resident_bytes {
        tracing::warn!(
            "Semantic search: {} needs about {} MB of memory and {} MB are available; the server may run short",
            spec.display_name,
            spec.resident_bytes >> 20,
            available >> 20
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::embed::EmbedError;
    use crate::semantic::test_model::FakeEmbedder;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn cx() -> RequestCx {
        RequestCx::unlimited(Duration::from_secs(10))
    }

    /// Holds the worker inside an index job until the returned sender is used or dropped.
    fn hold(inference: &Arc<Inference>) -> std::sync::mpsc::Sender<()> {
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let (started, running) = std::sync::mpsc::channel::<()>();
        let held = inference.clone();
        std::thread::spawn(move || {
            held.run_index(move |_| {
                started.send(()).unwrap();
                let _ = wait.recv();
            })
            .unwrap();
        });
        running.recv().unwrap();
        release
    }

    async fn until(what: &str, f: impl Fn() -> bool) {
        let started = Instant::now();
        while !f() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "timed out: {what}"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// `until` for plain threads.
    fn until_blocking(what: &str, f: impl Fn() -> bool) {
        let started = Instant::now();
        while !f() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "timed out: {what}"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    /// Counts loads and drops of the model a [`probed`] worker uses, and can
    /// make its `embed` panic.
    #[derive(Default)]
    struct Counts {
        loads: AtomicUsize,
        drops: AtomicUsize,
        panic: AtomicBool,
    }

    struct Probe {
        inner: FakeEmbedder,
        counts: Arc<Counts>,
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            self.counts.drops.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl Embedder for Probe {
        fn spec(&self) -> &ModelSpec {
            self.inner.spec()
        }
        fn fit(&self, text: &str) -> usize {
            self.inner.fit(text)
        }
        fn embed(&self, texts: &[&str], kind: EmbedKind) -> Result<Vec<Vec<f32>>, EmbedError> {
            if self.counts.panic.load(Ordering::SeqCst) {
                panic!("embed bug");
            }
            self.inner.embed(texts, kind)
        }
    }

    fn probed(idle: Duration) -> (Arc<Inference>, Arc<Counts>) {
        let counts = Arc::new(Counts::default());
        let made = counts.clone();
        let loader: Loader = Box::new(move || {
            made.loads.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(Probe {
                inner: FakeEmbedder::new(),
                counts: made.clone(),
            }) as Arc<dyn Embedder>)
        });
        (Inference::with_loader(fake(), loader, idle), counts)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn queries_run_before_queued_index_jobs() {
        let fake = Arc::new(FakeEmbedder::new());
        let inference = Inference::with_embedder(fake.clone());
        let release = hold(&inference);
        // Each index job records, on the worker, how many embeds ran before it.
        let seen = Arc::new(Mutex::new(Vec::<usize>::new()));
        let jobs: Vec<_> = (0..3)
            .map(|_| {
                let (inference, seen, fake) = (inference.clone(), seen.clone(), fake.clone());
                std::thread::spawn(move || {
                    inference
                        .run_index(move |_| {
                            seen.lock().unwrap().push(fake.calls.load(Ordering::SeqCst));
                        })
                        .unwrap();
                })
            })
            .collect();
        until("three queued jobs", || inference.queued().1 == 3).await;
        let query = {
            let inference = inference.clone();
            tokio::spawn(async move { inference.embed_query("flat tyre", &cx()).await })
        };
        until("the query queued", || inference.queued().0 == 1).await;
        drop(release);
        assert_eq!(query.await.unwrap(), Ok(fake.vector("flat tyre")));
        for job in jobs {
            job.join().unwrap();
        }
        assert_eq!(
            *seen.lock().unwrap(),
            vec![1, 1, 1],
            "the query ran before every queued index job"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cancelled_query_is_skipped() {
        let fake = Arc::new(FakeEmbedder::new());
        let inference = Inference::with_embedder(fake.clone());
        let release = hold(&inference);
        let request = cx();
        let cancel = request.cancel.clone();
        let query = {
            let inference = inference.clone();
            tokio::spawn(async move { inference.embed_query("flat tyre", &request).await })
        };
        until("the query queued", || inference.queued().0 == 1).await;
        cancel.cancel();
        assert_eq!(query.await.unwrap(), Err(SearchError::Cancelled));
        drop(release);
        inference.run_index(|_| ()).unwrap();
        assert_eq!(fake.calls.load(Ordering::SeqCst), 0, "the query never ran");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_ninth_waiting_query_is_busy() {
        let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
        let release = hold(&inference);
        let waiting: Vec<_> = (0..limits::MAX_QUERY_EMBEDS)
            .map(|i| {
                let inference = inference.clone();
                tokio::spawn(async move { inference.embed_query(&format!("q{i}"), &cx()).await })
            })
            .collect();
        until("eight queued", || {
            inference.queued().0 == limits::MAX_QUERY_EMBEDS
        })
        .await;
        assert_eq!(
            inference.embed_query("one too many", &cx()).await,
            Err(SearchError::Busy)
        );
        drop(release);
        for query in waiting {
            assert!(query.await.unwrap().is_ok());
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cancelled_query_frees_its_place_in_the_queue() {
        let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
        let release = hold(&inference);
        let requests: Vec<RequestCx> = (0..limits::MAX_QUERY_EMBEDS).map(|_| cx()).collect();
        let superseded = requests[0].cancel.clone();
        let waiting: Vec<_> = requests
            .into_iter()
            .enumerate()
            .map(|(i, request)| {
                let inference = inference.clone();
                tokio::spawn(async move { inference.embed_query(&format!("q{i}"), &request).await })
            })
            .collect();
        until("eight queued", || {
            inference.queued().0 == limits::MAX_QUERY_EMBEDS
        })
        .await;
        superseded.cancel();
        let newest = {
            let inference = inference.clone();
            tokio::spawn(async move { inference.embed_query("newest", &cx()).await })
        };
        until("the newest queued in the freed place", || {
            newest.is_finished()
                || inference
                    .shared
                    .lock()
                    .queries
                    .iter()
                    .any(|q| q.text == "newest")
        })
        .await;
        drop(release);
        assert!(newest.await.unwrap().is_ok());
        for (i, query) in waiting.into_iter().enumerate() {
            let answer = query.await.unwrap();
            if i == 0 {
                assert_eq!(answer, Err(SearchError::Cancelled));
            } else {
                assert!(answer.is_ok());
            }
        }
    }

    /// Paused time: the deadline passes as soon as the runtime idles, whatever the machine's speed.
    #[tokio::test(start_paused = true)]
    async fn a_query_past_its_deadline_is_busy_and_skipped() {
        let fake = Arc::new(FakeEmbedder::new());
        let inference = Inference::with_embedder(fake.clone());
        let release = hold(&inference);
        let late = RequestCx::unlimited(Duration::from_secs(5));
        assert_eq!(
            inference.embed_query("slow", &late).await,
            Err(SearchError::Busy)
        );
        drop(release);
        inference.run_index(|_| ()).unwrap();
        assert_eq!(
            fake.calls.load(Ordering::SeqCst),
            0,
            "the late query never ran"
        );
    }

    #[test]
    fn the_model_loads_once_and_unloads_when_idle() {
        let (inference, counts) = probed(Duration::from_millis(50));
        inference.run_index(|_| ()).unwrap();
        inference.run_index(|_| ()).unwrap();
        assert_eq!(counts.loads.load(Ordering::SeqCst), 1);
        until_blocking("the idle unload", || {
            counts.drops.load(Ordering::SeqCst) == 1
        });
        inference.run_index(|_| ()).unwrap();
        assert_eq!(
            counts.loads.load(Ordering::SeqCst),
            2,
            "reloaded after the idle unload"
        );
    }

    /// The worker times out waiting while a job is being queued (the test
    /// holds the queue lock past the idle deadline): it must run the job with
    /// the loaded model rather than unload and reload it.
    ///
    /// The test takes the lock only once the worker is parked in its timed
    /// idle wait with the model loaded (`parked == Some(true)`). If it misses
    /// that window (the worker unloaded first), it reloads and tries again, so
    /// the outcome never depends on scheduling.
    #[test]
    fn an_idle_unload_never_races_a_job_queued_at_the_deadline() {
        let idle = Duration::from_millis(20);
        let (inference, counts) = probed(idle);
        let started = Instant::now();
        let (mut queue, loads, drops) = loop {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "timed out: parked while loaded"
            );
            inference.run_index(|_| ()).unwrap();
            let caught = loop {
                let queue = inference.shared.lock();
                match queue.parked {
                    Some(true) => break Some(queue),
                    // Missed the idle window: the model is already unloaded.
                    Some(false) => break None,
                    None => {
                        drop(queue);
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            };
            if let Some(queue) = caught {
                // Parked while loaded and the lock is ours: the model can't be
                // unloaded until we let go.
                let (loads, drops) = (
                    counts.loads.load(Ordering::SeqCst),
                    counts.drops.load(Ordering::SeqCst),
                );
                break (queue, loads, drops);
            }
        };
        // The worker can't take the lock back: its idle timeout expires while
        // the job goes in.
        std::thread::sleep(idle * 5);
        let (reply, answer) = std::sync::mpsc::sync_channel(1);
        queue
            .index
            .push_back(Box::new(move |model: Result<&dyn Embedder, &str>| {
                let _ = reply.send(model.is_ok());
            }));
        drop(queue);
        inference.shared.wake.notify_one();
        assert!(answer.recv().unwrap(), "the job got the model");
        assert_eq!(counts.loads.load(Ordering::SeqCst), loads, "never reloaded");
        assert_eq!(counts.drops.load(Ordering::SeqCst), drops, "never unloaded");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_model_that_fails_to_load_answers_every_job_with_its_error() {
        let loader: Loader = Box::new(|| Err("The search model can't be loaded: broken".into()));
        let inference = Inference::with_loader(fake(), loader, IDLE_UNLOAD);
        let message = "The search model can't be loaded: broken".to_string();
        assert_eq!(inference.run_index(|_| ()), Err(message.clone()));
        assert_eq!(
            inference.embed_query("x", &cx()).await,
            Err(SearchError::Unavailable(message))
        );
    }

    #[test]
    fn a_panicking_job_fails_alone() {
        let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
        let failed: Result<(), String> = inference.run_index(|_| panic!("job bug"));
        assert_eq!(failed, Err(JOB_FAILED.to_string()));
        assert_eq!(inference.run_index(|_| 7), Ok(7));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_panicking_query_fails_alone_and_the_model_reloads() {
        let (inference, counts) = probed(IDLE_UNLOAD);
        counts.panic.store(true, Ordering::SeqCst);
        assert_eq!(
            inference.embed_query("boom", &cx()).await,
            Err(SearchError::Unavailable(JOB_FAILED.into()))
        );
        counts.panic.store(false, Ordering::SeqCst);
        assert!(inference.embed_query("fine", &cx()).await.is_ok());
        assert_eq!(
            counts.loads.load(Ordering::SeqCst),
            2,
            "reloaded after the panic"
        );
        assert_eq!(
            counts.drops.load(Ordering::SeqCst),
            1,
            "the suspect model was dropped"
        );
    }

    #[test]
    fn dropping_the_last_handle_stops_the_worker_and_frees_the_model() {
        let (inference, counts) = probed(IDLE_UNLOAD);
        inference.run_index(|_| ()).unwrap();
        let shared = inference.shared.clone();
        drop(inference);
        until_blocking("the worker exits", || {
            counts.drops.load(Ordering::SeqCst) == 1
        });
        until_blocking("the worker released its handle", || {
            Arc::strong_count(&shared) == 1
        });
    }

    #[test]
    fn a_store_without_the_model_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let models = Arc::new(ModelStore::new(dir.path().to_path_buf()));
        let inference = Inference::start(fake(), models, 1);
        assert_eq!(inference.model_state(), DownloadState::Missing);
        assert_eq!(inference.run_index(|_| ()), Err(NOT_DOWNLOADED.to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_stopped_worker_refuses_new_jobs() {
        let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
        inference.run_index(|_| ()).unwrap();
        inference.stop();
        inference.stopped().await;
        assert_eq!(inference.run_index(|_| ()), Err(STOPPED.to_string()));
        assert_eq!(
            inference.embed_query("x", &cx()).await,
            Err(SearchError::Unavailable(STOPPED.into()))
        );
    }

    #[test]
    fn candles_pool_is_capped_at_the_inference_threads_unless_the_operator_sized_it() {
        assert_eq!(candle_threads(None), Some(THREADS.to_string()));
        assert_eq!(candle_threads(Some("".into())), Some(THREADS.to_string()));
        assert_eq!(candle_threads(Some("6".into())), None);
    }

    fn fake() -> ModelSpec {
        crate::semantic::test_model::fake_spec()
    }
}
