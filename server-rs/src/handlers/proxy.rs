use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

/// Derive the proxy target URL: `http://` for localhost-ish hosts, `https://`
/// otherwise, with the original query string appended.
pub(crate) fn proxy_target_url(path: &str, query: Option<&str>) -> String {
    use std::sync::LazyLock;
    static LOCALHOST: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+|host\.docker\.internal)")
            .unwrap()
    });
    let q = query.map(|q| format!("?{q}")).unwrap_or_default();
    if LOCALHOST.is_match(path) {
        format!("http://{path}{q}")
    } else {
        format!("https://{path}{q}")
    }
}

pub async fn handle_proxy(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    method: Method,
    headers: HeaderMap,
    axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
    body: Body,
) -> impl IntoResponse {
    if state.boot_config.read_only {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            "Read only mode, no proxy allowed",
        )
            .into_response();
    }
    if path.is_empty() {
        return (StatusCode::BAD_REQUEST, "No URI provided").into_response();
    }

    let target = proxy_target_url(&path, raw_query.as_deref());

    // Collect the X-Proxy-Header-* request headers (prefix stripped).
    let mut fwd_headers: Vec<(String, String)> = Vec::new();
    let mut has_ua = false;
    for (k, v) in &headers {
        if let Some(name) = k.as_str().to_lowercase().strip_prefix("x-proxy-header-") {
            if name == "user-agent" {
                has_ua = true;
            }
            if let Ok(val) = v.to_str() {
                fwd_headers.push((name.to_string(), val.to_string()));
            }
        }
    }
    if !has_ua {
        fwd_headers.push(("user-agent".into(), "SilverBullet".into()));
    }

    tracing::info!("Proxying to {target}");

    // The proxy is pure network I/O at the edge (no business logic), so it uses
    // async `reqwest` directly rather than the sync-core `spawn_blocking` seam.
    let client = reqwest::Client::new();
    let rmethod =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut rb = client.request(rmethod, &target);
    for (k, v) in fwd_headers {
        rb = rb.header(k, v);
    }
    // Forward the request body as a stream (so large uploads aren't buffered in
    // memory). GET/HEAD carry no body, so none is attached there — avoiding a
    // spurious chunked body on a bodyless request.
    if !matches!(method, Method::GET | Method::HEAD) {
        rb = rb.body(reqwest::Body::wrap_stream(body.into_data_stream()));
    }

    match rb.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            // Capture response headers before consuming the body.
            let resp_headers: Vec<(String, String)> = resp
                .headers()
                .iter()
                .filter_map(|(k, v)| {
                    v.to_str()
                        .ok()
                        .map(|v| (k.as_str().to_string(), v.to_string()))
                })
                .collect();

            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header("x-proxy-status-code", status.to_string())
                .header("content-type", &content_type);
            for (k, v) in resp_headers {
                builder = builder.header(format!("x-proxy-header-{k}"), v);
            }
            // Stream the response body straight through rather than buffering it.
            builder
                .body(Body::from_stream(resp.bytes_stream()))
                .unwrap()
        }
        Err(e) => {
            tracing::error!("Proxy error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::proxy_target_url;
    use crate::state::AppState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    #[test]
    fn localhost_uses_http_others_https() {
        // Matrix ported from the legacy server's `TestLocalhostRegex`.
        for host in [
            "localhost:8080/api",
            "127.0.0.1:8080/api",
            "192.168.1.1:8080/api",
            "host.docker.internal:11434/api",
        ] {
            assert!(
                proxy_target_url(host, None).starts_with("http://"),
                "{host} should use http"
            );
        }
        for host in ["api.openai.com/v1", "example.com:8443/api"] {
            assert!(
                proxy_target_url(host, None).starts_with("https://"),
                "{host} should use https"
            );
        }
        // Query string preserved.
        assert_eq!(
            proxy_target_url("127.0.0.1/y", Some("a=1")),
            "http://127.0.0.1/y?a=1"
        );
    }

    fn state_read_only(read_only: bool) -> Arc<AppState> {
        let mut s = Arc::try_unwrap(test_state()).ok().expect("unique");
        s.boot_config.read_only = read_only;
        Arc::new(s)
    }

    #[tokio::test]
    async fn read_only_rejects_proxy() {
        let resp = crate::build_router(state_read_only(true))
            .oneshot(
                Request::builder()
                    .uri("/.proxy/api.example.com/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn empty_path_is_400() {
        // `/.proxy/` with no URL.
        let resp = crate::build_router(state_read_only(false))
            .oneshot(
                Request::builder()
                    .uri("/.proxy/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        // Either the wildcard captures empty → 400, or the route doesn't match → 404.
        assert!(
            resp.status() == StatusCode::BAD_REQUEST || resp.status() == StatusCode::NOT_FOUND,
            "got {}",
            resp.status()
        );
    }

    #[tokio::test]
    async fn forwards_to_upstream_with_header_rewriting() {
        // Throwaway upstream: echoes a forwarded request header into the body and
        // sets a custom response header.
        let upstream = axum::Router::new().route(
            "/echo",
            axum::routing::get(|headers: axum::http::HeaderMap| async move {
                let seen = headers
                    .get("x-test")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("none")
                    .to_string();
                (
                    [("x-upstream-marker", "yes")],
                    format!("upstream-saw:{seen}"),
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });

        // Proxy to it, forwarding `X-Test` via the `X-Proxy-Header-` prefix.
        let resp = crate::build_router(state_read_only(false))
            .oneshot(
                Request::builder()
                    .uri(format!("/.proxy/127.0.0.1:{port}/echo"))
                    .header("x-proxy-header-x-test", "abc")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        // The upstream's real status surfaces in x-proxy-status-code.
        assert_eq!(resp.headers().get("x-proxy-status-code").unwrap(), "200");
        // Upstream response headers are re-emitted with the x-proxy-header- prefix.
        assert!(
            resp.headers()
                .iter()
                .any(|(k, v)| k.as_str() == "x-proxy-header-x-upstream-marker" && v == "yes"),
            "missing rewritten upstream header in {:?}",
            resp.headers()
        );
        // The forwarded X-Test header (prefix stripped) reached the upstream.
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"upstream-saw:abc");
    }

    #[tokio::test]
    async fn streams_request_body_and_response_body() {
        // Upstream echoes the request body back, so a successful round-trip
        // proves the request body is forwarded and the response is read back
        // (both via streaming, not buffered).
        let upstream = axum::Router::new().route(
            "/echo-body",
            axum::routing::post(|body: String| async move { format!("got:{body}") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });

        let resp = crate::build_router(state_read_only(false))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/.proxy/127.0.0.1:{port}/echo-body"))
                    .header("content-type", "text/plain")
                    .body(Body::from("streamed-payload"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"got:streamed-payload");
    }
}
