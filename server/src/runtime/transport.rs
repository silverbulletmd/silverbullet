//! The lower seam: the ONLY per-backend code. A `ClientTransport` evaluates raw
//! JS in the client page and reports readiness. Console capture is pushed into
//! the shared `LogBuffer` the transport is handed at construction. The Chrome
//! transport (a later plan) and the webview transport are the two
//! implementations; everything above this trait is shared.

use std::time::Duration;

use super::backend::RuntimeError;

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
}
