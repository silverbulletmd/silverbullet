//! Browser launch and supervision for one isolated runtime transport.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::network::{CookieParam, CookieSameSite};
use chromiumoxide::cdp::browser_protocol::page::{
    AddScriptToEvaluateOnNewDocumentParams, CaptureScreenshotFormat, EventFrameNavigated,
    Viewport,
};
use chromiumoxide::cdp::js_protocol::runtime::{
    ConsoleApiCalledType, EvaluateParams, EventConsoleApiCalled, ExecutionContextId,
};
use chromiumoxide::error::CdpError;
use chromiumoxide::page::{Page, ScreenshotParams};
use futures::StreamExt;
use serde_json::Value;
use silverbullet_server::runtime::{CaptureRect, LogBuffer, LogEntry, RuntimeError};
use tokio::sync::{Mutex, Notify};

use crate::config::{ChromeConfig, SpacePage};

/// Evaluate a JS expression against the client's runtime bridge with
/// await-promise + return-by-value semantics, returning its JSON value (`Null`
/// when the expression produced no value).
///
/// `Ok(None)` means the expression never ran: the bridge is not up (the client
/// is still booting, e.g. after reloading itself), or the document has been
/// replaced. Retrying is safe then. The expression is pinned to the execution
/// context the readiness check passed in, so a reload between check and call
/// makes Chrome reject the call rather than run it on a bridgeless page. A
/// document replaced *while* the expression runs is an error, as it may have
/// had effects.
pub(crate) async fn eval_on_bridge(page: &Page, js: &str) -> Result<Option<Value>, RuntimeError> {
    let Some(context) = page.execution_context().await.map_err(cdp_error_to_runtime)? else {
        return Ok(None);
    };
    match evaluate_in(page, context, READY_JS, false).await {
        Ok(Value::Bool(true)) => {}
        Ok(_) => return Ok(None),
        Err(e) if is_context_gone(&e) => return Ok(None),
        Err(e) => return Err(cdp_error_to_runtime(e)),
    }
    match evaluate_in(page, context, js, true).await {
        Ok(value) => Ok(Some(value)),
        Err(e) if is_context_gone(&e) => Ok(None),
        Err(e) => Err(cdp_error_to_runtime(e)),
    }
}

async fn evaluate_in(
    page: &Page,
    context: ExecutionContextId,
    js: &str,
    await_promise: bool,
) -> Result<Value, CdpError> {
    let params = EvaluateParams::builder()
        .expression(js)
        .context_id(context)
        .await_promise(await_promise)
        .return_by_value(true)
        .build()
        .map_err(CdpError::msg)?;
    let result = page.evaluate(params).await?;
    Ok(result.value().cloned().unwrap_or(Value::Null))
}

/// Chrome's answer for a context whose document has been replaced; the
/// expression was never run.
fn is_context_gone(e: &CdpError) -> bool {
    matches!(e, CdpError::Chrome(err) if err.message == "Cannot find context with specified id")
}

pub(crate) async fn capture_on_page(
    page: &Page,
    clip: Option<CaptureRect>,
) -> Result<Vec<u8>, RuntimeError> {
    let mut params = ScreenshotParams::builder().format(CaptureScreenshotFormat::Png);
    if let Some(c) = clip {
        params = params.clip(Viewport {
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            scale: 1.0,
        });
    }
    page.screenshot(params.build())
        .await
        .map_err(|e| RuntimeError::Transport(e.to_string()))
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
        // The page ran fine but CDP could not serialize its result by value
        // (e.g. a symbol or a cyclic object): a problem with the user's value,
        // not with the browser connection.
        CdpError::Chrome(err)
            if err.message == "Object couldn't be returned by value"
                || err.message == "Object reference chain is too long" =>
        {
            RuntimeError::Eval(format!(
                "result contains a value that can't be returned ({})",
                err.message
            ))
        }
        other => RuntimeError::Transport(other.to_string()),
    }
}

