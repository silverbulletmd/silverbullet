use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::extract::Request;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post, put};
use axum::Router;
use silverbullet_common::SpaceError;

use crate::handlers::{bundle, control, fs};
use crate::state::AppState;

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
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
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
        (axum::http::StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
    }
}

/// Build the HTTP router for the file/config/bundle endpoints. Protected routes
/// require authorization when an authorizer is configured.
pub fn build_router(state: Arc<AppState>) -> Router {
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_authorization,
        ));

    // Open: liveness + the SPA shell/assets must always load.
    let open = Router::new().route("/.ping", get(control::handle_ping));

    open.merge(protected)
        .fallback(get(bundle::handle_client_bundle))
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

#[cfg(test)]
mod auth_tests {
    use crate::auth::{AuthContext, RequestAuthorizer};
    use crate::state::AppState;
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

    fn state_with(authz: Option<Arc<dyn RequestAuthorizer>>) -> Arc<AppState> {
        let mut s = std::sync::Arc::try_unwrap(test_state())
            .ok()
            .expect("unique");
        s.authorizer = authz;
        Arc::new(s)
    }

    async fn status(state: Arc<AppState>, uri: &str) -> StatusCode {
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

        let auth = Authenticator::from_secret_bytes(vec![5u8; 32], "h".into());
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into(), "sb_auth".into());
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
                    .header("cookie", format!("sb_auth={token}"))
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
}
