//! The admin-only REST API: space and account management. It carries no shell,
//! assets or login of its own — it is nested under `/api/admin` on the unified
//! `/.spaces` surface (see `space_index`), which owns the session. Sessions use
//! the same host-wide account cookie as every prefix-bound space.

use std::sync::Arc;

use axum::extract::{Path as AxumPath, Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{Authenticator, JwtAuthorizer, RequestAuthorizer};
use crate::multi::access::UserTokenAuthorizer;
use crate::multi::config::SpaceConfig;
use crate::multi::manager::{ApiError, MultiManager};
use crate::multi::users::UserStore;
use crate::router::run_blocking;

pub struct AdminState {
    pub manager: Arc<MultiManager>,
    pub authorizer: Arc<dyn RequestAuthorizer>,
    /// Same credentials, without the admin requirement. Used only to tell
    /// "not logged in" (401) apart from "logged in, but not an admin" (403);
    /// it never grants access on its own.
    pub account_authorizer: Arc<dyn RequestAuthorizer>,
    pub users: Arc<UserStore>,
}

impl AdminState {
    /// Uses the same server-wide authenticator as every space. Sessions are
    /// minted by the unified `/.spaces` surface; this state only *authorizes*,
    /// and both cookie sessions and bearer tokens are restricted to current
    /// administrators.
    pub fn new(
        manager: Arc<MultiManager>,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
    ) -> Self {
        let is_admin_token = {
            let store = users.clone();
            move |u: &str| store.is_admin(u)
        };
        let is_admin_session = {
            let store = users.clone();
            move |claims: &crate::auth::authenticator::Claims| {
                store.session_is_current(&claims.username, claims.credential_version.as_deref())
                    && store.is_admin(&claims.username)
            }
        };
        let jwt = JwtAuthorizer::with_filter(
            authenticator.clone(),
            String::new(),
            String::new(),
            Box::new(is_admin_session),
        );
        let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(UserTokenAuthorizer::new(
            Box::new(jwt),
            users.clone(),
            Box::new(is_admin_token),
        ));
        let is_current_session = {
            let store = users.clone();
            move |claims: &crate::auth::authenticator::Claims| {
                store.session_is_current(&claims.username, claims.credential_version.as_deref())
            }
        };
        let account_jwt = JwtAuthorizer::with_filter(
            authenticator,
            String::new(),
            String::new(),
            Box::new(is_current_session),
        );
        let account_authorizer: Arc<dyn RequestAuthorizer> = Arc::new(UserTokenAuthorizer::new(
            Box::new(account_jwt),
            users.clone(),
            Box::new(|user: &str| !user.is_empty()),
        ));
        Self {
            manager,
            authorizer,
            account_authorizer,
            users,
        }
    }
}

/// Gates every admin API route, distinguishing the two failure modes the
/// client has to treat differently: **401** means there is no valid session,
/// so the browser should go log in; **403** means the caller *is* signed in
/// but is not an administrator, which is a dead end — redirecting it to the
/// login screen would bounce straight back here and loop forever.
async fn require_admin(State(state): State<Arc<AdminState>>, req: Request, next: Next) -> Response {
    // `state.authorizer` alone decides pass/fail. `account_authorizer` is only
    // consulted on the failure path, to choose between 401 and 403 — it must
    // never be able to admit a request that `state.authorizer` rejected.
    let rejection = {
        let ctx = crate::auth::AuthContext {
            method: req.method(),
            path: req.uri().path(),
            query: req.uri().query(),
            headers: req.headers(),
        };
        if state.authorizer.is_authorized(&ctx) {
            None
        } else if state.account_authorizer.is_authorized(&ctx) {
            Some((StatusCode::FORBIDDEN, "Forbidden"))
        } else {
            Some((StatusCode::UNAUTHORIZED, "Unauthorized"))
        }
    };
    match rejection {
        None => next.run(req).await,
        Some(r) => r.into_response(),
    }
}

async fn handle_list(State(state): State<Arc<AdminState>>) -> Response {
    Json(state.manager.list()).into_response()
}

fn api_error(e: ApiError) -> Response {
    match e {
        ApiError::Validation(errors) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
        }
        ApiError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "errors": [{ "field": "id", "message": "no such space" }] })),
        )
            .into_response(),
        ApiError::Internal(msg) => {
            tracing::error!("admin API internal error: {msg}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "errors": [{ "field": "", "message": msg }] })),
            )
                .into_response()
        }
    }
}

