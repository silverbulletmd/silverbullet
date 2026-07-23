//! The `/.setup` surface: the first-run provisioning wizard an
//! otherwise-unconfigured server puts up. Serves the setup SPA shell + assets
//! from the client bundle and accepts the completed form — running
//! [`run_setup`] and then firing `on_complete` (which, in the running server,
//! hot-swaps the live router into the full multi-space stack).

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use silverbullet_server_common::SpacePrimitives;

use crate::multi::admin_api::dir_completion;
use crate::multi::setup::{canonicalize_best_effort, run_setup, SetupRequest};
use crate::router::run_blocking;

/// Everything the setup surface needs to serve the wizard and provision the
/// root. `on_complete` is called after a successful [`run_setup`]; in the
/// running server it swaps the live router into the multi-space stack.
pub struct SetupState {
    pub root: PathBuf,
    pub client_bundle: Box<dyn SpacePrimitives>,
    /// Seeded into a first space's index page (mirrors admin/single mode).
    pub index_template: String,
    pub on_complete: Box<dyn Fn() + Send + Sync>,
    /// Serializes `POST /.setup/api/complete`. `run_setup`'s `is_configured`
    /// check-then-write isn't atomic on its own — argon2 hashing the admin
    /// password widens the window between the check and `users.json` being
    /// written, so two concurrent completes could both observe "not yet
    /// configured" and both attempt to provision. Holding this lock across the
    /// whole handler (not just `run_setup`) serializes completes so the loser
    /// always re-checks against a fully-written `users.json` and gets the
    /// intended "already configured" 400.
    pub complete_lock: tokio::sync::Mutex<()>,
}

async fn handle_shell(State(state): State<Arc<SetupState>>) -> Response {
    let s = state.clone();
    match run_blocking(move || s.client_bundle.read_file(".client/setup.html")).await {
        Ok((data, _)) => ([(header::CONTENT_TYPE, "text/html")], data).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Setup UI not found in client bundle").into_response(),
    }
}

