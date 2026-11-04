use crate::runtime::{LogEntry, RuntimeBackend, RuntimeError};
use crate::state::ServerState;
use crate::test_support::test_state;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower::ServiceExt;

/// A `RuntimeBackend` we drive directly (no transport) for handler tests.
struct FakeBackend {
    eval: Result<serde_json::Value, RuntimeErrorKind>,
    logs: Vec<LogEntry>,
    calls: Arc<Mutex<Vec<(String, String)>>>,
    shot: Result<Vec<u8>, ShotError>,
    truncated: bool,
    settle: Settle,
    /// What `enabled()` answers: false while the admin toggle is off.
    enabled: bool,
    /// `for_actor` refuses the caller.
    refuse: bool,
}
/// How the fake answers `index.awaitPendingChanges()`.
#[derive(Clone, Copy)]
enum Settle {
    Ok,
    Fail,
    /// Longer than any budget the tests give it.
    Hang,
}
#[derive(Clone)]
enum ShotError {
    Missing,
    Invalid,
    Timeout,
}
/// A `Clone`-able error description (RuntimeError isn't Clone).
#[derive(Clone)]
enum RuntimeErrorKind {
    NotReady,
    Timeout,
    Eval,
}
impl FakeBackend {
    fn returning(value: serde_json::Value) -> Self {
        Self {
            eval: Ok(value),
            logs: vec![],
            calls: Arc::new(Mutex::new(vec![])),
            shot: Ok(b"\x89PNG\r\n\x1a\nrest".to_vec()),
            truncated: false,
            settle: Settle::Ok,
            enabled: true,
            refuse: false,
        }
    }
    fn failing(kind: RuntimeErrorKind) -> Self {
        Self {
            eval: Err(kind),
            logs: vec![],
            calls: Arc::new(Mutex::new(vec![])),
            shot: Ok(b"\x89PNG\r\n\x1a\nrest".to_vec()),
            truncated: false,
            settle: Settle::Ok,
            enabled: true,
            refuse: false,
        }
    }
    fn err(&self) -> RuntimeError {
        match self.eval.as_ref().err().unwrap() {
            RuntimeErrorKind::NotReady => RuntimeError::NotReady,
            RuntimeErrorKind::Timeout => RuntimeError::Timeout,
            RuntimeErrorKind::Eval => RuntimeError::Eval("attempt to call a nil value".into()),
        }
    }
}
impl RuntimeBackend for FakeBackend {
    fn eval_global(
        &self,
        fn_name: &str,
        arg: &str,
        _t: Duration,
    ) -> Result<serde_json::Value, RuntimeError> {
        self.calls
            .lock()
            .unwrap()
            .push((fn_name.to_string(), arg.to_string()));
        if arg == super::AWAIT_CODE {
            return match self.settle {
                Settle::Ok => Ok(serde_json::Value::Null),
                Settle::Fail => Err(RuntimeError::Eval("index failed".into())),
                // Overruns the budget it was given, as a stuck runtime would.
                Settle::Hang => {
                    std::thread::sleep(_t + Duration::from_millis(500));
                    Ok(serde_json::Value::Null)
                }
            };
        }
        self.eval.clone().map_err(|_| self.err())
    }
    fn screenshot(&self, selector: Option<&str>, _t: Duration) -> Result<Vec<u8>, RuntimeError> {
        self.calls
            .lock()
            .unwrap()
            .push(("screenshot".into(), selector.unwrap_or("").into()));
        self.shot.clone().map_err(|e| match e {
            ShotError::Missing => RuntimeError::SelectorNotFound("no match".into()),
            ShotError::Invalid => RuntimeError::InvalidSelector("invalid selector: bad".into()),
            ShotError::Timeout => RuntimeError::Timeout,
        })
    }
    fn screenshot_full_page(
        &self,
        _t: Duration,
    ) -> Result<crate::runtime::fullpage::FullPageShot, RuntimeError> {
        self.calls
            .lock()
            .unwrap()
            .push(("screenshot_full_page".into(), String::new()));
        Ok(crate::runtime::fullpage::FullPageShot {
            png: b"\x89PNG\r\n\x1a\nfull".to_vec(),
            truncated: self.truncated,
        })
    }
    fn logs(&self, _limit: usize, _since: Option<i64>) -> Vec<LogEntry> {
        self.logs.clone()
    }
    fn ready(&self) -> bool {
        true
    }
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn for_actor(
        &self,
        _actor: &crate::auth::Actor,
    ) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
        if self.refuse {
            Err(RuntimeError::Forbidden)
        } else {
            Ok(None)
        }
    }
}

