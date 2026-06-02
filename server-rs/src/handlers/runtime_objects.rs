//! `/.runtime/objects` + `/.runtime/objects/{tag}[/{ref}]` — the object query
//! API, dispatched to the client's `sbRuntime.objectsAPI` through the runtime
//! seam. Query parsing, percent-decoded path splitting, and error-code mapping
//! are ported from the App (transport-independent).

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::Response;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::RuntimeError;
use crate::state::AppState;

pub const DEFAULT_LIMIT: usize = 100;
pub const MAX_LIMIT: usize = 1000;

/// An error code the objects API emits. The wire string (the JSON `code` field)
/// and the HTTP status are both derived from the variant, so they can't drift.
/// `not_found`/`unknown_tag` are only ever returned *by the client*, so they
/// aren't variants here — [`status_for_wire`] recognizes them when relaying.
#[derive(Debug, Clone, Copy)]
pub enum ErrorCode {
    BadField,
    BadQuery,
    UnknownOperator,
    BadLimit,
    BridgeUnavailable,
    Timeout,
    Internal,
}

impl ErrorCode {
    /// The string written to the JSON `code` field.
    fn wire(self) -> &'static str {
        match self {
            ErrorCode::BadField => "bad_field",
            ErrorCode::BadQuery => "bad_query",
            ErrorCode::UnknownOperator => "unknown_operator",
            ErrorCode::BadLimit => "bad_limit",
            ErrorCode::BridgeUnavailable => "bridge_unavailable",
            ErrorCode::Timeout => "timeout",
            ErrorCode::Internal => "internal_error",
        }
    }

    /// The HTTP status this code maps to.
    fn status(self) -> StatusCode {
        status_for_wire(self.wire())
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.wire())
    }
}

static FIELD_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$").unwrap());
static WHERE_PARAM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^where\[([^\]]+)\](?:\[([^\]]+)\])?$").unwrap());