async fn handle_asset(
    State(state): State<Arc<SetupState>>,
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

async fn handle_status(State(state): State<Arc<SetupState>>) -> Response {
    // The wizard prepopulates the space folder with an absolute path under the
    // data root, so it needs to know where the server was booted — the user
    // shouldn't have to. Canonicalize so the shown path (and anything derived
    // from it) is stable and symlink-resolved.
    let root = canonicalize_best_effort(&state.root)
        .to_string_lossy()
        .to_string();
    Json(json!({ "root": root })).into_response()
}

async fn handle_complete(
    State(state): State<Arc<SetupState>>,
    Json(req): Json<SetupRequest>,
) -> Response {
    // Hold the lock across the entire handler so concurrent completes are
    // fully serialized: the second one to acquire it re-runs `run_setup`
    // against a filesystem the first has already finished writing to, and
    // gets a clean "already configured" 400 instead of racing the same
    // argon2-widened check-then-write window.
    let _guard = state.complete_lock.lock().await;

    let root = state.root.clone();
    let tmpl = state.index_template.clone();
    // `run_setup` hashes the admin password (argon2, deliberately slow) and
    // touches the filesystem — keep it off the async worker.
    let result = run_blocking(move || Ok(run_setup(&root, &req, &tmpl))).await;
    match result {
        Ok(Ok(())) => {
            (state.on_complete)();
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(errors)) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(serde::Deserialize)]
struct DirsQuery {
    #[serde(default)]
    path: String,
}

/// Folder-picker backend for the wizard, mirroring the admin's
/// `GET /.spaces/api/admin/fs/dirs`. Same trust model as the rest of `/.setup`:
/// unauthenticated, but only reachable while the server is unconfigured — the
/// whole surface vanishes the moment setup completes.
async fn handle_fs_dirs(
    State(state): State<Arc<SetupState>>,
    axum::extract::Query(q): axum::extract::Query<DirsQuery>,
) -> Response {
    let root = state.root.clone();
    let result = run_blocking(move || Ok(dir_completion(&root, &q.path))).await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Anything outside `/.setup/...` on an unconfigured server points the browser
/// at the wizard.
async fn handle_fallback() -> Response {
    Redirect::temporary("/.setup/").into_response()
}

pub fn build_setup_router(state: Arc<SetupState>) -> Router {
    Router::new()
        .route("/.setup/", get(handle_shell))
        .route("/.setup/assets/{file}", get(handle_asset))
        .route("/.setup/api/status", get(handle_status))
        .route("/.setup/api/fs/dirs", get(handle_fs_dirs))
        .route("/.setup/api/complete", post(handle_complete))
        .fallback(handle_fallback)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::setup::is_configured;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tower::ServiceExt;

    /// A setup state over `dir`, with a fake `setup.html` in the bundle unless
    /// `with_shell` is false. `flag` is flipped by `on_complete`.
    fn state(dir: &tempfile::TempDir, with_shell: bool, flag: Arc<AtomicBool>) -> Arc<SetupState> {
        let bundle = MemorySpacePrimitives::new();
        if with_shell {
            bundle
                .write_file(".client/setup.html", b"<html>SETUP-SHELL</html>", None)
                .unwrap();
            bundle
                .write_file(".client/setup.js", b"//setup js", None)
                .unwrap();
        }
        Arc::new(SetupState {
            root: dir.path().to_path_buf(),
            client_bundle: Box::new(bundle),
            index_template: "# Hello\n".into(),
            on_complete: Box::new(move || flag.store(true, Ordering::SeqCst)),
            complete_lock: tokio::sync::Mutex::new(()),
        })
    }

    async fn send(router: &Router, req: Request<Body>) -> axum::response::Response {
        router.clone().oneshot(req).await.unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn post_json(uri: &str, body: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn body_json(resp: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn shell_and_assets_served_from_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let r = build_setup_router(state(&dir, true, Arc::new(AtomicBool::new(false))));
        assert_eq!(send(&r, get("/.setup/")).await.status(), StatusCode::OK);
        assert_eq!(
            send(&r, get("/.setup/assets/setup.js")).await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn status_reports_the_data_root() {
        let dir = tempfile::tempdir().unwrap();
        let fresh = build_setup_router(state(&dir, true, Arc::new(AtomicBool::new(false))));
        let v = body_json(send(&fresh, get("/.setup/api/status")).await).await;
        // The status exposes the absolute, canonicalized data root so the
        // wizard can prepopulate the folder field.
        let root = v["root"].as_str().expect("root should be a string");
        assert!(
            std::path::Path::new(root).is_absolute(),
            "root {root:?} should be absolute"
        );
        assert_eq!(
            std::path::Path::new(root),
            std::fs::canonicalize(dir.path()).unwrap()
        );
    }

    #[tokio::test]
    async fn complete_provisions_and_fires_on_complete() {
        let dir = tempfile::tempdir().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let r = build_setup_router(state(&dir, true, flag.clone()));

        let resp = send(
            &r,
            post_json(
                "/.setup/api/complete",
                r#"{"adminUsername":"admin","adminPassword":"adminpw123",
                    "space":{"name":"Notes","prefix":"/","folder":""}}"#,
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_json(resp).await["status"], "ok");

        assert!(is_configured(dir.path()), "users.json should now exist");
        assert!(dir.path().join("spaces.json").exists());
        assert!(flag.load(Ordering::SeqCst), "on_complete must have fired");
    }

    #[tokio::test]
    async fn second_complete_is_rejected_already_configured() {
        let dir = tempfile::tempdir().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let r = build_setup_router(state(&dir, true, flag.clone()));
        let body = r#"{"adminUsername":"admin","adminPassword":"adminpw123"}"#;

        assert_eq!(
            send(&r, post_json("/.setup/api/complete", body))
                .await
                .status(),
            StatusCode::OK
        );

        // Second attempt: 400 with a non-empty errors array. `on_complete`
        // fires only for the first (successful) run.
        flag.store(false, Ordering::SeqCst);
        let resp = send(&r, post_json("/.setup/api/complete", body)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(!v["errors"].as_array().unwrap().is_empty(), "{v}");
        assert!(!flag.load(Ordering::SeqCst), "on_complete must not re-fire");
    }

    #[tokio::test]
    async fn concurrent_completes_are_serialized_exactly_one_wins() {
        // Guards the TOCTOU fix: without `complete_lock` serializing the
        // whole handler, two concurrent completes can both pass
        // `run_setup`'s `is_configured` check (argon2 hashing widens the
        // window) and both provision. With the lock, the loser re-checks
        // against a fully-written `users.json` and gets the intended 400.
        let dir = tempfile::tempdir().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let r = build_setup_router(state(&dir, true, flag.clone()));
        let body = r#"{"adminUsername":"admin","adminPassword":"adminpw123"}"#;

        let r1 = r.clone();
        let r2 = r.clone();
        let (resp1, resp2) = tokio::join!(
            r1.oneshot(post_json("/.setup/api/complete", body)),
            r2.oneshot(post_json("/.setup/api/complete", body)),
        );
        let status1 = resp1.unwrap().status();
        let status2 = resp2.unwrap().status();

        let statuses = [status1, status2];
        assert_eq!(
            statuses.iter().filter(|s| **s == StatusCode::OK).count(),
            1,
            "{statuses:?}"
        );
        assert_eq!(
            statuses
                .iter()
                .filter(|s| **s == StatusCode::BAD_REQUEST)
                .count(),
            1,
            "{statuses:?}"
        );
        assert!(is_configured(dir.path()));
    }

    #[tokio::test]
    async fn fs_dirs_reports_status_and_suggestions_unauthenticated() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("alpha")).unwrap();
        std::fs::create_dir_all(dir.path().join("alps")).unwrap();
        std::fs::create_dir_all(dir.path().join("beta")).unwrap();
        let r = build_setup_router(state(&dir, true, Arc::new(AtomicBool::new(false))));

        // No auth on the setup surface — this answers directly while the
        // server is unconfigured.
        let v = body_json(send(&r, get("/.setup/api/fs/dirs?path=al")).await).await;
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

        // An existing directory reports "exists".
        let v = body_json(send(&r, get("/.setup/api/fs/dirs?path=alpha")).await).await;
        assert_eq!(v["status"], "exists");
    }

    #[tokio::test]
    async fn unknown_path_redirects_to_setup() {
        let dir = tempfile::tempdir().unwrap();
        let r = build_setup_router(state(&dir, true, Arc::new(AtomicBool::new(false))));
        for uri in ["/", "/index", "/anything/here", "/.spaces/"] {
            let resp = send(&r, get(uri)).await;
            assert_eq!(
                resp.status(),
                StatusCode::TEMPORARY_REDIRECT,
                "{uri} should redirect"
            );
            assert_eq!(resp.headers()[header::LOCATION], "/.setup/");
        }
    }

    #[tokio::test]
    async fn missing_shell_file_404s_gracefully() {
        let dir = tempfile::tempdir().unwrap();
        let r = build_setup_router(state(&dir, false, Arc::new(AtomicBool::new(false))));
        let resp = send(&r, get("/.setup/")).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
