//! The shared headless-Chrome pool: one browser process for the whole server,
//! one page per space.
//!
//! Launch is LAZY at two levels. The browser does not start until the first
//! runtime request from *any* space, and a space's page is not created until
//! that space's own first request — so Chrome never runs while the runtime API
//! is unused, and a space nobody queries never costs a tab.
//!
//! `eval_js`/`wait_ready` are synchronous and block the calling thread (the
//! server invokes them via `spawn_blocking`) they run their async work on the
//! pool's owned runtime.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use chromiumoxide::browser::Browser;
use chromiumoxide::page::Page;
use serde_json::Value;
use silverbullet_server::runtime::{ClientTransport, LogBuffer, RuntimeError};
use tokio::runtime::Runtime;
use tokio::sync::{Mutex, Notify};

use crate::config::{ChromeConfig, SpacePage};
use crate::supervisor::{eval_on_page, launch_browser, supervise_space};

/// One registered space: its live page, readiness flag, and supervisor handle.
struct Registration {
    live: Arc<Mutex<Option<Page>>>,
    supervisor: tokio::task::JoinHandle<()>,
}

/// The pool's browser slot: the live browser tagged with the generation it was
/// launched as, or empty when there is none.
type BrowserSlot<B> = Arc<Mutex<Option<(u64, Arc<B>)>>>;

/// The shared headless-Chrome pool.
pub struct ChromePool<B = Browser> {
    rt: Option<Runtime>,
    config: ChromeConfig,
    browser: BrowserSlot<B>,
    launch_lock: Arc<Mutex<()>>,
    spaces: Arc<StdMutex<HashMap<u64, Registration>>>,
    next_id: AtomicU64,
    next_generation: AtomicU64,
}

/// Clear `slot` when — and only when — it still holds `generation`. Returns
/// whether it cleared anything.
///
/// This is the guard that stops a browser restart from ping-ponging: a
/// supervisor that noticed generation *G* had died may arrive long after
/// somebody else already launched *G+1* (a page launch takes seconds), and it
/// must not take the live browser down with it.
fn clear_if_generation<T>(slot: &mut Option<(u64, T)>, generation: u64) -> bool {
    match slot {
        Some((current, _)) if *current == generation => {
            *slot = None;
            true
        }
        _ => false,
    }
}

impl<B> ChromePool<B> {
    /// Construct the pool. Generic over the browser handle so tests can build a
    /// pool whose slot they are able to populate; `ChromePool::new` is the
    /// production entry point.
    fn build(config: ChromeConfig) -> Result<Arc<Self>, RuntimeError> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::Transport(format!("tokio runtime: {e}")))?;
        Ok(Arc::new(Self {
            rt: Some(rt),
            config,
            browser: Arc::new(Mutex::new(None)),
            launch_lock: Arc::new(Mutex::new(())),
            spaces: Arc::new(StdMutex::new(HashMap::new())),
            next_id: AtomicU64::new(0),
            next_generation: AtomicU64::new(0),
        }))
    }

    /// The owned runtime. Always present until `Drop`; the `Option` exists only
    /// so `Drop` can take it.
    fn rt(&self) -> &Runtime {
        self.rt.as_ref().expect("runtime present until drop")
    }

    pub fn config(&self) -> &ChromeConfig {
        &self.config
    }

    /// How many spaces currently hold a transport. Registration is per
    /// *transport*, not per space id: a space being rebuilt briefly has two.
    pub fn registered_spaces(&self) -> usize {
        self.spaces.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Retire the browser of `generation` so the next `ensure_browser` launches
    /// a fresh one. Called by a supervisor that saw *this* browser fail a
    /// liveness probe.
    pub(crate) async fn discard_browser(&self, generation: u64) {
        // Taken before the slot lock so this cannot interleave with
        // `ensure_browser`'s launch-then-store.
        let _guard = self.launch_lock.lock().await;
        let mut slot = self.browser.lock().await;
        if clear_if_generation(&mut slot, generation) {
            tracing::warn!("shared headless Chrome (generation {generation}) died; retiring it");
        }
    }

    /// Whether a browser process is currently held. Exists to pin the laziness
    /// guarantee in tests — nothing must launch Chrome before the first runtime
    /// request.
    #[cfg(test)]
    pub(crate) async fn browser_is_launched(&self) -> bool {
        self.browser.lock().await.is_some()
    }

    /// Install `browser` in the slot at `generation`, as a successful
    /// `ensure_browser` would. Tests only: it is the sole way to exercise
    /// `discard_browser` without launching real Chrome.
    #[cfg(test)]
    async fn seed_browser(&self, generation: u64, browser: B) {
        *self.browser.lock().await = Some((generation, Arc::new(browser)));
    }
}

impl ChromePool {
    /// Create the pool. Returns an error only if the tokio runtime can't be
    /// built.
    pub fn new(config: ChromeConfig) -> Result<Arc<Self>, RuntimeError> {
        Self::build(config)
    }

