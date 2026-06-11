//! The headless-Chrome `ClientTransport`: owns a dedicated tokio runtime and a
//! supervised browser page running the normal client in `?headless=1` mode.
//!
//! `eval_js`/`wait_ready` are synchronous and block the calling thread (the
//! server invokes them via `spawn_blocking`); they run their async work on the
//! transport's owned runtime. Launch is LAZY and tolerant: the supervisor does
//! not start Chrome until the first runtime request (`eval_js`/`wait_ready`),
//! then brings the browser up and keeps it alive — so the server can finish
//! binding its port before the headless page connects, and Chrome never runs
//! while the runtime API is unused. Until the page reports `sbRuntime.ready`,
//! `is_ready()` is false and eval/wait return `NotReady`/`Timeout` (→ the
//! server answers 503/504).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use silverbullet_server::runtime::{ClientTransport, LogBuffer, RuntimeError};
use tokio::runtime::Runtime;
use tokio::sync::{Mutex, Notify};

use crate::config::ChromeConfig;
use crate::supervisor::{eval_on_page, Live};

pub struct ChromeTransport {
    rt: Option<Runtime>,
    live: Arc<Mutex<Option<Live>>>,
    ready: Arc<AtomicBool>,
    /// Notified on the first runtime request; the supervisor parks on this
    /// before launching Chrome, so the browser only starts when the runtime API
    /// is actually used.
    trigger: Arc<Notify>,
    _supervisor: tokio::task::JoinHandle<()>,
}

impl ChromeTransport {
    /// Launch Chrome and start the supervisor. Pushes console output into `logs`
    /// (pass a clone of the `LogBuffer` you give to `ClientRuntime`). Returns an
    /// error only if the tokio runtime can't be created — the browser launch and
    /// page readiness are handled (and retried) by the supervisor, so the server
    /// can finish binding its port before the headless page connects.
    pub fn launch(config: ChromeConfig, logs: LogBuffer) -> Result<Self, RuntimeError> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::Transport(format!("tokio runtime: {e}")))?;
        let live = Arc::new(Mutex::new(None));
        let ready = Arc::new(AtomicBool::new(false));
        let trigger = Arc::new(Notify::new());
        let supervisor = {
            let (live, ready, logs, config, trigger) = (
                live.clone(),
                ready.clone(),
                logs.clone(),
                config.clone(),
                trigger.clone(),
            );
            rt.spawn(crate::supervisor::supervise(
                config, live, ready, logs, trigger,
            ))
        };
        Ok(Self {
            rt: Some(rt),
            live,
            ready,
            trigger,
            _supervisor: supervisor,
        })
    }

    /// The owned runtime. Always present until `Drop`; the `Option` exists only
    /// so `Drop` can take it.
    fn rt(&self) -> &Runtime {
        self.rt.as_ref().expect("runtime present until drop")
    }
}

impl Drop for ChromeTransport {
    fn drop(&mut self) {
        if let Some(rt) = self.rt.take() {
            rt.shutdown_background();
        }
    }
}

impl ClientTransport for ChromeTransport {
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<Value, RuntimeError> {
        // Any runtime use wakes the supervisor to launch Chrome.
        self.trigger.notify_one();
        let live = self.live.clone();
        let js = js.to_string();
        self.rt().block_on(async move {
            let guard = live.lock().await;
            let live = guard.as_ref().ok_or(RuntimeError::NotReady)?;
            match tokio::time::timeout(timeout, eval_on_page(&live.page, &js)).await {
                Err(_) => Err(RuntimeError::Timeout),
                Ok(r) => r,
            }
        })
    }

    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError> {
        // First runtime request wakes the supervisor to launch Chrome.
        self.trigger.notify_one();
        if self.ready.load(Ordering::Relaxed) {
            return Ok(());
        }
        let ready = self.ready.clone();
        self.rt().block_on(async move {
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
        // Same lazy-launch nudge as eval/wait: wake the supervisor so a
        // log read alone is enough to bring Chrome up.
        self.trigger.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server::runtime::LogBuffer;

    /// Regression test for the Ctrl-C shutdown panic: the transport owns a
    /// multi-thread runtime and is dropped while the outer server runtime is
    /// still active (here, the multi-thread `#[tokio::test]` runtime, matching
    /// `#[tokio::main]`).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_transport_inside_async_context_does_not_panic() {
        let cfg = crate::config::ChromeConfig::resolve(
            Some("/nonexistent/chrome".into()),
            None,
            "http://127.0.0.1:0".into(),
            String::new(),
            "/tmp".into(),
            false,
            false,
            false,
            true,
        )
        .expect("config resolves with an explicit chrome path");
        let transport = ChromeTransport::launch(cfg, LogBuffer::new()).unwrap();
        drop(transport); // must not panic
    }

    #[test]
    fn eval_against_live_server_when_configured() {
        let Ok(url) = std::env::var("SB_TEST_RUNTIME_URL") else {
            eprintln!("skip: set SB_TEST_RUNTIME_URL to run");
            return;
        };
        let Some(cfg) = crate::config::ChromeConfig::resolve(
            None,
            None,
            url,
            String::new(),
            "/tmp/x".into(),
            false,
            false,
            false,
            true,
        ) else {
            eprintln!("skip: no Chrome");
            return;
        };
        let t = ChromeTransport::launch(cfg, LogBuffer::new()).unwrap();
        t.wait_ready(std::time::Duration::from_secs(60)).unwrap();
        let v = t
            .eval_js(
                "sbRuntime.evalLua(\"return 1 + 1\")",
                std::time::Duration::from_secs(10),
            )
            .unwrap();
        assert_eq!(v, serde_json::json!(2));
    }
}
