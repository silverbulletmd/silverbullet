use super::*;

/// One request through `router`; the body is parsed as JSON (`Null` if it isn't).
async fn request(
    router: axum::Router,
    method: &str,
    path: &str,
    body: &str,
    headers: &[(&str, String)],
) -> (StatusCode, serde_json::Value) {
    use tower::ServiceExt;
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    for (name, value) in headers {
        req = req.header(*name, value.as_str());
    }
    let res = router
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

/// Waits up to 10 s for the space's first index build.
async fn wait_ready(state: &ServerState) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !state.search.status().ready {
        assert!(
            std::time::Instant::now() < deadline,
            "the index never became ready: {:?}",
            state.search.status()
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// `/.search/*` through a single-user space's real authorizer chain and
/// full-text index, with `Fern.md` in it. `bearer` is sent as
/// `Authorization: Bearer`.
async fn single_user_search(
    auth: Option<crate::auth::AuthConfig>,
    read_only: bool,
    bearer: Option<&str>,
) -> Vec<(&'static str, StatusCode, serde_json::Value)> {
    let dir = tempfile::tempdir().unwrap();
    let mut deps = test_deps(dir.path());
    deps.auth = InstanceAuth::Single(auth);
    let folder = dir.path().join("space");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("Fern.md"), "fern fronds\n").unwrap();
    let mut cfg = space(
        Binding::Prefix {
            prefix: "/o".into(),
        },
        folder.to_str().unwrap(),
    );
    cfg.read_only = read_only;
    let state = Arc::new(try_build_state("o", &cfg, "/o", &deps).unwrap());
    wait_ready(&state).await;
    let headers: Vec<_> = bearer
        .map(|token| ("authorization", format!("Bearer {token}")))
        .into_iter()
        .collect();
    let mut out = vec![];
    for (path, body) in [
        ("/.search/status", ""),
        ("/.search/query", r#"{"query":"fern"}"#),
        (
            "/.search/query",
            r#"{"query":"fern fronds","mode":"phrase"}"#,
        ),
        ("/.search/query", r#"{"query":"fern","mode":"regex"}"#),
        ("/.search/related", r#"{"page":"Fern"}"#),
    ] {
        let method = if body.is_empty() { "GET" } else { "POST" };
        let router = crate::build_router(state.clone());
        let (status, json) = request(router, method, path, body, &headers).await;
        out.push((path, status, json));
    }
    out
}

const PUBLIC: &str = "Search isn't available to public visitors";

/// A signed-in or trusted caller: every mode the index has, Fern found,
/// Regex refused as invalid, related unsupported (400, not a refusal).
fn assert_searches(results: &[(&str, StatusCode, serde_json::Value)]) {
    for (i, (path, status, body)) in results.iter().enumerate() {
        assert_ne!(body["message"], PUBLIC, "{path}: {body}");
        match (i, *path) {
            (_, "/.search/status") => {
                assert_eq!(body["backend"], "fulltext", "{body}");
                assert_eq!(
                    body["capabilities"]["modes"],
                    serde_json::json!(["words", "phrase"])
                );
            }
            (3, _) => assert_eq!(body["error"], "invalid", "regex: {body}"),
            (_, "/.search/query") => {
                assert_eq!(*status, StatusCode::OK, "{body}");
                assert_eq!(body["items"][0]["page"], "Fern", "{body}");
            }
            _ => assert_eq!(body["error"], "unsupported", "{path}: {body}"),
        }
    }
}

/// A public visitor: Words and Phrase find Fern, status lists only them,
/// and related is refused before admission (Regex is not a mode: invalid).
fn assert_public_searches(results: &[(&str, StatusCode, serde_json::Value)]) {
    for (i, (path, status, body)) in results.iter().enumerate() {
        match (i, *path) {
            (_, "/.search/status") => {
                assert_eq!(*status, StatusCode::OK);
                assert_eq!(body["backend"], "fulltext", "{body}");
                assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
                assert_eq!(
                    body["capabilities"],
                    serde_json::json!({"modes": ["words", "phrase"], "related": false})
                );
            }
            (1 | 2, _) => {
                assert_eq!(*status, StatusCode::OK, "{i}: {body}");
                assert_eq!(body["items"][0]["page"], "Fern", "{i}: {body}");
            }
            (3, _) => {
                assert_eq!(*status, StatusCode::BAD_REQUEST, "{body}");
                assert_eq!(body["error"], "invalid", "regex: {body}");
            }
            _ => {
                assert_eq!(*status, StatusCode::NOT_FOUND, "{i} {path}: {body}");
                assert_eq!(
                    *body,
                    serde_json::json!({"error": "unavailable", "message": PUBLIC}),
                    "{i} {path}"
                );
            }
        }
    }
}

/// `SB_READ_ONLY` without auth: the docs-site shape (Review Focus 5).
#[tokio::test]
async fn an_open_read_only_single_space_searches_publicly_in_words_and_phrases() {
    assert_public_searches(&single_user_search(None, true, None).await);
}

#[tokio::test]
async fn an_open_writable_single_space_searches() {
    assert_searches(&single_user_search(None, false, None).await);
}

#[tokio::test]
async fn a_token_caller_searches_a_read_only_single_space_with_auth() {
    let auth = || {
        crate::auth::AuthConfig::try_parse(Some("admin:pw"), Some("search-token"), None, None, None)
            .unwrap()
    };
    assert_searches(&single_user_search(auth(), true, Some("search-token")).await);
    // Without the token the caller never gets past authentication.
    for (path, status, _) in single_user_search(auth(), true, None).await {
        assert!(
            status == StatusCode::UNAUTHORIZED || status.is_redirection(),
            "{path}: {status}"
        );
    }
}

#[tokio::test]
async fn published_multi_user_spaces_search_for_anonymous_visitors() {
    for access in [SpaceAccess::Write, SpaceAccess::Read] {
        let (dir, state) = state_with_access(access);
        std::fs::write(dir.path().join("space/Fern.md"), "fern fronds\n").unwrap();
        let state = Arc::new(state);
        // Found through the watcher: the file came after the instance.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut results = vec![];
        for (path, body) in [
            ("/.search/status", ""),
            ("/.search/query", r#"{"query":"fern"}"#),
            (
                "/.search/query",
                r#"{"query":"fern fronds","mode":"phrase"}"#,
            ),
            ("/.search/query", r#"{"query":"fern","mode":"regex"}"#),
            ("/.search/related", r#"{"page":"Fern"}"#),
        ] {
            let method = if body.is_empty() { "GET" } else { "POST" };
            let result = loop {
                let router = crate::build_router(state.clone());
                let (status, json) = request(router, method, path, body, &[]).await;
                let found = path != "/.search/query"
                    || json["items"][0]["page"] == "Fern"
                    || status != StatusCode::OK;
                if found || std::time::Instant::now() >= deadline {
                    break (path, status, json);
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            };
            results.push(result);
        }
        if access == SpaceAccess::Write {
            // An anonymous writer isn't a public visitor.
            assert_searches(&results);
        } else {
            assert_public_searches(&results);
        }
    }
}

#[tokio::test]
async fn a_page_written_after_boot_is_found_within_two_seconds() {
    let (dir, state) = state_with_access(SpaceAccess::Write);
    let state = Arc::new(state);
    assert!(state.fs_events.is_some(), "the test needs the real watcher");
    wait_ready(&state).await;
    std::fs::write(dir.path().join("space/Bracken.md"), "bracken uncurls\n").unwrap();
    let started = std::time::Instant::now();
    loop {
        let router = crate::build_router(state.clone());
        let (status, body) = request(
            router,
            "POST",
            "/.search/query",
            r#"{"query":"bracken"}"#,
            &[],
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        if body["items"][0]["page"] == "Bracken" {
            break;
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "not found after 2 s: {body}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// The data root as a multi-user space's folder: the index lives under
/// `search/indexes/<id>/<SCHEMA_DIR>/` and the space never shows it
/// (Review Focus 3).
#[tokio::test]
async fn multi_user_indexes_live_under_the_data_root_hidden_from_a_root_folder_space() {
    let dir = tempfile::tempdir().unwrap();
    let mut deps = test_deps(dir.path());
    deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(dir.path()));
    let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
    store
        .create_user("admin", "adminpw1", true, Profile::default())
        .unwrap();
    let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
    deps.auth = InstanceAuth::Accounts {
        users: store.clone(),
        authenticator: authenticator.clone(),
        session: SessionPolicy::default(),
    };
    std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
    let cfg = space_users_model(
        Binding::Prefix { prefix: "/".into() },
        SpaceAccess::None,
        Default::default(),
        dir.path().to_str().unwrap(),
    );
    let state = Arc::new(try_build_state("root", &cfg, "", &deps).unwrap());
    // What `/.events` clients, the listing cache and the index's forwarder see.
    let mut events = state.fs_events.as_ref().unwrap().subscribe();
    std::fs::create_dir_all(dir.path().join("git-keys")).unwrap();
    std::fs::write(dir.path().join("git-keys/sample"), "private state").unwrap();
    wait_ready(&state).await;

    let index = dir
        .path()
        .join("search/indexes/root")
        .join(silverbullet_server_search::fulltext::SCHEMA_DIR);
    assert!(index.join("meta.json").is_file(), "{}", index.display());
    #[cfg(unix)]
    for d in ["search", "search/indexes", "search/indexes/root"] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join(d))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700, "{d}");
    }

    let version = store.credential_version("admin").unwrap();
    let jwt = authenticator
        .issue_jwt_with_version("admin", version, 3600)
        .unwrap();
    let headers = [
        ("host", "localhost".to_string()),
        ("cookie", format!("auth_localhost={jwt}")),
        ("sec-fetch-site", "same-origin".to_string()),
    ];
    let router = || crate::build_router(state.clone());
    let (status, listing) = request(router(), "GET", "/.fs", "", &headers).await;
    assert_eq!(status, StatusCode::OK, "{listing}");
    let names: Vec<&str> = listing
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|file| file["name"].as_str())
        .collect();
    assert!(names.contains(&"Fern.md"), "{names:?}");
    assert!(
        names
            .iter()
            .all(|name| !name.to_ascii_lowercase().starts_with("search/")),
        "{names:?}"
    );
    let schema = silverbullet_server_search::fulltext::SCHEMA_DIR;
    for path in [
        format!("/.fs/search/indexes/root/{schema}/meta.json"),
        format!("/.fs/Search/indexes/root/{schema}/meta.json"),
    ] {
        let (status, _) = request(router(), "GET", &path, "", &headers).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, body) = request(
        router(),
        "POST",
        "/.search/query",
        r#"{"query":"fern"}"#,
        &headers,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1, "{body}");
    assert_eq!(body["items"][0]["page"], "Fern");

    // An edit commits to the index again; only the edit is reported.
    std::fs::write(dir.path().join("Bracken.md"), "bracken uncurls\n").unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let (_, body) = request(
            router(),
            "POST",
            "/.search/query",
            r#"{"query":"bracken"}"#,
            &headers,
        )
        .await;
        if body["items"][0]["page"] == "Bracken" {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "{body}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    // Let the commit's file events (if any leaked) reach the channel.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let mut seen = vec![];
    loop {
        match events.try_recv() {
            Ok(event) => seen.push((event.name, event.action)),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
            Err(error) => panic!("{error:?}"),
        }
    }
    assert!(
        seen.iter().any(|(name, _)| name == "Bracken.md"),
        "the watcher reports the edit: {seen:?}"
    );
    for (name, action) in &seen {
        assert!(
            name.ends_with(".md") && *action != crate::FsAction::Resync,
            "only page events, no rescans: {seen:?}"
        );
    }
}

/// Single-space mode (`SpaceSearch::in_memory()`): the index is in RAM.
#[tokio::test]
async fn a_single_space_writes_no_index_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut deps = test_deps(dir.path());
    deps.auth = InstanceAuth::Single(None);
    std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
    let cfg = space(Binding::Prefix { prefix: "/".into() }, ".");
    let state = Arc::new(try_build_state("single", &cfg, "", &deps).unwrap());
    wait_ready(&state).await;
    let (status, body) = request(
        crate::build_router(state.clone()),
        "POST",
        "/.search/query",
        r#"{"query":"fern"}"#,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["items"][0]["page"], "Fern");
    let mut entries = vec![];
    let mut stack = vec![dir.path().to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            entries.push(path.strip_prefix(dir.path()).unwrap().to_path_buf());
        }
    }
    assert_eq!(entries, [std::path::PathBuf::from("Fern.md")]);
}

/// Search covers the space's own files, not the bundled fallback layer
/// (`Library/Std` and the like), which the space API still serves.
#[tokio::test]
async fn bundled_fallback_files_are_not_searched() {
    let dir = tempfile::tempdir().unwrap();
    let mut deps = test_deps(dir.path());
    deps.auth = InstanceAuth::Single(None);
    deps.assets.base_fs = Box::new(|| {
        let bundled = MemorySpacePrimitives::new();
        bundled
            .write_file("Library/Std/Fern Guide.md", b"fern lore\n", None)
            .unwrap();
        Box::new(bundled)
    });
    let folder = dir.path().join("space");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("Fern.md"), "fern fronds\n").unwrap();
    let cfg = space(
        Binding::Prefix { prefix: "/".into() },
        folder.to_str().unwrap(),
    );
    let state = Arc::new(try_build_state("own", &cfg, "", &deps).unwrap());
    wait_ready(&state).await;
    let router = || crate::build_router(state.clone());
    let (status, _) = request(router(), "GET", "/.fs/Library/Std/Fern%20Guide.md", "", &[]).await;
    assert_eq!(status, StatusCode::OK, "the fallback layer is served");
    let (status, body) = request(
        router(),
        "POST",
        "/.search/query",
        r#"{"query":"fern"}"#,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1, "{body}");
    assert_eq!(body["items"][0]["page"], "Fern");
}
