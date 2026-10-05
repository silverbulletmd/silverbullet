//! The `RuntimeBackend` trait consumed by the router, and its error type. The
//! router never knows *how* Lua is evaluated — only this trait. Concrete
//! backends are built from a `ClientTransport` via `ClientRuntime` (see
//! `client.rs`).

use std::time::Duration;

use super::logs::LogEntry;

/// An infrastructure-level runtime failure (transport down, not ready, timed
/// out). A *Lua-level* error is NOT one of these — it travels back inside the
/// success envelope as `{ "error": ... }`.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("runtime access denied")]
    Forbidden,
    /// The client runtime has not signaled readiness within the deadline.
    #[error("runtime not ready")]
    NotReady,
    /// The evaluation did not complete within the deadline.
    #[error("runtime request timed out")]
    Timeout,
    /// The transport failed (e.g. the browser crashed, eval could not be sent).
    #[error("runtime transport error: {0}")]
    Transport(String),
    #[error("{0}")]
    Eval(String),
    #[error("{0}")]
    SelectorNotFound(String),
    #[error("{0}")]
    InvalidSelector(String),
}

/// What the router/handlers call. A single primitive: evaluate one client
/// `sbRuntime.*` function with one JSON-string argument and return its JSON
/// result. The Lua endpoints use this for `sbRuntime.evalLua` and
/// `sbRuntime.evalLuaScript`. Only infrastructure failures surface as `Err`;
/// a Lua-level error travels back inside the success value.
pub trait RuntimeBackend: Send + Sync {
    fn for_actor(
        &self,
        _actor: &crate::auth::Actor,
    ) -> Result<Option<std::sync::Arc<dyn RuntimeBackend>>, RuntimeError> {
        Ok(None)
    }

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
    ) -> Result<Option<std::sync::Arc<dyn RuntimeBackend>>, RuntimeError> {
        Err(RuntimeError::Transport(
            "runtime management unavailable".into(),
        ))
    }
    fn runtime_instances(&self) -> Vec<super::RuntimeInstance> {
        Vec::new()
    }
    fn manage_runtime(&self, _id: &str, _reset: bool) -> Result<bool, RuntimeError> {
        Ok(false)
    }
    fn reset(&self) {}
    fn revoke_user(&self, _username: &str) {}

    /// Evaluate `<fn_name>(<arg as a single JSON-encoded string>)` in the client
    /// runtime and return its JSON result, blocking up to `timeout`.
    fn eval_global(
        &self,
        fn_name: &str,
        arg: &str,
        timeout: Duration,
    ) -> Result<serde_json::Value, RuntimeError>;

    fn screenshot(
        &self,
        _selector: Option<&str>,
        _timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        Err(RuntimeError::Transport("screenshot unsupported".into()))
    }

    /// Recent console-log entries (most recent `limit`, optionally only those
    /// strictly newer than `since`).
    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry>;

    /// Whether the client runtime is ready to evaluate.
    fn ready(&self) -> bool;
    fn shutdown(&self) {}
}
