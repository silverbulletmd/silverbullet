//! The headless-Chrome `ClientTransport`: owns a dedicated tokio runtime and a
//! supervised browser page running the normal client in `?headless=1` mode.
//!
//! `eval_js`/`wait_ready` are synchronous and block the calling thread (the
//! server invokes them via `spawn_blocking`); they run their async work on the
//! transport's owned runtime. Launch is tolerant: the browser is brought up and
//! kept alive by the supervisor, so the server can finish binding its port
//! before the headless page connects. Until the page reports
//! `sbRuntime.ready`, `is_ready()` is false and eval/wait return
//! `NotReady`/`Timeout` (→ the server answers 503/504).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use silverbullet_server::runtime::{ClientTransport, LogBuffer, RuntimeError};
use tokio::runtime::Runtime;
use tokio::sync::Mutex;

use crate::config::ChromeConfig;
use crate::supervisor::{eval_on_page, Live};

pub struct ChromeTransport {
    rt: Runtime,
    live: Arc<Mutex<Option<Live>>>,
    ready: Arc<AtomicBool>,
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
        let supervisor = {
            let (live, ready, logs, config) =
                (live.clone(), ready.clone(), logs.clone(), config.clone());
            rt.spawn(crate::supervisor::supervise(config, live, ready, logs))
        };
        Ok(Self {
            rt,
            live,
            ready,
            _supervisor: supervisor,
        })
    }
}

impl ClientTransport for ChromeTransport {
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<Value, RuntimeError> {
        let live = self.live.clone();
        let js = js.to_string();
        self.rt.block_on(async move {
            let guard = live.lock().await;
            let live = guard.as_ref().ok_or(RuntimeError::NotReady)?;
            match tokio::time::timeout(timeout, eval_on_page(&live.page, &js)).await {
                Err(_) => Err(RuntimeError::Timeout),
                Ok(r) => r,
            }
        })
    }

    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError> {
        if self.ready.load(Ordering::Relaxed) {
            return Ok(());
        }
        let ready = self.ready.clone();
        self.rt.block_on(async move {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server::runtime::LogBuffer;

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
