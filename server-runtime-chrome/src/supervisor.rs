//! Browser launch and per-space page supervision: brings up the shared
//! `Browser` for the pool, opens a space's `Page` in it, captures console output
//! into that space's log buffer, waits for the client runtime to signal
//! readiness, and restarts (with exponential backoff) whenever the page dies.
//!
//! One supervisor task per space runs on the pool's tokio runtime. It is
//! deliberately tolerant of a not-yet-listening server: transports are
//! constructed *before* the server binds its port, so the first navigation may
//! fail and is simply retried with backoff.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::network::{CookieParam, CookieSameSite};
use chromiumoxide::cdp::js_protocol::runtime::{
    ConsoleApiCalledType, EvaluateParams, EventConsoleApiCalled,
};
use chromiumoxide::error::CdpError;
use chromiumoxide::page::Page;
use futures::StreamExt;
use serde_json::Value;
use silverbullet_server::runtime::{LogBuffer, LogEntry, RuntimeError};
use tokio::sync::{Mutex, Notify};

use crate::config::{ChromeConfig, SpacePage};

/// Evaluate a raw JS expression in the page with await-promise +
/// return-by-value semantics, returning its JSON value (`Null` when the
/// expression produced no value).
pub(crate) async fn eval_on_page(page: &Page, js: &str) -> Result<Value, RuntimeError> {
    let params = EvaluateParams::builder()
        .expression(js)
        .await_promise(true)
        .return_by_value(true)
        .build()
        .map_err(RuntimeError::Transport)?;
    let result = page.evaluate(params).await.map_err(cdp_error_to_runtime)?;
    Ok(result.value().cloned().unwrap_or(Value::Null))
}

/// Classify a chromiumoxide error from `page.evaluate`. A thrown client
/// exception (a Lua error, or any uncaught JS) is a *user-level* `Eval` failure
/// with a clean one-line message
fn cdp_error_to_runtime(e: CdpError) -> RuntimeError {
    match e {
        CdpError::JavascriptException(details) => {
            let description = details
                .exception
                .as_ref()
                .and_then(|o| o.description.as_deref());
            RuntimeError::Eval(clean_exception_message(&details.text, description))
        }
        other => RuntimeError::Transport(other.to_string()),
    }
}

/// Reduce a V8 exception to a concise single line. Prefers `text` (e.g.
/// `"Uncaught (in promise) Error: attempt to call a nil value"`), strips the
/// `Uncaught …` framing and a leading `Error:` label so the underlying message
/// stands alone, and drops any JS stack (the full detail still reaches the
/// `runtime_console` log). Falls back to the object `description`'s first line.
fn clean_exception_message(text: &str, description: Option<&str>) -> String {
    let first_line = |s: &str| s.lines().next().unwrap_or("").trim().to_string();
    let mut msg = first_line(text);
    if msg.is_empty() {
        msg = description.map(first_line).unwrap_or_default();
    }
    for prefix in ["Uncaught (in promise) ", "Uncaught "] {
        if let Some(rest) = msg.strip_prefix(prefix) {
            msg = rest.to_string();
        }
    }
    if let Some(rest) = msg.strip_prefix("Error: ") {
        msg = rest.to_string();
    }
    if msg.is_empty() {
        "client evaluation error".to_string()
    } else {
        msg
    }
}

/// Evaluate a *synchronous* JS expression (no promise awaiting) and return its
/// JSON value. Used for readiness/liveness probes, whose expressions are plain
/// booleans — using `await_promise` there can stall on a busy client page.
async fn eval_sync(page: &Page, js: &str) -> Result<Value, RuntimeError> {
    let params = EvaluateParams::builder()
        .expression(js)
        .return_by_value(true)
        .build()
        .map_err(RuntimeError::Transport)?;
    let result = page.evaluate(params).await.map_err(cdp_error_to_runtime)?;
    Ok(result.value().cloned().unwrap_or(Value::Null))
}