    /// Register a space and return its transport. Spawns the space's supervisor
    /// parked on its trigger; no browser or page work happens until the first
    /// runtime request.
    pub fn transport_for(
        self: &Arc<Self>,
        page: SpacePage,
        logs: LogBuffer,
    ) -> SharedChromeTransport {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let live: Arc<Mutex<Option<Page>>> = Arc::new(Mutex::new(None));
        let ready = Arc::new(AtomicBool::new(false));
        let trigger = Arc::new(Notify::new());

        let supervisor = self.rt().spawn(supervise_space(
            self.clone(),
            page.clone(),
            live.clone(),
            ready.clone(),
            logs,
            trigger.clone(),
        ));

        self.spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                id,
                Registration {
                    live: live.clone(),
                    supervisor,
                },
            );

        SharedChromeTransport {
            pool: self.clone(),
            id,
            live,
            ready,
            trigger,
        }
    }

    /// The live browser and its generation, launching it if there isn't one.
    /// Concurrent callers serialize on `launch_lock`; the second one finds the
    /// slot already filled and returns it.
    ///
    /// The returned `Arc` is a *transient* clone: use it for one `new_page` and
    /// drop it. Holding it would keep a dead Chrome's process alive across a
    /// relaunch. The generation goes back to `discard_browser` if this browser
    /// turns out to be dead.
    pub(crate) async fn ensure_browser(&self) -> Result<(u64, Arc<Browser>), String> {
        /// Cap on a single `Browser::launch`. It is awaited while holding
        /// `launch_lock`, so a Chrome that hangs on startup would otherwise
        /// block *every* space's supervisor forever.
        const LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);

        if let Some((generation, b)) = self.browser.lock().await.as_ref() {
            return Ok((*generation, b.clone()));
        }
        let _guard = self.launch_lock.lock().await;
        if let Some((generation, b)) = self.browser.lock().await.as_ref() {
            return Ok((*generation, b.clone()));
        }
        tracing::info!(
            "runtime API used; launching shared headless Chrome ({})",
            self.config.chrome_path
        );
        let browser = match tokio::time::timeout(LAUNCH_TIMEOUT, launch_browser(&self.config)).await
        {
            Err(_) => {
                return Err(format!(
                    "browser launch timed out after {}s",
                    LAUNCH_TIMEOUT.as_secs()
                ))
            }
            Ok(result) => Arc::new(result?),
        };
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        *self.browser.lock().await = Some((generation, browser.clone()));
        Ok((generation, browser))
    }
}

impl<B> Drop for ChromePool<B> {
    fn drop(&mut self) {
        // Abort every supervisor first so none of them races the teardown.
        for (_, reg) in self
            .spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
        {
            reg.supervisor.abort();
            drop(reg.live);
        }
        if let Some(rt) = self.rt.take() {
            // `shutdown_background` rather than a blocking shutdown: the pool is
            // dropped from inside the server's own async context on Ctrl-C, and
            // blocking there panics.
            rt.shutdown_background();
        }
    }
}

/// One space's view of the shared browser: its own page, readiness flag, and
/// lazy-launch trigger.
pub struct SharedChromeTransport {
    pool: Arc<ChromePool>,
    id: u64,
    live: Arc<Mutex<Option<Page>>>,
    ready: Arc<AtomicBool>,
    trigger: Arc<Notify>,
}