/// Reduce a V8 exception to a concise single line. Prefers `text` (e.g.
/// `"Uncaught (in promise) Error: attempt to call a nil value"`), strips the
/// `Uncaught …` framing and a leading `Error:` label so the underlying message
/// stands alone, and drops any JS stack (the full detail still reaches the
/// `runtime_console` log). Falls back to the object `description`'s first line
/// when `text` is nothing but framing: a synchronous throw reports bare
/// `"Uncaught"` there, with the actual message only in `description`.
fn clean_exception_message(text: &str, description: Option<&str>) -> String {
    let first_line = |s: &str| s.lines().next().unwrap_or("").trim().to_string();
    let strip_framing = |mut msg: String| {
        for prefix in ["Uncaught (in promise)", "Uncaught"] {
            if let Some(rest) = msg.strip_prefix(prefix) {
                msg = rest.trim_start().to_string();
            }
        }
        msg
    };
    let mut msg = strip_framing(first_line(text));
    if msg.is_empty() {
        msg = strip_framing(description.map(first_line).unwrap_or_default());
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

/// Bound probes and closes on unresponsive pages below chromiumoxide's
/// default 30-second timeout to limit restart latency.
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

pub(crate) struct OwnedBrowser {
    browser: Browser,
    handler: tokio::task::JoinHandle<()>,
    pub(crate) identity: Option<(u32, u64)>,
}

impl std::ops::Deref for OwnedBrowser {
    type Target = Browser;

    fn deref(&self) -> &Browser {
        &self.browser
    }
}

impl OwnedBrowser {
    pub(crate) async fn shutdown(&mut self, graceful: bool) -> Result<(), String> {
        if graceful {
            let _ = tokio::time::timeout(PROBE_TIMEOUT, self.browser.close()).await;
            if matches!(
                tokio::time::timeout(PROBE_TIMEOUT, self.browser.wait()).await,
                Ok(Ok(_))
            ) {
                return Ok(());
            }
        }
        match tokio::time::timeout(PROBE_TIMEOUT, self.browser.kill()).await {
            Ok(Some(Ok(()))) | Ok(None) => Ok(()),
            Ok(Some(Err(e))) => Err(format!("stop browser: {e}")),
            Err(_) => Err("stop browser timed out".into()),
        }
    }
}

impl Drop for OwnedBrowser {
    fn drop(&mut self) {
        self.handler.abort();
    }
}

pub(crate) async fn launch_browser(
    config: &ChromeConfig,
    profile: &std::path::Path,
) -> Result<OwnedBrowser, String> {
    let mut builder = BrowserConfig::builder()
        .chrome_executable(&config.chrome_path)
        .user_data_dir(profile)
        .window_size(800, 600)
        .no_sandbox()
        .arg(("host-resolver-rules", "MAP *.runtime.localhost 127.0.0.1"))
        .args([
            "disable-dev-shm-usage",
            "disable-extensions",
            "disable-gpu",
            "disable-software-rasterizer",
        ]);
    if config.show {
        builder = builder.with_head();
    } else {
        // Newer Chrome versions otherwise create hidden address-bar renderers
        // for headless windows, each retaining a separate JavaScript heap.
        builder = builder
            .arg((
                "disable-features",
                "WebUIOmniboxPopup,WebUIOmniboxAimPopup,WebUIOmniboxFullPopup",
            ))
            .arg(("js-flags", "--optimize-for-size"));
    }
    let browser_config = builder.build()?;

    let (mut browser, mut handler) = Browser::launch(browser_config)
        .await
        .map_err(|e| format!("browser launch: {e}"))?;

    let identity = browser
        .get_mut_child()
        .and_then(|child| child.as_mut_inner().id())
        .and_then(crate::metrics::process_identity);
    let handler = tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if event.is_err() {
                break;
            }
        }
    });

    Ok(OwnedBrowser {
        identity,
        browser,
        handler,
    })
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

