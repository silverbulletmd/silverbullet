//! `/.runtime/{lua,lua_script,logs,screenshot}` — bridge HTTP to the Lua `RuntimeBackend`.
//! When no backend is configured the runtime API is "not enabled" and every
//! endpoint returns 503. With `X-Await-Index`, the evaluating endpoints first
//! let the index catch up with file changes (see [`catch_up`]).

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::auth::Actor;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde_json::json;
use server_space_tools::ops::{IndexStatus, AWAIT_INDEX_HEADER, INDEX_STATUS_HEADER};

use crate::forwarding;
use crate::runtime::{RuntimeBackend, RuntimeError};
use crate::state::ServerState;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
/// The most a request waits for the index before it runs.
pub(crate) const CATCH_UP_LIMIT: Duration = Duration::from_secs(5);
const AWAIT_CODE: &str = "index.awaitPendingChanges()";

/// X-Timeout is a whole number of seconds, defaulting to 30.
pub(crate) fn parse_timeout(headers: &HeaderMap) -> Duration {
    headers
        .get("X-Timeout")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|s| *s > 0)
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
}

/// The space's runtime, unless there is none or the runtime API is switched
/// off; either way the endpoints answer "not enabled".
fn usable_runtime(state: &ServerState) -> Option<&Arc<dyn RuntimeBackend>> {
    state.runtime.as_ref().filter(|runtime| runtime.enabled())
}

/// Lets the runtime's index catch up with the space's file changes, within
/// `budget`, and says how far it got:
/// - `unknown` when nothing follows the space's pages;
/// - `caught-up` without asking the runtime when nothing changed since the
///   last catch-up and the watcher has forwarded everything;
/// - otherwise after `index.awaitPendingChanges()` succeeds, `caught-up`, or
///   `polling` when the watcher polls (disk edits may wait for its next poll);
/// - `unknown` when the runtime refuses the caller (the request fails too);
/// - `behind` when that fails or runs out of budget.
pub(crate) async fn catch_up(state: &ServerState, actor: &Actor, budget: Duration) -> IndexStatus {
    let (Some(changes), Some(runtime)) =
        (state.page_watch.changes(), usable_runtime(state).cloned())
    else {
        return IndexStatus::Unknown;
    };
    let deadline = Instant::now() + budget;
    let forwarding = state.fs_guard.forwarding();
    let forwarded = forwarding::caught_up(forwarding, deadline).await;
    let seen = match changes.dirty() {
        Some(seen) => seen,
        None if forwarded => return IndexStatus::CaughtUp,
        None => changes.seen(),
    };
    if Instant::now() >= deadline {
        return IndexStatus::Behind;
    }
    let actor = actor.clone();
    let settled = tokio::task::spawn_blocking(move || {
        let selected = runtime.for_actor(&actor)?;
        // Measured after `for_actor`, which may start a runtime, so the eval
        // never outlives the deadline.
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(RuntimeError::Timeout);
        }
        selected.as_ref().unwrap_or(&runtime).eval_global(
            "sbRuntime.evalLua",
            AWAIT_CODE,
            remaining,
        )
    });
    match tokio::time::timeout_at(deadline.into(), settled).await {
        Ok(Ok(Ok(_))) => {
            changes.settle(seen);
            if forwarding::polls(forwarding) {
                IndexStatus::Polling
            } else {
                IndexStatus::CaughtUp
            }
        }
        Ok(Ok(Err(RuntimeError::Forbidden))) => IndexStatus::Unknown,
        _ => IndexStatus::Behind,
    }
}

pub(crate) fn awaits_index(headers: &HeaderMap) -> bool {
    is_truthy(
        headers
            .get(AWAIT_INDEX_HEADER)
            .and_then(|v| v.to_str().ok()),
    )
}

/// The catch-up's status, when the request asked for one; the request then
/// runs with its own full timeout.
async fn index_status(
    state: &ServerState,
    actor: &Actor,
    headers: &HeaderMap,
    timeout: Duration,
) -> Option<IndexStatus> {
    if !awaits_index(headers) {
        return None;
    }
    Some(catch_up(state, actor, timeout.min(CATCH_UP_LIMIT)).await)
}

/// Adds `X-Index-Status` when the request carried `X-Await-Index`, as
/// `unknown` when it was answered before any catch-up.
fn with_index_status(
    mut response: Response,
    headers: &HeaderMap,
    status: Option<IndexStatus>,
) -> Response {
    if awaits_index(headers) {
        let value = status.unwrap_or(IndexStatus::Unknown).as_str();
        response
            .headers_mut()
            .insert(INDEX_STATUS_HEADER, header::HeaderValue::from_static(value));
    }
    response
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
        RuntimeError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
        RuntimeError::NotReady | RuntimeError::Transport(_) => {
            (StatusCode::SERVICE_UNAVAILABLE, "bridge_unavailable")
        }
        RuntimeError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "timeout"),
        // The evaluated code threw (e.g. a Lua error): a user-level failure, not
        // a bridge outage — 500 with the clean message, per `Runtime API.md`.
        RuntimeError::Eval(_) => (StatusCode::INTERNAL_SERVER_ERROR, "script_error"),
        RuntimeError::SelectorNotFound(_) => (StatusCode::NOT_FOUND, "selector_not_found"),
        RuntimeError::InvalidSelector(_) => (StatusCode::BAD_REQUEST, "invalid_selector"),
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
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    runtime_eval(state, actor, headers, body, EvalKind::Lua).await
}

