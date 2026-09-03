use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::extract::Request;
use axum::http::Method;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post, put};
use axum::Router;
use silverbullet_server_common::SpaceError;
use tower_http::compression::predicate::{DefaultPredicate, NotForContentType, Predicate};
use tower_http::compression::CompressionLayer;

use crate::auth::{AccessLevel, AuthOutcome};
use crate::handlers::{accounts, bundle, control, fs, revisions};
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

/// Paths here have the space's URL prefix already stripped by the multi-space
/// dispatcher, so they always start at `/.`.
///
/// Revisions need `Write` in both directions rather than `Read`: publishing a
/// space's current content is not publishing every revision it ever had, and
/// the client already drops its whole revisions surface in read-only mode, so
/// this keeps API and UI consistent without a second authorization axis.
pub(crate) fn required_level(method: &Method, path: &str) -> AccessLevel {
    let safe = matches!(*method, Method::GET | Method::HEAD);

    if path.starts_with("/.shell")
        || path.starts_with("/.proxy/")
        || path.starts_with("/.runtime/")
        || path.starts_with("/.revisions")
    {
        return AccessLevel::Write;
    }
    if !safe {
        return AccessLevel::Write;
    }
    AccessLevel::Read
}

/// A cookie whose name starts with this prefix is a SilverBullet session cookie
/// (`auth_<host>` / `auth_<host><prefix>`), so its presence marks a browser
/// session request — the only requests subject to the confused-deputy.
fn has_session_cookie(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|h| {
            h.split(';')
                .filter_map(|pair| pair.trim().split_once('='))
                .any(|(name, _)| name.starts_with("auth_"))
        })
        .unwrap_or(false)
}

fn has_bearer(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start().to_ascii_lowercase().starts_with("bearer "))
        .unwrap_or(false)
}

/// The request's own origin (`scheme://host`) as the browser would compute it.
fn own_origin(headers: &axum::http::HeaderMap) -> String {
    let scheme = if crate::auth::is_secure_request(headers) {
        "https"
    } else {
        "http"
    };
    format!("{scheme}://{}", crate::auth::request_host(headers))
}

pub(crate) fn cross_origin_refused(
    headers: &axum::http::HeaderMap,
    method: &Method,
    path: &str,
) -> bool {
    // Only the sensitive set is guarded.
    if required_level(method, path) != AccessLevel::Write {
        return false;
    }
    if has_bearer(headers) || !has_session_cookie(headers) {
        return false;
    }
    match headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_ascii_lowercase())
    {
        Some(ref s) if s == "cross-site" || s == "same-site" => true,
        Some(_) => false, // same-origin, none, or any unrecognized value: allow
        None => {
            // Legacy client without Sec-Fetch-*: fall back to Origin.
            match headers
                .get(axum::http::header::ORIGIN)
                .and_then(|v| v.to_str().ok())
            {
                Some(origin) => !origin.eq_ignore_ascii_case(&own_origin(headers)),
                None => false,
            }
        }
    }
}

/// Reject requests below the route's required access level. When no
/// authorizer is configured the server is open and trusted at `Write`.
/// Either way, inserts an `Extension<Actor>` carrying the verified identity
/// (if any) and its level so downstream handlers can attribute writes to it.
async fn require_authorization(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
    mut req: Request,
    next: Next,
) -> Response {
    let outcome = match state.authorizer.clone() {
        None => Some(AuthOutcome::trusted()),
        Some(authorizer) => {
            let ctx = crate::auth::AuthContext {
                method: req.method(),
                path: req.uri().path(),
                query: req.uri().query(),
                headers: req.headers(),
            };
            authorizer.authorize(&ctx)
        }
    };

    // The authorizer itself refusing the request (`None`) is not gradeable —
    // it never reaches the access policy, or an anonymous grade from a
    // permissive policy could paper over an outright denial.
    let Some(AuthOutcome { username, grant }) = outcome else {
        return refuse(&state, false);
    };
    let level = grant.unwrap_or_else(|| state.access_policy.level_for(username.as_deref()));
    let is_account = username.is_some() || grant.is_some();

    if level < required_level(req.method(), req.uri().path()) {
        return refuse(&state, is_account);
    }

    if cross_origin_refused(req.headers(), req.method(), req.uri().path()) {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "Cross-origin request refused",
        )
            .into_response();
    }

    let profile = state.identity.resolve(username.as_deref());
    req.extensions_mut().insert(actor_from(profile, level));
    next.run(req).await
}