/// Closes a newly opened page on drop unless ownership has been transferred.
/// Chromiumoxide does not close tabs when Page handles are dropped.
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

/// Runs before any page script in every document the runtime page loads.
/// `?headless=1` only reaches the first boot — the client strips the query
/// string — so without this a reload (`editor.reloadUI()`, e.g. Toggle Dark
/// Mode) would boot a regular client that never exposes the runtime bridge.
const HEADLESS_INIT_JS: &str = "(globalThis.sbRuntime ??= {}).headless = true;";

/// Open and initialize the space's page, publishing it to `live` when ready.
/// PageCloseGuard closes it on errors or cancellation during initialization.
/// Cancellation inside new_page itself can still orphan a browser-side target
/// before its handle reaches the guard.
async fn launch_page(
    browser: &Browser,
    page_cfg: &SpacePage,
    log_console: bool,
    live: &Arc<Mutex<Option<Page>>>,
    ready: &Arc<AtomicBool>,
    logs: &LogBuffer,
    navigated: &Arc<Notify>,
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

    page.evaluate_on_new_document(AddScriptToEvaluateOnNewDocumentParams::new(HEADLESS_INIT_JS))
        .await
        .map_err(|e| format!("headless init script: {e}"))?;
    attach_navigation_watch(page, ready, navigated)
        .await
        .map_err(|e| format!("navigation listener: {e}"))?;

    page.goto(page_cfg.page_url().as_str())
        .await
        .map_err(|e| format!("headless page navigation: {e}"))?;

    wait_for_client_ready(page).await?;

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

/// A main-frame navigation (the client reloading itself) replaces the document
/// and with it the runtime bridge: mark the runtime not ready at once, so calls
/// wait instead of hitting the fresh page before it has booted, and wake the
/// supervisor to wait for the new client's readiness.
async fn attach_navigation_watch(
    page: &Page,
    ready: &Arc<AtomicBool>,
    navigated: &Arc<Notify>,
) -> Result<(), String> {
    let mut events = page
        .event_listener::<EventFrameNavigated>()
        .await
        .map_err(|e| e.to_string())?;
    let ready = ready.clone();
    let navigated = navigated.clone();
    tokio::spawn(async move {
        while let Some(ev) = events.next().await {
            if ev.frame.parent_id.is_none() {
                ready.store(false, Ordering::Relaxed);
                navigated.notify_one();
            }
        }
    });
    Ok(())
}

const READY_JS: &str = "!!(globalThis.sbRuntime && globalThis.sbRuntime.ready)";

/// Poll `globalThis.sbRuntime.ready` every 500ms until it is truthy, giving up
/// after 60s.
async fn wait_for_client_ready(page: &Page) -> Result<(), String> {
    const READY_TIMEOUT: Duration = Duration::from_secs(60);
    const POLL_INTERVAL: Duration = Duration::from_millis(500);
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        match eval_sync(page, READY_JS).await {
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

enum PageState {
    /// The client answers and its runtime bridge is up.
    Ready,
    /// The page answers but its client is (re)booting, e.g. after reloading
    /// itself; the page is returned so the supervisor can await readiness.
    Booting(Page),
    /// No page, or one that errors or never answers: restart it.
    Dead,
}

/// Probe this space's page. An eval that errors — or that never answers —
/// means the page (or the whole browser) is gone.
async fn probe_page(live: &Arc<Mutex<Option<Page>>>) -> PageState {
    let guard = live.lock().await;
    let Some(page) = guard.as_ref() else {
        return PageState::Dead;
    };
    // A timed-out probe reports dead, so the supervisor takes the restart
    // path rather than waiting on a page that will never answer.
    match tokio::time::timeout(PROBE_TIMEOUT, eval_sync(page, READY_JS)).await {
        Ok(Ok(Value::Bool(true))) => PageState::Ready,
        Ok(Ok(_)) => PageState::Booting(page.clone()),
        _ => PageState::Dead,
    }
}

async fn browser_is_dead(browser: &Browser) -> bool {
    browser.pages().await.is_err()
}

/// Supervise one space's page for the lifetime of its transport.
pub(crate) async fn supervise_space(
    owner: Arc<crate::pool::BrowserOwner>,
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

    let navigated = Arc::new(Notify::new());
    let mut backoff = BACKOFF_FLOOR;
    let mut has_launched = false;
    loop {
        match probe_page(&live).await {
            PageState::Ready => {
                // Also restores readiness after a navigation event that turned
                // out not to replace the client (e.g. a same-document one).
                ready.store(true, Ordering::Relaxed);
                tokio::select! {
                    _ = tokio::time::sleep(LIVENESS_INTERVAL) => {}
                    _ = navigated.notified() => {}
                }
                continue;
            }
            PageState::Booting(page) => {
                // The client reloaded itself: calls wait on `ready` until the
                // new client has exposed the bridge again.
                ready.store(false, Ordering::Relaxed);
                match wait_for_client_ready(&page).await {
                    Ok(()) => {
                        ready.store(true, Ordering::Relaxed);
                        tracing::info!(
                            "headless client for {} reloaded; runtime ready again",
                            page_cfg.server_url
                        );
                        continue;
                    }
                    Err(e) => tracing::warn!(
                        "headless client for {} did not come back after reloading: {e}",
                        page_cfg.server_url
                    ),
                }
            }
            PageState::Dead => {}
        }

        if has_launched {
            tracing::warn!("headless page for {} died; restarting", page_cfg.server_url);
        }
        ready.store(false, Ordering::Relaxed);
        let stale = live.lock().await.take();
        if let Some(old) = stale {
            let _ = tokio::time::timeout(PROBE_TIMEOUT, old.close()).await;
        }

        let attempt = match owner.ensure_browser().await {
            Ok((generation, browser)) => {
                let result = launch_page(
                    &browser,
                    &page_cfg,
                    owner.config().log_console,
                    &live,
                    &ready,
                    &logs,
                    &navigated,
                )
                .await;
                let dead = result.is_err() && browser_is_dead(&browser).await;
                drop(browser);
                if dead {
                    owner.discard_browser(generation).await;
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

        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
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
    fn clean_exception_message_uses_description_for_bare_uncaught() {
        assert_eq!(
            clean_exception_message(
                "Uncaught",
                Some("ReferenceError: sbRuntime is not defined\n    at <anonymous>:1:1"),
            ),
            "ReferenceError: sbRuntime is not defined"
        );
        assert_eq!(
            clean_exception_message("Uncaught (in promise)", Some("Error: boom\nstack")),
            "boom"
        );
    }

    #[test]
    fn clean_exception_message_never_empty() {
        assert_eq!(clean_exception_message("", None), "client evaluation error");
    }
    fn chrome_error(code: i64, message: &str) -> CdpError {
        CdpError::Chrome(chromiumoxide::types::Error {
            code,
            message: message.to_string(),
        })
    }

    #[test]
    fn unreturnable_result_is_an_eval_error_not_a_transport_error() {
        for message in [
            "Object couldn't be returned by value",
            "Object reference chain is too long",
        ] {
            match cdp_error_to_runtime(chrome_error(-32000, message)) {
                RuntimeError::Eval(msg) => {
                    assert!(
                        msg.starts_with("result contains a value that can't be returned"),
                        "{msg}"
                    );
                    assert!(msg.contains(message), "{msg}");
                }
                other => panic!("expected Eval for {message:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn other_cdp_errors_stay_transport_errors() {
        assert!(matches!(
            cdp_error_to_runtime(chrome_error(-32000, "Target closed")),
            RuntimeError::Transport(_)
        ));
        assert!(matches!(
            cdp_error_to_runtime(CdpError::NoResponse),
            RuntimeError::Transport(_)
        ));
    }
}
