//! The shared upper layer, written and tested ONCE for every transport. It
//! builds the `sbRuntime.*` call snippet, delegates evaluation to the
//! transport, and serves the shared log buffer. Whatever the client function
//! returns is passed through verbatim — endpoint-specific shaping (e.g. the
//! objects string→JSON unwrap) lives in the handlers.

use std::time::{Duration, Instant};

use super::backend::{RuntimeBackend, RuntimeError};
use super::logs::{LogBuffer, LogEntry};
use super::transport::{CaptureRect, ClientTransport};

/// Build the JS expression that invokes a global function with a single
/// JSON-encoded string argument. The transport awaits the returned promise and
/// extracts its JSON value.
///
/// `build_global_call_js("sbRuntime.evalLua", "1 + 1")` → `sbRuntime.evalLua("1 + 1")`.
pub fn build_global_call_js(fn_name: &str, arg: &str) -> String {
    let arg_json = serde_json::to_string(arg).unwrap_or_else(|_| "\"\"".to_string());
    format!("{fn_name}({arg_json})")
}

const SETTLE_JS: &str = r#"(async (selector) => {
  const frame = () => new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });
  await document.fonts.ready;
  await frame();
  await frame();
  if (selector === null) return { clip: null };
  let element;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    return { invalid: String((error && error.message) || error) };
  }
  if (!element) return { missing: true };
  element.scrollIntoView({ block: "nearest" });
  await frame();
  const rect = element.getBoundingClientRect();
  const left = Math.floor(Math.max(0, rect.left));
  const top = Math.floor(Math.max(0, rect.top));
  const right = Math.ceil(Math.min(innerWidth, rect.right));
  const bottom = Math.ceil(Math.min(innerHeight, rect.bottom));
  if (right <= left || bottom <= top) return { missing: true };
  return { clip: { x: left, y: top, width: right - left, height: bottom - top } };
})"#;

/// Build the JS that waits for rendering to settle and, given a selector,
/// resolves the element's rectangle clipped to the viewport in whole CSS
/// pixels. Hidden windows throttle `requestAnimationFrame`, so each frame wait
/// also races a short timer.
pub fn build_settle_js(selector: Option<&str>) -> String {
    let arg = serde_json::to_string(&selector).unwrap_or_else(|_| "null".to_string());
    format!("{SETTLE_JS}({arg})")
}

pub(crate) fn parse_settle_result(
    value: &serde_json::Value,
) -> Result<Option<CaptureRect>, RuntimeError> {
    if let Some(message) = value.get("invalid").and_then(|m| m.as_str()) {
        return Err(RuntimeError::InvalidSelector(format!(
            "invalid selector: {message}"
        )));
    }
    if value.get("missing").and_then(|m| m.as_bool()) == Some(true) {
        return Err(RuntimeError::SelectorNotFound(
            "no visible element matches the selector".into(),
        ));
    }
    match value.get("clip") {
        Some(serde_json::Value::Null) => Ok(None),
        Some(clip) => serde_json::from_value(clip.clone())
            .map(Some)
            .map_err(|e| RuntimeError::Transport(format!("invalid capture rectangle: {e}"))),
        None => Err(RuntimeError::Transport(
            "unexpected screenshot settle result".into(),
        )),
    }
}

