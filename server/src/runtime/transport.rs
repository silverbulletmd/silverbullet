//! The lower seam: the ONLY per-backend code. A `ClientTransport` evaluates raw
//! JS in the client page and reports readiness. Console capture is pushed into
//! the shared `LogBuffer` the transport is handed at construction. The Chrome
//! transport (a later plan) and the webview transport are the two
//! implementations; everything above this trait is shared.

use std::time::Duration;

use super::backend::RuntimeError;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CaptureRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub trait ClientTransport: Send + Sync {
    /// Evaluate a raw JS expression in the client page and return its JSON
    /// result, blocking up to `timeout`. Implementations run any async work on
    /// their own runtime and block the calling thread — callers therefore invoke
    /// this on a blocking thread, never on an async worker.
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<serde_json::Value, RuntimeError>;

    /// Block until the client runtime is ready to evaluate, up to `timeout`.
    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError>;

    /// Non-blocking readiness check.
    fn is_ready(&self) -> bool;
    fn capture(
        &self,
        _clip: Option<CaptureRect>,
        _timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        Err(RuntimeError::Transport("screenshot unsupported".into()))
    }
    fn ensure_started(&self) {}
    fn shutdown(&self) {}
    fn snapshot(&self) -> Option<super::RuntimeSnapshot> {
        None
    }
    fn stop(&self, _retain_profile: bool) -> Result<(), RuntimeError> {
        Err(RuntimeError::Transport(
            "runtime management unavailable".into(),
        ))
    }
    fn restart(
        &self,
        _headless_token: &str,
        _logs: super::LogBuffer,
    ) -> Result<Option<Box<dyn ClientTransport>>, RuntimeError> {
        Err(RuntimeError::Transport(
            "runtime management unavailable".into(),
        ))
    }
}

impl ClientTransport for Box<dyn ClientTransport> {
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<serde_json::Value, RuntimeError> {
        (**self).eval_js(js, timeout)
    }
    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError> {
        (**self).wait_ready(timeout)
    }
    fn is_ready(&self) -> bool {
        (**self).is_ready()
    }
    fn capture(
        &self,
        clip: Option<CaptureRect>,
        timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        (**self).capture(clip, timeout)
    }
    fn ensure_started(&self) {
        (**self).ensure_started()
    }
    fn shutdown(&self) {
        (**self).shutdown()
    }
    fn snapshot(&self) -> Option<super::RuntimeSnapshot> {
        (**self).snapshot()
    }
    fn stop(&self, retain_profile: bool) -> Result<(), RuntimeError> {
        (**self).stop(retain_profile)
    }
    fn restart(
        &self,
        token: &str,
        logs: super::LogBuffer,
    ) -> Result<Option<Box<dyn ClientTransport>>, RuntimeError> {
        (**self).restart(token, logs)
    }
}