/// An anonymous caller is sent to the login page, because signing in is the
/// remedy. An account that simply lacks the level is not: it is already past
/// the login page, so bouncing it there is a dead end.
fn refuse(state: &ServerState, is_account: bool) -> Response {
    if is_account {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "Insufficient access to this space",
        )
            .into_response();
    }
    let location = format!("{}/.auth", state.host_url_prefix);
    (
        axum::http::StatusCode::UNAUTHORIZED,
        [(axum::http::header::LOCATION, location)],
        "Unauthorized",
    )
        .into_response()
}

fn actor_from(profile: crate::auth::UserProfile, level: AccessLevel) -> crate::auth::Actor {
    crate::auth::Actor {
        username: profile.username,
        full_name: profile.full_name,
        email: profile.email,
        level,
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
        .route("/.accounts", get(accounts::handle_accounts))
        // Gzip/brotli-compress file reads (Accept-Encoding aware). Big text
        // assets like a self-hosted mermaid.min.js (~3.3 MB) transfer at
        // ~0.9 MB. Scoped to GET so writes are untouched. The `x-content-length`
        // metadata header still reflects the real (uncompressed) size.
        .route(
            "/.fs",
            get(fs::handle_fs_list).layer(CompressionLayer::new()),
        )
        .route(
            "/.fs/",
            get(fs::handle_fs_list).layer(CompressionLayer::new()),
        )
        .route(
            "/.fs/{*path}",
            get(fs::handle_fs_get).layer(CompressionLayer::new()),
        )
        .route("/.fs/{*path}", put(fs::handle_fs_put))
        .route("/.fs/{*path}", delete(fs::handle_fs_delete))
        .route(
            "/.fs/{*path}",
            post(fs::handle_fs_reconcile).layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .route("/.events", get(crate::handlers::events::handle_events))
        .route(
            "/.revisions/",
            get(revisions::handle_space_log)
                .post(revisions::handle_snapshot)
                .layer(CompressionLayer::new()),
        )
        .route(
            "/.revisions/{*path}",
            get(revisions::handle_file_revisions).layer(CompressionLayer::new()),
        )
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_authorization,
        ));

    // Unauthenticated POST bodies are otherwise buffered (via `Form<...>`)
    // before any auth/CSRF check runs, and the global body limit below is
    // disabled — so these three routes get their own cap.
    let auth_routes = Router::new()
        .route(
            "/.auth",
            get(crate::handlers::auth::handle_auth_get)
                .post(crate::handlers::auth::handle_auth_post),
        )
        .route(
            "/.auth/authorize",
            get(crate::handlers::oauth::handle_authorize_get)
                .post(crate::handlers::oauth::handle_authorize_post),
        )
        .route("/.auth/token", post(crate::handlers::oauth::handle_token))
        .route_layer(DefaultBodyLimit::max(64 * 1024));

    // Open: liveness + the SPA shell/assets must always load.
    let open = Router::new()
        .route("/.ping", get(control::handle_ping))
        .route("/.client/manifest.json", get(control::handle_manifest))
        .route("/.logout", get(crate::handlers::auth::handle_logout))
        .merge(auth_routes);

    let bundle_compression = CompressionLayer::new()
        .compress_when(DefaultPredicate::new().and(NotForContentType::const_new("font/")));

    open.merge(protected)
        .fallback(get(bundle::handle_client_bundle).layer(bundle_compression))
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
    use crate::auth::{AccessLevel, Actor, AuthContext, AuthOutcome, RequestAuthorizer};
    use crate::state::ServerState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    struct Always(bool);
    impl RequestAuthorizer for Always {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            self.0.then_some(AuthOutcome::anonymous())
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
    async fn removed_objects_endpoint_uses_client_bundle_fallback() {
        let state = test_state();
        state
            .client_bundle
            .write_file(".client/index.html", b"<html>client shell</html>", None)
            .unwrap();

        let response = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/.runtime/objects")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("content-type").unwrap(), "text/html");
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

    /// `/.accounts` emits the space's roster, so an unauthenticated request
    /// must never reach it.
    #[tokio::test]
    async fn accounts_requires_authorization() {
        let st = state_with(Some(Arc::new(Always(false))));
        assert_eq!(status(st, "/.accounts").await, StatusCode::UNAUTHORIZED);

        let st = state_with(Some(Arc::new(Always(true))));
        assert_eq!(status(st, "/.accounts").await, StatusCode::OK);
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

    /// An authenticated JWT (cookie session) request's verified username
    /// reaches downstream handlers via `Extension<Actor>`.
    #[tokio::test]
    async fn jwt_cookie_session_exposes_username_via_actor_extension() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;
        use axum::routing::get;
        use axum::Extension;

        async fn probe(Extension(actor): Extension<Actor>) -> String {
            actor.username.unwrap_or_default()
        }

        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into());
        let st = state_with(Some(Arc::new(authz)));

        let probe_router = axum::Router::new()
            .route("/probe", get(probe))
            .route_layer(axum::middleware::from_fn_with_state(
                st.clone(),
                super::require_authorization,
            ))
            .with_state(st);

        let resp = probe_router
            .oneshot(
                Request::builder()
                    .uri("/probe")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"alice");
    }

    /// The resolver runs on every request, including on an open server
    /// (`state.authorizer == None`) -- see `ServerState.identity`.
    #[tokio::test]
    async fn actor_carries_the_resolved_profile() {
        use axum::routing::get;
        use axum::Extension;

        struct FixedProfile;
        impl crate::auth::IdentityResolver for FixedProfile {
            fn resolve(&self, username: Option<&str>) -> crate::auth::UserProfile {
                crate::auth::UserProfile {
                    username: username.map(str::to_string),
                    full_name: Some("Ada Lovelace".into()),
                    email: Some("ada@example.org".into()),
                }
            }
        }

        async fn probe(Extension(actor): Extension<Actor>) -> String {
            assert_eq!(actor.level, AccessLevel::Write);
            format!(
                "{}|{}",
                actor.full_name.unwrap_or_default(),
                actor.email.unwrap_or_default()
            )
        }

        let mut s = test_state();
        s.authorizer = None;
        s.identity = Arc::new(FixedProfile);
        let st = Arc::new(s);

        let probe_router = axum::Router::new()
            .route("/probe", get(probe))
            .route_layer(axum::middleware::from_fn_with_state(
                st.clone(),
                super::require_authorization,
            ))
            .with_state(st);

        let resp = probe_router
            .oneshot(
                Request::builder()
                    .uri("/probe")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"Ada Lovelace|ada@example.org");
    }

    /// Bearer-token auth is a valid credential but carries no verified
    /// identity (constraint 4): `Actor.username` is `None`.
    #[tokio::test]
    async fn bearer_token_auth_yields_actor_with_no_username() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;
        use axum::routing::get;
        use axum::Extension;

        async fn probe(Extension(actor): Extension<Actor>) -> StatusCode {
            assert_eq!(actor.username, None);
            StatusCode::OK
        }

        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let authz = JwtAuthorizer::new(auth, "tok".into());
        let st = state_with(Some(Arc::new(authz)));

        let probe_router = axum::Router::new()
            .route("/probe", get(probe))
            .route_layer(axum::middleware::from_fn_with_state(
                st.clone(),
                super::require_authorization,
            ))
            .with_state(st);

        let resp = probe_router
            .oneshot(
                Request::builder()
                    .uri("/probe")
                    .header("authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
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

    #[test]
    fn capability_routes_require_write() {
        for path in ["/.shell", "/.proxy/https://example.com", "/.runtime/lua"] {
            assert_eq!(
                super::required_level(&Method::GET, path),
                AccessLevel::Write,
                "{path}"
            );
        }
    }

    #[test]
    fn reads_and_writes_of_fs_are_graded_separately() {
        assert_eq!(
            super::required_level(&Method::GET, "/.fs/index.md"),
            AccessLevel::Read
        );
        assert_eq!(
            super::required_level(&Method::PUT, "/.fs/index.md"),
            AccessLevel::Write
        );
        assert_eq!(
            super::required_level(&Method::POST, "/.fs/index.md"),
            AccessLevel::Write
        );
    }

    #[test]
    fn revisions_require_write_in_both_directions() {
        assert_eq!(
            super::required_level(&Method::GET, "/.revisions/index.md"),
            AccessLevel::Write
        );
        assert_eq!(
            super::required_level(&Method::POST, "/.revisions/"),
            AccessLevel::Write
        );
    }

    #[test]
    fn plain_reads_need_only_read() {
        for path in ["/.config", "/.accounts", "/.events", "/.fs"] {
            assert_eq!(
                super::required_level(&Method::GET, path),
                AccessLevel::Read,
                "{path}"
            );
        }
    }

    /// An unrecognized protected path defaults to `Write` for any mutating
    /// method, so a future route that forgets to special-case itself fails
    /// closed rather than silently opening up to `Read`-level callers.
    #[test]
    fn unknown_mutating_route_defaults_to_write() {
        assert_eq!(
            super::required_level(&Method::PUT, "/.something-new"),
            AccessLevel::Write
        );
    }

    struct AsUser(&'static str);
    impl RequestAuthorizer for AsUser {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            Some(AuthOutcome::user(self.0.to_string()))
        }
    }

    struct FixedPolicy(AccessLevel);
    impl crate::auth::AccessPolicy for FixedPolicy {
        fn level_for(&self, _username: Option<&str>) -> AccessLevel {
            self.0
        }
    }

    #[tokio::test]
    async fn account_below_required_level_is_403_without_location() {
        let mut s = test_state();
        s.authorizer = Some(Arc::new(AsUser("sam")));
        s.access_policy = Arc::new(FixedPolicy(AccessLevel::Read));
        let response = crate::build_router(Arc::new(s))
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/index.md")
                    .body(Body::from("hello"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response.headers().get("location").is_none());
    }

    #[tokio::test]
    async fn denied_request_is_401_with_location() {
        let mut s = test_state();
        s.authorizer = Some(Arc::new(Always(false)));
        s.access_policy = Arc::new(FixedPolicy(AccessLevel::Read));
        let response = crate::build_router(Arc::new(s))
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/index.md")
                    .body(Body::from("hello"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(response.headers().get("location").is_some());
    }

    /// `Always(true)` yields `AuthOutcome::anonymous()` -- the authorizer
    /// approved the request but verified no identity -- so this is graded
    /// through `access_policy`, unlike an outright denial above. This is the
    /// path `AnonymousFallbackAuthorizer` (Task 5) turns into the common case
    /// for anonymous visitors.
    #[tokio::test]
    async fn approved_anonymous_below_required_level_is_401_with_location() {
        let mut s = test_state();
        s.authorizer = Some(Arc::new(Always(true)));
        s.access_policy = Arc::new(FixedPolicy(AccessLevel::Read));
        let response = crate::build_router(Arc::new(s))
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/index.md")
                    .body(Body::from("hello"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(response.headers().get("location").is_some());
    }

    #[test]
    fn cross_origin_refused_policy() {
        use axum::http::{HeaderMap, HeaderValue, Method};
        let sensitive = "/.shell";
        let read = "/some/page"; // GET here is required_level Read

        fn h(pairs: &[(&str, &str)]) -> HeaderMap {
            let mut m = HeaderMap::new();
            for (k, v) in pairs {
                m.insert(
                    k.parse::<axum::http::HeaderName>().unwrap(),
                    HeaderValue::from_str(v).unwrap(),
                );
            }
            m
        }
        let post = &Method::POST;
        let get = &Method::GET;
        let cookie = ("cookie", "auth_localhost_4137=jwt");

        // Non-sensitive route (a plain GET): never guarded, even cross-site + cookie.
        assert!(!super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "cross-site")]),
            get,
            read
        ));

        // Bearer token present: skipped even on a sensitive cross-site POST.
        assert!(!super::cross_origin_refused(
            &h(&[
                ("authorization", "Bearer abc"),
                ("sec-fetch-site", "cross-site")
            ]),
            post,
            sensitive
        ));

        // No session cookie (and no bearer): skipped.
        assert!(!super::cross_origin_refused(
            &h(&[("sec-fetch-site", "cross-site")]),
            post,
            sensitive
        ));

        assert!(!super::cross_origin_refused(
            &h(&[
                cookie,
                ("authorization", "Bearer abc"),
                ("sec-fetch-site", "cross-site")
            ]),
            post,
            sensitive
        ));

        // Cookie-authed sensitive POST, cross-site / same-site -> REFUSE.
        assert!(super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "cross-site")]),
            post,
            sensitive
        ));
        assert!(super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "same-site")]),
            post,
            sensitive
        ));

        // Cookie-authed sensitive POST, same-origin / none -> allow.
        assert!(!super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "same-origin")]),
            post,
            sensitive
        ));
        assert!(!super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "none")]),
            post,
            sensitive
        ));

        // Unknown sec-fetch-site value -> lenient allow.
        assert!(!super::cross_origin_refused(
            &h(&[cookie, ("sec-fetch-site", "weird")]),
            post,
            sensitive
        ));

        // No sec-fetch-site -> Origin fallback. Mismatch refuses; match/absent allow.
        assert!(super::cross_origin_refused(
            &h(&[
                cookie,
                ("host", "a.example.com"),
                ("origin", "https://evil.example.com")
            ]),
            post,
            sensitive
        ));
        assert!(!super::cross_origin_refused(
            &h(&[
                cookie,
                ("host", "a.example.com"),
                ("x-forwarded-proto", "https"),
                ("origin", "https://a.example.com")
            ]),
            post,
            sensitive
        ));
        assert!(!super::cross_origin_refused(
            &h(&[cookie, ("host", "a.example.com")]),
            post,
            sensitive
        )); // no Origin
    }

    /// A cookie-authed cross-site POST to a sensitive path (e.g. `/.shell`) is
    /// refused by the `require_authorization` layer itself (not just the pure
    /// `cross_origin_refused` function): a same-origin cookie POST and a
    /// cross-site bearer POST both pass through to the inner handler.
    #[tokio::test]
    async fn cross_origin_cookie_post_is_refused() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;
        use axum::routing::post;

        async fn probe() -> StatusCode {
            StatusCode::OK
        }

        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into());
        let st = state_with(Some(Arc::new(authz)));

        // Sensitive path so `required_level` grades it `Write`.
        let probe_router = axum::Router::new()
            .route("/.shell", post(probe))
            .route_layer(axum::middleware::from_fn_with_state(
                st.clone(),
                super::require_authorization,
            ))
            .with_state(st);

        // Cookie-authed, cross-site: refused by the guard, not the inner handler.
        let resp = probe_router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);

        // Cookie-authed, same-origin: passes the guard, reaches the handler.
        let resp = probe_router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .header("sec-fetch-site", "same-origin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Bearer, cross-site: bearer skips the guard entirely.
        let resp = probe_router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .header("authorization", "Bearer tok")
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
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
        s.runtime = Some(Arc::new(Noop));
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
