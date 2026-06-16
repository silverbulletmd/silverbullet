use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::extract::Request;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post, put};
use axum::Router;
use silverbullet_server_common::SpaceError;

use crate::handlers::{bundle, control, fs};
use crate::state::ServerState;

/// Run a synchronous `SpacePrimitives` operation on the blocking thread pool so
/// it never stalls an async worker. This is the single async↔sync seam; handler
/// bodies otherwise read as straight-line synchronous code. A panic in the
/// blocking closure is surfaced as `SpaceError::Io` rather than unwound.
pub(crate) async fn run_blocking<F, T>(f: F) -> Result<T, SpaceError>
where
    F: FnOnce() -> Result<T, SpaceError> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result,
        Err(join_err) => {
            tracing::error!("blocking task failed: {join_err}");
            Err(SpaceError::Io(std::io::Error::other(format!(
                "blocking task join error: {join_err}"
            ))))
        }
    }
}

/// Reject unauthorized requests to protected routes with 401. When no
/// authorizer is configured the server is open and every request passes.
async fn require_authorization(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
    req: Request,
    next: Next,
) -> Response {
    let Some(authorizer) = state.authorizer.clone() else {
        return next.run(req).await;
    };
    let authorized = {
        let ctx = crate::auth::AuthContext {
            method: req.method(),
            path: req.uri().path(),
            query: req.uri().query(),
            headers: req.headers(),
        };
        authorizer.is_authorized(&ctx)
    };
    if authorized {
        next.run(req).await
    } else {
        // The client's boot code follows this `Location` to the login page; all
        // protected routes are `/.`-prefixed, hence the 401-with-Location
        // branch.
        let location = format!("{}/.auth", state.host_url_prefix);
        (
            axum::http::StatusCode::UNAUTHORIZED,
            [(axum::http::header::LOCATION, location)],
            "Unauthorized",
        )
            .into_response()
    }
}

/// Increment the HTTP request counter when metrics are enabled, then continue.
/// A no-op (apart from the cheap `Option` check) when metrics are off.
async fn count_requests(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
    req: Request,
    next: Next,
) -> Response {
    if let Some(metrics) = state.metrics.as_ref() {
        metrics.http_requests.inc();
    }
    next.run(req).await
}

/// Build the HTTP router for the file/config/bundle endpoints. Protected routes
/// require authorization when an authorizer is configured.
pub fn build_router(state: Arc<ServerState>) -> Router {
    // Protected: require authorization (when an authorizer is configured).
    let protected = Router::new()
        .route("/.config", get(control::handle_config))
        .route("/.fs", get(fs::handle_fs_list))
        .route("/.fs/", get(fs::handle_fs_list))
        .route("/.fs/{*path}", get(fs::handle_fs_get))
        .route("/.fs/{*path}", put(fs::handle_fs_put))
        .route("/.fs/{*path}", delete(fs::handle_fs_delete))
        .route("/.shell", post(crate::handlers::shell::handle_shell))
        .route("/.proxy/{*path}", any(crate::handlers::proxy::handle_proxy))
        .route(
            "/.runtime/lua",
            post(crate::handlers::runtime::handle_runtime_lua),
        )
        .route(
            "/.runtime/lua_script",
            post(crate::handlers::runtime::handle_runtime_lua_script),
        )
        .route(
            "/.runtime/logs",
            get(crate::handlers::runtime::handle_runtime_logs),
        )
        .route(
            "/.runtime/objects",
            get(crate::handlers::runtime_objects::handle_objects_list_tags),
        )
        .route(
            "/.runtime/objects/{*path}",
            get(crate::handlers::runtime_objects::handle_objects_by_path),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_authorization,
        ));

    // Open: liveness + the SPA shell/assets must always load.
    let open = Router::new()
        .route("/.ping", get(control::handle_ping))
        .route("/.client/manifest.json", get(control::handle_manifest))
        .route(
            "/.auth",
            get(crate::handlers::auth::handle_auth_get)
                .post(crate::handlers::auth::handle_auth_post),
        )
        .route("/.logout", get(crate::handlers::auth::handle_logout));

    open.merge(protected)
        .fallback(get(bundle::handle_client_bundle))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            count_requests,
        ))
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