fn state_with_runtime(backend: Option<Box<dyn RuntimeBackend>>) -> Arc<ServerState> {
    let mut s = test_state();
    s.runtime = backend.map(Arc::from);
    Arc::new(s)
}

async fn post_lua(state: Arc<ServerState>, body: &str) -> (StatusCode, String) {
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/.runtime/lua")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

#[tokio::test]
async fn no_backend_returns_503_not_enabled() {
    let (status, body) = post_lua(state_with_runtime(None), "1 + 1").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.contains("not enabled"), "{body}");
}

#[tokio::test]
async fn eval_success_returns_envelope_200() {
    let backend = FakeBackend::returning(serde_json::json!(2));
    let calls = backend.calls.clone();
    let (status, body) = post_lua(state_with_runtime(Some(Box::new(backend))), "1 + 1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, r#"{"result":2}"#);
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[("sbRuntime.evalLua".into(), "1 + 1".into())]
    );
}

#[tokio::test]
async fn script_endpoint_uses_script_evaluator() {
    let backend = FakeBackend::returning(serde_json::json!(null));
    let calls = backend.calls.clone();
    let state = state_with_runtime(Some(Box::new(backend)));
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/.runtime/lua_script")
                .body(Body::from("value = 1"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[("sbRuntime.evalLuaScript".into(), "value = 1".into())]
    );
}

#[tokio::test]
async fn empty_body_is_400() {
    let backend = Box::new(FakeBackend::returning(serde_json::json!(null)));
    let (status, _) = post_lua(state_with_runtime(Some(backend)), "   ").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn not_ready_maps_to_503_bridge_unavailable() {
    let backend = Box::new(FakeBackend::failing(RuntimeErrorKind::NotReady));
    let (status, body) = post_lua(state_with_runtime(Some(backend)), "x").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.contains("bridge_unavailable"), "{body}");
}

#[tokio::test]
async fn eval_error_maps_to_500_with_clean_message() {
    let backend = Box::new(FakeBackend::failing(RuntimeErrorKind::Eval));
    let (status, body) = post_lua(state_with_runtime(Some(backend)), "editor.reload()").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body.contains("script_error"), "{body}");
    assert!(
        body.contains(r#""error":"attempt to call a nil value""#),
        "{body}"
    );
}

#[tokio::test]
async fn timeout_maps_to_504() {
    let backend = Box::new(FakeBackend::failing(RuntimeErrorKind::Timeout));
    let (status, body) = post_lua(state_with_runtime(Some(backend)), "x").await;
    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
    assert!(body.contains("timeout"), "{body}");
}

#[tokio::test]
async fn logs_endpoint_wraps_entries() {
    let mut backend = FakeBackend::returning(serde_json::json!(null));
    backend.logs = vec![LogEntry {
        level: "log".into(),
        text: "hi".into(),
        timestamp: 1,
    }];
    let state = state_with_runtime(Some(Box::new(backend)));
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .uri("/.runtime/logs?limit=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"logs": [{"level": "log", "text": "hi", "timestamp": 1}]})
    );
}

#[tokio::test]
async fn logs_without_backend_is_503() {
    let state = state_with_runtime(None);
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .uri("/.runtime/logs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

async fn get_screenshot(
    state: Arc<ServerState>,
    query: &str,
) -> (StatusCode, Option<String>, Vec<u8>) {
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .uri(format!("/.runtime/screenshot{query}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let content_type = resp
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, content_type, bytes)
}

#[tokio::test]
async fn screenshot_returns_png_and_passes_selector() {
    let backend = FakeBackend::returning(serde_json::json!(null));
    let calls = backend.calls.clone();
    let (status, ct, body) = get_screenshot(
        state_with_runtime(Some(Box::new(backend))),
        "?selector=%23sb-top",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ct.as_deref(), Some("image/png"));
    assert!(body.starts_with(b"\x89PNG"));
    assert_eq!(
        calls.lock().unwrap()[0],
        ("screenshot".to_string(), "#sb-top".to_string())
    );
}

#[tokio::test]
async fn screenshot_empty_selector_means_viewport() {
    let backend = FakeBackend::returning(serde_json::json!(null));
    let calls = backend.calls.clone();
    let (status, _, _) =
        get_screenshot(state_with_runtime(Some(Box::new(backend))), "?selector=").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(calls.lock().unwrap()[0].1, "");
}

#[tokio::test]
async fn screenshot_errors_map_to_status_and_code() {
    for (error, status, code) in [
        (
            ShotError::Missing,
            StatusCode::NOT_FOUND,
            "selector_not_found",
        ),
        (
            ShotError::Invalid,
            StatusCode::BAD_REQUEST,
            "invalid_selector",
        ),
        (ShotError::Timeout, StatusCode::GATEWAY_TIMEOUT, "timeout"),
    ] {
        let mut backend = FakeBackend::returning(serde_json::json!(null));
        backend.shot = Err(error);
        let (got, ct, body) =
            get_screenshot(state_with_runtime(Some(Box::new(backend))), "?selector=x").await;
        assert_eq!(got, status);
        assert_eq!(ct.as_deref(), Some("application/json"));
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["code"], code);
    }
}

async fn get_full_page(backend: FakeBackend, query: &str) -> (StatusCode, Option<String>, Vec<u8>) {
    let resp = crate::build_router(state_with_runtime(Some(Box::new(backend))))
        .oneshot(
            Request::builder()
                .uri(format!("/.runtime/screenshot{query}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let truncated = resp
        .headers()
        .get(super::TRUNCATED_HEADER)
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, truncated, bytes)
}

#[tokio::test]
async fn full_page_query_calls_the_full_page_capture() {
    for query in ["?fullPage=1", "?fullPage=true"] {
        let backend = FakeBackend::returning(serde_json::json!(null));
        let calls = backend.calls.clone();
        let (status, truncated, body) = get_full_page(backend, query).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(truncated, None);
        assert!(body.ends_with(b"full"));
        assert_eq!(calls.lock().unwrap()[0].0, "screenshot_full_page");
    }
}

#[tokio::test]
async fn full_page_off_values_take_a_plain_screenshot() {
    for query in ["?fullPage=0", "?fullPage=", "?fullPage=false"] {
        let backend = FakeBackend::returning(serde_json::json!(null));
        let calls = backend.calls.clone();
        let (status, _, _) = get_full_page(backend, query).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(calls.lock().unwrap()[0].0, "screenshot");
    }
}

#[tokio::test]
async fn truncated_full_page_sets_the_header() {
    let mut backend = FakeBackend::returning(serde_json::json!(null));
    backend.truncated = true;
    let (status, truncated, _) = get_full_page(backend, "?fullPage=1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(truncated.as_deref(), Some("true"));
}

#[tokio::test]
async fn full_page_with_selector_is_rejected() {
    let backend = FakeBackend::returning(serde_json::json!(null));
    let calls = backend.calls.clone();
    let (status, _, body) = get_full_page(backend, "?fullPage=1&selector=%23sb-top").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["code"], "invalid_request");
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn screenshot_without_backend_is_503() {
    let (status, _, _) = get_screenshot(state_with_runtime(None), "").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

/// A state whose pages are followed, so catch-up has something to count.
fn followed(backend: FakeBackend) -> ServerState {
    let mut s = test_state();
    s.runtime = Some(Arc::new(backend));
    let view = crate::search::SpaceSearchView::new(
        Arc::new(silverbullet_server_common::space::MemorySpacePrimitives::new()),
        silverbullet_server_common::space::GitignoreMatcher::default(),
    );
    s.page_watch = Arc::new(crate::page_watch::PageWatch::new(Some(
        crate::search::PageSource::new(Arc::new(view), tokio::sync::broadcast::channel(4).0),
    )));
    s
}

async fn send(
    state: Arc<ServerState>,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, Option<String>) {
    let mut request = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let body = if method == "POST" {
        Body::from("1 + 1")
    } else {
        Body::empty()
    };
    let resp = crate::build_router(state)
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let index = resp
        .headers()
        .get("x-index-status")
        .map(|v| v.to_str().unwrap().to_string());
    (resp.status(), index)
}

fn awaits(calls: &Mutex<Vec<(String, String)>>) -> usize {
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, arg)| arg == super::AWAIT_CODE)
        .count()
}

const AWAIT: (&str, &str) = ("X-Await-Index", "1");

#[tokio::test]
async fn await_index_header_runs_await_pending_changes_once_when_dirty() {
    let backend = FakeBackend::returning(serde_json::json!(2));
    let calls = backend.calls.clone();
    let state = Arc::new(followed(backend));
    for uri in ["/.runtime/lua", "/.runtime/lua_script"] {
        let (status, index) = send(state.clone(), "POST", uri, &[AWAIT]).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(index.as_deref(), Some("caught-up"));
    }
    assert_eq!(awaits(&calls), 1);
    assert_eq!(calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn no_header_means_no_catch_up_and_no_status_header() {
    let backend = FakeBackend::returning(serde_json::json!(2));
    let calls = backend.calls.clone();
    let (status, index) = send(Arc::new(followed(backend)), "POST", "/.runtime/lua", &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index, None);
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[("sbRuntime.evalLua".into(), "1 + 1".into())]
    );
}

#[tokio::test]
async fn without_page_source_reports_unknown() {
    let backend = FakeBackend::returning(serde_json::json!(2));
    let calls = backend.calls.clone();
    let state = state_with_runtime(Some(Box::new(backend)));
    let (status, index) = send(state, "POST", "/.runtime/lua", &[AWAIT]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index.as_deref(), Some("unknown"));
    assert_eq!(awaits(&calls), 0);
}

#[tokio::test]
async fn without_runtime_still_reports_a_status() {
    let (status, index) = send(state_with_runtime(None), "POST", "/.runtime/lua", &[AWAIT]).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(index.as_deref(), Some("unknown"));
}

#[tokio::test]
async fn polling_watcher_reports_polling() {
    let backend = FakeBackend::returning(serde_json::json!(2));
    let calls = backend.calls.clone();
    let state = followed(backend);
    state
        .fs_guard
        .watched(crate::watcher::WatchMode::Poll(Duration::from_secs(60)));
    let state = Arc::new(state);
    for _ in 0..2 {
        let (status, index) = send(state.clone(), "POST", "/.runtime/lua", &[AWAIT]).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(index.as_deref(), Some("polling"));
    }
    // A poll can bring changes nothing announced, so each call asks.
    assert_eq!(awaits(&calls), 2);
}

#[tokio::test]
async fn failed_catch_up_reports_behind_and_still_runs_the_request() {
    let mut backend = FakeBackend::returning(serde_json::json!(2));
    backend.settle = Settle::Fail;
    let calls = backend.calls.clone();
    let state = Arc::new(followed(backend));
    for _ in 0..2 {
        let (status, index) = send(state.clone(), "POST", "/.runtime/lua", &[AWAIT]).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(index.as_deref(), Some("behind"));
    }
    // A failed catch-up is not recorded: the next call tries again.
    assert_eq!(awaits(&calls), 2);
    assert_eq!(
        calls.lock().unwrap().last().unwrap(),
        &("sbRuntime.evalLua".to_string(), "1 + 1".to_string())
    );
}

#[tokio::test]
async fn catch_up_respects_x_timeout_budget() {
    let mut backend = FakeBackend::returning(serde_json::json!(2));
    backend.settle = Settle::Hang;
    let started = std::time::Instant::now();
    let (status, index) = send(
        Arc::new(followed(backend)),
        "POST",
        "/.runtime/lua",
        &[AWAIT, ("X-Timeout", "2")],
    )
    .await;
    let elapsed = started.elapsed();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index.as_deref(), Some("behind"));
    assert!(elapsed >= Duration::from_millis(1900), "{elapsed:?}");
    assert!(elapsed < Duration::from_millis(3000), "{elapsed:?}");
}

#[tokio::test]
async fn screenshot_accepts_await_index() {
    let backend = FakeBackend::returning(serde_json::json!(null));
    let calls = backend.calls.clone();
    let (status, index) = send(
        Arc::new(followed(backend)),
        "GET",
        "/.runtime/screenshot",
        &[AWAIT],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index.as_deref(), Some("caught-up"));
    let calls = calls.lock().unwrap();
    assert_eq!(calls[0].1, super::AWAIT_CODE);
    assert_eq!(calls[1].0, "screenshot");
}

#[tokio::test]
async fn a_disabled_runtime_answers_not_enabled_everywhere() {
    let mut backend = FakeBackend::returning(serde_json::json!(2));
    backend.enabled = false;
    let calls = backend.calls.clone();
    let state = Arc::new(followed(backend));
    for (method, uri) in [
        ("POST", "/.runtime/lua"),
        ("POST", "/.runtime/lua_script"),
        ("GET", "/.runtime/logs"),
        ("GET", "/.runtime/screenshot"),
    ] {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("X-Await-Index", "1");
        if method == "GET" {
            request = request.header("content-length", "0");
        }
        let body = if method == "POST" { "1 + 1" } else { "" };
        let resp = crate::build_router(state.clone())
            .oneshot(request.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            serde_json::json!({ "error": "Runtime API is not enabled" }),
            "{uri}"
        );
    }
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_refused_catch_up_reports_unknown() {
    let mut backend = FakeBackend::returning(serde_json::json!(2));
    backend.refuse = true;
    let (status, index) = send(
        Arc::new(followed(backend)),
        "POST",
        "/.runtime/lua",
        &[AWAIT],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(index.as_deref(), Some("unknown"));
}