pub async fn handle_runtime_lua_script(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    runtime_eval(state, actor, headers, body, EvalKind::Script).await
}

async fn runtime_eval(
    state: Arc<ServerState>,
    actor: Actor,
    headers: HeaderMap,
    body: Bytes,
    kind: EvalKind,
) -> Response {
    let (response, index) = evaluate(state, actor, &headers, body, kind).await;
    with_index_status(response, &headers, index)
}

async fn evaluate(
    state: Arc<ServerState>,
    actor: Actor,
    headers: &HeaderMap,
    body: Bytes,
    kind: EvalKind,
) -> (Response, Option<IndexStatus>) {
    if let Some(metrics) = state.metrics.as_ref() {
        metrics.runtime_api_requests.inc();
    }
    if usable_runtime(&state).is_none() {
        return (not_enabled(), None);
    }
    let code = String::from_utf8_lossy(&body).trim().to_string();
    if code.is_empty() {
        let response = (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Request body is required" })),
        )
            .into_response();
        return (response, None);
    }
    let timeout = parse_timeout(headers);
    let index = index_status(&state, &actor, headers, timeout).await;
    let fn_name = match kind {
        EvalKind::Lua => "sbRuntime.evalLua",
        EvalKind::Script => "sbRuntime.evalLuaScript",
    };

    // The backend is synchronous and may block (waiting on a browser); run it on
    // the blocking pool so it never stalls an async worker.
    let st = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        let runtime = st.runtime.as_ref().expect("runtime present");
        let selected = runtime.for_actor(&actor)?;
        selected
            .as_ref()
            .unwrap_or(runtime)
            .eval_global(fn_name, &code, timeout)
    })
    .await;

    let response = match result {
        Ok(Ok(value)) => (StatusCode::OK, Json(json!({ "result": value }))).into_response(),
        Ok(Err(e)) => runtime_error_response(e),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("runtime task failed: {join}") })),
        )
            .into_response(),
    };
    (response, index)
}

#[derive(serde::Deserialize, Default)]
pub struct LogsQuery {
    limit: Option<usize>,
    since: Option<i64>,
}

pub async fn handle_runtime_logs(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    Query(params): Query<LogsQuery>,
) -> Response {
    let Some(rt) = usable_runtime(&state) else {
        return not_enabled();
    };
    let runtime = rt.clone();
    let result = tokio::task::spawn_blocking(move || {
        let selected = runtime.for_actor(&actor)?;
        Ok::<_, RuntimeError>(
            selected
                .as_ref()
                .unwrap_or(&runtime)
                .logs(params.limit.unwrap_or(100), params.since),
        )
    })
    .await;
    match result {
        Ok(Ok(logs)) => (StatusCode::OK, Json(json!({ "logs": logs }))).into_response(),
        Ok(Err(error)) => runtime_error_response(error),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[derive(serde::Deserialize, Default)]
pub struct ScreenshotQuery {
    selector: Option<String>,
    #[serde(rename = "fullPage")]
    full_page: Option<String>,
}

/// `fullPage=1` / `fullPage=true` (an empty or `0`/`false` value is off).
fn is_truthy(value: Option<&str>) -> bool {
    matches!(value.map(str::trim), Some("1" | "true" | "yes"))
}

/// Set on a full-page screenshot that stopped at the size cap before the end
/// of the page.
pub const TRUNCATED_HEADER: &str = "X-Screenshot-Truncated";

fn png_response(png: Vec<u8>, truncated: bool) -> Response {
    let mut response = (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        png,
    )
        .into_response();
    if truncated {
        response
            .headers_mut()
            .insert(TRUNCATED_HEADER, header::HeaderValue::from_static("true"));
    }
    response
}

pub async fn handle_runtime_screenshot(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    Query(params): Query<ScreenshotQuery>,
) -> Response {
    let (response, index) = screenshot(state, actor, &headers, params).await;
    with_index_status(response, &headers, index)
}

async fn screenshot(
    state: Arc<ServerState>,
    actor: Actor,
    headers: &HeaderMap,
    params: ScreenshotQuery,
) -> (Response, Option<IndexStatus>) {
    let Some(rt) = usable_runtime(&state) else {
        return (not_enabled(), None);
    };
    let runtime = rt.clone();
    let timeout = parse_timeout(headers);
    let selector = params.selector.filter(|s| !s.trim().is_empty());
    let full_page = is_truthy(params.full_page.as_deref());
    if full_page && selector.is_some() {
        let response = (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "fullPage and selector cannot be combined",
                "code": "invalid_request",
            })),
        )
            .into_response();
        return (response, None);
    }
    let index = index_status(&state, &actor, headers, timeout).await;
    let result = tokio::task::spawn_blocking(move || {
        let selected = runtime.for_actor(&actor)?;
        let backend = selected.as_ref().unwrap_or(&runtime);
        if full_page {
            backend
                .screenshot_full_page(timeout)
                .map(|shot| (shot.png, shot.truncated))
        } else {
            backend
                .screenshot(selector.as_deref(), timeout)
                .map(|png| (png, false))
        }
    })
    .await;
    let response = match result {
        Ok(Ok((png, truncated))) => png_response(png, truncated),
        Ok(Err(e)) => runtime_error_response(e),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("runtime task failed: {join}") })),
        )
            .into_response(),
    };
    (response, index)
}

#[cfg(test)]
mod tests;
