//! The shared upper layer, written and tested ONCE for every transport. It
//! builds the `sbRuntime.*` call snippet, delegates evaluation to the
//! transport, and serves the shared log buffer. Whatever the client function
//! returns is passed through verbatim — endpoint-specific shaping (e.g. the
//! objects string→JSON unwrap) lives in the handlers.

use std::time::{Duration, Instant};

use super::backend::{RuntimeBackend, RuntimeError};
use super::fullpage::{
    crop_plan, next_step, stitch, FullPageShot, SegmentMeta, Step, MAX_HEIGHT, MAX_SEGMENTS,
};
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

/// One full-page step: optionally scroll the editor scroller to `scrollTo`
/// and wait for the newly visible lines and widgets to render, then measure
/// the scroller. `original` is the scroll position before scrolling, so the
/// caller can restore it. `{ none: true }` means no scrollable editor.
const FULLPAGE_STEP_JS: &str = r##"(async (step) => {
  const frame = () => new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });
  const scroller = document.querySelector("#sb-editor > .cm-editor > .cm-scroller");
  if (!scroller || scroller.clientHeight === 0) return { none: true };
  const original = Math.round(scroller.scrollTop);
  if (step.scrollTo !== null) {
    scroller.scrollTop = step.scrollTo;
    if (!step.settle) return { original };
    await frame();
    await frame();
    const awaitRender = globalThis.sbRuntime && globalThis.sbRuntime.awaitRender;
    if (typeof awaitRender === "function") await awaitRender(5000);
    await frame();
  }
  const rect = scroller.getBoundingClientRect();
  const top = Math.max(0, Math.floor(rect.top));
  const bottom = Math.min(innerHeight, Math.floor(rect.bottom));
  const left = Math.max(0, Math.floor(rect.left));
  const right = Math.min(innerWidth, Math.ceil(rect.right));
  const scrollTop = Math.round(scroller.scrollTop);
  let contentEnd = scroller.scrollHeight;
  const content = scroller.querySelector(".cm-content");
  if (content) {
    const end = scrollTop + content.getBoundingClientRect().bottom - rect.top;
    contentEnd = Math.min(contentEnd, Math.ceil(end) + 24);
  }
  return { original, scrollTop, top, bottom, left, width: right - left, contentEnd };
})"##;

pub fn build_fullpage_step_js(scroll_to: Option<f64>, settle: bool) -> String {
    let arg = serde_json::json!({ "scrollTo": scroll_to, "settle": settle });
    format!("{FULLPAGE_STEP_JS}({arg})")
}

/// The scroller measured by `FULLPAGE_STEP_JS`, in whole CSS pixels.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScrollerMeasure {
    pub original: f64,
    pub scroll_top: f64,
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub width: f64,
    pub content_end: f64,
}

