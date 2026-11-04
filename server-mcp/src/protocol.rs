use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};
use silverbullet_server::auth::mcp::normalise_authority;

use crate::tool::{Caller, ToolSet};

const LATEST_INITIALIZE_VERSION: &str = "2025-11-25";
const SUPPORTED_INITIALIZE_VERSIONS: [&str; 2] = ["2025-06-18", "2025-11-25"];
const DISCOVER_VERSION: &str = "2026-07-28";

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const HEADER_MISMATCH: i64 = -32020;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailure {
    /// No bearer was presented.
    Missing,
    InvalidToken,
    InsufficientScope,
}

pub trait Authenticate: Send + Sync {
    fn authenticate(&self, headers: &HeaderMap) -> Result<Caller, AuthFailure>;
    /// The RFC 9728 metadata URL to advertise in challenges, for hosts that
    /// serve it; without one the challenge names only a realm.
    fn resource_metadata(&self, _headers: &HeaderMap) -> Option<String> {
        None
    }
}

#[derive(Clone)]
pub(crate) struct McpState {
    pub tools: Arc<dyn ToolSet>,
    pub auth: Arc<dyn Authenticate>,
}

pub(crate) async fn handle(
    State(state): State<McpState>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if method != Method::POST {
        return (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST")]).into_response();
    }
    if !origin_allowed(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let caller = match state.auth.authenticate(&headers) {
        Ok(caller) => caller,
        Err(failure) => return challenge(&*state.auth, &headers, failure),
    };

    let request: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return rpc_error(
                StatusCode::BAD_REQUEST,
                Value::Null,
                PARSE_ERROR,
                "parse error",
            )
        }
    };
    if request.is_array() {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            INVALID_REQUEST,
            "batch requests are not supported",
        );
    }
    let Some(object) = request.as_object() else {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            INVALID_REQUEST,
            "request must be a JSON object",
        );
    };
    let Some(id) = object.get("id").cloned() else {
        // Notifications, and responses to server requests we never send.
        return StatusCode::ACCEPTED.into_response();
    };
    let Some(rpc_method) = object.get("method").and_then(Value::as_str) else {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            id,
            INVALID_REQUEST,
            "missing method",
        );
    };
    let params = object.get("params").cloned().unwrap_or(Value::Null);

    if let Some(message) = header_mismatch(&headers, rpc_method) {
        return rpc_error(StatusCode::BAD_REQUEST, id, HEADER_MISMATCH, &message);
    }

    let outcome = match rpc_method {
        "initialize" => Ok(initialize(&*state.tools, &params)),
        "server/discover" => Ok(discover(&*state.tools)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(list_tools(&*state.tools)),
        "tools/call" => call_tool(&*state.tools, &caller, params).await,
        other => Err((METHOD_NOT_FOUND, format!("method not found: {other}"))),
    };
    match outcome {
        Ok(result) => {
            axum::Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
        }
        Err((code, message)) => rpc_error(StatusCode::OK, id, code, &message),
    }
}

fn rpc_error(status: StatusCode, id: Value, code: i64, message: &str) -> Response {
    (
        status,
        axum::Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        })),
    )
        .into_response()
}

fn challenge(auth: &dyn Authenticate, headers: &HeaderMap, failure: AuthFailure) -> Response {
    let (status, error) = match failure {
        AuthFailure::Missing => (StatusCode::UNAUTHORIZED, None),
        AuthFailure::InvalidToken => (StatusCode::UNAUTHORIZED, Some("invalid_token")),
        AuthFailure::InsufficientScope => (StatusCode::FORBIDDEN, Some("insufficient_scope")),
    };
    let mut value = match auth.resource_metadata(headers) {
        Some(url) => format!("Bearer resource_metadata=\"{url}\", scope=\"mcp\""),
        None => "Bearer realm=\"SilverBullet MCP\"".to_owned(),
    };
    if let Some(error) = error {
        value.push_str(&format!(", error=\"{error}\""));
    }
    (status, [(header::WWW_AUTHENTICATE, value)]).into_response()
}

/// A present `Origin` must name this server's own authority. A reverse proxy
/// that rewrites `Host` announces the public one in `X-Forwarded-Host`; a
/// chain of proxies lists several, the client-facing one first.
fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let (scheme, rest) = origin.split_once("://").unwrap_or(("", origin));
    let origin_authority = rest.split('/').next().unwrap_or("");
    let own = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("")
        .trim();
    let scheme = scheme.to_ascii_lowercase();
    !own.is_empty()
        && normalise_authority(origin_authority, &scheme) == normalise_authority(own, &scheme)
}