fn remaining(deadline: Instant) -> Result<Duration, RuntimeError> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        Err(RuntimeError::Timeout)
    } else {
        Ok(left)
    }
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
        // Log all runtime API failures here, including client-side Lua errors.
        let result = self.transport.wait_ready(timeout).and_then(|()| {
            self.transport
                .eval_js(&build_global_call_js(fn_name, arg), timeout)
        });
        if let Err(e) = &result {
            tracing::warn!("runtime call {fn_name} failed: {e}");
        }
        result
    }

    fn screenshot(
        &self,
        selector: Option<&str>,
        timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        let deadline = Instant::now() + timeout;
        let result = self.transport.wait_ready(timeout).and_then(|()| {
            let settled = self
                .transport
                .eval_js(&build_settle_js(selector), remaining(deadline)?)?;
            let clip = parse_settle_result(&settled)?;
            self.transport.capture(clip, remaining(deadline)?)
        });
        if let Err(e) = &result {
            tracing::warn!("runtime screenshot failed: {e}");
        }
        result
    }

    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        // A log read must start a lazy runtime or sb logs --follow can wait forever.
        self.transport.ensure_started();
        self.logs.query(limit, since)
    }

    fn ready(&self) -> bool {
        self.transport.is_ready()
    }

    fn snapshot(&self) -> Option<super::RuntimeSnapshot> {
        self.transport.snapshot()
    }
    fn stop(&self, retain_profile: bool) -> Result<(), RuntimeError> {
        self.transport.stop(retain_profile)
    }
    fn restart(
        &self,
        token: &str,
    ) -> Result<Option<std::sync::Arc<dyn RuntimeBackend>>, RuntimeError> {
        let logs = LogBuffer::new();
        Ok(self
            .transport
            .restart(token, logs.clone())?
            .map(|transport| {
                std::sync::Arc::new(ClientRuntime::new(transport, logs))
                    as std::sync::Arc<dyn RuntimeBackend>
            }))
    }
    fn shutdown(&self) {
        self.transport.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use crate::runtime::transport::CaptureRect;

    #[test]
    fn unsupported_management_cannot_report_success() {
        let runtime =
            ClientRuntime::new(FakeTransport::ok(serde_json::json!(null)), LogBuffer::new());
        assert!(runtime.snapshot().is_none());
        assert!(runtime.stop(true).is_err());
        assert!(runtime.restart("fresh-token").is_err());
    }

    #[test]
    fn builds_call_snippet_with_json_escaping() {
        assert_eq!(
            build_global_call_js("sbRuntime.evalLua", "1 + 1"),
            r#"sbRuntime.evalLua("1 + 1")"#
        );
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
        captures: Mutex<Vec<(Option<CaptureRect>, Duration)>>,
        eval_delay: Duration,
    }

    impl FakeTransport {
        fn ok(value: serde_json::Value) -> Self {
            Self {
                ready: true,
                wait_result: Ok(()),
                eval_result: Ok(value),
                seen_js: Mutex::new(Vec::new()),
                started: AtomicBool::new(false),
                captures: Mutex::new(Vec::new()),
                eval_delay: Duration::ZERO,
            }
        }
    }

    impl ClientTransport for FakeTransport {
        fn eval_js(&self, js: &str, _timeout: Duration) -> Result<serde_json::Value, RuntimeError> {
            std::thread::sleep(self.eval_delay);
            self.seen_js.lock().unwrap().push(js.to_string());
            self.eval_result
                .as_ref()
                .map(|v| v.clone())
                .map_err(|e| match e {
                    RuntimeError::Forbidden => RuntimeError::Forbidden,
                    RuntimeError::NotReady => RuntimeError::NotReady,
                    RuntimeError::Timeout => RuntimeError::Timeout,
                    RuntimeError::Transport(s) => RuntimeError::Transport(s.clone()),
                    RuntimeError::Eval(s) => RuntimeError::Eval(s.clone()),
                    RuntimeError::SelectorNotFound(s) => RuntimeError::SelectorNotFound(s.clone()),
                    RuntimeError::InvalidSelector(s) => RuntimeError::InvalidSelector(s.clone()),
                })
        }
        fn wait_ready(&self, _timeout: Duration) -> Result<(), RuntimeError> {
            match &self.wait_result {
                Ok(()) => Ok(()),
                Err(RuntimeError::Forbidden) => Err(RuntimeError::Forbidden),
                Err(RuntimeError::NotReady) => Err(RuntimeError::NotReady),
                Err(RuntimeError::Timeout) => Err(RuntimeError::Timeout),
                Err(RuntimeError::Transport(s)) => Err(RuntimeError::Transport(s.clone())),
                Err(RuntimeError::Eval(s)) => Err(RuntimeError::Eval(s.clone())),
                Err(RuntimeError::SelectorNotFound(s)) => {
                    Err(RuntimeError::SelectorNotFound(s.clone()))
                }
                Err(RuntimeError::InvalidSelector(s)) => {
                    Err(RuntimeError::InvalidSelector(s.clone()))
                }
            }
        }
        fn is_ready(&self) -> bool {
            self.ready
        }
        fn ensure_started(&self) {
            self.started.store(true, Ordering::Relaxed);
        }
        fn capture(
            &self,
            clip: Option<CaptureRect>,
            timeout: Duration,
        ) -> Result<Vec<u8>, RuntimeError> {
            self.captures.lock().unwrap().push((clip, timeout));
            Ok(b"\x89PNGfake".to_vec())
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
        // Log reads must start a lazy runtime even before the first eval.
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

    #[test]
    fn settle_js_embeds_selector_json_escaped() {
        let js = build_settle_js(Some(r#"a[title="x\"y"]</script>"#));
        assert!(js.ends_with(r#"("a[title=\"x\\\"y\"]</script>")"#), "{js}");
        assert!(build_settle_js(None).ends_with("(null)"));
    }

    #[test]
    fn settle_result_maps_each_shape() {
        use serde_json::json;
        assert_eq!(parse_settle_result(&json!({"clip": null})).unwrap(), None);
        assert_eq!(
            parse_settle_result(
                &json!({"clip": {"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0}})
            )
            .unwrap(),
            Some(CaptureRect {
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0
            })
        );
        assert!(matches!(
            parse_settle_result(&json!({"missing": true})),
            Err(RuntimeError::SelectorNotFound(_))
        ));
        assert!(matches!(
            parse_settle_result(&json!({"invalid": "'[[' is not a valid selector"})),
            Err(RuntimeError::InvalidSelector(m)) if m.contains("not a valid selector")
        ));
        assert!(matches!(
            parse_settle_result(&json!(42)),
            Err(RuntimeError::Transport(_))
        ));
    }

    #[test]
    fn screenshot_settles_then_captures_the_clip() {
        let rect =
            serde_json::json!({"clip": {"x": 0.0, "y": 10.0, "width": 50.0, "height": 20.0}});
        let rt = ClientRuntime::new(FakeTransport::ok(rect), LogBuffer::new());
        let png = rt
            .screenshot(Some("#sb-top"), Duration::from_secs(5))
            .unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        assert!(rt.transport.seen_js.lock().unwrap()[0].contains(r##""#sb-top""##));
        let captures = rt.transport.captures.lock().unwrap();
        assert_eq!(
            captures[0].0,
            Some(CaptureRect {
                x: 0.0,
                y: 10.0,
                width: 50.0,
                height: 20.0
            })
        );
    }

    #[test]
    fn screenshot_missing_selector_does_not_capture() {
        let rt = ClientRuntime::new(
            FakeTransport::ok(serde_json::json!({"missing": true})),
            LogBuffer::new(),
        );
        let err = rt
            .screenshot(Some(".nope"), Duration::from_secs(5))
            .unwrap_err();
        assert!(matches!(err, RuntimeError::SelectorNotFound(_)));
        assert!(rt.transport.captures.lock().unwrap().is_empty());
    }

    #[test]
    fn screenshot_with_spent_deadline_times_out_before_capture() {
        let mut transport = FakeTransport::ok(serde_json::json!({"clip": null}));
        transport.eval_delay = Duration::from_millis(60);
        let rt = ClientRuntime::new(transport, LogBuffer::new());
        let err = rt.screenshot(None, Duration::from_millis(50)).unwrap_err();
        assert!(matches!(err, RuntimeError::Timeout));
        assert!(rt.transport.captures.lock().unwrap().is_empty());
    }

    #[test]
    fn default_transport_capture_is_unsupported() {
        struct Bare;
        impl ClientTransport for Bare {
            fn eval_js(&self, _: &str, _: Duration) -> Result<serde_json::Value, RuntimeError> {
                Ok(serde_json::json!({"clip": null}))
            }
            fn wait_ready(&self, _: Duration) -> Result<(), RuntimeError> {
                Ok(())
            }
            fn is_ready(&self) -> bool {
                true
            }
        }
        let rt = ClientRuntime::new(Bare, LogBuffer::new());
        assert!(matches!(
            rt.screenshot(None, Duration::from_secs(1)),
            Err(RuntimeError::Transport(m)) if m.contains("unsupported")
        ));
    }
}