/// Bound on the CDP round trips this module makes against a page it has reason
/// to distrust: the liveness probe, and every `close`.
///
/// Nothing here was ever *unbounded* — chromiumoxide gives every command its own
/// `REQUEST_TIMEOUT` (~30s) and resolves it to `CdpError::Timeout` — but 30s is
/// the wrong bound for these call sites, and inheriting it from a dependency's
/// internals leaves the policy invisible. A liveness probe evaluates the literal
/// `1` and a close is a single command; five seconds is already enormously
/// generous for either, and the difference between 5s and 30s is paid by the
/// server (see `page_is_alive`) or by a space's restart latency.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Current wall-clock time in milliseconds since the Unix epoch.
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The space's headless auth cookie: HTTP-only, `SameSite=Strict`, scoped by
/// `Path` to the space prefix, with no expiry (a session cookie).
pub(crate) fn headless_cookie(page: &SpacePage) -> Result<CookieParam, String> {
    CookieParam::builder()
        .name(&page.cookie_name)
        .value(&page.headless_token)
        .url(&page.server_url)
        .path(page.cookie_path())
        .http_only(true)
        .same_site(CookieSameSite::Strict)
        .build()
}

pub(crate) async fn launch_browser(config: &ChromeConfig) -> Result<Browser, String> {
    let mut builder = BrowserConfig::builder()
        .chrome_executable(&config.chrome_path)
        .user_data_dir(&config.user_data_dir)
        .window_size(800, 600)
        .no_sandbox()
        .args([
            "disable-dev-shm-usage",
            "disable-extensions",
            "disable-gpu",
            "disable-software-rasterizer",
        ]);
    if config.show {
        builder = builder.with_head();
    }
    let browser_config = builder.build()?;

    let (browser, mut handler) = Browser::launch(browser_config)
        .await
        .map_err(|e| format!("browser launch: {e}"))?;

    // Drive the connection handler until it ends (browser closed/crashed).
    tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if event.is_err() {
                break;
            }
        }
    });

    Ok(browser)
}

/// A page handle whose tab must be closed explicitly rather than dropped.
///
/// Abstracted behind a trait for exactly one reason: `PageCloseGuard`'s
/// behaviour under task cancellation is the thing this module most needs to
/// test, and `chromiumoxide::Page` cannot be constructed without a live Chrome.
/// Production only ever instantiates it at `P = Page`.
///
/// Declared with an explicit `-> impl Future + Send` rather than `async fn`: the
/// close is handed to `tokio::spawn`, which needs the `Send` bound stated on the
/// trait itself.
trait ClosablePage: Send + 'static {
    fn close_page(self) -> impl std::future::Future<Output = ()> + Send;
}

impl ClosablePage for Page {
    async fn close_page(self) {
        // Explicitly bounded, rather than leaning on chromiumoxide's ~30s
        // request timeout: this frequently runs on a page already declared dead.
        let _ = tokio::time::timeout(PROBE_TIMEOUT, self.close()).await;
    }
}

/// Owns a freshly opened page and **closes** it on drop, unless disarmed.
///
/// chromiumoxide implements `Drop` for `Browser` but *not* for `Page` —
/// `Page::close` is an explicit `async fn` — so a dropped `Page` leaves its tab
/// and renderer process running inside the browser every other space depends
/// on. This used to be impossible: each attempt owned its own `Browser`, so a
/// failed attempt took the whole process tree with it. Sharing the browser
/// removed that implicit cleanup, and this guard replaces it.
struct PageCloseGuard<P: ClosablePage> {
    page: Option<P>,
}

impl<P: ClosablePage> PageCloseGuard<P> {
    fn new(page: P) -> Self {
        Self { page: Some(page) }
    }

    /// The guarded page. Borrowed, never moved out: ownership stays with the
    /// guard so cancellation at *any* await point still reaches `Drop`.
    fn page(&self) -> &P {
        self.page.as_ref().expect("armed until disarmed")
    }

    /// Give up responsibility for the page. Only correct once the page is
    /// published somewhere that will close it — i.e. `live`.
    fn disarm(&mut self) {
        self.page = None;
    }
}

