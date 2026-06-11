//! Browser supervisor: owns the live `Browser` + `Page`, captures console
//! output into the shared log buffer, waits for the client runtime to signal
//! readiness, and restarts (with exponential backoff) whenever the page dies.
//!
//! The supervisor runs as a single long-lived task on the transport's tokio
//! runtime. It is deliberately tolerant of a not-yet-listening server: the
//! transport is constructed *before* the server binds its port, so the first
//! navigation may fail and is simply retried with backoff.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::js_protocol::runtime::{
    ConsoleApiCalledType, EvaluateParams, EventConsoleApiCalled,
};
use chromiumoxide::error::CdpError;
use chromiumoxide::page::Page;
use futures::StreamExt;
use serde_json::Value;
use silverbullet_server::runtime::{LogBuffer, LogEntry, RuntimeError};
use tokio::sync::{Mutex, Notify};

use crate::config::ChromeConfig;

/// The live browser and its single page, kept together so dropping the pair
/// (on restart) tears down the old Chrome process cleanly.
pub struct Live {
    /// Held purely to keep the Chrome process alive; dropping `Live` (on
    /// restart) drops this and tears Chrome down. Never read directly.
    #[allow(dead_code)]
    pub browser: Browser,
    pub page: Page,
}

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

/// Current wall-clock time in milliseconds since the Unix epoch.
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Build the headless page URL from the configured server URL, trimming a
/// trailing slash and appending `?headless=1&token=…`. The token is always
/// present; an open (no-auth) server simply ignores it.
fn page_url(config: &ChromeConfig) -> String {
    let base = config.server_url.trim_end_matches('/');
    format!("{base}/?headless=1&token={}", config.headless_token)
}

/// Launch a fresh browser + page, attach console capture, wait for the client
/// runtime to become ready, then publish the live pair into `live_slot` and
/// set `ready = true`. Returns `Err(msg)` on any failure (the caller backs off
/// and retries).
async fn launch_once(
    config: &ChromeConfig,
    live_slot: &Arc<Mutex<Option<Live>>>,
    ready: &Arc<AtomicBool>,
    logs: &LogBuffer,
) -> Result<(), String> {
    // chromiumoxide's `.args()` expects BARE flag keys (no leading `--`) — it
    // prepends the dashes itself when building the command line, so a value like
    // `"--no-sandbox"` is mangled to `----no-sandbox` and silently ignored. Use
    // the dedicated `.no_sandbox()` method (it emits the correct
    // `--no-sandbox` + `--disable-setuid-sandbox`, required when running as root,
    // e.g. inside a container) and pass the remaining flags as bare keys.
    let mut builder = BrowserConfig::builder()
        .chrome_executable(&config.chrome_path)
        .user_data_dir(&config.user_data_dir)
        .window_size(800, 600)
        .no_sandbox()
        .args([
            "disable-dev-shm-usage",
            "disable-extensions",
            "disable-gpu",
            "in-process-gpu",
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

    let page = browser
        .new_page(page_url(config).as_str())
        .await
        .map_err(|e| format!("new page: {e}"))?;

    attach_console_capture(&page, logs, config.log_console)
        .await
        .map_err(|e| format!("console capture: {e}"))?;

    wait_for_client_ready(&page).await?;

    *live_slot.lock().await = Some(Live { browser, page });
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

/// Is the current page still alive? A trivial eval that errors means the page
/// (or the whole browser) is gone.
async fn page_is_alive(live_slot: &Arc<Mutex<Option<Live>>>) -> bool {
    let guard = live_slot.lock().await;
    match guard.as_ref() {
        None => false,
        Some(live) => eval_sync(&live.page, "1").await.is_ok(),
    }
}

/// Supervise the browser for the lifetime of the transport.
///
/// Loop shape: each iteration first checks liveness. When the page is dead
/// (the initial `None` slot, or a crashed page), we mark the runtime not-ready,
/// drop any stale `Live`, and attempt `launch_once`. On success we reset the
/// backoff to its floor and continue; on failure we sleep for the current
/// backoff (2s, doubling up to 120s) before the next attempt. When the page is
/// alive we sleep ~2s between liveness checks. The browser is launched LAZILY:
/// the supervisor idles until the first runtime request (`requested`) before its
/// first `launch_once`, so Chrome never starts while the runtime API is unused.
pub async fn supervise(
    config: ChromeConfig,
    live_slot: Arc<Mutex<Option<Live>>>,
    ready: Arc<AtomicBool>,
    logs: LogBuffer,
    trigger: Arc<Notify>,
) {
    const BACKOFF_FLOOR: Duration = Duration::from_secs(2);
    const BACKOFF_CAP: Duration = Duration::from_secs(120);
    const LIVENESS_INTERVAL: Duration = Duration::from_secs(2);

    // Lazy launch: park here until the first runtime request, so Chrome is not
    // started (and emits no CDP noise) while the runtime API is unused. `Notify`
    // suspends the task with no polling; if the request arrived first,
    // `notify_one` already stored a permit so this returns immediately.
    trigger.notified().await;
    tracing::info!(
        "runtime API used; launching headless Chrome ({})",
        config.chrome_path
    );

    let mut backoff = BACKOFF_FLOOR;
    let mut has_launched = false;
    loop {
        if page_is_alive(&live_slot).await {
            tokio::time::sleep(LIVENESS_INTERVAL).await;
            continue;
        }

        // The page is dead (or never launched): mark not-ready and drop any
        // stale browser before relaunching. A dead page *after* a successful
        // launch is a crash/restart, worth flagging distinctly from first boot.
        if has_launched {
            tracing::warn!("headless Chrome page died; restarting");
        }
        ready.store(false, Ordering::Relaxed);
        *live_slot.lock().await = None;

        match launch_once(&config, &live_slot, &ready, &logs).await {
            Ok(()) => {
                has_launched = true;
                backoff = BACKOFF_FLOOR;
                tracing::info!("headless Chrome runtime ready");
            }
            Err(e) => {
                tracing::warn!("headless chrome launch failed: {e}; retrying in {backoff:?}");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(BACKOFF_CAP);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
