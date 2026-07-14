//! The `/.admin` surface: login (admin credentials from SB_USER), the admin
//! SPA shell + assets, and the space-management REST API. Sessions use the
//! `auth_<host>__admin` cookie scoped to Path=/.admin.

use std::sync::Arc;

use axum::extract::{Path as AxumPath, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use silverbullet_server_common::SpacePrimitives;

use crate::auth::cookie::set_cookie_value;
use crate::auth::{
    is_secure_request, request_host, scoped_auth_cookie_name, AuthConfig, Authenticator,
    CookieOptions, JwtAuthorizer, LockoutTimer, LoginManager, RequestAuthorizer,
};
use crate::multi::config::SpaceConfig;
use crate::multi::manager::{ApiError, MultiManager};
use crate::router::run_blocking;

pub const ADMIN_PREFIX: &str = "/.admin";

pub struct AdminState {
    pub manager: Arc<MultiManager>,
    pub login: Arc<LoginManager>,
    pub authorizer: Arc<dyn RequestAuthorizer>,
    pub client_bundle: Box<dyn SpacePrimitives>,
}

impl AdminState {
    pub fn new(
        manager: Arc<MultiManager>,
        authenticator: Arc<Authenticator>,
        auth_config: AuthConfig,
        client_bundle: Box<dyn SpacePrimitives>,
    ) -> Self {
        let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(JwtAuthorizer::with_prefix(
            authenticator.clone(),
            auth_config.auth_token.clone(),
            ADMIN_PREFIX.to_string(),
        ));
        let lockout =
            LockoutTimer::from_config(auth_config.lockout_time_secs, auth_config.lockout_limit);
        let login = Arc::new(LoginManager::new(
            authenticator,
            auth_config,
            lockout,
            ADMIN_PREFIX.to_string(),
        ));
        Self {
            manager,
            login,
            authorizer,
            client_bundle,
        }
    }
}

/// 401 for API routes without a valid admin session.
async fn require_admin(State(state): State<Arc<AdminState>>, req: Request, next: Next) -> Response {
    let authorized = {
        let ctx = crate::auth::AuthContext {
            method: req.method(),
            path: req.uri().path(),
            query: req.uri().query(),
            headers: req.headers(),
        };
        state.authorizer.is_authorized(&ctx)
    };
    if authorized {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
    }
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

async fn handle_login(
    State(state): State<Arc<AdminState>>,
    headers: axum::http::HeaderMap,
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
    let (jwt, secs) = match state.login.issue_session(&body.username, false) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("failed to mint admin session JWT: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response();
        }
    };
    let host = request_host(&headers);
    let opts = CookieOptions {
        path: ADMIN_PREFIX.to_string(),
        max_age_secs: Some(secs as i64),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut resp = Json(json!({ "status": "ok" })).into_response();
    let name = scoped_auth_cookie_name(&host, ADMIN_PREFIX);
    if let Ok(v) = set_cookie_value(&name, &jwt, &opts).parse() {
        resp.headers_mut().append(header::SET_COOKIE, v);
    }
    resp
}

async fn handle_logout(
    State(_state): State<Arc<AdminState>>,
    headers: axum::http::HeaderMap,
) -> Response {
    let host = request_host(&headers);
    let opts = CookieOptions {
        path: ADMIN_PREFIX.to_string(),
        max_age_secs: Some(0),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut resp = Json(json!({ "status": "ok" })).into_response();
    let name = scoped_auth_cookie_name(&host, ADMIN_PREFIX);
    if let Ok(v) = set_cookie_value(&name, "", &opts).parse() {
        resp.headers_mut().append(header::SET_COOKIE, v);
    }
    resp
}

async fn handle_shell(State(state): State<Arc<AdminState>>) -> Response {
    let s = state.clone();
    match run_blocking(move || s.client_bundle.read_file(".client/admin.html")).await {
        Ok((data, _)) => ([(header::CONTENT_TYPE, "text/html")], data).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Admin UI not found in client bundle").into_response(),
    }
}

async fn handle_asset(
    State(state): State<Arc<AdminState>>,
    AxumPath(file): AxumPath<String>,
) -> Response {
    if file.contains("..") || file.contains('/') {
        return (StatusCode::BAD_REQUEST, "Invalid asset path").into_response();
    }
    let s = state.clone();
    let path = format!(".client/{file}");
    match run_blocking(move || s.client_bundle.read_file(&path)).await {
        Ok((data, _)) => {
            let ctype = match file.rsplit('.').next() {
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("map") | Some("json") => "application/json",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, ctype)], data).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
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

async fn handle_create(
    State(state): State<Arc<AdminState>>,
    Json(cfg): Json<SpaceConfig>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.create(cfg))).await {
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

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

async fn handle_set_password(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<PasswordBody>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.set_password(&id, &body.password))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
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

#[derive(Deserialize)]
struct PortQuery {
    #[serde(default)]
    port: String,
    /// Space id whose own current port binding counts as available (editing).
    #[serde(default, rename = "self")]
    self_id: Option<String>,
}

/// `GET /api/net/port?port=…[&self=<id>]` — live availability check for the
/// form's port field: `{"status": "available"|"inUse"|"invalid", "reason"}`.
async fn handle_port_check(
    State(state): State<Arc<AdminState>>,
    axum::extract::Query(q): axum::extract::Query<PortQuery>,
) -> Response {
    let port = match q.port.trim().parse::<u16>() {
        Ok(p) if p != 0 => p,
        _ => {
            return Json(json!({ "status": "invalid", "reason": "not a valid port number" }))
                .into_response();
        }
    };
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.port_check(port, q.self_id.as_deref()))).await {
        Ok((true, reason)) => {
            Json(json!({ "status": "available", "reason": reason })).into_response()
        }
        Ok((false, reason)) => Json(json!({ "status": "inUse", "reason": reason })).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Path status + subdirectory suggestions for the admin form's folder field.
/// Relative input resolves against the server root. Directory names only.
fn dir_completion(root: &std::path::Path, input: &str) -> serde_json::Value {
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

pub fn build_admin_router(state: Arc<AdminState>) -> Router {
    let api = Router::new()
        .route("/api/spaces", get(handle_list).post(handle_create))
        .route(
            "/api/spaces/{id}",
            axum::routing::put(handle_update).delete(handle_delete),
        )
        .route("/api/spaces/{id}/password", post(handle_set_password))
        .route("/api/fs/dirs", get(handle_fs_dirs))
        .route("/api/net/port", get(handle_port_check))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));
    Router::new()
        .route("/", get(handle_shell))
        .route("/index.html", get(handle_shell))
        .route("/assets/{file}", get(handle_asset))
        .route("/api/login", post(handle_login))
        .route("/api/logout", get(handle_logout))
        .merge(api)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::instance::{AssetFactories, InstanceDeps};
    use crate::multi::manager::MultiManager;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use silverbullet_server_common::SpacePrimitives;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_| None),
            metrics: None,
            admin_auth: crate::auth::AuthConfig::try_parse(
                Some("admin:pw"),
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap(),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
        }
    }

    pub(crate) fn admin_router(dir: &tempfile::TempDir) -> (axum::Router, Arc<MultiManager>) {
        let manager =
            MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), 3000, None).unwrap();
        let authenticator = Arc::new(crate::auth::Authenticator::from_parts(
            vec![7u8; 32],
            "c2FsdA==".into(),
            "h".into(),
        ));
        let auth_config =
            crate::auth::AuthConfig::try_parse(Some("admin:pw"), None, None, None, None)
                .unwrap()
                .unwrap();
        let bundle = MemorySpacePrimitives::new();
        bundle
            .write_file(".client/admin.html", b"<html>ADMIN-SHELL</html>", None)
            .unwrap();
        bundle
            .write_file(".client/admin.js", b"//js", None)
            .unwrap();
        let state = Arc::new(AdminState::new(
            manager.clone(),
            authenticator,
            auth_config,
            Box::new(bundle),
        ));
        (build_admin_router(state), manager)
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

    async fn login_cookie(router: &axum::Router) -> String {
        let resp = send(
            router,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"pw"}"#))
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        resp.headers()[axum::http::header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn shell_and_assets_are_open() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = admin_router(&dir);
        assert_eq!(send(&r, get("/")).await.status(), StatusCode::OK);
        assert_eq!(
            send(&r, get("/assets/admin.js")).await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn api_is_gated_and_login_cookie_unlocks_it() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = admin_router(&dir);
        assert_eq!(
            send(&r, get("/api/spaces")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        let cookie = login_cookie(&r).await;
        assert!(cookie.starts_with("auth_localhost__admin="), "{cookie}");
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
    }

    #[tokio::test]
    async fn login_cookie_is_scoped_to_admin_path() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = admin_router(&dir);
        let resp = send(
            &r,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"pw"}"#))
                .unwrap(),
        )
        .await;
        let raw = resp.headers()[axum::http::header::SET_COOKIE]
            .to_str()
            .unwrap();
        assert!(raw.contains("Path=/.admin"), "{raw}");
        assert!(raw.contains("HttpOnly"), "{raw}");
    }

    #[tokio::test]
    async fn bad_credentials_rejected_json() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = admin_router(&dir);
        let resp = send(
            &r,
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"nope"}"#))
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp.headers().get(axum::http::header::SET_COOKIE).is_none());
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["status"], "error");
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

    #[tokio::test]
    async fn crud_lifecycle_over_http() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m) = admin_router(&dir);
        let cookie = login_cookie(&r).await;

        // Create.
        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Work","binding":{"prefix":"/work"},"auth":{"mode":"none"}}"#,
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
        let resp = authed(&r, "PUT", &format!("/api/spaces/{id}"),
            &format!(r#"{{"name":"Work","folder":"spaces/{id}","binding":{{"prefix":"/w2"}},"auth":{{"mode":"none"}}}}"#),
            &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Validation error shape.
        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Dup","binding":{"prefix":"/w2"},"auth":{"mode":"none"}}"#,
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
    async fn password_endpoint_hashes_and_redacts() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m) = admin_router(&dir);
        let cookie = login_cookie(&r).await;
        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                r#"{"name":"C","binding":{"prefix":"/c"},"auth":{"mode":"custom","user":"u"}}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();
        let resp = authed(
            &r,
            "POST",
            &format!("/api/spaces/{id}/password"),
            r#"{"password":"hunter2"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert_eq!(v[&id]["hasPassword"], true);
        assert!(v[&id]["auth"].get("passHash").is_none());
        // Persisted hash on disk is argon2id, not plaintext.
        let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        assert!(!raw.contains("hunter2"));
        assert!(raw.contains("$argon2id$"));
    }

    #[tokio::test]
    async fn fs_dirs_completion_and_status() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("alpha")).unwrap();
        std::fs::create_dir_all(dir.path().join("alps")).unwrap();
        std::fs::create_dir_all(dir.path().join("beta")).unwrap();
        std::fs::write(dir.path().join("afile"), "x").unwrap();
        let (r, _m) = admin_router(&dir);
        let cookie = login_cookie(&r).await;

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
    async fn port_check_statuses() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m) = admin_router(&dir);
        let cookie = login_cookie(&r).await;

        // Gated.
        assert_eq!(
            send(&r, get("/api/net/port?port=4000")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        // Invalid input.
        let v = body_json(authed(&r, "GET", "/api/net/port?port=nope", "", &cookie).await).await;
        assert_eq!(v["status"], "invalid");
        let v = body_json(authed(&r, "GET", "/api/net/port?port=0", "", &cookie).await).await;
        assert_eq!(v["status"], "invalid");

        // A free port is available.
        let free = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let v = body_json(
            authed(
                &r,
                "GET",
                &format!("/api/net/port?port={free}"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(v["status"], "available");

        // The admin router's manager was booted with main_port 3000.
        let v = body_json(authed(&r, "GET", "/api/net/port?port=3000", "", &cookie).await).await;
        assert_eq!(v["status"], "inUse");

        // A port held by another process is not bindable.
        let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let held = blocker.local_addr().unwrap().port();
        let v = body_json(
            authed(
                &r,
                "GET",
                &format!("/api/net/port?port={held}"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(v["status"], "inUse");

        // A port claimed by an existing space is inUse — unless it's the space
        // being edited (self exclusion).
        let space_port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                &format!(
                    r#"{{"name":"P","binding":{{"port":{space_port}}},"auth":{{"mode":"none"}}}}"#
                ),
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap();
        let v = body_json(
            authed(
                &r,
                "GET",
                &format!("/api/net/port?port={space_port}"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(v["status"], "inUse");
        let v = body_json(
            authed(
                &r,
                "GET",
                &format!("/api/net/port?port={space_port}&self={id}"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(v["status"], "available");
    }
}
