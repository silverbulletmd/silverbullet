use crate::revisions::read;
use crate::state::ServerState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use silverbullet_server_common::space::disk::lookup_content_type;
use std::sync::Arc;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

#[derive(Deserialize)]
pub struct HistoryQuery {
    rev: Option<String>,
    before: Option<String>,
    limit: Option<usize>,
    format: Option<String>,
    parent: Option<String>,
    q: Option<String>,
    to: Option<String>,
}

fn disabled() -> Response {
    (
        StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({"error": "revisions disabled"})),
    )
        .into_response()
}

fn limit_of(q: &HistoryQuery) -> usize {
    q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn is_hex40(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn flag(v: Option<&String>) -> bool {
    matches!(v.map(String::as_str), Some("1") | Some("true"))
}

/// Runs a history call on the blocking thread pool, keeping its plain
/// `String` error intact rather than folding it into an unrelated
/// `SpaceError` variant just to fit a shared signature.
async fn run_blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result,
        Err(join_err) => {
            tracing::error!("blocking task failed: {join_err}");
            Err(format!("blocking task join error: {join_err}"))
        }
    }
}

pub async fn handle_sync_status(State(state): State<Arc<ServerState>>) -> Response {
    let Some(engine) = state.revisions.clone() else {
        return disabled();
    };
    let Ok(mut snapshot) = tokio::task::spawn_blocking(move || engine.sync_snapshot()).await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    snapshot.sync = snapshot.sync.without_message();
    axum::Json(snapshot).into_response()
}