/// For the 2026-07-28 era the routing headers must agree with the body.
fn header_mismatch(headers: &HeaderMap, rpc_method: &str) -> Option<String> {
    let version = headers
        .get("mcp-protocol-version")
        .and_then(|v| v.to_str().ok());
    let declared_method = headers.get("mcp-method").and_then(|v| v.to_str().ok());
    let discover_era = rpc_method == "server/discover" || version == Some(DISCOVER_VERSION);
    if !discover_era {
        return None;
    }
    if version.is_some_and(|v| v != DISCOVER_VERSION) {
        return Some("MCP-Protocol-Version header does not match the request".into());
    }
    if declared_method.is_some_and(|m| m != rpc_method) {
        return Some("Mcp-Method header does not match the request method".into());
    }
    None
}

fn capabilities() -> Value {
    json!({ "tools": { "listChanged": false } })
}

fn server_info(tools: &dyn ToolSet) -> Value {
    json!({ "name": "silverbullet", "title": "SilverBullet", "version": tools.version() })
}

fn initialize(tools: &dyn ToolSet, params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|v| SUPPORTED_INITIALIZE_VERSIONS.contains(v))
        .unwrap_or(LATEST_INITIALIZE_VERSION);
    json!({
        "protocolVersion": version,
        "capabilities": capabilities(),
        "serverInfo": server_info(tools),
        "instructions": tools.instructions(),
    })
}

fn discover(tools: &dyn ToolSet) -> Value {
    json!({
        "supportedVersions": [DISCOVER_VERSION],
        "capabilities": capabilities(),
        "serverInfo": server_info(tools),
        "instructions": tools.instructions(),
    })
}

fn list_tools(tools: &dyn ToolSet) -> Value {
    let defs: Vec<Value> = tools
        .tools()
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
                "inputSchema": t.input_schema,
                "annotations": t.annotations,
            })
        })
        .collect();
    json!({ "tools": defs })
}