/// A minimal router exposing `/metrics` in Prometheus text format. The
/// standalone binary binds this on its own port. Returns 503 when no metrics
/// are configured.
pub fn metrics_router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/metrics", get(handle_metrics))
        .with_state(state)
}

async fn handle_metrics(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
) -> Response {
    match state.metrics.as_ref() {
        Some(metrics) => (
            [(
                axum::http::header::CONTENT_TYPE,
                "text/plain; version=0.0.4",
            )],
            metrics.gather(),
        )
            .into_response(),
        None => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Metrics disabled",
        )
            .into_response(),
    }
}

#[cfg(test)]
mod auth_tests {
    use crate::auth::{AuthContext, RequestAuthorizer};
    use crate::state::ServerState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    struct Always(bool);
    impl RequestAuthorizer for Always {
        fn is_authorized(&self, _ctx: &AuthContext) -> bool {
            self.0
        }
    }

    fn state_with(authz: Option<Arc<dyn RequestAuthorizer>>) -> Arc<ServerState> {
        let mut s = test_state();
        s.authorizer = authz;
        Arc::new(s)
    }

    async fn status(state: Arc<ServerState>, uri: &str) -> StatusCode {
        crate::build_router(state)
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn no_authorizer_leaves_protected_routes_open() {
        let st = state_with(None);
        assert_eq!(status(st, "/.config").await, StatusCode::OK);
    }

    #[tokio::test]
    async fn unauthorized_protected_route_is_401() {
        let st = state_with(Some(Arc::new(Always(false))));
        assert_eq!(status(st, "/.config").await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authorized_protected_route_passes() {
        let st = state_with(Some(Arc::new(Always(true))));
        assert_eq!(status(st, "/.config").await, StatusCode::OK);
    }

    #[tokio::test]
    async fn ping_stays_open_even_when_authorizer_denies_all() {
        let st = state_with(Some(Arc::new(Always(false))));
        assert_eq!(status(st, "/.ping").await, StatusCode::OK);
    }

    #[tokio::test]
    async fn jwt_authorizer_guards_fs_end_to_end() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;

        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into());
        let st = state_with(Some(Arc::new(authz)));

        // No credential:  401.
        let r = crate::build_router(st.clone())
            .oneshot(Request::builder().uri("/.fs").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

        // Valid bearer: 200.
        let r = crate::build_router(st.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs")
                    .header("authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::OK);

        // Valid session cookie: 200.
        let r = crate::build_router(st)
            .oneshot(
                Request::builder()
                    .uri("/.fs")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::OK);
    }

    /// Regression guard: every write method on `/.fs`, and even an undeclared
    /// method, must be rejected by the auth layer — a future router refactor
    /// must not let a verb skate past it into an open handler/fallback.
    #[tokio::test]
    async fn all_fs_methods_are_guarded() {
        let st = state_with(Some(Arc::new(Always(false))));
        for (method, uri) in [
            ("PUT", "/.fs/x.md"),
            ("DELETE", "/.fs/x.md"),
            ("POST", "/.fs/x.md"),
        ] {
            let status = crate::build_router(st.clone())
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
                .status();
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri} must 401");
        }
    }

    /// `/.shell` and `/.proxy` are sensitive and must sit behind auth too
    /// (ported from the App's `shell_requires_auth` / `proxy_requires_auth`).
    #[tokio::test]
    async fn shell_and_proxy_require_authorization() {
        let st = state_with(Some(Arc::new(Always(false))));
        let shell = crate::build_router(st.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(shell.status(), StatusCode::UNAUTHORIZED, "/.shell must 401");

        let proxy = crate::build_router(st)
            .oneshot(
                Request::builder()
                    .uri("/.proxy/example.com/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(proxy.status(), StatusCode::UNAUTHORIZED, "/.proxy must 401");
    }

    /// `/.runtime/*` is sensitive and must sit behind auth too.
    #[tokio::test]
    async fn runtime_routes_require_authorization() {
        let st = state_with(Some(Arc::new(Always(false))));
        for (method, uri) in [
            ("POST", "/.runtime/lua"),
            ("POST", "/.runtime/lua_script"),
            ("GET", "/.runtime/logs"),
        ] {
            let status = crate::build_router(st.clone())
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
                .status();
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri} must 401");
        }
    }
}

#[cfg(test)]
mod metrics_tests {
    use crate::metrics::Metrics;
    use crate::state::ServerState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    fn state_with_metrics() -> (Arc<ServerState>, Arc<Metrics>) {
        let metrics = Arc::new(Metrics::new());
        let mut s = test_state();
        s.metrics = Some(metrics.clone());
        (Arc::new(s), metrics)
    }

    #[tokio::test]
    async fn counting_middleware_increments_http_requests() {
        let (state, metrics) = state_with_metrics();
        // Seed a bundle asset so the request is a clean 200.
        state
            .client_bundle
            .write_file(".client/a.js", b"x", None)
            .unwrap();
        let before = metrics.http_requests.get();
        let _ = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.client/a.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(metrics.http_requests.get(), before + 1);
    }

    #[tokio::test]
    async fn no_metrics_means_no_counting_and_no_panic() {
        // Default test_state has metrics = None; a request must still succeed.
        let state = test_state();
        let resp = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/.ping")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn metrics_router_serves_exposition() {
        let (state, metrics) = state_with_metrics();
        metrics.http_requests.inc();
        let resp = crate::metrics_router(state)
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(text.contains("silverbullet_http_requests"), "{text}");
    }

    #[tokio::test]
    async fn metrics_router_without_metrics_is_503() {
        let resp = crate::metrics_router(Arc::new(test_state()))
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn shell_execution_increments_counter_on_run() {
        // test_state's ShellConfig is enabled with an empty whitelist, which
        // allows all commands, so this `echo` actually runs (or, on Windows,
        // fails to spawn but still returns a response) → the counter ticks once.
        let (state, metrics) = state_with_metrics();
        let before = metrics.shell_executions.get();
        let _ = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"cmd":"echo","args":["hi"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(metrics.shell_executions.get(), before + 1);
    }

    #[tokio::test]
    async fn rejected_shell_request_does_not_increment_counter() {
        // A read-only space rejects the command before it runs → no increment
        // (only executed commands are counted).
        let metrics = Arc::new(Metrics::new());
        let mut s = test_state();
        s.metrics = Some(metrics.clone());
        s.boot_config.read_only = true;
        let state = Arc::new(s);
        let before = metrics.shell_executions.get();
        let _ = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"cmd":"echo","args":["hi"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(metrics.shell_executions.get(), before);
    }

    #[tokio::test]
    async fn proxy_increments_counter_only_on_successful_forward() {
        // Throwaway upstream so the proxy reaches a real response.
        let upstream = axum::routing::get(|| async { "ok" });
        let app = axum::Router::new().route("/x", upstream);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let (state, metrics) = state_with_metrics();
        let before = metrics.proxy_requests.get();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(format!("/.proxy/127.0.0.1:{port}/x"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(metrics.proxy_requests.get(), before + 1);
    }

    #[tokio::test]
    async fn read_only_proxy_does_not_increment_counter() {
        let metrics = Arc::new(Metrics::new());
        let mut s = test_state();
        s.metrics = Some(metrics.clone());
        s.boot_config.read_only = true;
        let state = Arc::new(s);
        let before = metrics.proxy_requests.get();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.proxy/example.com/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(metrics.proxy_requests.get(), before);
    }

    #[tokio::test]
    async fn runtime_eval_increments_counter_but_logs_does_not() {
        use crate::runtime::{LogEntry, RuntimeBackend, RuntimeError};
        use std::time::Duration;

        struct Noop;
        impl RuntimeBackend for Noop {
            fn eval_global(
                &self,
                _fn_name: &str,
                _arg: &str,
                _t: Duration,
            ) -> Result<serde_json::Value, RuntimeError> {
                Ok(serde_json::json!({ "result": null }))
            }
            fn logs(&self, _l: usize, _s: Option<i64>) -> Vec<LogEntry> {
                vec![]
            }
            fn ready(&self) -> bool {
                true
            }
        }

        let metrics = Arc::new(Metrics::new());
        let mut s = test_state();
        s.metrics = Some(metrics.clone());
        s.runtime = Some(Box::new(Noop));
        let state = Arc::new(s);

        let before = metrics.runtime_api_requests.get();
        // An eval request ticks the counter.
        let _ = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.runtime/lua")
                    .body(Body::from("1 + 1"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(metrics.runtime_api_requests.get(), before + 1);

        // A logs request does NOT.
        let _ = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.runtime/logs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(metrics.runtime_api_requests.get(), before + 1);
    }
}