pub async fn handle_sync_now(State(state): State<Arc<ServerState>>) -> Response {
    if state.boot_config.read_only {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(engine) = state.revisions.clone() else {
        return disabled();
    };
    engine.request_sync();
    let Ok(mut snapshot) = tokio::task::spawn_blocking(move || engine.sync_snapshot()).await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    snapshot.sync = snapshot.sync.without_message();
    (StatusCode::ACCEPTED, axum::Json(snapshot)).into_response()
}

pub async fn handle_conflicts(State(state): State<Arc<ServerState>>) -> Response {
    let Some(engine) = state.revisions.clone() else {
        return disabled();
    };
    match tokio::task::spawn_blocking(move || engine.conflicts()).await {
        Ok(Ok(conflicts)) => axum::Json(conflicts).into_response(),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({"error":"ConflictStatusUnavailable"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
pub struct ConflictSideQuery {
    generation: Option<String>,
}

pub async fn handle_conflict_side(
    State(state): State<Arc<ServerState>>,
    Path((id, side)): Path<(String, String)>,
    Query(query): Query<ConflictSideQuery>,
) -> Response {
    use crate::revisions::conflicts::ResolveError;
    let Some(engine) = state.revisions.clone() else {
        return disabled();
    };
    let Some(generation) = query.generation else {
        return StatusCode::CONFLICT.into_response();
    };
    let filename = match side.as_str() {
        "local" => "attachment; filename=conflict-local",
        "remote" => "attachment; filename=conflict-remote",
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    match tokio::task::spawn_blocking(move || engine.conflict_side(&id, &generation, &side)).await {
        Ok(Ok(bytes)) => (
            [
                ("Content-Type", "application/octet-stream"),
                ("Content-Disposition", filename),
                ("Cache-Control", "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Ok(Err(ResolveError::Stale)) => (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({"error":"StaleConflict"})),
        )
            .into_response(),
        Ok(Err(ResolveError::Unsupported)) => StatusCode::NOT_FOUND.into_response(),
        _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

pub async fn handle_resolve_conflict(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    axum::Extension(actor): axum::Extension<crate::auth::Actor>,
    axum::Json(request): axum::Json<crate::revisions::conflicts::ResolveRequest>,
) -> Response {
    use crate::revisions::conflicts::ResolveError;
    if state.boot_config.read_only {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(engine) = state.revisions.clone() else {
        return disabled();
    };
    let result =
        tokio::task::spawn_blocking(move || engine.resolve_conflict(&id, &request, &actor)).await;
    let (status, error) = match result {
        Ok(Ok(conflicts)) => return axum::Json(conflicts).into_response(),
        Ok(Err(ResolveError::Stale)) => (StatusCode::CONFLICT, "StaleConflict"),
        Ok(Err(ResolveError::PreconditionRequired)) => {
            (StatusCode::PRECONDITION_REQUIRED, "ContentRevisionRequired")
        }
        Ok(Err(ResolveError::Unsupported)) => {
            (StatusCode::UNPROCESSABLE_ENTITY, "UnsupportedResolution")
        }
        _ => (StatusCode::SERVICE_UNAVAILABLE, "ResolutionFailed"),
    };
    (status, axum::Json(serde_json::json!({"error":error}))).into_response()
}

pub async fn handle_space_log(
    State(state): State<Arc<ServerState>>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let Some(history) = state.revisions.clone() else {
        return disabled();
    };
    if let (Some(rev), Some(to_raw)) = (q.rev.as_deref(), q.to.as_deref()) {
        if !is_hex40(rev) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        let Some(to) = read::RangeEnd::parse(to_raw) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        let rev = rev.to_string();
        let result = run_blocking(move || read::range_summary(history.store(), &rev, &to)).await;
        return match result {
            Ok(summary) => axum::Json(summary).into_response(),
            Err(e) => revisions_error(e),
        };
    }
    let limit = limit_of(&q);
    let history_for_sync = history.clone();
    let result = run_blocking(move || {
        read::space_log(history.store(), q.before.as_deref(), limit, q.q.as_deref())
    })
    .await;
    match result {
        Ok(log) => {
            let mut body = serde_json::to_value(log).unwrap_or_default();
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "sync".into(),
                    serde_json::to_value(history_for_sync.sync_state().without_message())
                        .unwrap_or(serde_json::Value::Null),
                );
            }
            axum::Json(body).into_response()
        }
        Err(e) => revisions_error(e),
    }
}

#[derive(Deserialize)]
pub struct ActivityQuery {
    since: Option<i64>,
    #[serde(rename = "filesSince")]
    files_since: Option<i64>,
    top: Option<usize>,
}

pub async fn handle_activity(
    State(state): State<Arc<ServerState>>,
    Query(q): Query<ActivityQuery>,
) -> Response {
    let Some(history) = state.revisions.clone() else {
        return disabled();
    };
    let now = chrono::Utc::now().timestamp();
    let since = q.since.unwrap_or(now - 140 * 86_400);
    let files_since = q.files_since.unwrap_or(now - 30 * 86_400);
    let top = q.top.unwrap_or(5).clamp(1, 50);
    match run_blocking(move || read::activity(history.store(), since, files_since, top)).await {
        Ok(activity) => axum::Json(activity).into_response(),
        Err(e) => revisions_error(e),
    }
}

pub async fn handle_snapshot(State(state): State<Arc<ServerState>>) -> Response {
    let Some(history) = state.revisions.clone() else {
        return disabled();
    };
    match run_blocking(move || history.snapshot_now()).await {
        Ok(committed) => axum::Json(serde_json::json!({ "committed": committed })).into_response(),
        Err(e) => revisions_error(e),
    }
}

pub async fn handle_file_revisions(
    State(state): State<Arc<ServerState>>,
    Path(path): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let Some(history) = state.revisions.clone() else {
        return disabled();
    };
    let limit = limit_of(&q);
    let parent = flag(q.parent.as_ref());
    if let Some(rev) = q.rev {
        if !is_hex40(&rev) {
            return StatusCode::NOT_FOUND.into_response();
        }
        if let Some(to_raw) = q.to.as_deref() {
            let Some(to) = read::RangeEnd::parse(to_raw) else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            let path_inner = path.clone();
            let result = run_blocking(move || {
                read::range_file_diff(history.store(), &path_inner, &rev, &to)
            })
            .await;
            return match result {
                Ok(Some(diff)) => (
                    StatusCode::OK,
                    [("Content-Type", "text/plain; charset=utf-8")],
                    diff,
                )
                    .into_response(),
                Ok(None) => StatusCode::NOT_FOUND.into_response(),
                Err(e) => revisions_error(e),
            };
        }
        if q.format.as_deref() == Some("diff") {
            let path_inner = path.clone();
            let result =
                run_blocking(move || read::file_diff(history.store(), &path_inner, &rev, parent))
                    .await;
            return match result {
                Ok(Some(diff)) => (
                    StatusCode::OK,
                    [("Content-Type", "text/plain; charset=utf-8")],
                    diff,
                )
                    .into_response(),
                Ok(None) => StatusCode::NOT_FOUND.into_response(),
                Err(e) => revisions_error(e),
            };
        }
        let path_inner = path.clone();
        let result =
            run_blocking(move || read::file_at(history.store(), &path_inner, &rev, parent)).await;
        return match result {
            Ok(Some(bytes)) => (
                StatusCode::OK,
                [("Content-Type", lookup_content_type(&path))],
                bytes,
            )
                .into_response(),
            Ok(None) => StatusCode::NOT_FOUND.into_response(),
            Err(e) => revisions_error(e),
        };
    }
    if q.format.as_deref() == Some("diff") {
        let result = run_blocking(move || read::working_diff(history.store(), &path)).await;
        return match result {
            Ok(Some(diff)) => (
                StatusCode::OK,
                [("Content-Type", "text/plain; charset=utf-8")],
                diff,
            )
                .into_response(),
            Ok(None) => StatusCode::NOT_FOUND.into_response(),
            Err(e) => revisions_error(e),
        };
    }
    let result = run_blocking(move || {
        read::file_history(history.store(), &path, q.before.as_deref(), limit)
    })
    .await;
    match result {
        Ok(h) => axum::Json(h).into_response(),
        Err(e) => revisions_error(e),
    }
}

fn revisions_error(msg: String) -> Response {
    if msg.contains("invalid path") {
        (StatusCode::BAD_REQUEST, msg).into_response()
    } else if msg.contains("not managed") || msg.contains("auto-commit") {
        (StatusCode::CONFLICT, msg).into_response()
    } else if msg.contains("no repository")
        || msg.contains("invalid")
        // No binary on this machine: nothing here can work, which is the same
        // answer as "this space has no history" rather than a server fault.
        || msg.contains("git is not installed")
    {
        (StatusCode::NOT_FOUND, msg).into_response()
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
    }
}

#[cfg(test)]
mod tests {
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::RevisionsMode;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn history_state(dir: &tempfile::TempDir) -> crate::ServerState {
        let mut state = test_state();
        let store =
            crate::revisions::RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("note.md"), b"v1").unwrap();
        store
            .commit_batch("alice", "alice@x", "add note", &["note.md".into()])
            .unwrap();
        std::fs::write(dir.path().join("note.md"), b"v2").unwrap();
        store
            .commit_batch("bob", "bob@x", "edit note", &["note.md".into()])
            .unwrap();
        state.revisions = Some(crate::revisions::RevisionEngine::start(
            store,
            None,
            crate::revisions::Timing::default(),
            None,
        ));
        state
    }

    async fn get_json(router: axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let resp = router
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn conflict_endpoints_enforce_preconditions_and_download_exact_stage_bytes() {
        let (_remote, _seed, work) = crate::revisions::sync::tests::conflict_fixture(
            "Café.bin",
            Some(b"base\0"),
            b"local\0",
            b"remote\0",
        );
        let mut state = test_state();
        let store =
            crate::revisions::RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        state.revisions = Some(crate::revisions::RevisionEngine::start(
            store,
            None,
            crate::revisions::Timing::default(),
            None,
        ));
        let router = crate::build_router(Arc::new(state));
        let (status, listing) = get_json(router.clone(), "/.revisions/_conflicts").await;
        assert_eq!(status, StatusCode::OK);
        let conflict = &listing["conflicts"][0];
        let id = conflict["id"].as_str().unwrap();
        let generation = listing["generation"].as_str().unwrap();
        assert_eq!(conflict["path"], "Café.bin");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/.revisions/_conflicts/{id}/remote?generation={generation}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["content-disposition"],
            "attachment; filename=conflict-remote"
        );
        assert_eq!(
            axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .as_ref(),
            b"remote\0"
        );
        let request = |body: serde_json::Value| {
            Request::builder()
                .method("POST")
                .uri(format!("/.revisions/_conflicts/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };
        let response = router
            .clone()
            .oneshot(request(
                serde_json::json!({"generation":generation,"action":"remote"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PRECONDITION_REQUIRED);
        let response = router.clone().oneshot(request(serde_json::json!({"generation":generation,"action":"remote","contentRevision":"old"}))).await.unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            std::fs::read(work.path().join("Café.bin")).unwrap(),
            b"local\0"
        );
        let response = router.oneshot(request(serde_json::json!({"generation":generation,"action":"remote","contentRevision":conflict["contentRevision"]}))).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            std::fs::read(work.path().join("Café.bin")).unwrap(),
            b"remote\0"
        );
    }

    #[tokio::test]
    async fn file_history_and_old_content_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, json) =
            get_json(crate::build_router(state.clone()), "/.revisions/note.md").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["mode"], "managed");
        assert_eq!(json["revisions"].as_array().unwrap().len(), 2);
        let old_rev = json["revisions"][1]["rev"].as_str().unwrap().to_string();

        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(format!("/.revisions/note.md?rev={old_rev}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap(),
            "text/markdown"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"v1");
    }

    #[tokio::test]
    async fn rev_with_format_diff_returns_unified_diff_as_plain_text() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, json) =
            get_json(crate::build_router(state.clone()), "/.revisions/note.md").await;
        assert_eq!(status, StatusCode::OK);
        let latest_rev = json["revisions"][0]["rev"].as_str().unwrap().to_string();

        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(format!("/.revisions/note.md?rev={latest_rev}&format=diff"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap(),
            "text/plain; charset=utf-8"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(body.contains("@@"), "{body}");
    }

    #[tokio::test]
    async fn format_diff_without_a_rev_is_the_uncommitted_change() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        std::fs::write(dir.path().join("note.md"), b"v3").unwrap();

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.revisions/note.md?format=diff")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(body.contains("+v3"), "{body}");

        std::fs::write(dir.path().join("note.md"), b"v2").unwrap();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.revisions/note.md?format=diff")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn parent_flag_serves_the_version_before_a_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        std::fs::remove_file(dir.path().join("note.md")).unwrap();
        let store = state.revisions.clone().unwrap();
        let deletion = store
            .store()
            .commit_batch("carol", "carol@x", "remove note", &["note.md".into()])
            .unwrap()
            .unwrap();

        let router = crate::build_router(state.clone());
        let resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/.revisions/note.md?rev={deletion}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(format!("/.revisions/note.md?rev={deletion}&parent=1"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"v2");
    }

    #[tokio::test]
    async fn space_log_lists_commits_with_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, json) = get_json(crate::build_router(state), "/.revisions/").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["commits"].as_array().unwrap().len(), 2);
        assert_eq!(json["commits"][0]["files"][0]["path"], "note.md");
        assert_eq!(json["commits"][0]["files"][0]["status"], "modified");
    }

    #[tokio::test]
    async fn space_log_includes_sync_state() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, json) = get_json(crate::build_router(state), "/.revisions/").await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            json["sync"].is_null() || json["sync"].is_object(),
            "sync must be null-or-object: {json}"
        );
        assert_eq!(json["sync"]["state"], "idle");
    }

    async fn post_json(router: axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let resp = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn posting_to_the_log_snapshots_outstanding_changes() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        std::fs::write(dir.path().join("note.md"), b"v3").unwrap();

        let (status, json) = post_json(crate::build_router(state.clone()), "/.revisions/").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["committed"], true);

        let (_, log) = get_json(crate::build_router(state.clone()), "/.revisions/").await;
        assert_eq!(log["commits"].as_array().unwrap().len(), 3);

        let (status, json) = post_json(crate::build_router(state), "/.revisions/").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["committed"], false);
    }

    #[tokio::test]
    async fn snapshotting_an_unmanaged_space_is_a_409() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = test_state();
        std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let store =
            crate::revisions::RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        state.revisions = Some(crate::revisions::RevisionEngine::start(
            store,
            None,
            crate::revisions::Timing::default(),
            None,
        ));

        let (status, _) = post_json(crate::build_router(Arc::new(state)), "/.revisions/").await;

        assert_eq!(status, StatusCode::CONFLICT);
    }

    /// An upgrade onto a machine with no `git` leaves an Unmanaged space whose
    /// reads cannot work. That is "no history here", not a server fault -- a
    /// 500 would just fill the log on every panel open.
    #[test]
    fn a_missing_git_binary_reads_as_unavailable_not_a_server_error() {
        let resp = super::revisions_error("git is not installed".to_string());
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn snapshotting_a_disabled_space_reports_404() {
        let state = Arc::new(test_state()); // revisions: None
        let (status, json) = post_json(crate::build_router(state), "/.revisions/").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["error"], "revisions disabled");
    }

    #[tokio::test]
    async fn disabled_space_reports_404() {
        let state = Arc::new(test_state()); // revisions: None
        let (status, json) = get_json(crate::build_router(state), "/.revisions/note.md").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["error"], "revisions disabled");
    }

    #[tokio::test]
    async fn activity_returns_commits_and_top_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, json) = get_json(
            crate::build_router(state),
            "/.revisions/_activity?since=0&filesSince=0",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(!json["commits"].as_array().unwrap().is_empty());
        assert!(json["topFiles"].is_array());
        assert!(json["authors"].is_array());
    }

    #[tokio::test]
    async fn activity_on_disabled_space_reports_404() {
        let state = Arc::new(test_state());
        let (status, json) = get_json(crate::build_router(state), "/.revisions/_activity").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["error"], "revisions disabled");
    }

    #[tokio::test]
    async fn unknown_or_invalid_rev_is_a_404_not_a_500() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let (status, _) = get_json(
            crate::build_router(state.clone()),
            &format!("/.revisions/note.md?rev={}", "0".repeat(40)),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _) =
            get_json(crate::build_router(state), "/.revisions/note.md?rev=nothex").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn traversal_and_empty_segment_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        for uri in ["/.revisions/docs/../x.md", "/.revisions/a//b.md"] {
            let (status, _) = get_json(crate::build_router(state.clone()), uri).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        }
        let (status, _) = get_json(
            crate::build_router(state),
            &format!("/.revisions/docs/../x.md?rev={}", "a".repeat(40)),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_bad_range_end_is_a_400_not_a_500() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(history_state(&dir));
        let rev = "a".repeat(40);
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/.revisions/note.md?rev={rev}&to=HEAD~3&format=diff"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn dormant_store_404_body_is_the_plain_read_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = test_state();
        let store =
            crate::revisions::RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        state.revisions = Some(crate::revisions::RevisionEngine::start(
            store,
            None,
            crate::revisions::Timing::default(),
            None,
        ));
        let resp = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/.revisions/note.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(body.contains("no repository"), "{body}");
        assert!(!body.contains("Could not write file"), "{body}");
    }
}