impl<P: ClosablePage> Drop for PageCloseGuard<P> {
    fn drop(&mut self) {
        if let Some(page) = self.page.take() {
            // Fire-and-forget: `Drop` cannot await. See the type-level comment
            // for why a runtime is guaranteed to be present here.
            tokio::spawn(page.close_page());
        }
    }
}

/// Open this space's page in the shared browser: blank page, auth cookie,
/// console capture, navigation, then wait for the client runtime to report
/// ready. Publishes into `live` and sets `ready` on success.
///
/// The tab is owned by a `PageCloseGuard` for the whole of this function, so
/// every exit — `?`, a returned `Err`, or the task being aborted at any of the
/// await points — closes it. That is the single mechanism; there is
/// deliberately no separate close on the error paths. Without it, a space that
/// keeps timing out in `wait_for_client_ready` (a large space still indexing on
/// first boot is the likeliest trigger), or one whose supervisor is aborted
/// mid-launch by an admin API space write, abandons a live renderer per attempt,
/// forever — the browser never looks dead, so nothing ever retires it.
///
/// One residual window is out of reach: an abort landing *inside* `new_page`
/// itself can leave a target that was created browser-side but whose handle
/// never reached this task. It is a single CDP round trip rather than a 60s
/// poll loop, so the exposure is tiny compared to what the guard covers.
async fn launch_page(
    browser: &Browser,
    page_cfg: &SpacePage,
    log_console: bool,
    live: &Arc<Mutex<Option<Page>>>,
    ready: &Arc<AtomicBool>,
    logs: &LogBuffer,
) -> Result<(), String> {
    let mut guard = PageCloseGuard::new(
        browser
            .new_page("about:blank")
            .await
            .map_err(|e| format!("new page: {e}"))?,
    );
    let page = guard.page();

    page.set_cookie(headless_cookie(page_cfg)?)
        .await
        .map_err(|e| format!("headless auth cookie: {e}"))?;

    // Console capture is attached *before* navigating: attaching afterwards
    // deterministically misses the client's earliest boot output, which is
    // exactly what an operator needs to debug a space that never reaches ready.
    attach_console_capture(page, logs, log_console)
        .await
        .map_err(|e| format!("console capture: {e}"))?;

    page.goto(page_cfg.page_url().as_str())
        .await
        .map_err(|e| format!("headless page navigation: {e}"))?;

    wait_for_client_ready(page).await?;

    // Publish first, disarm second, and never await in between: from here on the
    // supervisor (or `SharedChromeTransport::Drop`) closes the page via `live`.
    // `Page` is `Clone` and the clones share one underlying tab, so closing any
    // of them closes it.
    *live.lock().await = Some(page.clone());
    guard.disarm();
    ready.store(true, Ordering::Relaxed);
    Ok(())
}

/// Map a console API call type to the `tracing` level used when forwarding it
/// to the server log: errors → ERROR, warnings → WARN, everything else
/// (log/info/debug/dir/trace/…) → INFO.
fn console_level(t: &ConsoleApiCalledType) -> tracing::Level {
    match t {
        ConsoleApiCalledType::Error => tracing::Level::ERROR,
        ConsoleApiCalledType::Warning => tracing::Level::WARN,
        _ => tracing::Level::INFO,
    }
}

