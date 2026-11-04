//! `X-Await-Index` on `/.search/query`: the wait, and the `X-Index-Status` it reports.

use super::*;

/// A space on disk with a real watcher feeding the full-text index, as a
/// served space has.
async fn watched_state(dir: &std::path::Path) -> Arc<crate::ServerState> {
    let mut state = test_state();
    let root = dir.canonicalize().unwrap();
    let disk = DiskSpacePrimitives::new(&root, "").unwrap();
    let matcher = disk.gitignore_matcher();
    state.space = Arc::new(disk);
    let events =
        crate::start_watcher(&root, "", crate::WatchMode::Auto, state.fs_guard.clone()).unwrap();
    state.search = crate::search::full_text_backend(
        "test",
        state.space.clone(),
        matcher,
        crate::search::Location::Memory,
        events.subscribe(),
    );
    state.fs_events = Some(events);
    let folder = root.to_string_lossy().to_string();
    state.space_folder_path = folder.clone();
    state.boot_config.space_folder_path = folder;
    state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Write), Some("gardener"))));
    wait_ready(&state).await;
    Arc::new(state)
}

async fn search_awaiting_index(
    state: &Arc<crate::ServerState>,
    query: &str,
) -> (StatusCode, Option<String>, serde_json::Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri("/.search/query")
        .header("content-type", "application/json")
        .header("x-await-index", "1")
        .body(Body::from(
            serde_json::json!({ "query": query }).to_string(),
        ))
        .unwrap();
    let res = crate::build_router(state.clone())
        .oneshot(req)
        .await
        .unwrap();
    let status = res.status();
    let index = res
        .headers()
        .get("x-index-status")
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (status, index, serde_json::from_slice(&bytes).unwrap())
}

/// `X-Await-Index` makes a search right after a write see it, as it does a
/// runtime call.
#[tokio::test(flavor = "multi_thread")]
async fn a_search_awaiting_the_index_sees_a_write_just_made() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Garden.md"), "tomatoes\n").unwrap();
    let state = watched_state(dir.path()).await;
    for round in 0..5 {
        let word = format!("basil{round}");
        let req = Request::builder()
            .method(Method::PUT)
            .uri("/.fs/Garden.md")
            .body(Body::from(format!("{word}\n")))
            .unwrap();
        let res = crate::build_router(state.clone())
            .oneshot(req)
            .await
            .unwrap();
        assert!(res.status().is_success(), "{}", res.status());
        let (status, index, body) = search_awaiting_index(&state, &word).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(index.as_deref(), Some("caught-up"));
        assert_eq!(body["items"][0]["page"], "Garden", "{word}: {body}");
    }
}

#[tokio::test]
async fn index_status_only_when_asked_and_only_for_members() {
    let state = stub_state("stub-await-writer", one_match);
    let (_, headers, _) = call_with_headers(
        state.clone(),
        Method::POST,
        "/.search/query",
        r#"{"query":"x"}"#,
    )
    .await;
    assert!(headers.get("x-index-status").is_none());
    let (status, index, _) = search_awaiting_index(&state, "x").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index.as_deref(), Some("caught-up"));

    let dir = fern_space();
    let mut visitor = ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Read), None)).await;
    visitor.anonymous_readable = true;
    let (status, index, body) = search_awaiting_index(&Arc::new(visitor), "fern").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(index.as_deref(), Some("unknown"));
}

/// A request that fails before running answers at once, without first
/// waiting for the index; a valid one waits.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_query_does_not_wait_for_the_index() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Garden.md"), "tomatoes\n").unwrap();
    let state = watched_state(dir.path()).await;
    let pending = || {
        // A write the watcher never reports holds a catch-up for seconds.
        state.fs_guard.record_expected_write(
            "Ghost.md",
            "hash",
            crate::auth::Actor::default(),
            None,
            None,
        );
    };
    for body in [r#"{"query":"#, r#"{"query":"tomatoes","mode":"regex"}"#] {
        pending();
        let started = std::time::Instant::now();
        let req = Request::builder()
            .method(Method::POST)
            .uri("/.search/query")
            .header("content-type", "application/json")
            .header("x-await-index", "1")
            .body(Body::from(body))
            .unwrap();
        let res = crate::build_router(state.clone())
            .oneshot(req)
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(res.headers()["x-index-status"], "unknown", "{body}");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(1),
            "{body}: waited {:?}",
            started.elapsed()
        );
    }
    pending();
    let started = std::time::Instant::now();
    let (status, index, body) = search_awaiting_index(&state, "tomatoes").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(index.as_deref(), Some("caught-up"));
    assert!(started.elapsed() >= std::time::Duration::from_secs(1));
}
