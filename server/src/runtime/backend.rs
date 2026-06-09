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
    /// The client runtime has not signaled readiness within the deadline.
    #[error("runtime not ready")]
    NotReady,
    /// The evaluation did not complete within the deadline.
    #[error("runtime request timed out")]
    Timeout,
    /// The transport failed (e.g. the browser crashed, eval could not be sent).
    #[error("runtime transport error: {0}")]
    Transport(String),
}

/// What the router/handlers call. A single primitive: evaluate one client
/// `sbRuntime.*` function with one JSON-string argument and return its JSON
/// result. Every runtime endpoint is built on this — `/.runtime/lua` →
/// `sbRuntime.evalLua`, `/.runtime/lua_script` → `sbRuntime.evalLuaScript`,
/// `/.runtime/objects*` → `sbRuntime.objectsAPI`. Only infrastructure failures
/// surface as `Err`; a Lua-level error travels back inside the success value.
pub trait RuntimeBackend: Send + Sync {
    /// Evaluate `<fn_name>(<arg as a single JSON-encoded string>)` in the client
    /// runtime and return its JSON result, blocking up to `timeout`.
    fn eval_global(
        &self,
        fn_name: &str,
        arg: &str,
        timeout: Duration,
    ) -> Result<serde_json::Value, RuntimeError>;

    /// Recent console-log entries (most recent `limit`, optionally only those
    /// strictly newer than `since`).
    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry>;

    /// Whether the client runtime is ready to evaluate.
    fn ready(&self) -> bool;
}