/// Subscribe to `Runtime.consoleAPICalled` and push each call into the shared
/// log buffer. The runtime domain must be enabled for these events to flow.
/// When `log_console` is set, each entry is also emitted to `tracing` (under
/// the `runtime_console` target) so it shows up in the server console.
async fn attach_console_capture(
    page: &Page,
    logs: &LogBuffer,
    log_console: bool,
) -> Result<(), String> {
    page.enable_runtime()
        .await
        .map_err(|e| format!("enable runtime: {e}"))?;
    let mut events = page
        .event_listener::<EventConsoleApiCalled>()
        .await
        .map_err(|e| format!("console listener: {e}"))?;
    let logs = logs.clone();
    tokio::spawn(async move {
        while let Some(ev) = events.next().await {
            let text = ev
                .args
                .iter()
                .map(|arg| match &arg.value {
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => String::new(),
                })
                .collect::<Vec<_>>()
                .join(" ");
            if log_console {
                match console_level(&ev.r#type) {
                    tracing::Level::ERROR => tracing::error!(target: "runtime_console", "{text}"),
                    tracing::Level::WARN => tracing::warn!(target: "runtime_console", "{text}"),
                    _ => tracing::info!(target: "runtime_console", "{text}"),
                }
            }
            logs.push(LogEntry {
                level: format!("{:?}", ev.r#type),
                text,
                timestamp: now_millis(),
            });
        }
    });
    Ok(())
}

/// Poll `globalThis.sbRuntime.ready` every 500ms until it is truthy, giving up
/// after 60s.
async fn wait_for_client_ready(page: &Page) -> Result<(), String> {
    const READY_TIMEOUT: Duration = Duration::from_secs(60);
    const POLL_INTERVAL: Duration = Duration::from_millis(500);
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        match eval_sync(
            page,
            "!!(globalThis.sbRuntime && globalThis.sbRuntime.ready)",
        )
        .await
        {
            Ok(Value::Bool(true)) => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                // The page may still be loading; keep polling until the
                // deadline rather than failing on the first transient error.
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!("client never became ready: {e}"));
                }
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("client runtime did not become ready within 60s".to_string());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Is this space's page still alive? A trivial eval that errors — or that never
/// answers — means the page (or the whole browser) is gone.
async fn page_is_alive(live: &Arc<Mutex<Option<Page>>>) -> bool {
    let guard = live.lock().await;
    match guard.as_ref() {
        None => false,
        // A timed-out probe reports *not* alive, so the supervisor takes the
        // restart path rather than waiting on a page that will never answer.
        Some(page) => matches!(
            tokio::time::timeout(PROBE_TIMEOUT, eval_sync(page, "1")).await,
            Ok(Ok(_))
        ),
    }
}

async fn browser_is_dead(browser: &Browser) -> bool {
    browser.pages().await.is_err()
}

/// Supervise one space's page for the lifetime of its transport.
pub(crate) async fn supervise_space(
    pool: Arc<crate::pool::ChromePool>,
    page_cfg: SpacePage,
    live: Arc<Mutex<Option<Page>>>,
    ready: Arc<AtomicBool>,
    logs: LogBuffer,
    trigger: Arc<Notify>,
) {
    const BACKOFF_FLOOR: Duration = Duration::from_secs(2);
    const BACKOFF_CAP: Duration = Duration::from_secs(120);
    const LIVENESS_INTERVAL: Duration = Duration::from_secs(2);

    trigger.notified().await;

    let mut backoff = BACKOFF_FLOOR;
    let mut has_launched = false;
    loop {
        if page_is_alive(&live).await {
            tokio::time::sleep(LIVENESS_INTERVAL).await;
            continue;
        }

        if has_launched {
            tracing::warn!("headless page for {} died; restarting", page_cfg.server_url);
        }
        ready.store(false, Ordering::Relaxed);
        let stale = live.lock().await.take();
        if let Some(old) = stale {
            let _ = tokio::time::timeout(PROBE_TIMEOUT, old.close()).await;
        }

        // `browser` is deliberately scoped to this block: the pool holds the
        // owning handle, and a lingering clone here would keep a dead Chrome
        // process alive across a relaunch.
        let attempt = match pool.ensure_browser().await {
            Ok((generation, browser)) => {
                let result = launch_page(
                    &browser,
                    &page_cfg,
                    pool.config().log_console,
                    &live,
                    &ready,
                    &logs,
                )
                .await;
                // Retire the browser only when it is genuinely gone. Discarding
                // on every failed attempt would let one space's persistent
                // navigation failure keep killing the browser for everyone.
                let dead = result.is_err() && browser_is_dead(&browser).await;
                // Drop the transient clone *before* retiring the pool's handle,
                // so clearing the slot really does release the process tree.
                drop(browser);
                if dead {
                    pool.discard_browser(generation).await;
                }
                result
            }
            Err(e) => Err(e),
        };

        match attempt {
            Ok(()) => {
                has_launched = true;
                backoff = BACKOFF_FLOOR;
                tracing::info!("headless runtime ready for {}", page_cfg.server_url);
            }
            Err(e) => {
                tracing::warn!(
                    "headless page for {} failed to start: {e}; retrying in {backoff:?}",
                    page_cfg.server_url
                );
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(BACKOFF_CAP);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    #[derive(Clone)]
    struct FakePage {
        closed: Arc<AtomicUsize>,
    }

    impl ClosablePage for FakePage {
        async fn close_page(self) {
            self.closed.fetch_add(1, Ordering::SeqCst);
        }
    }

    async fn launch_page_shaped(
        page: FakePage,
        live: Arc<Mutex<Option<FakePage>>>,
        ready: Arc<AtomicBool>,
        entered: Arc<Notify>,
        hold: Arc<Notify>,
    ) {
        let mut guard = PageCloseGuard::new(page);
        let page = guard.page();
        entered.notify_one();

        // set_cookie / attach_console_capture / goto.
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        // wait_for_client_ready.
        hold.notified().await;

        *live.lock().await = Some(page.clone());
        guard.disarm();
        ready.store(true, Ordering::Relaxed);
    }

    /// Wait (briefly) for the detached close task spawned by `Drop` to run.
    async fn await_closes(closed: &Arc<AtomicUsize>, want: usize) -> usize {
        for _ in 0..200 {
            let n = closed.load(Ordering::SeqCst);
            if n >= want {
                return n;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        closed.load(Ordering::SeqCst)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aborting_a_launch_mid_flight_closes_the_page() {
        let closed = Arc::new(AtomicUsize::new(0));
        let live = Arc::new(Mutex::new(None));
        let ready = Arc::new(AtomicBool::new(false));
        let entered = Arc::new(Notify::new());
        let hold = Arc::new(Notify::new());

        let task = tokio::spawn(launch_page_shaped(
            FakePage {
                closed: closed.clone(),
            },
            live.clone(),
            ready.clone(),
            entered.clone(),
            hold.clone(),
        ));

        // Let it reach the readiness wait, then cancel it there.
        entered.notified().await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(closed.load(Ordering::SeqCst), 0, "nothing closed yet");
        task.abort();
        let _ = task.await;

        assert_eq!(
            await_closes(&closed, 1).await,
            1,
            "a cancelled launch must close its page, not drop the handle"
        );
        assert!(live.lock().await.is_none());
        assert!(!ready.load(Ordering::Relaxed));
    }

    /// Cancellation before the readiness wait — the earlier await points
    /// (`set_cookie`, console capture, `goto`) — is covered too.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aborting_a_launch_during_setup_closes_the_page() {
        let closed = Arc::new(AtomicUsize::new(0));
        let live = Arc::new(Mutex::new(None));
        let entered = Arc::new(Notify::new());
        let hold = Arc::new(Notify::new());

        let task = tokio::spawn(launch_page_shaped(
            FakePage {
                closed: closed.clone(),
            },
            live.clone(),
            Arc::new(AtomicBool::new(false)),
            entered.clone(),
            hold,
        ));
        // Abort as soon as the guard exists — no sleep — so the cancellation
        // lands in the setup awaits rather than the readiness wait.
        entered.notified().await;
        task.abort();
        let _ = task.await;

        assert_eq!(await_closes(&closed, 1).await, 1);
        assert!(live.lock().await.is_none());
    }

    /// The other half: a launch that *succeeds* must not close the page it just
    /// published. Ownership moves to `live`, and the supervisor closes it from
    /// there on restart.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_successful_launch_does_not_close_the_page() {
        let closed = Arc::new(AtomicUsize::new(0));
        let live = Arc::new(Mutex::new(None));
        let ready = Arc::new(AtomicBool::new(false));
        let entered = Arc::new(Notify::new());
        let hold = Arc::new(Notify::new());

        let task = tokio::spawn(launch_page_shaped(
            FakePage {
                closed: closed.clone(),
            },
            live.clone(),
            ready.clone(),
            entered,
            hold.clone(),
        ));
        hold.notify_one();
        task.await.unwrap();

        // Long enough that a stray close task would have landed by now.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(closed.load(Ordering::SeqCst), 0);
        assert!(live.lock().await.is_some());
        assert!(ready.load(Ordering::Relaxed));
    }

    /// An `Err` return closes the tab through the same single mechanism — there
    /// is deliberately no separate close on `launch_page`'s error paths.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_error_return_closes_the_page_via_the_guard() {
        let closed = Arc::new(AtomicUsize::new(0));
        let c = closed.clone();
        let task = tokio::spawn(async move {
            let guard = PageCloseGuard::new(FakePage { closed: c });
            let _ = guard.page();
            Err::<(), String>("headless page navigation: boom".to_string())
        });
        assert!(task.await.unwrap().is_err());
        assert_eq!(await_closes(&closed, 1).await, 1);
    }

    fn page_cfg(server_url: &str) -> SpacePage {
        SpacePage {
            server_url: server_url.to_string(),
            headless_token: "secret".to_string(),
            cookie_name: "silverbullet_headless_a".to_string(),
        }
    }

    #[test]
    fn headless_cookie_is_http_only_and_named_per_space() {
        let cookie = headless_cookie(&page_cfg("http://127.0.0.1:3000")).unwrap();
        assert_eq!(cookie.name, "silverbullet_headless_a");
        assert_eq!(cookie.value, "secret");
        assert_eq!(cookie.url.as_deref(), Some("http://127.0.0.1:3000"));
        assert_eq!(cookie.path.as_deref(), Some("/"));
        assert_eq!(cookie.http_only, Some(true));
        assert_eq!(cookie.same_site, Some(CookieSameSite::Strict));
        // Session cookie: it must not outlive the browser.
        assert_eq!(cookie.expires, None);
    }

    #[test]
    fn headless_cookie_is_scoped_to_the_space_prefix() {
        let cookie = headless_cookie(&page_cfg("http://127.0.0.1:3000/notes")).unwrap();
        assert_eq!(cookie.path.as_deref(), Some("/notes"));
    }

    #[test]
    fn console_level_maps_severity() {
        assert_eq!(
            console_level(&ConsoleApiCalledType::Error),
            tracing::Level::ERROR
        );
        assert_eq!(
            console_level(&ConsoleApiCalledType::Warning),
            tracing::Level::WARN
        );
        assert_eq!(
            console_level(&ConsoleApiCalledType::Log),
            tracing::Level::INFO
        );
        assert_eq!(
            console_level(&ConsoleApiCalledType::Debug),
            tracing::Level::INFO
        );
        assert_eq!(
            console_level(&ConsoleApiCalledType::Info),
            tracing::Level::INFO
        );
    }

    #[test]
    fn clean_exception_message_strips_v8_framing() {
        // The real shape for a thrown Lua error.
        assert_eq!(
            clean_exception_message(
                "Uncaught (in promise) Error: attempt to call a nil value",
                Some("y: attempt to call a nil value\n    at $ (client.js:66:35699)"),
            ),
            "attempt to call a nil value"
        );
    }

    #[test]
    fn clean_exception_message_drops_stack_and_handles_sync_uncaught() {
        assert_eq!(
            clean_exception_message("Uncaught Error: boom\n    at f (x.js:1:1)", None),
            "boom"
        );
    }

    #[test]
    fn clean_exception_message_falls_back_to_description() {
        assert_eq!(
            clean_exception_message("", Some("Error: from description\nstack")),
            "from description"
        );
    }

    #[test]
    fn clean_exception_message_never_empty() {
        assert_eq!(clean_exception_message("", None), "client evaluation error");
    }
}