async fn call_tool(
    tools: &dyn ToolSet,
    caller: &Caller,
    params: Value,
) -> Result<Value, (i64, String)> {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return Err((INVALID_PARAMS, "tools/call requires a tool name".into()));
    };
    let args = match params.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(v) if v.is_object() => v.clone(),
        Some(_) => return Err((INVALID_PARAMS, "arguments must be an object".into())),
    };
    Ok(tools.call(caller, name, args).await)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, Response};
    use axum::Router;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::*;
    use crate::tool::{text_result, ToolDef, ToolResult};

    struct FakeTools;

    #[async_trait]
    impl ToolSet for FakeTools {
        fn tools(&self) -> Vec<ToolDef> {
            vec![ToolDef {
                name: "echo",
                title: "Echo",
                description: "Echo text".into(),
                input_schema: json!({"type": "object"}),
                annotations: json!({"readOnlyHint": true}),
            }]
        }
        fn instructions(&self) -> String {
            "Use help first.".into()
        }
        fn version(&self) -> String {
            "9.8.7".into()
        }
        async fn call(&self, _caller: &Caller, _name: &str, args: Value) -> ToolResult {
            text_result(args["text"].as_str().unwrap_or(""))
        }
    }

    struct FakeAuth;

    impl Authenticate for FakeAuth {
        fn authenticate(&self, headers: &HeaderMap) -> Result<Caller, AuthFailure> {
            match headers.get("authorization").and_then(|v| v.to_str().ok()) {
                None => Err(AuthFailure::Missing),
                Some("Bearer ok") => Ok(Caller::local("tester")),
                Some("Bearer narrow") => Err(AuthFailure::InsufficientScope),
                Some(_) => Err(AuthFailure::InvalidToken),
            }
        }
    }

    fn app() -> Router {
        crate::mcp_router(Arc::new(FakeTools), Arc::new(FakeAuth))
    }

    async fn send(
        method: &str,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> (Response<Body>, Vec<u8>) {
        let mut req = Request::builder().method(method).uri("/.mcp");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let body = body.map_or(Body::empty(), |b| Body::from(b.to_string()));
        let res = app().oneshot(req.body(body).unwrap()).await.unwrap();
        let (parts, body) = res.into_parts();
        let bytes = to_bytes(body, usize::MAX).await.unwrap().to_vec();
        (Response::from_parts(parts, Body::empty()), bytes)
    }

    async fn rpc(body: Value) -> Value {
        let (res, bytes) = send("POST", &[("authorization", "Bearer ok")], Some(body)).await;
        assert_eq!(res.status(), 200);
        serde_json::from_slice(&bytes).unwrap()
    }

    fn req(method: &str, params: Value) -> Value {
        json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    }

    #[tokio::test]
    async fn post_without_bearer_is_401_with_www_authenticate() {
        let (res, _) = send("POST", &[], Some(req("ping", json!({})))).await;
        assert_eq!(res.status(), 401);
        let challenge = res.headers()[header::WWW_AUTHENTICATE].to_str().unwrap();
        assert!(challenge.starts_with("Bearer"));
    }

    #[tokio::test]
    async fn challenge_without_resource_metadata_keeps_realm() {
        let challenge = |res: &Response<Body>| {
            res.headers()[header::WWW_AUTHENTICATE]
                .to_str()
                .unwrap()
                .to_owned()
        };
        let (res, _) = send("POST", &[], Some(req("ping", json!({})))).await;
        assert_eq!(challenge(&res), "Bearer realm=\"SilverBullet MCP\"");
        let (res, _) = send(
            "POST",
            &[("authorization", "Bearer wrong")],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 401);
        assert_eq!(
            challenge(&res),
            "Bearer realm=\"SilverBullet MCP\", error=\"invalid_token\""
        );
        let (res, _) = send(
            "POST",
            &[("authorization", "Bearer narrow")],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 403);
        assert_eq!(
            challenge(&res),
            "Bearer realm=\"SilverBullet MCP\", error=\"insufficient_scope\""
        );
    }

    #[tokio::test]
    async fn initialize_echoes_supported_version() {
        let (res, bytes) = send(
            "POST",
            &[("authorization", "Bearer ok")],
            Some(req("initialize", json!({"protocolVersion": "2025-06-18"}))),
        )
        .await;
        assert!(res.headers().get("mcp-session-id").is_none());
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["result"]["protocolVersion"], "2025-06-18");
        assert!(v["result"]["capabilities"]["tools"].is_object());
        assert_eq!(v["result"]["instructions"], FakeTools.instructions());
    }

    #[tokio::test]
    async fn initialize_unknown_version_answers_latest_initialize_era() {
        let v = rpc(req("initialize", json!({"protocolVersion": "2024-01-01"}))).await;
        assert_eq!(v["result"]["protocolVersion"], "2025-11-25");
    }

    #[tokio::test]
    async fn server_discover_returns_instructions_and_capabilities() {
        let (res, bytes) = send(
            "POST",
            &[
                ("authorization", "Bearer ok"),
                ("mcp-protocol-version", "2026-07-28"),
            ],
            Some(req("server/discover", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 200);
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["result"]["instructions"], "Use help first.");
        assert!(v["result"]["capabilities"]["tools"].is_object());
    }

    #[tokio::test]
    async fn discover_with_mismatched_headers_is_400_32020() {
        for headers in [
            vec![("mcp-protocol-version", "2025-06-18")],
            vec![
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/list"),
            ],
        ] {
            let mut all = vec![("authorization", "Bearer ok")];
            all.extend(headers);
            let (res, bytes) = send("POST", &all, Some(req("server/discover", json!({})))).await;
            assert_eq!(res.status(), 400);
            let v: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(v["error"]["code"], -32020);
        }
    }

    #[tokio::test]
    async fn tools_list_returns_defs() {
        let v = rpc(req("tools/list", json!({}))).await;
        let tool = &v["result"]["tools"][0];
        assert_eq!(tool["name"], "echo");
        assert!(tool["inputSchema"].is_object());
        assert!(tool["annotations"].is_object());
    }

    #[tokio::test]
    async fn tools_call_dispatches() {
        let v = rpc(req(
            "tools/call",
            json!({"name": "echo", "arguments": {"text": "hi"}}),
        ))
        .await;
        assert_eq!(v["result"]["content"][0]["text"], "hi");
    }

    #[tokio::test]
    async fn tools_call_without_name_is_invalid_params() {
        let v = rpc(req("tools/call", json!({}))).await;
        assert_eq!(v["error"]["code"], -32602);
    }

    #[tokio::test]
    async fn notification_gets_202() {
        let (res, bytes) = send(
            "POST",
            &[("authorization", "Bearer ok")],
            Some(json!({"jsonrpc": "2.0", "method": "notifications/initialized"})),
        )
        .await;
        assert_eq!(res.status(), 202);
        assert!(bytes.is_empty());
    }

    #[tokio::test]
    async fn get_and_delete_are_405() {
        for m in ["GET", "DELETE"] {
            let (res, _) = send(m, &[("authorization", "Bearer ok")], None).await;
            assert_eq!(res.status(), 405, "{m}");
        }
    }

    #[tokio::test]
    async fn foreign_origin_is_403() {
        let (res, _) = send(
            "POST",
            &[
                ("authorization", "Bearer ok"),
                ("origin", "https://evil.example"),
                ("host", "notes.example.test"),
            ],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn same_origin_and_missing_origin_are_allowed() {
        let (res, _) = send(
            "POST",
            &[
                ("authorization", "Bearer ok"),
                ("origin", "https://notes.example.test"),
                ("host", "notes.example.test"),
                ("x-forwarded-proto", "https"),
            ],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 200);
        let (res, _) = send(
            "POST",
            &[
                ("authorization", "Bearer ok"),
                ("host", "notes.example.test"),
            ],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 200);
    }

    #[tokio::test]
    async fn forwarded_host_takes_precedence_for_origin() {
        let (res, _) = send(
            "POST",
            &[
                ("authorization", "Bearer ok"),
                ("origin", "https://public.example.test"),
                ("host", "internal:3000"),
                ("x-forwarded-host", "public.example.test"),
            ],
            Some(req("ping", json!({}))),
        )
        .await;
        assert_eq!(res.status(), 200);
    }

    async fn origin_status(origin: &str, host_headers: &[(&str, &str)]) -> u16 {
        let mut headers = vec![("authorization", "Bearer ok"), ("origin", origin)];
        headers.extend_from_slice(host_headers);
        let (res, _) = send("POST", &headers, Some(req("ping", json!({})))).await;
        res.status().as_u16()
    }

    #[tokio::test]
    async fn forwarded_host_list_uses_the_first_entry() {
        let chain = [
            ("host", "internal:3000"),
            ("x-forwarded-host", "public.example.test, proxy.internal"),
        ];
        assert_eq!(
            origin_status("https://public.example.test", &chain).await,
            200
        );
        assert_eq!(origin_status("https://proxy.internal", &chain).await, 403);
    }

    #[tokio::test]
    async fn default_ports_are_normalised() {
        let host = [("host", "notes.example.test")];
        assert_eq!(
            origin_status("https://notes.example.test:443", &host).await,
            200
        );
        assert_eq!(
            origin_status("http://notes.example.test:80", &host).await,
            200
        );
        assert_eq!(
            origin_status(
                "https://notes.example.test",
                &[("host", "notes.example.test:443")]
            )
            .await,
            200
        );
        assert_eq!(
            origin_status("http://notes.example.test:443", &host).await,
            403
        );
        assert_eq!(
            origin_status("https://notes.example.test:8443", &host).await,
            403
        );
    }

    #[tokio::test]
    async fn server_info_reports_the_build_version() {
        let v = rpc(req("initialize", json!({"protocolVersion": "2025-11-25"}))).await;
        assert_eq!(v["result"]["serverInfo"]["version"], "9.8.7");
        let v = rpc(req("server/discover", json!({}))).await;
        assert_eq!(v["result"]["serverInfo"]["version"], "9.8.7");
    }

    #[tokio::test]
    async fn unknown_method_is_jsonrpc_error_32601() {
        let v = rpc(req("nope/nothing", json!({}))).await;
        assert_eq!(v["error"]["code"], -32601);
        assert_eq!(v["id"], 1);
    }

    #[tokio::test]
    async fn batch_array_is_rejected_32600() {
        let (res, bytes) = send(
            "POST",
            &[("authorization", "Bearer ok")],
            Some(json!([req("ping", json!({}))])),
        )
        .await;
        assert_eq!(res.status(), 400);
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"]["code"], -32600);
    }

    #[tokio::test]
    async fn ping_returns_empty_result() {
        let v = rpc(req("ping", json!({}))).await;
        assert_eq!(v["result"], json!({}));
    }

    #[tokio::test]
    async fn oversized_body_is_413() {
        let big = "x".repeat(16 * 1024 * 1024 + 1);
        let (res, _) = send(
            "POST",
            &[("authorization", "Bearer ok")],
            Some(req("ping", json!({"pad": big}))),
        )
        .await;
        assert_eq!(res.status(), 413);
    }
}