impl ClientTransport for SharedChromeTransport {
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<Value, RuntimeError> {
        // Any runtime use wakes this space's supervisor, which brings the shared
        // browser up if needed and then this space's page.
        self.trigger.notify_one();
        let live = self.live.clone();
        let js = js.to_string();
        self.pool.rt().block_on(async move {
            // The timeout covers *acquiring* `live` as well as the eval itself.
            // The eval alone was never unbounded — chromiumoxide gives every
            // command a ~30s `REQUEST_TIMEOUT` of its own — but the lock wait in
            // front of it had no bound at all, and it is the part that stacks:
            // this call occupies a thread on the server's shared
            // `spawn_blocking` pool, and the supervisor's liveness probe takes
            // the same lock. Wrapping both means a caller's own timeout is the
            // real bound, instead of an implicit one from a dependency plus an
            // unbounded queue behind it.
            let attempt = async {
                let guard = live.lock().await;
                let page = guard.as_ref().ok_or(RuntimeError::NotReady)?;
                eval_on_page(page, &js).await
            };
            match tokio::time::timeout(timeout, attempt).await {
                Err(_) => Err(RuntimeError::Timeout),
                Ok(r) => r,
            }
        })
    }

    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError> {
        self.trigger.notify_one();
        if self.ready.load(Ordering::Relaxed) {
            return Ok(());
        }
        let ready = self.ready.clone();
        self.pool.rt().block_on(async move {
            let deadline = tokio::time::Instant::now() + timeout;
            loop {
                if ready.load(Ordering::Relaxed) {
                    return Ok(());
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(RuntimeError::NotReady);
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
    }

    fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }

    fn ensure_started(&self) {
        // Same lazy-launch nudge as eval/wait: a log read alone is enough to
        // bring this space's page up.
        self.trigger.notify_one();
    }
}

impl Drop for SharedChromeTransport {
    fn drop(&mut self) {
        // A space instance is rebuilt on *every* admin API space write, so
        // without this each write would leak a tab in the shared browser.
        let reg = self
            .pool
            .spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
        let Some(reg) = reg else { return };
        let Registration { live, supervisor } = reg;
        self.pool.rt().spawn(async move {
            // Abort *and wait* before touching `live`. `JoinHandle::abort` is
            // not synchronous: cancelling the supervisor while it is inside
            // `launch_page` means its page is a task local, in neither `live`
            // nor anywhere else, until its `PageCloseGuard` drops. Aborting from
            // `Drop` and closing here immediately could observe `live == None`,
            // finish, and let the supervisor then publish a page nobody will
            // ever look at again. Awaiting the handle guarantees the task (and
            // its guard) is fully torn down first.
            supervisor.abort();
            let _ = supervisor.await;
            // Two statements, so the `MutexGuard` is dropped at the `;` rather
            // than held across the `close` await — matching `supervise_space`'s
            // restart path. Nothing contends for `live` here, but the two sites
            // should read alike.
            let stale = live.lock().await.take();
            if let Some(page) = stale {
                let _ = page.close().await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ChromeConfig {
        ChromeConfig {
            // Never launched: registration and teardown are lazy, so no real
            // browser is needed to exercise the pool's bookkeeping.
            chrome_path: "/nonexistent/chrome".into(),
            user_data_dir: "/tmp/sb-pool-test".into(),
            show: false,
            log_console: false,
        }
    }

    fn page(name: &str, url: &str) -> SpacePage {
        SpacePage {
            server_url: url.into(),
            headless_token: "secret".into(),
            cookie_name: format!("silverbullet_headless_{name}"),
        }
    }

    #[test]
    fn registers_and_deregisters_each_space() {
        let pool = ChromePool::new(config()).unwrap();
        assert_eq!(pool.registered_spaces(), 0);

        let a = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let b = pool.transport_for(page("b", "http://127.0.0.1:3000/notes"), LogBuffer::new());
        assert_eq!(pool.registered_spaces(), 2);

        drop(a);
        assert_eq!(pool.registered_spaces(), 1);
        drop(b);
        assert_eq!(pool.registered_spaces(), 0);
    }

    #[test]
    fn rebuilding_a_space_does_not_deregister_its_replacement() {
        let pool = ChromePool::new(config()).unwrap();
        let old = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let new = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        assert_eq!(pool.registered_spaces(), 2);

        drop(old);
        assert_eq!(pool.registered_spaces(), 1);
        drop(new);
        assert_eq!(pool.registered_spaces(), 0);
    }

    #[tokio::test]
    async fn no_browser_is_launched_before_any_runtime_request() {
        let pool = ChromePool::new(config()).unwrap();
        assert!(!pool.browser_is_launched().await);

        let t = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        // Give the supervisor task a chance to run before checking.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!pool.browser_is_launched().await);
        assert!(!t.is_ready());
    }

    #[test]
    fn a_stale_discard_leaves_a_newer_browser_alone() {
        let mut slot = Some((1u64, "browser-1"));
        assert!(!clear_if_generation(&mut slot, 0));
        assert_eq!(slot, Some((1, "browser-1")));
    }

    #[test]
    fn discarding_the_current_generation_clears_the_slot() {
        let mut slot = Some((1u64, "browser-1"));
        assert!(clear_if_generation(&mut slot, 1));
        assert_eq!(slot, None);
    }

    #[tokio::test]
    async fn discard_browser_retires_only_the_generation_it_was_given() {
        let pool = ChromePool::<&'static str>::build(config()).unwrap();
        pool.seed_browser(1, "browser-1").await;

        // A supervisor that watched generation 0 die, arriving after somebody
        // else already launched generation 1, must leave it alone.
        pool.discard_browser(0).await;
        assert!(
            pool.browser_is_launched().await,
            "a stale generation must not retire the live browser"
        );

        // The generation that actually failed is retired, so the next
        // `ensure_browser` launches a fresh one.
        pool.discard_browser(1).await;
        assert!(
            !pool.browser_is_launched().await,
            "the current generation must clear the slot"
        );
    }

    #[test]
    fn discarding_an_empty_slot_is_a_no_op() {
        let mut slot: Option<(u64, &str)> = None;
        assert!(!clear_if_generation(&mut slot, 0));
        assert_eq!(slot, None);
    }

    #[test]
    fn generations_are_monotonic() {
        let pool = ChromePool::new(config()).unwrap();
        let first = pool.next_generation.fetch_add(1, Ordering::Relaxed);
        let second = pool.next_generation.fetch_add(1, Ordering::Relaxed);
        assert_eq!((first, second), (0, 1));
    }

    #[tokio::test]
    async fn a_failed_launch_leaves_the_slot_empty() {
        let pool = ChromePool::new(config()).unwrap();
        // `/nonexistent/chrome` cannot be spawned, so this fails fast.
        assert!(pool.ensure_browser().await.is_err());
        assert!(!pool.browser_is_launched().await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_the_pool_inside_an_async_context_does_not_panic() {
        let pool = ChromePool::new(config()).unwrap();
        let t = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        drop(t);
        drop(pool); // must not panic
    }
}
