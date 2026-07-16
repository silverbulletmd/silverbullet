//! The shared upper layer, written and tested ONCE for every transport. It
//! builds the `sbRuntime.*` call snippet, delegates evaluation to the
//! transport, and serves the shared log buffer. Whatever the client function
//! returns is passed through verbatim — endpoint-specific shaping (e.g. the
//! objects string→JSON unwrap) lives in the handlers.

use std::time::Duration;

use super::backend::{RuntimeBackend, RuntimeError};
use super::logs::{LogBuffer, LogEntry};
use super::transport::ClientTransport;

/// Build the JS expression that invokes a global function with a single
/// JSON-encoded string argument. The transport awaits the returned promise and
/// extracts its JSON value.
///
/// `build_global_call_js("sbRuntime.evalLua", "1 + 1")` → `sbRuntime.evalLua("1 + 1")`.
pub fn build_global_call_js(fn_name: &str, arg: &str) -> String {
    let arg_json = serde_json::to_string(arg).unwrap_or_else(|_| "\"\"".to_string());
    format!("{fn_name}({arg_json})")
}

/// A `RuntimeBackend` for any `ClientTransport`. Holds the transport plus the
/// shared `LogBuffer` (the transport pushes console output into a clone of it).
pub struct ClientRuntime<T: ClientTransport> {
    transport: T,
    logs: LogBuffer,
}

impl<T: ClientTransport> ClientRuntime<T> {
    /// `logs` must be the same buffer (clone) the transport pushes console
    /// output into, so `/.runtime/logs` reflects what the client logged.
    pub fn new(transport: T, logs: LogBuffer) -> Self {
        Self { transport, logs }
    }
}

impl<T: ClientTransport> RuntimeBackend for ClientRuntime<T> {
    fn eval_global(
        &self,
        fn_name: &str,
        arg: &str,
        timeout: Duration,
    ) -> Result<serde_json::Value, RuntimeError> {
        // Single choke point for the Lua runtime API calls (evalLua and
        // evalLuaScript), so a failure here — the runtime not coming up, a
        // timeout, or a thrown error in the client (e.g. a Lua error) — always
        // leaves a trace in the server log.
        let result = self.transport.wait_ready(timeout).and_then(|()| {
            self.transport
                .eval_js(&build_global_call_js(fn_name, arg), timeout)
        });
        if let Err(e) = &result {
            tracing::warn!("runtime call {fn_name} failed: {e}");
        }
        result
    }

    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        // Reading logs counts as using the runtime: nudge a lazily-launched
        // transport to boot so console output actually starts flowing. Without
        // this, `sb logs` (especially `--follow`) against a freshly-started
        // server that has had no eval yet would sit on an empty buffer forever.
        self.transport.ensure_started();
        self.logs.query(limit, since)
    }

    fn ready(&self) -> bool {
        self.transport.is_ready()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    #[test]
    fn builds_call_snippet_with_json_escaping() {
        assert_eq!(
            build_global_call_js("sbRuntime.evalLua", "1 + 1"),
            r#"sbRuntime.evalLua("1 + 1")"#
        );
        // Quotes / newlines in the argument are JSON-escaped, not injected raw.
        assert_eq!(
            build_global_call_js("f", "print(\"hi\")\n"),
            r#"f("print(\"hi\")\n")"#
        );
    }

    /// A fake transport: records the JS it was asked to eval, returns a canned
    /// result, and has configurable readiness.
    struct FakeTransport {
        ready: bool,
        wait_result: Result<(), RuntimeError>,
        eval_result: Result<serde_json::Value, RuntimeError>,
        seen_js: Mutex<Vec<String>>,
        started: AtomicBool,
    }

    impl FakeTransport {
        fn ok(value: serde_json::Value) -> Self {
            Self {
                ready: true,
                wait_result: Ok(()),
                eval_result: Ok(value),
                seen_js: Mutex::new(Vec::new()),
                started: AtomicBool::new(false),
            }
        }
    }

    impl ClientTransport for FakeTransport {
        fn eval_js(&self, js: &str, _timeout: Duration) -> Result<serde_json::Value, RuntimeError> {
            self.seen_js.lock().unwrap().push(js.to_string());
            self.eval_result
                .as_ref()
                .map(|v| v.clone())
                .map_err(|e| match e {
                    RuntimeError::NotReady => RuntimeError::NotReady,
                    RuntimeError::Timeout => RuntimeError::Timeout,
                    RuntimeError::Transport(s) => RuntimeError::Transport(s.clone()),
                    RuntimeError::Eval(s) => RuntimeError::Eval(s.clone()),
                })
        }
        fn wait_ready(&self, _timeout: Duration) -> Result<(), RuntimeError> {
            match &self.wait_result {
                Ok(()) => Ok(()),
                Err(RuntimeError::NotReady) => Err(RuntimeError::NotReady),
                Err(RuntimeError::Timeout) => Err(RuntimeError::Timeout),
                Err(RuntimeError::Transport(s)) => Err(RuntimeError::Transport(s.clone())),
                Err(RuntimeError::Eval(s)) => Err(RuntimeError::Eval(s.clone())),
            }
        }
        fn is_ready(&self) -> bool {
            self.ready
        }
        fn ensure_started(&self) {
            self.started.store(true, Ordering::Relaxed);
        }
    }

    #[test]
    fn eval_global_calls_the_named_fn_and_passes_the_value_through() {
        let logs = LogBuffer::new();
        let envelope = serde_json::json!({ "result": 2 });
        let rt = ClientRuntime::new(FakeTransport::ok(envelope.clone()), logs);
        let out = rt
            .eval_global("sbRuntime.evalLua", "1 + 1", Duration::from_secs(5))
            .unwrap();
        // The transport's value is returned verbatim (no shaping at this layer).
        assert_eq!(out, envelope);
        let seen = rt.transport.seen_js.lock().unwrap();
        assert_eq!(seen[0], r#"sbRuntime.evalLua("1 + 1")"#);
    }

    #[test]
    fn not_ready_short_circuits_before_eval() {
        let logs = LogBuffer::new();
        let mut transport = FakeTransport::ok(serde_json::json!(null));
        transport.wait_result = Err(RuntimeError::NotReady);
        let rt = ClientRuntime::new(transport, logs);
        let err = rt
            .eval_global("sbRuntime.evalLua", "x", Duration::from_secs(1))
            .unwrap_err();
        assert!(matches!(err, RuntimeError::NotReady));
        // eval_js must NOT have been called.
        assert!(rt.transport.seen_js.lock().unwrap().is_empty());
    }

    #[test]
    fn logs_are_read_from_the_shared_buffer() {
        let logs = LogBuffer::new();
        logs.push(LogEntry {
            level: "log".into(),
            text: "hello".into(),
            timestamp: 1,
        });
        let rt = ClientRuntime::new(FakeTransport::ok(serde_json::json!(null)), logs);
        let got = rt.logs(100, None);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].text, "hello");
    }

    #[test]
    fn logs_nudges_a_lazy_transport_to_start() {
        // Reading logs must boot a lazily-launched runtime so console output
        // starts flowing (the `sb logs`-on-a-fresh-server fix).
        let logs = LogBuffer::new();
        let rt = ClientRuntime::new(FakeTransport::ok(serde_json::json!(null)), logs);
        let _ = rt.logs(100, None);
        assert!(rt.transport.started.load(Ordering::Relaxed));
    }

    #[test]
    fn ready_delegates_to_transport() {
        let logs = LogBuffer::new();
        let rt = ClientRuntime::new(FakeTransport::ok(serde_json::json!(null)), logs);
        assert!(rt.ready());
    }
}