/// Maps `UserStore`'s plain `Err(String)` to a response: a message starting
/// with "no such" (missing user/token) is 404; everything else — invalid
/// username, duplicate username/token, the last-admin guards — is 400. The
/// `field` is derived from the known message prefixes/strings `UserStore`
/// actually produces (see `multi::users`) so the admin UI can highlight the
/// right input; anything unrecognized falls back to `""`. The last-admin
/// guards are matched by their exact strings (not a substring heuristic)
/// so an unrelated message that happens to mention "admin" doesn't get
/// mis-tagged.
fn user_store_error(msg: String) -> Response {
    if msg.starts_with("no such") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "errors": [{ "field": "", "message": msg }] })),
        )
            .into_response();
    }
    let field = if msg.starts_with("invalid username") || msg.starts_with("user ") {
        "username"
    } else if msg.starts_with("token ") {
        "name"
    } else if msg == "cannot remove the last admin" || msg == "cannot demote the last admin" {
        "admin"
    } else {
        ""
    };
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "errors": [{ "field": field, "message": msg }] })),
    )
        .into_response()
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    #[serde(default = "default_true")]
    seed_index: bool,
    #[serde(flatten)]
    config: SpaceConfig,
}

async fn handle_create(
    State(state): State<Arc<AdminState>>,
    Json(body): Json<CreateBody>,
) -> Response {
    let manager = state.manager.clone();
    let CreateBody { seed_index, config } = body;
    match run_blocking(move || Ok(manager.create(config, seed_index))).await {
        Ok(Ok(id)) => Json(json!({ "id": id })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_update(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(cfg): Json<SpaceConfig>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.update(&id, cfg))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_get(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.manager.get(&id) {
        Some(v) => Json(v).into_response(),
        None => api_error(ApiError::NotFound),
    }
}

async fn handle_patch(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<serde_json::Map<String, serde_json::Value>>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.patch(&id, body))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_delete(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.delete(&id))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

// --- Account management (users.json via `UserStore`) ---------------------

async fn handle_list_users(State(state): State<Arc<AdminState>>) -> Response {
    Json(state.users.list()).into_response()
}

async fn handle_get_user(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    match state.users.get(&name) {
        Some(user) => Json(user).into_response(),
        None => user_store_error(format!("no such user {name:?}")),
    }
}

#[derive(Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    #[serde(default)]
    admin: bool,
}

async fn handle_create_user(
    State(state): State<Arc<AdminState>>,
    Json(body): Json<CreateUserBody>,
) -> Response {
    let users = state.users.clone();
    let result =
        run_blocking(move || Ok(users.create_user(&body.username, &body.password, body.admin)))
            .await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Deletes the account first, then atomically sweeps it out of every space's
/// `members` and shrinks the manager's known-users set to the store's
/// post-delete usernames.
async fn handle_delete_user(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    let users = state.users.clone();
    let name_for_store = name.clone();
    match run_blocking(move || Ok(users.delete_user(&name_for_store))).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return user_store_error(e),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
    let manager = state.manager.clone();
    let users_for_sweep = state.users.clone();
    let name_for_sweep = name;
    match run_blocking(move || {
        let new_known_users = users_for_sweep.usernames();
        Ok(manager.remove_member_everywhere(&name_for_sweep, new_known_users))
    })
    .await
    {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

async fn handle_set_user_password(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<PasswordBody>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.set_password(&name, &body.password))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct SetAdminBody {
    admin: bool,
}

async fn handle_set_admin(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<SetAdminBody>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.set_admin(&name, body.admin))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct CreateTokenBody {
    name: String,
}

async fn handle_create_token(
    State(state): State<Arc<AdminState>>,
    AxumPath(user): AxumPath<String>,
    Json(body): Json<CreateTokenBody>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.create_token(&user, &body.name))).await;
    match result {
        Ok(Ok(token)) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "token": token })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_delete_token(
    State(state): State<Arc<AdminState>>,
    AxumPath((user, token_name)): AxumPath<(String, String)>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.delete_token(&user, &token_name))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct DirsQuery {
    #[serde(default)]
    path: String,
}

async fn handle_fs_dirs(
    State(state): State<Arc<AdminState>>,
    axum::extract::Query(q): axum::extract::Query<DirsQuery>,
) -> Response {
    let root = state.manager.root().to_path_buf();
    let result = run_blocking(move || Ok(dir_completion(&root, &q.path))).await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Path status + subdirectory suggestions for a folder-picker field. Relative
/// input resolves against the server root; directory names only. Shared with
/// the setup surface (`GET /.setup/api/fs/dirs`) so both the admin space form
/// and the first-run wizard drive the same picker off one implementation.
pub(crate) fn dir_completion(root: &std::path::Path, input: &str) -> serde_json::Value {
    let input_is_absolute = std::path::Path::new(input).is_absolute();
    let resolved = {
        let p = std::path::Path::new(input);
        if input_is_absolute {
            p.to_path_buf()
        } else {
            root.join(p)
        }
    };
    let status = match std::fs::metadata(&resolved) {
        Ok(m) if m.is_dir() => "exists",
        Ok(_) => "notADirectory",
        Err(_) => "missing",
    };
    let writable = status == "exists"
        && std::fs::metadata(&resolved)
            .map(|m| !m.permissions().readonly())
            .unwrap_or(false);

    // Complete the last path component against its parent directory.
    let (parent, partial) = if status == "exists" || input.ends_with('/') {
        (resolved.clone(), String::new())
    } else {
        (
            resolved
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| root.to_path_buf()),
            resolved
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
    };
    let mut suggestions: Vec<String> = std::fs::read_dir(&parent)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    !name.starts_with('.') && name.starts_with(&partial)
                })
                .map(|e| {
                    let path = e.path();
                    // For relative input, keep suggestions relative to the
                    // server root; absolute input keeps absolute suggestions.
                    let shown = if input_is_absolute {
                        path.as_path()
                    } else {
                        path.strip_prefix(root).unwrap_or(path.as_path())
                    };
                    shown.to_string_lossy().to_string()
                })
                .collect()
        })
        .unwrap_or_default();
    suggestions.sort();
    suggestions.truncate(50);

    json!({ "status": status, "writable": writable, "suggestions": suggestions })
}