/// `Ok(None)` when the page has no scrollable editor (e.g. a media viewer).
pub(crate) fn parse_fullpage_step(
    value: &serde_json::Value,
) -> Result<Option<ScrollerMeasure>, RuntimeError> {
    if value.get("none").and_then(|n| n.as_bool()) == Some(true) {
        return Ok(None);
    }
    let measure: ScrollerMeasure = serde_json::from_value(value.clone())
        .map_err(|e| RuntimeError::Transport(format!("unexpected full-page measure: {e}")))?;
    if measure.bottom <= measure.top || measure.width <= 0.0 {
        return Ok(None);
    }
    Ok(Some(measure))
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

impl<T: ClientTransport> ClientRuntime<T> {
    fn measure_after_scroll(
        &self,
        scroll_to: f64,
        deadline: Instant,
    ) -> Result<Option<ScrollerMeasure>, RuntimeError> {
        let value = self.transport.eval_js(
            &build_fullpage_step_js(Some(scroll_to), true),
            remaining(deadline)?,
        )?;
        parse_fullpage_step(&value)
    }

    /// Scroll the editor from the top one screen at a time, capturing each
    /// screen, then stitch. Sets `original` once the editor has been scrolled.
    fn capture_full_page(
        &self,
        deadline: Instant,
        original: &mut Option<f64>,
    ) -> Result<FullPageShot, RuntimeError> {
        let Some(first) = self.measure_after_scroll(0.0, deadline)? else {
            // Nothing to scroll: a plain viewport capture is the whole page.
            let png = self.transport.capture(None, remaining(deadline)?)?;
            return Ok(FullPageShot {
                png,
                truncated: false,
            });
        };
        *original = Some(first.original);
        let mut segments = Vec::new();
        let mut captures = Vec::new();
        let mut measure = first;
        let mut prev_scroll_top = None;
        let truncated = loop {
            let header = if segments.is_empty() {
                measure.top
            } else {
                0.0
            };
            let clip = CaptureRect {
                x: measure.left,
                y: measure.top - header,
                width: measure.width,
                height: measure.bottom - measure.top + header,
            };
            captures.push(self.transport.capture(Some(clip), remaining(deadline)?)?);
            let seg = SegmentMeta {
                scroll_top: measure.scroll_top,
                view_height: measure.bottom - measure.top,
                header,
            };
            segments.push(seg);
            match next_step(seg, prev_scroll_top, measure.content_end, segments.len()) {
                Step::Done => break false,
                Step::Truncated => break true,
                Step::Scroll(target) => {
                    prev_scroll_top = Some(seg.scroll_top);
                    match self.measure_after_scroll(target, deadline)? {
                        Some(next) => measure = next,
                        None => break false,
                    }
                }
            }
        };
        let crops = crop_plan(&segments, measure.content_end);
        let png = stitch(&captures, &segments, &crops)?;
        Ok(FullPageShot { png, truncated })
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

    fn screenshot_full_page(&self, timeout: Duration) -> Result<FullPageShot, RuntimeError> {
        let deadline = Instant::now() + timeout;
        let mut original = None;
        let result = self.transport.wait_ready(timeout).and_then(|()| {
            self.transport
                .eval_js(&build_settle_js(None), remaining(deadline)?)?;
            self.capture_full_page(deadline, &mut original)
        });
        // Put the editor back where it was, even after a failure.
        if let Some(top) = original {
            let restore = build_fullpage_step_js(Some(top), false);
            let budget = remaining(deadline).unwrap_or(Duration::from_secs(2));
            if let Err(e) = self.transport.eval_js(&restore, budget) {
                tracing::warn!("restoring scroll position after full-page screenshot: {e}");
            }
        }
        match &result {
            Err(e) => tracing::warn!("runtime full-page screenshot failed: {e}"),
            Ok(shot) if shot.truncated => tracing::info!(
                "full-page screenshot truncated after {MAX_SEGMENTS} screens or {MAX_HEIGHT}px"
            ),
            Ok(_) => {}
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

    /// Replays scripted eval results in order and captures blank PNGs of
    /// the requested clip size, recording every JS snippet and clip.
    struct ScriptedTransport {
        evals: Mutex<std::collections::VecDeque<serde_json::Value>>,
        seen_js: Mutex<Vec<String>>,
        clips: Mutex<Vec<Option<CaptureRect>>>,
    }

    impl ScriptedTransport {
        fn new(evals: Vec<serde_json::Value>) -> Self {
            Self {
                evals: Mutex::new(evals.into()),
                seen_js: Mutex::new(Vec::new()),
                clips: Mutex::new(Vec::new()),
            }
        }
    }

    fn blank_png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        let mut writer = encoder.write_header().unwrap();
        writer
            .write_image_data(&vec![255; (width * height * 4) as usize])
            .unwrap();
        writer.finish().unwrap();
        out
    }

    impl ClientTransport for ScriptedTransport {
        fn eval_js(&self, js: &str, _: Duration) -> Result<serde_json::Value, RuntimeError> {
            self.seen_js.lock().unwrap().push(js.to_string());
            Ok(self
                .evals
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(serde_json::json!({})))
        }
        fn wait_ready(&self, _: Duration) -> Result<(), RuntimeError> {
            Ok(())
        }
        fn is_ready(&self) -> bool {
            true
        }
        fn capture(&self, clip: Option<CaptureRect>, _: Duration) -> Result<Vec<u8>, RuntimeError> {
            self.clips.lock().unwrap().push(clip);
            let (w, h) = clip.map_or((8, 6), |c| (c.width as u32, c.height as u32));
            Ok(blank_png(w, h))
        }
    }

    fn measure(original: f64, scroll_top: f64, content_end: f64) -> serde_json::Value {
        serde_json::json!({"original": original, "scrollTop": scroll_top, "top": 10,
            "bottom": 110, "left": 0, "width": 2, "contentEnd": content_end})
    }

    #[test]
    fn full_page_scrolls_captures_stitches_and_restores() {
        let transport = ScriptedTransport::new(vec![
            serde_json::json!({"clip": null}),
            measure(333.0, 0.0, 250.0),
            measure(0.0, 60.0, 250.0),
            measure(60.0, 120.0, 250.0),
            // Clamped at the maximum scroll position.
            measure(120.0, 150.0, 250.0),
            serde_json::json!({"original": 150}),
        ]);
        let rt = ClientRuntime::new(transport, LogBuffer::new());
        let shot = rt.screenshot_full_page(Duration::from_secs(5)).unwrap();
        assert!(!shot.truncated);
        assert_eq!(
            crate::runtime::fullpage::tests_png_size(&shot.png),
            (2, 10 + 250)
        );
        let clips = rt.transport.clips.lock().unwrap();
        assert_eq!(clips.len(), 4);
        // The first capture includes the top bar, later ones only the scroller.
        assert_eq!(clips[0].unwrap().y, 0.0);
        assert_eq!(clips[0].unwrap().height, 110.0);
        assert_eq!(clips[1].unwrap().y, 10.0);
        assert_eq!(clips[1].unwrap().height, 100.0);
        let js = rt.transport.seen_js.lock().unwrap();
        assert!(
            js[1].ends_with(r#"({"scrollTo":0.0,"settle":true})"#),
            "{}",
            js[1]
        );
        assert!(js[2].contains(r#""scrollTo":60.0"#));
        assert!(
            js[5].ends_with(r#"({"scrollTo":333.0,"settle":false})"#),
            "{}",
            js[5]
        );
    }

    #[test]
    fn full_page_reports_truncation() {
        let mut evals = vec![serde_json::json!({"clip": null})];
        for i in 0..crate::runtime::fullpage::MAX_SEGMENTS {
            evals.push(measure(0.0, (i * 60) as f64, 1_000_000.0));
        }
        let rt = ClientRuntime::new(ScriptedTransport::new(evals), LogBuffer::new());
        let shot = rt.screenshot_full_page(Duration::from_secs(5)).unwrap();
        assert!(shot.truncated);
        assert_eq!(
            rt.transport.clips.lock().unwrap().len(),
            crate::runtime::fullpage::MAX_SEGMENTS
        );
    }

    #[test]
    fn full_page_without_an_editor_captures_the_viewport() {
        let transport = ScriptedTransport::new(vec![
            serde_json::json!({"clip": null}),
            serde_json::json!({"none": true}),
        ]);
        let rt = ClientRuntime::new(transport, LogBuffer::new());
        let shot = rt.screenshot_full_page(Duration::from_secs(5)).unwrap();
        assert!(!shot.truncated);
        assert_eq!(*rt.transport.clips.lock().unwrap(), vec![None]);
        // Nothing was scrolled, so nothing is restored.
        assert_eq!(rt.transport.seen_js.lock().unwrap().len(), 2);
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
