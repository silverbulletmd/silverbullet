//! The single logged-in web surface, served at `/.spaces`. Any valid account
//! can log in; the space list contains only the spaces that account may
//! actually open. Administrators additionally get the space/user management
//! screens, driven by the admin API nested at `/api/admin` — one shell, one
//! session, one set of assets.

use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use silverbullet_server_common::SpacePrimitives;

use crate::auth::cookie::set_cookie_value;
use crate::auth::{
    cookie_value, is_secure_request, request_host, scoped_auth_cookie_name, Authenticator,
    CookieOptions, LoginManager,
};
use crate::multi::access::{AnyUserAuth, SessionPolicy};
use crate::multi::manager::MultiManager;
use crate::multi::users::{Profile, UserStore};
use crate::router::run_blocking;

pub const SPACES_PREFIX: &str = "/.spaces";

pub struct SpaceIndexState {
    manager: Arc<MultiManager>,
    login: Arc<LoginManager>,
    authenticator: Arc<Authenticator>,
    users: Arc<UserStore>,
    client_bundle: Box<dyn SpacePrimitives>,
    oidc_configured: bool,
}

impl SpaceIndexState {
    pub fn new(
        manager: Arc<MultiManager>,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
        session: SessionPolicy,
        client_bundle: Box<dyn SpacePrimitives>,
        oidc_configured: bool,
    ) -> Self {
        // Server-wide, not per-account: `LockoutTimer` counts failures across
        // every login attempt against this surface regardless of username
        // (see `is_locked`/`record_failure`, called below with no username).
        // Before the admin UI merged into `/.spaces`, `/.admin` minted its own
        // `LockoutTimer`, so failed logins against ordinary accounts could not
        // lock administrators out of their separate door. Now that both share
        // this one timer, an attacker spraying failed logins against any
        // account can also delay administrator login. This is inherent to
        // having a single surface, and was reviewed and accepted as the
        // tradeoff for unifying them — not an oversight. Changing it means
        // per-account lockout, which is a deliberate design change, not a fix.
        let lockout = session.lockout();
        let version_store = users.clone();
        let login = Arc::new(
            LoginManager::new(
                authenticator.clone(),
                Arc::new(AnyUserAuth {
                    store: users.clone(),
                }),
                session.remember_me_hours,
                lockout,
                String::new(),
            )
            .with_credential_version(Arc::new(move |username| {
                version_store
                    .credential_version(username)
                    .unwrap_or_default()
            }))
            .with_server_wide_session(),
        );
        Self {
            manager,
            login,
            authenticator,
            users,
            client_bundle,
            oidc_configured,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginBody {
    username: String,
    password: String,
    /// Opt into the longer `SessionPolicy::remember_me_hours` session. Absent
    /// in older clients, so it defaults to a short session, not a sticky one.
    #[serde(default)]
    remember_me: bool,
}

async fn handle_login(
    State(state): State<Arc<SpaceIndexState>>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if state.login.is_locked() {
        return Json(
            json!({ "status": "error", "error": "Too many failed attempts — please wait" }),
        )
        .into_response();
    }
    if !state.login.authorize(&body.username, &body.password) {
        state.login.record_failure();
        return Json(json!({ "status": "error", "error": "Invalid username and/or password" }))
            .into_response();
    }
    let (jwt, secs) = match state.login.issue_session(&body.username, body.remember_me) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!("failed to mint space-index session JWT: {error}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response();
        }
    };
    let options = CookieOptions {
        path: "/".to_string(),
        max_age_secs: Some(secs as i64),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut response = Json(json!({ "status": "ok" })).into_response();
    let name = scoped_auth_cookie_name(&request_host(&headers), "");
    if let Ok(value) = set_cookie_value(&name, &jwt, &options).parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

async fn handle_logout(headers: HeaderMap) -> Response {
    let options = CookieOptions {
        path: "/".to_string(),
        max_age_secs: Some(0),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut response = Json(json!({ "status": "ok" })).into_response();
    let name = scoped_auth_cookie_name(&request_host(&headers), "");
    if let Ok(value) = set_cookie_value(&name, "", &options).parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

fn current_username(state: &SpaceIndexState, headers: &HeaderMap) -> Option<String> {
    let name = scoped_auth_cookie_name(&request_host(headers), "");
    let token = cookie_value(headers, &name)?;
    let claims = state.authenticator.verify_jwt(&token).ok()?;
    state
        .users
        .session_is_current(&claims.username, claims.credential_version.as_deref())
        .then_some(claims.username)
}

/// Any *account* — not public. The client reads `admin` from here to decide
/// whether to render the Users tab and edit affordances; that is a display
/// hint only, since every admin route is gated server-side regardless.
async fn handle_session(State(state): State<Arc<SpaceIndexState>>, headers: HeaderMap) -> Response {
    let Some(username) = current_username(&state, &headers) else {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    };
    let admin = state.users.is_admin(&username);
    Json(json!({ "username": username, "admin": admin, "oidcConfigured": state.oidc_configured }))
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileBody {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    email: String,
}

async fn handle_get_profile(
    State(state): State<Arc<SpaceIndexState>>,
    headers: HeaderMap,
) -> Response {
    let Some(username) = current_username(&state, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let profile = state.users.profile(&username).unwrap_or_default();
    Json(json!({
        "username": username,
        "admin": state.users.is_admin(&username),
        "fullName": profile.full_name,
        "email": profile.email,
    }))
    .into_response()
}

/// The username comes from the session cookie only, never from the request
/// body — this is what stops a caller from naming another account.
async fn handle_put_profile(
    State(state): State<Arc<SpaceIndexState>>,
    headers: HeaderMap,
    Json(body): Json<ProfileBody>,
) -> Response {
    let Some(username) = current_username(&state, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let profile = match Profile::parse(&body.full_name, &body.email) {
        Ok(profile) => profile,
        Err(e) => return profile_error(e),
    };
    let users = state.users.clone();
    match run_blocking(move || Ok(users.set_profile(&username, profile))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => profile_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

fn profile_error(message: String) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "errors": [{ "field": "", "message": message }] })),
    )
        .into_response()
}

async fn handle_list(State(state): State<Arc<SpaceIndexState>>, headers: HeaderMap) -> Response {
    let Some(username) = current_username(&state, &headers) else {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    };
    let admin = state.users.is_admin(&username);
    Json(state.manager.list_accessible(&username, admin)).into_response()
}

async fn handle_shell(State(state): State<Arc<SpaceIndexState>>) -> Response {
    let bundle = state.clone();
    let oidc_configured = state.oidc_configured;
    match run_blocking(move || bundle.client_bundle.read_file(".client/spaces.html")).await {
        Ok((data, _)) => {
            let shell = String::from_utf8_lossy(&data);
            let mut env = minijinja::Environment::new();
            env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
            let ctx = minijinja::context! { oidc_configured => oidc_configured };
            let body = match env.render_str(&shell, ctx) {
                Ok(rendered) => rendered.into_bytes(),
                Err(err) => {
                    tracing::error!("spaces.html template render failed: {err}");
                    data
                }
            };
            ([(header::CONTENT_TYPE, "text/html")], body).into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Spaces UI not found in client bundle",
        )
            .into_response(),
    }
}

async fn handle_asset(
    State(state): State<Arc<SpaceIndexState>>,
    AxumPath(file): AxumPath<String>,
) -> Response {
    if file.contains("..") || file.contains('/') {
        return (StatusCode::BAD_REQUEST, "Invalid asset path").into_response();
    }
    let bundle = state.clone();
    let path = format!(".client/{file}");
    match run_blocking(move || bundle.client_bundle.read_file(&path)).await {
        Ok((data, _)) => {
            let content_type = match file.rsplit('.').next() {
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("map") | Some("json") => "application/json",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, content_type)], data).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

/// The single logged-in surface. Shell routes are open (the shell is a static
/// bundle); every screen it renders is driven by data behind `/api/*`, which
/// authorizes per request. `admin_api` arrives already gated — see
/// `build_admin_api_router`.
pub fn build_spaces_router(state: Arc<SpaceIndexState>, admin_api: Router) -> Router {
    let router = Router::new()
        .route("/", get(handle_shell))
        .route("/index.html", get(handle_shell))
        .route("/new", get(handle_shell))
        .route("/users", get(handle_shell))
        .route("/users/new", get(handle_shell))
        .route("/users/{name}", get(handle_shell))
        .route("/login", get(handle_shell))
        // Single-segment catch-all for a space id. Static segments above win
        // in matchit, so `/new`, `/users` and `/login` are unaffected.
        .route("/{id}", get(handle_shell))
        .route("/assets/{file}", get(handle_asset))
        .route("/api/session", get(handle_session))
        .route(
            "/api/profile",
            get(handle_get_profile).put(handle_put_profile),
        )
        .route("/api/spaces", get(handle_list))
        .route("/api/login", post(handle_login))
        .route("/api/logout", get(handle_logout));

    router
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
        // Nested after with_state: both sides are Router<()> here.
        .nest("/api/admin", admin_api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use crate::multi::users::Profile;
    use axum::body::Body;
    use axum::http::Request;
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use tower::ServiceExt;

    fn config(name: &str, prefix: &str, public: bool, members: &[&str]) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding: Binding::Prefix {
                prefix: prefix.into(),
            },
            public,
            members: members
                .iter()
                .map(|name| (name.to_string(), Default::default()))
                .collect(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: String::new(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            extra: Default::default(),
        }
    }

    fn setup() -> (tempfile::TempDir, Router) {
        setup_with(SessionPolicy::default())
    }

    fn setup_with(session: SessionPolicy) -> (tempfile::TempDir, Router) {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("admin", "adminpw", true, Profile::default())
            .unwrap();
        users
            .create_user("alice", "alicepw", false, Profile::default())
            .unwrap();
        users
            .create_user("bob", "bobpw", false, Profile::default())
            .unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![7; 32], "v1".into()));
        let deps = InstanceDeps {
            root: dir.path().to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users: users.clone(),
                authenticator: authenticator.clone(),
                session,
            },
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: false,
            index_template: "# Test\n".into(),
            shutdown: None,
            space_prefixes: Default::default(),
            #[cfg(feature = "oidc")]
            oidc: None,
        };
        let manager =
            MultiManager::boot(dir.path().to_path_buf(), deps, users.usernames()).unwrap();
        manager
            .create(config("Public", "/public", true, &[]), true)
            .unwrap();
        manager
            .create(config("Alice", "/alice", false, &["alice"]), true)
            .unwrap();
        manager
            .create(config("Bob", "/bob", false, &["bob"]), true)
            .unwrap();
        let bundle = MemorySpacePrimitives::new();
        bundle
            .write_file(".client/spaces.html", b"SPACES-SHELL", None)
            .unwrap();
        bundle
            .write_file(".client/admin.css", b"/* styles */", None)
            .unwrap();
        let admin_state = Arc::new(crate::multi::admin_api::AdminState::new(
            manager.clone(),
            users.clone(),
            authenticator.clone(),
            crate::runtime::RuntimeAvailability::Available,
            false,
        ));
        let state = Arc::new(SpaceIndexState::new(
            manager,
            users,
            authenticator,
            session,
            Box::new(bundle),
            false,
        ));
        (
            dir,
            build_spaces_router(
                state,
                crate::multi::admin_api::build_admin_api_router(admin_state),
            ),
        )
    }

    async fn send(router: &Router, request: Request<Body>) -> Response {
        router.clone().oneshot(request).await.unwrap()
    }

    async fn login(router: &Router, username: &str, password: &str) -> String {
        let response = send(
            router,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "username": username, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let set_cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(set_cookie.contains("Path=/"));
        set_cookie.split(';').next().unwrap().to_string()
    }

    async fn list(router: &Router, cookie: Option<&str>) -> Response {
        let mut request = Request::builder()
            .uri("/api/spaces")
            .header("host", "localhost");
        if let Some(cookie) = cookie {
            request = request.header("cookie", cookie);
        }
        send(router, request.body(Body::empty()).unwrap()).await
    }

    async fn json_body(response: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// `GET /api/spaces` is the `VisibleSpace` list itself — a bare JSON array,
    /// with no envelope. The `admin` flag it used to carry now lives on
    /// `GET /api/session`.
    fn space_names(body: &serde_json::Value) -> Vec<String> {
        body.as_array()
            .expect("the space list should be an array")
            .iter()
            .map(|s| s["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn shell_is_public_but_space_list_requires_a_session() {
        let (_dir, router) = setup();
        assert_eq!(
            send(
                &router,
                Request::builder().uri("/").body(Body::empty()).unwrap()
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert_eq!(list(&router, None).await.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn ordinary_user_sees_public_and_member_spaces_only() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let body = json_body(list(&router, Some(&cookie)).await).await;
        let mut names = space_names(&body);
        names.sort();
        assert_eq!(names, ["Alice", "Public"]);
    }

    #[tokio::test]
    async fn administrator_sees_every_space() {
        let (_dir, router) = setup();
        let cookie = login(&router, "admin", "adminpw").await;
        let body = json_body(list(&router, Some(&cookie)).await).await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn non_admin_list_omits_sensitive_fields() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let body = json_body(list(&router, Some(&cookie)).await).await;
        let spaces = body.as_array().unwrap();
        // Guard against a vacuously-true loop below if the fixture ever
        // stopped returning any space to alice.
        assert!(
            !spaces.is_empty(),
            "expected alice to see at least one space"
        );
        for space in spaces {
            let obj = space.as_object().unwrap();
            // The allowlist: exactly these keys, nothing else. An allowlist,
            // not a denylist of named-sensitive fields — a denylist would
            // silently pass if a new field (e.g. `description`) were added
            // to `VisibleSpace` without being one of the ones named here.
            let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
            keys.sort();
            assert_eq!(keys, vec!["binding", "id", "name", "state"]);
        }
    }

    #[tokio::test]
    async fn session_reports_admin_flag() {
        let (_dir, router) = setup();
        let cookie = login(&router, "admin", "adminpw").await;
        let response = send(
            &router,
            Request::builder()
                .uri("/api/session")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        let body = json_body(response).await;
        assert_eq!(body["username"], "admin");
        assert_eq!(body["admin"], true);
    }

    #[tokio::test]
    async fn session_for_non_admin_reports_false() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let body = json_body(
            send(
                &router,
                Request::builder()
                    .uri("/api/session")
                    .header("host", "localhost")
                    .header("Cookie", &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await,
        )
        .await;
        assert_eq!(body["username"], "alice");
        assert_eq!(body["admin"], false);
    }

    #[tokio::test]
    async fn session_without_cookie_is_401() {
        let (_dir, router) = setup();
        let response = send(
            &router,
            Request::builder()
                .uri("/api/session")
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn profile_get_and_put_operate_on_the_caller() {
        let (dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;

        let resp = send(
            &router,
            Request::builder()
                .method("PUT")
                .uri("/api/profile")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"fullName":"Alice Smith","email":"alice@example.org"}"#,
                ))
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = send(
            &router,
            Request::builder()
                .uri("/api/profile")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        let body = json_body(resp).await;
        assert_eq!(body["username"], "alice");
        assert_eq!(body["fullName"], "Alice Smith");
        assert_eq!(body["email"], "alice@example.org");

        // The write went to alice, never to anyone else.
        let users = UserStore::open(dir.path()).unwrap().unwrap();
        assert_eq!(users.profile("bob").unwrap(), Profile::default());
    }

    #[tokio::test]
    async fn profile_requires_a_session() {
        let (_dir, router) = setup();
        let resp = send(
            &router,
            Request::builder()
                .uri("/api/profile")
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logout_clears_the_session_cookie() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let response = send(
            &router,
            Request::builder()
                .uri("/api/logout")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let set_cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(set_cookie.starts_with("auth_localhost=;"), "{set_cookie}");
        assert!(set_cookie.contains("Max-Age=0"), "{set_cookie}");
    }

    #[tokio::test]
    async fn login_cookie_is_server_wide_and_http_only() {
        let (_dir, router) = setup();
        let response = send(
            &router,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "username": "admin", "password": "adminpw" }).to_string(),
                ))
                .unwrap(),
        )
        .await;
        let raw = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(raw.contains("Path=/;"), "{raw}");
        assert!(raw.contains("HttpOnly"), "{raw}");
    }

    /// The surface's remember-me window comes from the `SessionPolicy` it was
    /// built with, not a compiled-in constant: an unchecked "remember me" gets
    /// the fixed one-week session, checking it gets the configured window.
    #[tokio::test]
    async fn remember_me_window_follows_the_session_policy() {
        let (_dir, router) = setup_with(SessionPolicy {
            remember_me_hours: 2,
            ..SessionPolicy::default()
        });
        let max_age = |remember: bool| {
            let router = router.clone();
            async move {
                let response = send(
                    &router,
                    Request::builder()
                        .method("POST")
                        .uri("/api/login")
                        .header("host", "localhost")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({
                                "username": "admin",
                                "password": "adminpw",
                                "rememberMe": remember
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await;
                let raw = response.headers()[header::SET_COOKIE]
                    .to_str()
                    .unwrap()
                    .to_string();
                raw.split(';')
                    .map(str::trim)
                    .find_map(|part| part.strip_prefix("Max-Age="))
                    .unwrap_or_default()
                    .to_string()
            }
        };
        assert_eq!(max_age(true).await, "7200");
        assert_eq!(
            max_age(false).await,
            crate::auth::login::SESSION_EXPIRY_SECS.to_string(),
            "an ordinary session is unaffected by the remember-me window"
        );
    }

    /// Same for the lockout thresholds: a limit of one locks the surface after
    /// a single failure, so even correct credentials are turned away.
    #[tokio::test]
    async fn lockout_thresholds_follow_the_session_policy() {
        let (_dir, router) = setup_with(SessionPolicy {
            lockout_limit: 1,
            lockout_time_secs: 3600,
            ..SessionPolicy::default()
        });
        let attempt = |password: &'static str| {
            let router = router.clone();
            async move {
                json_body(
                    send(
                        &router,
                        Request::builder()
                            .method("POST")
                            .uri("/api/login")
                            .header("host", "localhost")
                            .header("content-type", "application/json")
                            .body(Body::from(
                                json!({ "username": "admin", "password": password }).to_string(),
                            ))
                            .unwrap(),
                    )
                    .await,
                )
                .await["error"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string()
            }
        };
        assert!(attempt("wrong").await.contains("Invalid username"));
        assert!(attempt("adminpw")
            .await
            .contains("Too many failed attempts"));
    }

    #[tokio::test]
    async fn bad_credentials_rejected_json_without_a_cookie() {
        let (_dir, router) = setup();
        let response = send(
            &router,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "username": "admin", "password": "nope" }).to_string(),
                ))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get(header::SET_COOKIE).is_none());
        assert_eq!(json_body(response).await["status"], "error");
    }

    /// A signed-in non-admin is *forbidden*, not *unauthenticated*. The
    /// distinction is load-bearing for the client: `/.spaces` is the landing
    /// screen for every account, and it only redirects to the login page on
    /// 401. A 401 here would send alice to a login screen that sees her
    /// perfectly valid session and bounces her straight back — a loop.
    #[tokio::test]
    async fn non_admin_session_is_403_from_admin_api_not_401() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let response = send(
            &router,
            Request::builder()
                .uri("/api/admin/users")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    /// The other half of the split: alice can still see her own landing data,
    /// so the 403 above costs her nothing on the screen she actually lands on.
    #[tokio::test]
    async fn non_admin_still_gets_session_and_spaces_on_the_landing_screen() {
        let (_dir, router) = setup();
        let cookie = login(&router, "alice", "alicepw").await;
        let session = send(
            &router,
            Request::builder()
                .uri("/api/session")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(session.status(), StatusCode::OK);
        let v = json_body(session).await;
        assert_eq!(v["username"], "alice");
        assert_eq!(v["admin"], false);

        let spaces = list(&router, Some(&cookie)).await;
        assert_eq!(spaces.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn admin_can_reach_admin_api() {
        let (_dir, router) = setup();
        let cookie = login(&router, "admin", "adminpw").await;
        let response = send(
            &router,
            Request::builder()
                .uri("/api/admin/users")
                .header("host", "localhost")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    /// No session at all is 401 — the one case where the client *should*
    /// navigate to the login screen.
    #[tokio::test]
    async fn anonymous_is_401_from_admin_api() {
        let (_dir, router) = setup();
        let response = send(
            &router,
            Request::builder()
                .uri("/api/admin/spaces")
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    /// The admin API and the login endpoint are two halves of one surface now,
    /// so the round trip is testable end to end: an admin resets an account's
    /// password through `/api/admin`, and `/api/login` immediately reflects it.
    #[tokio::test]
    async fn password_reset_through_the_admin_api_changes_the_login_result() {
        let (_dir, router) = setup();
        let cookie = login(&router, "admin", "adminpw").await;

        let response = send(
            &router,
            Request::builder()
                .method("POST")
                .uri("/api/admin/users/alice/password")
                .header("host", "localhost")
                .header("cookie", &cookie)
                .header("content-type", "application/json")
                .body(Body::from(json!({ "password": "newalicepw" }).to_string()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);

        let attempt = |password: &'static str| {
            let router = router.clone();
            async move {
                json_body(
                    send(
                        &router,
                        Request::builder()
                            .method("POST")
                            .uri("/api/login")
                            .header("host", "localhost")
                            .header("content-type", "application/json")
                            .body(Body::from(
                                json!({ "username": "alice", "password": password }).to_string(),
                            ))
                            .unwrap(),
                    )
                    .await,
                )
                .await
            }
        };
        assert_eq!(attempt("alicepw").await["status"], "error");
        assert_eq!(attempt("newalicepw").await["status"], "ok");
    }

    #[tokio::test]
    async fn spa_routes_serve_the_shell() {
        let (_dir, router) = setup();
        // Every deep-linkable view is a static bundle load; the SPA decides
        // what to render. `/{id}` is a single-segment catch-all for a space
        // id, so the static names below must not be swallowed by it — hence
        // the body assertion, not just the status.
        for uri in [
            "/",
            "/index.html",
            "/new",
            "/users",
            "/users/new",
            "/users/alice",
            "/login",
            "/some-space-id",
        ] {
            let response = send(
                &router,
                Request::builder().uri(uri).body(Body::empty()).unwrap(),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(&body[..], b"SPACES-SHELL", "{uri} did not return the shell");
        }
    }

    /// The route table pairs static single-segment routes (`/new`, `/users`,
    /// `/login`) with a `/{id}` catch-all. Both currently resolve to the same
    /// handler, so a same-router test cannot tell them apart — this mirrors the
    /// exact route strings with distinguishable handlers to pin the matchit
    /// priority that `build_spaces_router` relies on. If axum ever stopped
    /// preferring static segments, this fails loudly instead of silently
    /// routing `/users` at a space named "users".
    #[tokio::test]
    async fn static_spa_routes_win_over_the_space_id_catch_all() {
        let probe: Router = Router::new()
            .route("/new", get(|| async { "static" }))
            .route("/users", get(|| async { "static" }))
            .route("/login", get(|| async { "static" }))
            .route("/index.html", get(|| async { "static" }))
            .route("/{id}", get(|| async { "catch-all" }));
        for (uri, expected) in [
            ("/new", "static"),
            ("/users", "static"),
            ("/login", "static"),
            ("/index.html", "static"),
            ("/anything-else", "catch-all"),
        ] {
            let response = send(
                &probe,
                Request::builder().uri(uri).body(Body::empty()).unwrap(),
            )
            .await;
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(
                std::str::from_utf8(&body).unwrap(),
                expected,
                "{uri} routed to the wrong handler"
            );
        }
    }

    #[tokio::test]
    async fn assets_are_served_with_a_content_type() {
        let (_dir, router) = setup();
        let response = send(
            &router,
            Request::builder()
                .uri("/assets/admin.css")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/css");
        // Traversal out of `.client/` is refused.
        assert_eq!(
            send(
                &router,
                Request::builder()
                    .uri("/assets/..%2Fsecret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
}