/// The admin route table. Deliberately returns an UNGATED router: the gate is
/// applied by the only caller, `build_admin_api_router`. Add new admin routes
/// here — because this function cannot express a layer, a route added anywhere
/// in it is gated, with no ordering rule to remember.
fn admin_api_routes() -> Router<Arc<AdminState>> {
    Router::new()
        .route("/spaces", get(handle_list).post(handle_create))
        .route(
            "/spaces/{id}",
            get(handle_get)
                .put(handle_update)
                .patch(handle_patch)
                .delete(handle_delete),
        )
        .route("/fs/dirs", get(handle_fs_dirs))
        .route("/users", get(handle_list_users).post(handle_create_user))
        .route(
            "/users/{name}",
            get(handle_get_user)
                .put(handle_set_admin)
                .delete(handle_delete_user),
        )
        .route("/users/{name}/password", post(handle_set_user_password))
        .route("/users/{name}/tokens", post(handle_create_token))
        .route(
            "/users/{name}/tokens/{token_name}",
            axum::routing::delete(handle_delete_token),
        )
}

/// The admin-only API surface, gated by a single `require_admin` layer.
///
/// Returned already finalized with its state so it can be nested into a router
/// carrying a different state type.
pub fn build_admin_api_router(state: Arc<AdminState>) -> Router {
    admin_api_routes()
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin))
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use crate::multi::manager::MultiManager;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn test_authenticator() -> Arc<Authenticator> {
        Arc::new(Authenticator::from_secret_bytes(vec![9; 32], "v1".into()))
    }

    fn deps(
        root: &std::path::Path,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
    ) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users,
                authenticator,
            },
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            index_template: "# Test space\n".into(),
        }
    }

    pub(crate) fn admin_router(
        dir: &tempfile::TempDir,
    ) -> (axum::Router, Arc<MultiManager>, Arc<UserStore>) {
        let users = UserStore::create_empty(dir.path()).unwrap();
        users.create_user("admin", "adminpw1", true).unwrap();
        let authenticator = test_authenticator();
        let manager = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path(), users.clone(), authenticator.clone()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        let state = Arc::new(AdminState::new(
            manager.clone(),
            users.clone(),
            authenticator,
        ));
        // Nested at `/api` so these tests address the same URIs the unified
        // surface exposes at `/api/admin/...` minus its own prefix.
        let router = axum::Router::new().nest("/api", build_admin_api_router(state));
        (router, manager, users)
    }

    /// The API no longer mints sessions — `/.spaces/api/login` does (see
    /// `space_index`). `test_authenticator()` is deterministic, so forge the
    /// very cookie that surface would have set. Reading `credential_version`
    /// live keeps the forged session subject to revocation exactly as a real
    /// one is.
    fn session_cookie(users: &UserStore, username: &str) -> String {
        let jwt = test_authenticator()
            .issue_jwt_with_version(
                username,
                users.credential_version(username).unwrap_or_default(),
                3600,
            )
            .unwrap();
        format!(
            "{}={jwt}",
            crate::auth::scoped_auth_cookie_name("localhost", "")
        )
    }

    async fn send(router: &axum::Router, req: Request<Body>) -> axum::response::Response {
        router.clone().oneshot(req).await.unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .header("host", "localhost")
            .body(Body::empty())
            .unwrap()
    }

    #[test]
    fn admin_and_spaces_share_one_authenticator() {
        use crate::multi::config::{Binding, SpaceConfig};
        use crate::multi::instance::{build_instance, InstanceStatus};

        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users.create_user("admin", "adminpw1", true).unwrap();
        let authenticator = test_authenticator();

        // The admin surface persists its signing secret to the *admin* file
        // under the data root.
        let manager = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path(), users.clone(), authenticator.clone()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        AdminState::new(manager, users.clone(), authenticator.clone());

        // A private (users-backed) space whose folder resolves to the data
        // root persists its own secret to the *space* file in that same dir.
        let cfg = SpaceConfig {
            name: "Root".into(),
            folder: dir.path().to_str().unwrap().to_string(),
            binding: Binding::Prefix { prefix: "/".into() },
            public: false,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            extra: Default::default(),
        };
        let inst = build_instance(
            "root",
            &cfg,
            &deps(dir.path(), users.clone(), authenticator.clone()),
        );
        assert!(
            matches!(inst.status, InstanceStatus::Running),
            "{:?}",
            inst.status
        );

        assert!(Arc::strong_count(&authenticator) > 1);
    }

    #[tokio::test]
    async fn api_is_gated_and_an_admin_session_unlocks_it() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        assert_eq!(
            send(&r, get("/api/spaces")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        let cookie = session_cookie(&users, "admin");
        assert!(cookie.starts_with("auth_localhost="), "{cookie}");
        let resp = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        // A valid session for a *non-admin* account is still refused — but as
        // 403, not 401: the caller is signed in, so sending it to the login
        // screen would only bounce it back here.
        users.create_user("bob", "pw123456", false).unwrap();
        let bob = session_cookie(&users, "bob");
        let resp = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &bob)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    /// The 401/403 split the unified `/.spaces` client depends on: no session
    /// at all is 401 (go log in), a valid non-admin session is 403 (a dead
    /// end the client must render as an error, never as a redirect).
    #[tokio::test]
    async fn admin_api_is_401_without_a_session_and_403_for_a_non_admin() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);

        // No cookie at all.
        assert_eq!(
            send(&r, get("/api/spaces")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        // A cookie that isn't a valid JWT is equally "not logged in".
        let garbage = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", "auth_localhost=not-a-jwt")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(garbage.status(), StatusCode::UNAUTHORIZED);

        // A valid session belonging to a non-admin account.
        users.create_user("alice", "alicepw12", false).unwrap();
        let alice = session_cookie(&users, "alice");
        let forbidden = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &alice)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        // Promoting her flips the same session to allowed, confirming the 403
        // was about the role and not about the session being unreadable.
        users.set_admin("alice", true).unwrap();
        let allowed = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &alice)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    async fn authed(
        router: &axum::Router,
        method: &str,
        uri: &str,
        body: &str,
        cookie: &str,
    ) -> axum::response::Response {
        send(
            router,
            Request::builder()
                .method(method)
                .uri(uri)
                .header("host", "localhost")
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(if body.is_empty() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
    }

    async fn body_json(resp: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// Create a space through the API and return its id.
    async fn create_space(router: &axum::Router, cookie: &str, body: &str) -> String {
        let resp = authed(router, "POST", "/api/spaces", body, cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        body_json(resp).await["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn get_single_space_returns_the_collection_shape() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Work");
        // The live derived status is present, exactly as in the list view.
        assert!(v.get("status").is_some(), "{v}");
    }

    #[tokio::test]
    async fn get_unknown_space_is_404() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let resp = authed(&router, "GET", "/api/spaces/nope", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn patch_carrying_unknown_auth_is_400() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"auth":{"mode":"inherit"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );
    }

    #[tokio::test]
    async fn patch_name_only_leaves_other_fields_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"},"readOnly":true}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"name":"Renamed"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Renamed");
        assert_eq!(
            v["readOnly"], true,
            "PATCH must not reset unnamed fields: {v}"
        );
    }

    #[tokio::test]
    async fn patch_members_with_an_unknown_user_is_400() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        // Validation is not relaxed for PATCH: an unknown member fails exactly
        // as it does through PUT. `admin_router` boots with no known users.
        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"members":{"ghost":{}}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn patch_empty_body_is_a_noop_returning_ok() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            "{}",
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Work");
    }

    #[tokio::test]
    async fn crud_lifecycle_over_http() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        // Create.
        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        let id = v["id"].as_str().unwrap().to_string();

        // List shows it running.
        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert_eq!(v[&id]["status"]["state"], "running");

        // Update to a new prefix.
        let resp = authed(
            &r,
            "PUT",
            &format!("/api/spaces/{id}"),
            &format!(r#"{{"name":"Work","folder":"spaces/{id}","binding":{{"prefix":"/w2"}}}}"#),
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Validation error shape.
        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Dup","binding":{"prefix":"/w2"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(!v["errors"].as_array().unwrap().is_empty(), "{v}");

        // Delete.
        let resp = authed(&r, "DELETE", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = authed(&r, "DELETE", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn fs_dirs_completion_and_status() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("alpha")).unwrap();
        std::fs::create_dir_all(dir.path().join("alps")).unwrap();
        std::fs::create_dir_all(dir.path().join("beta")).unwrap();
        std::fs::write(dir.path().join("afile"), "x").unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        // Unauthenticated: gated.
        assert_eq!(
            send(&r, get("/api/fs/dirs?path=al")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        // Partial relative path completes against the server root, and the
        // suggestions stay relative to it (not absolute).
        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=al", "", &cookie).await).await;
        assert_eq!(v["status"], "missing");
        let sugg: Vec<String> = v["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        assert!(sugg.iter().any(|s| s == "alpha"), "{sugg:?}");
        assert!(sugg.iter().any(|s| s == "alps"), "{sugg:?}");
        assert!(!sugg.iter().any(|s| s == "beta"), "{sugg:?}");

        // Absolute input keeps absolute suggestions.
        let abs = format!("{}/al", dir.path().display());
        let v =
            body_json(authed(&r, "GET", &format!("/api/fs/dirs?path={abs}"), "", &cookie).await)
                .await;
        let abs_sugg: Vec<String> = v["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        assert!(
            abs_sugg
                .iter()
                .any(|s| s.ends_with("/alpha") && s.starts_with('/')),
            "{abs_sugg:?}"
        );

        // Existing dir.
        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=alpha", "", &cookie).await).await;
        assert_eq!(v["status"], "exists");

        // A file is notADirectory.
        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=afile", "", &cookie).await).await;
        assert_eq!(v["status"], "notADirectory");
    }

    #[tokio::test]
    async fn port_check_endpoint_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let response = authed(&r, "GET", "/api/net/port?port=4000", "", &cookie).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn admin_api_token_of_admin_user_works_and_member_token_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir); // helper now also returns the store
        users.create_user("bob", "pw123456", false).unwrap();
        let admin_tok = users.create_token("admin", "ci").unwrap();
        let bob_tok = users.create_token("bob", "ci").unwrap();
        let ok = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(ok.status(), StatusCode::OK);
        let no = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {bob_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        // Bob's token is a real credential, so this is 403 (authenticated,
        // not permitted) rather than 401 — same split as cookie sessions.
        assert_eq!(no.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn user_crud_lifecycle_over_http_incl_last_admin_guard() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        // The sole admin can't be demoted or deleted through itself. (These
        // are guard failures — the store is untouched, so `cookie` stays a
        // valid admin session for everything that follows. Actually flipping
        // `admin`'s own flag would 401 the rest of this test, since
        // `require_admin` re-checks admin-ness live on every request.)
        let resp = authed(&r, "PUT", "/api/users/admin", r#"{"admin":false}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["message"]
                .as_str()
                .unwrap()
                .contains("last admin"),
            "{v}"
        );
        let resp = authed(&r, "DELETE", "/api/users/admin", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        // Create a non-admin user.
        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], false);
        assert_eq!(v["admin"]["admin"], true);

        // A stable user-detail route gets the same redacted shape as one
        // entry in the collection and never exposes password/token hashes.
        let v = body_json(authed(&r, "GET", "/api/users/bob", "", &cookie).await).await;
        assert_eq!(v["admin"], false);
        assert!(v.get("passwordHash").is_none(), "{v}");
        let resp = authed(&r, "GET", "/api/users/ghost", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        // Duplicate username is a 400 with a username field.
        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["errors"][0]["field"], "username");

        // Promote bob to admin (now two admins: admin + bob).
        let resp = authed(&r, "PUT", "/api/users/bob", r#"{"admin":true}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], true);

        // With two admins, demoting bob (not `admin`, whose session we're
        // using) is fine.
        let resp = authed(&r, "PUT", "/api/users/bob", r#"{"admin":false}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], false);

        // And, being a non-admin now, bob can be deleted outright.
        let resp = authed(&r, "DELETE", "/api/users/bob", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert!(v.get("bob").is_none());

        // Deleting/updating a nonexistent user 404s.
        let resp = authed(&r, "DELETE", "/api/users/ghost", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let resp = authed(&r, "PUT", "/api/users/ghost", r#"{"admin":true}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn token_endpoint_returns_plaintext_once_and_gates_admin_api() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/users/admin/tokens",
                r#"{"name":"ci"}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let admin_tok = v["token"].as_str().unwrap().to_string();
        assert!(admin_tok.starts_with("sbt_"), "{admin_tok}");

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/users/bob/tokens",
                r#"{"name":"ci"}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let bob_tok = v["token"].as_str().unwrap().to_string();

        let ok = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(ok.status(), StatusCode::OK);

        let no = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {bob_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        // Authenticated as bob, just not permitted.
        assert_eq!(no.status(), StatusCode::FORBIDDEN);

        // Revoking the token removes its authority.
        let resp = authed(&r, "DELETE", "/api/users/admin/tokens/ci", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let no_more = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(no_more.status(), StatusCode::UNAUTHORIZED);

        // Deleting an unknown token 404s.
        let resp = authed(&r, "DELETE", "/api/users/admin/tokens/nope", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn password_reset_endpoint_revokes_existing_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users/admin/password",
            r#"{"password":"newpw12345"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Resetting the password revoked the session that performed the
        // reset: the JWT still verifies, but its credential version is stale.
        assert_eq!(
            authed(&r, "GET", "/api/users", "", &cookie).await.status(),
            StatusCode::UNAUTHORIZED
        );
        // A session minted after the reset is accepted again. (Whether the
        // *password* itself now works at login is the unified surface's
        // concern — see `space_index`'s
        // `password_reset_through_the_admin_api_changes_the_login_result`.)
        let new_cookie = session_cookie(&users, "admin");
        assert_eq!(
            authed(&r, "GET", "/api/users", "", &new_cookie)
                .await
                .status(),
            StatusCode::OK
        );

        // A nonexistent user 404s.
        let resp = authed(
            &r,
            "POST",
            "/api/users/ghost/password",
            r#"{"password":"whatever12"}"#,
            &new_cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deleting_user_sweeps_membership_from_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                r#"{"name":"Team","binding":{"prefix":"/team"},"members":{"bob":{}}}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();

        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert!(
            v[&id]["members"].as_object().unwrap().contains_key("bob"),
            "{v}"
        );

        let resp = authed(&r, "DELETE", "/api/users/bob", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // `members` is omitted entirely once empty (skip_serializing_if), so
        // "no key" and "key present but without bob" both count as swept.
        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert!(
            !v[&id]["members"]
                .as_object()
                .is_some_and(|m| m.contains_key("bob")),
            "{v}"
        );
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert!(v.get("bob").is_none());

        // Persisted, not just the in-memory view.
        let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        assert!(!raw.contains("bob"), "{raw}");
    }

    #[tokio::test]
    async fn auth_field_rejected_on_create_and_update() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Work","binding":{"prefix":"/work"},"auth":{"mode":"none"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );

        // A space created without the unknown field can be updated — just not
        // by introducing it.
        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();

        let resp = authed(
            &r,
            "PUT",
            &format!("/api/spaces/{id}"),
            &format!(
                r#"{{"name":"Work","folder":"spaces/{id}","binding":{{"prefix":"/work"}},"auth":{{"mode":"none"}}}}"#
            ),
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );
    }
}
