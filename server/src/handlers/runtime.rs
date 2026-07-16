//! `/.runtime/{lua,lua_script,logs}` — bridge HTTP to the Lua `RuntimeBackend`.
//! When no backend is configured the runtime API is "not enabled" and every
//! endpoint returns 503 (the per-space runtime gate).

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::runtime::RuntimeError;
use crate::state::ServerState;

const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// `X-Timeout` is a whole number of **seconds** (default 30), matching the
/// legacy standalone server.
pub(crate) fn parse_timeout(headers: &HeaderMap) -> Duration {
    headers
        .get("X-Timeout")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|s| *s > 0)
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
}

fn not_enabled() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "Runtime API is not enabled" })),
    )
        .into_response()
}

fn runtime_error_response(e: RuntimeError) -> Response {
    let (status, code) = match e {
        RuntimeError::NotReady | RuntimeError::Transport(_) => {
            (StatusCode::SERVICE_UNAVAILABLE, "bridge_unavailable")
        }
        RuntimeError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "timeout"),
        // The evaluated code threw (e.g. a Lua error): a user-level failure, not
        // a bridge outage — 500 with the clean message, per `Runtime API.md`.
        RuntimeError::Eval(_) => (StatusCode::INTERNAL_SERVER_ERROR, "script_error"),
    };
    (
        status,
        Json(json!({ "error": e.to_string(), "code": code })),
    )
        .into_response()
}

#[derive(Clone, Copy)]
enum EvalKind {
    Lua,
    Script,
}

pub async fn handle_runtime_lua(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    runtime_eval(state, headers, body, EvalKind::Lua).await
}

pub async fn handle_runtime_lua_script(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    runtime_eval(state, headers, body, EvalKind::Script).await
}

async fn runtime_eval(
    state: Arc<ServerState>,
    headers: HeaderMap,
    body: Bytes,
    kind: EvalKind,
) -> Response {
    // Counted on entry (the eval endpoints only).
    if let Some(metrics) = state.metrics.as_ref() {
        metrics.runtime_api_requests.inc();
    }
    if state.runtime.is_none() {
        return not_enabled();
    }
    let code = String::from_utf8_lossy(&body).trim().to_string();
    if code.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Request body is required" })),
        )
            .into_response();
    }
    let timeout = parse_timeout(&headers);
    let fn_name = match kind {
        EvalKind::Lua => "sbRuntime.evalLua",
        EvalKind::Script => "sbRuntime.evalLuaScript",
    };

    // The backend is synchronous and may block (waiting on a browser); run it on
    // the blocking pool so it never stalls an async worker.
    let st = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        st.runtime
            .as_ref()
            .expect("runtime present (checked above)")
            .eval_global(fn_name, &code, timeout)
    })
    .await;

    match result {
        Ok(Ok(value)) => (StatusCode::OK, Json(json!({ "result": value }))).into_response(),
        Ok(Err(e)) => runtime_error_response(e),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("runtime task failed: {join}") })),
        )
            .into_response(),
    }
}

#[derive(serde::Deserialize, Default)]
pub struct LogsQuery {
    limit: Option<usize>,
    since: Option<i64>,
}

pub async fn handle_runtime_logs(
    State(state): State<Arc<ServerState>>,
    Query(params): Query<LogsQuery>,
) -> Response {
    let Some(rt) = state.runtime.as_ref() else {
        return not_enabled();
    };
    let limit = params.limit.unwrap_or(100);
    let logs = rt.logs(limit, params.since);
    (StatusCode::OK, Json(json!({ "logs": logs }))).into_response()
}

#[cfg(test)]
mod tests {
    use crate::runtime::{LogEntry, RuntimeBackend, RuntimeError};
    use crate::state::ServerState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use std::time::Duration;
    use tower::ServiceExt;

    /// A `RuntimeBackend` we drive directly (no transport) for handler tests.
    struct FakeBackend {
        eval: Result<serde_json::Value, RuntimeErrorKind>,
        logs: Vec<LogEntry>,
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
            }
        }
        fn failing(kind: RuntimeErrorKind) -> Self {
            Self {
                eval: Err(kind),
                logs: vec![],
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
            _fn_name: &str,
            _arg: &str,
            _t: Duration,
        ) -> Result<serde_json::Value, RuntimeError> {
            self.eval.clone().map_err(|_| self.err())
        }
        fn logs(&self, _limit: usize, _since: Option<i64>) -> Vec<LogEntry> {
            self.logs.clone()
        }
        fn ready(&self) -> bool {
            true
        }
    }

    fn state_with_runtime(backend: Option<Box<dyn RuntimeBackend>>) -> Arc<ServerState> {
        let mut s = test_state();
        s.runtime = backend;
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
        let backend = Box::new(FakeBackend::returning(serde_json::json!(2)));
        let (status, body) = post_lua(state_with_runtime(Some(backend)), "1 + 1").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, r#"{"result":2}"#);
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
        // The clean message flows verbatim into the `error` field (no Debug dump).
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
        let body = String::from_utf8_lossy(&bytes);
        assert!(body.contains(r#""logs":["#), "{body}");
        assert!(body.contains(r#""text":"hi""#), "{body}");
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
}