const ALLOWED_OPS: &[&str] = &[
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "contains",
    "startsWith",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Filter {
    pub field: String,
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderKey {
    pub field: String,
    pub desc: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ObjectsListQuery {
    pub filters: Vec<Filter>,
    pub order: Vec<OrderKey>,
    pub limit: usize,
    pub offset: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub select: Vec<String>,
    pub debug: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("{code}: {msg}")]
pub struct ParseError {
    pub code: ErrorCode,
    pub msg: String,
}

pub fn parse_objects_query(pairs: &[(String, String)]) -> Result<ObjectsListQuery, ParseError> {
    let mut q = ObjectsListQuery {
        limit: DEFAULT_LIMIT,
        ..Default::default()
    };
    for (key, val) in pairs {
        if let Some(caps) = WHERE_PARAM_RE.captures(key) {
            let field = caps.get(1).unwrap().as_str();
            let op = caps.get(2).map(|m| m.as_str()).unwrap_or("eq");
            if !FIELD_PATH_RE.is_match(field) {
                return Err(ParseError {
                    code: ErrorCode::BadField,
                    msg: format!("invalid field path {field:?}"),
                });
            }
            if !ALLOWED_OPS.contains(&op) {
                return Err(ParseError {
                    code: ErrorCode::UnknownOperator,
                    msg: op.to_string(),
                });
            }
            q.filters.push(Filter {
                field: field.to_string(),
                op: op.to_string(),
                value: val.clone(),
            });
        } else if key == "order" {
            let (field, desc) = match val.split_once(':') {
                None => (val.as_str(), false),
                Some((f, "asc")) => (f, false),
                Some((f, "desc")) => (f, true),
                Some((_, d)) => {
                    return Err(ParseError {
                        code: ErrorCode::BadQuery,
                        msg: format!("order direction must be asc|desc, got {d:?}"),
                    });
                }
            };
            if !FIELD_PATH_RE.is_match(field) {
                return Err(ParseError {
                    code: ErrorCode::BadField,
                    msg: format!("invalid field path {field:?}"),
                });
            }
            q.order.push(OrderKey {
                field: field.to_string(),
                desc,
            });
        } else if key == "limit" {
            let n: isize = val.parse().map_err(|_| ParseError {
                code: ErrorCode::BadLimit,
                msg: format!("limit must be 1..{MAX_LIMIT}"),
            })?;
            if n <= 0 || (n as usize) > MAX_LIMIT {
                return Err(ParseError {
                    code: ErrorCode::BadLimit,
                    msg: format!("limit must be 1..{MAX_LIMIT}"),
                });
            }
            q.limit = n as usize;
        } else if key == "offset" {
            let n: isize = val.parse().map_err(|_| ParseError {
                code: ErrorCode::BadQuery,
                msg: "offset must be >= 0".to_string(),
            })?;
            if n < 0 {
                return Err(ParseError {
                    code: ErrorCode::BadQuery,
                    msg: "offset must be >= 0".to_string(),
                });
            }
            q.offset = n as usize;
        } else if key == "select" {
            for f in val.split(',') {
                let f = f.trim();
                if !FIELD_PATH_RE.is_match(f) {
                    return Err(ParseError {
                        code: ErrorCode::BadField,
                        msg: format!("invalid field path {f:?}"),
                    });
                }
                q.select.push(f.to_string());
            }
        } else if key == "debug" && val == "1" {
            q.debug = true;
        }
    }
    Ok(q)
}

/// Mirrors the JSON returned by `sbRuntime.objectsAPI(req)`.
#[derive(Debug, Deserialize, Default)]
pub struct ObjectsResponse {
    pub ok: bool,
    #[serde(default)]
    pub items: Option<serde_json::Value>,
    #[serde(default)]
    pub item: Option<serde_json::Value>,
    #[serde(rename = "equivalentLua", default)]
    pub equivalent_lua: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
}

/// Map a wire `code` — ours, or one the client returns such as `not_found` /
/// `unknown_tag` — to its HTTP status. Unknown codes are internal errors.
fn status_for_wire(code: &str) -> StatusCode {
    match code {
        "not_found" | "unknown_tag" => StatusCode::NOT_FOUND,
        "bad_field" | "bad_query" | "unknown_operator" | "bad_limit" => StatusCode::BAD_REQUEST,
        "bridge_unavailable" => StatusCode::SERVICE_UNAVAILABLE,
        "timeout" => StatusCode::GATEWAY_TIMEOUT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn json_error(status: StatusCode, code: &str, msg: &str) -> Response {
    let body = json!({ "error": msg, "code": code }).to_string();
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

/// Error response for one of our own [`ErrorCode`]s (status + wire both derived).
fn err(code: ErrorCode, msg: &str) -> Response {
    json_error(code.status(), code.wire(), msg)
}

/// Error response relaying a wire `code` string (e.g. one the client returned).
fn err_wire(code: &str, msg: &str) -> Response {
    json_error(status_for_wire(code), code, msg)
}

/// The error response a non-`ok` client `ObjectsResponse` should produce — its
/// `code` is relayed verbatim (any string), its status derived from it.
fn client_error(resp: &ObjectsResponse) -> Response {
    err_wire(
        resp.code.as_deref().unwrap_or(ErrorCode::Internal.wire()),
        resp.error.as_deref().unwrap_or(""),
    )
}

/// Call `sbRuntime.objectsAPI(req)` through the runtime backend (on the blocking
/// pool) and parse the `ObjectsResponse`. `Err` carries a ready HTTP response.
async fn call_objects_api(
    state: &Arc<AppState>,
    req: serde_json::Value,
    timeout: Duration,
) -> Result<ObjectsResponse, Response> {
    if state.runtime.is_none() {
        return Err(err(
            ErrorCode::BridgeUnavailable,
            "Runtime API is not enabled",
        ));
    }
    // `sbRuntime.objectsAPI` takes one string argument: the request JSON.
    let req_json = serde_json::to_string(&req).map_err(|e| {
        err(
            ErrorCode::Internal,
            &format!("serialize objects request: {e}"),
        )
    })?;
    let st = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        st.runtime
            .as_ref()
            .expect("runtime present (checked above)")
            .eval_global("sbRuntime.objectsAPI", &req_json, timeout)
    })
    .await;
    let raw = match result {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            let code = match e {
                RuntimeError::NotReady | RuntimeError::Transport(_) => ErrorCode::BridgeUnavailable,
                RuntimeError::Timeout => ErrorCode::Timeout,
            };
            return Err(err(code, &e.to_string()));
        }
        Err(join) => {
            return Err(err(
                ErrorCode::Internal,
                &format!("runtime task failed: {join}"),
            ));
        }
    };
    // `objectsAPI` returns a JSON *string*; normalize to the inner value (a
    // transport that already hands back a parsed object passes through).
    let value = match raw {
        serde_json::Value::String(s) => serde_json::from_str(&s).map_err(|e| {
            err(
                ErrorCode::Internal,
                &format!("bad objects response JSON: {e}"),
            )
        })?,
        other => other,
    };
    serde_json::from_value::<ObjectsResponse>(value).map_err(|e| {
        err(
            ErrorCode::Internal,
            &format!("failed to parse objects response: {e}"),
        )
    })
}

/// Serialize an `Option<Value>` body part, defaulting to `default` when absent.
fn body_or(value: Option<serde_json::Value>, default: &str) -> String {
    value
        .map(|v| v.to_string())
        .unwrap_or_else(|| default.to_string())
}

/// GET `/.runtime/objects` — list known tags and their counts.
pub async fn handle_objects_list_tags(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    let timeout = crate::handlers::runtime::parse_timeout(&headers);
    match call_objects_api(&state, json!({ "kind": "list_tags" }), timeout).await {
        Err(resp) => resp,
        Ok(resp) if !resp.ok => client_error(&resp),
        Ok(resp) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/json")
            .body(Body::from(body_or(resp.items, "[]")))
            .unwrap(),
    }
}

/// Split the encoded suffix after `/.runtime/objects/` into `(tag, ref?)`. Tags
/// and refs containing `/` are percent-encoded (`%2F`); we split on the first
/// un-encoded `/`, then decode each segment.
fn split_objects_path(escaped_suffix: &str) -> Result<(String, Option<String>), String> {
    let (raw_tag, raw_ref) = match escaped_suffix.split_once('/') {
        Some((t, r)) => (t, Some(r)),
        None => (escaped_suffix, None),
    };
    let tag = percent_encoding::percent_decode_str(raw_tag)
        .decode_utf8()
        .map_err(|e| format!("invalid tag encoding: {e}"))?
        .into_owned();
    let ref_ = match raw_ref {
        Some(r) => Some(
            percent_encoding::percent_decode_str(r)
                .decode_utf8()
                .map_err(|e| format!("invalid ref encoding: {e}"))?
                .into_owned(),
        ),
        None => None,
    };
    Ok((tag, ref_))
}

/// GET `/.runtime/objects/{tag}[/{ref}]`. A wildcard route + manual
/// percent-decoding (rather than a `Path` extractor) so tags/refs may contain
/// `/` as `%2F`.
pub async fn handle_objects_by_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
    Query(raw): Query<Vec<(String, String)>>,
) -> Response {
    let suffix = uri.path().strip_prefix("/.runtime/objects/").unwrap_or("");
    let (tag, ref_) = match split_objects_path(suffix) {
        Ok(v) => v,
        Err(msg) => return err(ErrorCode::BadQuery, &msg),
    };
    if tag.is_empty() {
        return err(ErrorCode::BadQuery, "missing tag");
    }
    let timeout = crate::handlers::runtime::parse_timeout(&headers);
    match ref_ {
        Some(r) => {
            let req = json!({ "kind": "get", "tag": tag, "ref": r });
            match call_objects_api(&state, req, timeout).await {
                Err(resp) => resp,
                Ok(resp) if !resp.ok => client_error(&resp),
                Ok(resp) => Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "application/json")
                    .body(Body::from(body_or(resp.item, "null")))
                    .unwrap(),
            }
        }
        None => {
            let q = match parse_objects_query(&raw) {
                Ok(q) => q,
                Err(e) => return err(e.code, &e.msg),
            };
            let mut req = json!({
                "kind": "list",
                "tag": tag,
                "filters": q.filters,
                "order": q.order,
                "limit": q.limit,
                "offset": q.offset,
                "debug": q.debug,
            });
            if !q.select.is_empty() {
                req["select"] = serde_json::to_value(&q.select).unwrap();
            }
            match call_objects_api(&state, req, timeout).await {
                Err(resp) => resp,
                Ok(resp) if !resp.ok => client_error(&resp),
                Ok(resp) => {
                    let mut builder = Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", "application/json");
                    if q.debug {
                        if let Some(eq) = &resp.equivalent_lua {
                            builder = builder.header("X-Equivalent-Lua", eq.as_str());
                        }
                    }
                    builder.body(Body::from(body_or(resp.items, "[]"))).unwrap()
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{LogEntry, RuntimeBackend};
    use crate::state::AppState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // ---- ported pure-logic tests ----

    #[test]
    fn split_path_cases() {
        assert_eq!(
            split_objects_path("page").unwrap(),
            ("page".to_string(), None)
        );
        assert_eq!(
            split_objects_path("page/index").unwrap(),
            ("page".to_string(), Some("index".to_string())),
        );
        assert_eq!(
            split_objects_path("meta%2Flibrary").unwrap(),
            ("meta/library".to_string(), None),
        );
        assert_eq!(
            split_objects_path("meta%2Flibrary/Some%20Page").unwrap(),
            ("meta/library".to_string(), Some("Some Page".to_string())),
        );
        assert_eq!(
            split_objects_path("task/Daily%2F2026-05-14%40L3").unwrap(),
            ("task".to_string(), Some("Daily/2026-05-14@L3".to_string())),
        );
        assert!(split_objects_path("%FF%FE/x").is_err());
    }

    #[test]
    fn defaults_empty() {
        let q = parse_objects_query(&[]).unwrap();
        assert_eq!(q.limit, DEFAULT_LIMIT);
        assert_eq!(q.offset, 0);
        assert!(q.filters.is_empty());
    }

    #[test]
    fn where_variants() {
        let q = parse_objects_query(&pairs(&[
            ("where[name]", "foo"),
            ("where[age][gte]", "10"),
            ("where[status][in]", "open,pending"),
            ("order", "name"),
            ("order", "age:desc"),
            ("limit", "20"),
            ("offset", "5"),
            ("select", "name,age"),
        ]))
        .unwrap();
        assert_eq!(q.limit, 20);
        assert_eq!(q.offset, 5);
        assert_eq!(q.order.len(), 2);
        assert!(q.order[1].desc);
        assert_eq!(q.select, vec!["name", "age"]);
        let mut fs = q.filters.clone();
        fs.sort_by(|a, b| a.field.cmp(&b.field));
        assert_eq!(fs[0].field, "age");
        assert_eq!(fs[0].op, "gte");
        assert_eq!(fs[2].op, "in");
    }

    #[test]
    fn rejects_bad_inputs() {
        for kv in &[
            vec![("limit", "abc")],
            vec![("limit", "-1")],
            vec![("limit", "1001")],
            vec![("offset", "-1")],
            vec![("where[1bad]", "v")],
            vec![("where[f][nope]", "v")],
        ] {
            assert!(
                parse_objects_query(&pairs(kv)).is_err(),
                "expected err for {kv:?}"
            );
        }
    }

    // ---- handler tests against a fake backend ----

    /// Returns a canned `ObjectsResponse` Value (as an object) for every call.
    struct ObjBackend(serde_json::Value);
    impl RuntimeBackend for ObjBackend {
        fn eval_global(
            &self,
            _fn_name: &str,
            _arg: &str,
            _t: Duration,
        ) -> Result<serde_json::Value, RuntimeError> {
            Ok(self.0.clone())
        }
        fn logs(&self, _l: usize, _s: Option<i64>) -> Vec<LogEntry> {
            vec![]
        }
        fn ready(&self) -> bool {
            true
        }
    }

    fn state_with(backend: Option<Box<dyn RuntimeBackend>>) -> Arc<AppState> {
        let mut s = test_state();
        s.runtime = backend;
        Arc::new(s)
    }

    async fn get(state: Arc<AppState>, uri: &str) -> (StatusCode, String) {
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn list_tags_returns_items() {
        let backend = ObjBackend(serde_json::json!({ "ok": true, "items": [{"tag":"page"}] }));
        let (status, body) = get(state_with(Some(Box::new(backend))), "/.runtime/objects").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(r#""tag":"page""#), "{body}");
    }

    #[tokio::test]
    async fn get_one_returns_item() {
        let backend = ObjBackend(serde_json::json!({ "ok": true, "item": {"name":"Home"} }));
        let (status, body) = get(
            state_with(Some(Box::new(backend))),
            "/.runtime/objects/page/Home",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(r#""name":"Home""#), "{body}");
    }

    #[tokio::test]
    async fn backend_error_code_maps_to_status() {
        let backend = ObjBackend(
            serde_json::json!({ "ok": false, "code": "not_found", "error": "no such tag" }),
        );
        let (status, body) = get(
            state_with(Some(Box::new(backend))),
            "/.runtime/objects/nope",
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(body.contains("not_found"), "{body}");
    }

    #[tokio::test]
    async fn bad_query_is_400_without_calling_backend() {
        let backend = ObjBackend(serde_json::json!({ "ok": true, "items": [] }));
        let (status, body) = get(
            state_with(Some(Box::new(backend))),
            "/.runtime/objects/page?limit=abc",
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body.contains("bad_limit"), "{body}");
    }

    #[tokio::test]
    async fn no_backend_is_503() {
        let (status, _) = get(state_with(None), "/.runtime/objects").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }
}
