use super::*;
use silverbullet_server_search::fulltext::SCHEMA_DIR;
use std::path::PathBuf;

/// Rebuilding an instance (a `spaces.json` theme edit) while its search
/// runs: the old and new instance share the index directory for a while.
/// Nothing panics or fails, the new instance answers, and an edit made
/// right after the rebuild is found within 5 s (Review Focus 2).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_rebuilt_space_takes_over_its_index_while_searches_run() {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::time::{Duration, Instant};
    use tower::ServiceExt;
    async fn query(router: axum::Router, q: &str) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method("POST")
            .uri("/.search/query")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::json!({ "query": q }).to_string()))
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    async fn found(router: &axum::Router, q: &str, page: &str, within: Duration) {
        let deadline = Instant::now() + within;
        loop {
            let (status, body) = query(router.clone(), q).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            if body["items"][0]["page"] == page {
                return;
            }
            assert!(Instant::now() < deadline, "{q}: {body}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("notes")).unwrap();
    std::fs::write(root.join("notes/Fern.md"), "fern fronds\n").unwrap();
    let mut space = payload("Notes", Binding::Prefix { prefix: "".into() });
    space.folder = "notes".into();
    MultiConfig {
        spaces: [("notes".to_string(), space)].into_iter().collect(),
    }
    .save(&root.join("spaces.json"))
    .unwrap();
    let mut deps = deps(root);
    deps.auth = InstanceAuth::Single(None);
    deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root));
    let m = MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap();

    // The committed index's `meta.json`, which every commit rewrites.
    let meta_json = || {
        std::fs::read(
            root.join("search/indexes/notes")
                .join(silverbullet_server_search::fulltext::SCHEMA_DIR)
                .join("meta.json"),
        )
        .ok()
    };
    let old = m.instance("notes").unwrap();
    let old_router = old.router.clone().unwrap();
    found(&old_router, "fern", "Fern", Duration::from_secs(10)).await;

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let searching = {
        let (router, stop) = (old_router.clone(), stop.clone());
        tokio::spawn(async move {
            let mut answered = 0;
            while !stop.load(std::sync::atomic::Ordering::SeqCst) {
                let (status, body) = query(router.clone(), "fern").await;
                assert!(!status.is_server_error(), "{status}: {body}");
                answered += 1;
            }
            answered
        })
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    let patch = serde_json::json!({ "themeColor": "#336699" });
    m.patch("notes", patch.as_object().unwrap().clone())
        .unwrap();
    let new = m.instance("notes").unwrap();
    assert!(!Arc::ptr_eq(&old, &new), "the edit rebuilt the instance");
    assert_eq!(new.config.theme_color, "#336699");
    let new_router = new.router.clone().unwrap();
    std::fs::write(root.join("notes/Moss.md"), "moss carpets\n").unwrap();
    found(&new_router, "moss", "Moss", Duration::from_secs(5)).await;
    found(&new_router, "fern", "Fern", Duration::from_secs(5)).await;

    stop.store(true, std::sync::atomic::Ordering::SeqCst);
    let answered = searching
        .await
        .expect("searches on the old instance never panic");
    assert!(answered > 0);
    drop((old, old_router));
    // With the old instance gone, the new one keeps indexing on its own.
    let before = meta_json();
    std::fs::write(root.join("notes/Lichen.md"), "lichen crusts\n").unwrap();
    found(&new_router, "lichen", "Lichen", Duration::from_secs(5)).await;
    assert_ne!(
        meta_json(),
        before,
        "the new instance commits to the disk index on its own"
    );
}

fn walkdir_list(d: &std::path::Path) -> Vec<String> {
    let mut out = vec![];
    let mut stack = vec![d.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p.clone());
            }
            out.push(p.display().to_string());
        }
    }
    out
}

#[tokio::test]
async fn deleting_a_space_removes_its_search_index() {
    use std::time::{Duration, Instant};
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut deps = deps(root);
    deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root));
    let m = MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap();
    let keep = m
        .create(
            payload(
                "Keep",
                Binding::Prefix {
                    prefix: "/keep".into(),
                },
            ),
            true,
        )
        .unwrap();
    let gone = m
        .create(
            payload(
                "Gone",
                Binding::Prefix {
                    prefix: "/gone".into(),
                },
            ),
            true,
        )
        .unwrap();
    let index = |id: &str| root.join("search/indexes").join(id).join(SCHEMA_DIR);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !(index(&keep).join("meta.json").is_file() && index(&gone).join("meta.json").is_file()) {
        assert!(Instant::now() < deadline, "indexes never created");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    m.delete(&gone).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while root.join("search/indexes").join(&gone).exists() {
        if Instant::now() >= deadline {
            let left: Vec<_> = walkdir_list(&root.join("search/indexes").join(&gone));
            panic!("the deleted space's index is still there: {left:?}");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        index(&keep).join("meta.json").is_file(),
        "other spaces keep theirs"
    );
}
#[tokio::test]
async fn boot_skips_a_space_whose_folder_overlaps_a_reserved_directory() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let indexes = root.join("search/indexes");
    for d in ["spaces/fern", "spaces/moss", "git-keys"] {
        std::fs::create_dir_all(root.join(d)).unwrap();
    }
    for d in ["bracken", "orphan"] {
        std::fs::create_dir_all(indexes.join(d).join(SCHEMA_DIR)).unwrap();
    }
    let mut fern = payload(
        "Fern",
        Binding::Prefix {
            prefix: "/fern".into(),
        },
    );
    fern.folder = "spaces/fern".into();
    let mut bracken = payload(
        "Bracken",
        Binding::Prefix {
            prefix: "/bracken".into(),
        },
    );
    bracken.folder = "search".into();
    let mut lichen = payload(
        "Lichen",
        Binding::Prefix {
            prefix: "/lichen".into(),
        },
    );
    lichen.folder = "..".into();
    MultiConfig {
        spaces: [
            ("fern".to_string(), fern.clone()),
            ("bracken".to_string(), bracken.clone()),
            ("lichen".to_string(), lichen),
        ]
        .into_iter()
        .collect(),
    }
    .save(&root.join("spaces.json"))
    .unwrap();
    let mut deps = deps(root);
    deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root));
    let m = MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap();

    assert_eq!(m.get("fern").unwrap()["status"]["state"], "running");
    let status = &m.get("bracken").unwrap()["status"];
    assert_eq!(status["state"], "errored");
    assert!(
        status["reason"]
            .as_str()
            .unwrap()
            .contains("\"search\" folder"),
        "{status}"
    );
    let status = &m.get("lichen").unwrap()["status"];
    assert_eq!(status["state"], "errored");
    assert!(
        status["reason"]
            .as_str()
            .unwrap()
            .contains("cannot contain the data folder"),
        "{status}"
    );
    assert!(
        indexes.join("bracken").join(SCHEMA_DIR).is_dir(),
        "skipped keeps its index"
    );
    assert!(!indexes.join("orphan").exists(), "orphans are swept");

    // Changes keep refusing such folders.
    let mut moss = payload(
        "Moss",
        Binding::Prefix {
            prefix: "/moss".into(),
        },
    );
    moss.folder = "git-keys".into();
    assert!(matches!(
        m.create(moss.clone(), false),
        Err(ApiError::Validation(_))
    ));
    let mut moved = fern.clone();
    moved.folder = "Search/indexes".into();
    assert!(matches!(
        m.update("fern", moved),
        Err(ApiError::Validation(_))
    ));
    let mut moved = bracken.clone();
    moved.folder = "git-drafts".into();
    assert!(matches!(
        m.update("bracken", moved),
        Err(ApiError::Validation(_))
    ));
    // A skipped space keeps its binding: no other space can take it.
    let mut taker = payload(
        "Taker",
        Binding::Prefix {
            prefix: "/bracken".into(),
        },
    );
    taker.folder = "spaces/moss".into();
    let Err(ApiError::Validation(errors)) = m.create(taker, false) else {
        panic!("a skipped space's prefix was taken");
    };
    assert!(
        errors.iter().any(|e| e.field.ends_with(".binding")),
        "{errors:?}"
    );
    // Skipped spaces don't block other changes, including their own that
    // keep the folder (the space stays errored), and fixing the folder
    // brings a skipped space up.
    let mut renamed = bracken.clone();
    renamed.name = "Bracken 2".into();
    m.update("bracken", renamed).unwrap();
    assert_eq!(m.get("bracken").unwrap()["status"]["state"], "errored");
    m.set_server_config(None, Some("Garden"), None).unwrap();
    m.delete("lichen").unwrap();
    bracken.folder = "spaces/moss".into();
    m.update("bracken", bracken).unwrap();
    assert_eq!(m.get("bracken").unwrap()["status"]["state"], "running");
    assert!(m.get("lichen").is_none());
}

fn member(role: MemberRole) -> MemberEntry {
    MemberEntry {
        role,
        runtime_api: false,
        runtime_api_explicit: true,
        extra: Default::default(),
    }
}

#[tokio::test]
async fn deleting_a_member_of_a_skipped_space_applies_and_boots_again() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("spaces/fern")).unwrap();
    let mut fern = payload(
        "Fern",
        Binding::Prefix {
            prefix: "/fern".into(),
        },
    );
    fern.folder = "spaces/fern".into();
    fern.members.insert("bob".into(), member(MemberRole::Write));
    let mut bracken = payload(
        "Bracken",
        Binding::Prefix {
            prefix: "/bracken".into(),
        },
    );
    bracken.folder = "search".into();
    bracken
        .members
        .insert("bob".into(), member(MemberRole::Read));
    bracken
        .members
        .insert("ada".into(), member(MemberRole::Read));
    MultiConfig {
        spaces: [("fern".to_string(), fern), ("bracken".to_string(), bracken)]
            .into_iter()
            .collect(),
    }
    .save(&root.join("spaces.json"))
    .unwrap();
    let m = boot_with_users(root, &["ada", "bob"]);
    assert_eq!(m.get("bracken").unwrap()["status"]["state"], "errored");

    let remaining: BTreeSet<String> = ["ada".to_string()].into();
    m.remove_member_everywhere("bob", remaining.clone())
        .unwrap();
    let saved = MultiConfig::load(&root.join("spaces.json")).unwrap();
    for (id, space) in &saved.spaces {
        assert!(!space.members.contains_key("bob"), "{id}");
    }
    assert!(saved.spaces["bracken"].members.contains_key("ada"));
    drop(m);
    let m = MultiManager::boot(root.to_path_buf(), deps(root), remaining).unwrap();
    assert_eq!(m.get("fern").unwrap()["status"]["state"], "running");
    assert_eq!(m.get("bracken").unwrap()["status"]["state"], "errored");
}

#[tokio::test]
async fn the_index_sweep_keeps_ids_of_any_case_and_needs_a_spaces_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let indexes = root.join("search/indexes");
    for d in [
        PathBuf::from("Fern").join(SCHEMA_DIR),
        PathBuf::from("Fern/semantic-v1"),
        PathBuf::from("orphan").join(SCHEMA_DIR),
        PathBuf::from("orphan/semantic-v1"),
    ] {
        std::fs::create_dir_all(indexes.join(d)).unwrap();
    }
    let boot_here = || {
        let mut deps = deps(root);
        deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root));
        MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap()
    };
    // No spaces.json (moved away, or a partial restore): nothing is swept.
    drop(boot_here());
    assert!(indexes.join("orphan").join(SCHEMA_DIR).is_dir());
    assert!(indexes.join("Fern").join(SCHEMA_DIR).is_dir());
    assert!(indexes.join("orphan/semantic-v1").is_dir());

    let mut fern = payload(
        "Fern",
        Binding::Prefix {
            prefix: "/fern".into(),
        },
    );
    fern.folder = "spaces/fern".into();
    std::fs::create_dir_all(root.join("spaces/fern")).unwrap();
    MultiConfig {
        spaces: [("fern".to_string(), fern)].into_iter().collect(),
    }
    .save(&root.join("spaces.json"))
    .unwrap();
    drop(boot_here());
    assert!(!indexes.join("orphan").exists());
    assert!(
        indexes.join("Fern").is_dir(),
        "a directory whose name differs from a space id only in case is kept"
    );
    assert!(
        indexes.join("Fern/semantic-v1").is_dir(),
        "with its semantic index"
    );
}

/// Boot removes superseded model revisions, and keeps the configured
/// model's current one (where a download goes, partial files included).
#[tokio::test]
async fn boot_sweeps_superseded_models_only() {
    use silverbullet_server_search::semantic::catalog;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(
        root.join("server.json"),
        r#"{"search":{"model":"multilingual-e5-small"}}"#,
    )
    .unwrap();
    let models = crate::search::search_root(root).models();
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    let superseded = models.join(format!("{}@0123abcd", e5.id));
    let current = models.join(e5.dir_name());
    std::fs::create_dir_all(&superseded).unwrap();
    std::fs::create_dir_all(&current).unwrap();
    std::fs::write(current.join("model.safetensors.partial"), "x").unwrap();
    let mut deps = deps(root);
    deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root));
    let m = MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap();
    assert_eq!(m.search().model().map(|s| s.id), Some(e5.id));
    assert!(!superseded.exists());
    assert!(current.join("model.safetensors.partial").is_file());
}

mod semantic {
    use super::*;
    use crate::search::SemanticChoice;
    use axum::body::Body;
    use axum::http::Request;
    use silverbullet_server_search::semantic::download::ModelStore;
    use silverbullet_server_search::semantic::test_model::FakeEmbedder;
    use silverbullet_server_search::semantic::test_server::{serve_files, FileServer};
    use silverbullet_server_search::semantic::SemanticService;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    use tower::ServiceExt;

    async fn get_json(
        router: &axum::Router,
        method: &str,
        uri: &str,
        body: &str,
    ) -> serde_json::Value {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let res = router.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
    }

    async fn status(m: &MultiManager, id: &str) -> serde_json::Value {
        let router = m.instance(id).unwrap().router.clone().unwrap();
        get_json(&router, "GET", "/.search/status", "").await
    }

    async fn until_ready(m: &MultiManager, id: &str) {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let s = status(m, id).await;
            if s["ready"] == true {
                return;
            }
            assert!(Instant::now() < deadline, "{s}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// A data root with two spaces, `notes` opted in and `plain` not.
    fn boot(root: &std::path::Path, fake: &Arc<FakeEmbedder>) -> Arc<MultiManager> {
        for (dir, page) in [("notes", "Fern.md"), ("plain", "Moss.md")] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
            std::fs::write(root.join(dir).join(page), "green fronds and mats\n").unwrap();
        }
        let mut notes = payload(
            "Notes",
            Binding::Prefix {
                prefix: "/notes".into(),
            },
        );
        notes.folder = "notes".into();
        notes.semantic_search = SemanticChoice::On;
        let mut plain = payload(
            "Plain",
            Binding::Prefix {
                prefix: "/plain".into(),
            },
        );
        plain.folder = "plain".into();
        plain.semantic_search = SemanticChoice::Off;
        MultiConfig {
            spaces: [("notes".to_string(), notes), ("plain".to_string(), plain)]
                .into_iter()
                .collect(),
        }
        .save(&root.join("spaces.json"))
        .unwrap();
        // The fake stands in for whatever model `server.json` names.
        let server = serde_json::json!({ "search": { "model": "multilingual-e5-small" } });
        std::fs::write(root.join("server.json"), server.to_string()).unwrap();
        let mut deps = deps(root);
        deps.auth = InstanceAuth::Single(None);
        deps.search = crate::search::SpaceSearch::in_root(crate::search::search_root(root))
            .with_semantic(SemanticService::with_embedder(fake.clone()));
        MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn only_opted_in_spaces_get_the_semantic_backend() {
        let dir = tempfile::tempdir().unwrap();
        let fake = Arc::new(FakeEmbedder::new());
        let m = boot(dir.path(), &fake);
        assert_eq!(status(&m, "notes").await["backend"], "semantic");
        assert_eq!(status(&m, "plain").await["backend"], "fulltext");
        assert_eq!(m.search().model().unwrap().id, "test-fake");
    }

    /// Review Focus 4.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn rebuilding_a_semantic_space_reuses_its_index() {
        let dir = tempfile::tempdir().unwrap();
        let fake = Arc::new(FakeEmbedder::new());
        let m = boot(dir.path(), &fake);
        until_ready(&m, "notes").await;
        let file = dir
            .path()
            .join("search/indexes/notes/semantic-v1/test-fake.bin");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !file.is_file() {
            assert!(Instant::now() < deadline, "the index was saved when idle");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let embedded = fake.texts.load(Ordering::SeqCst);

        let theme = serde_json::json!({ "themeColor": "#336699" });
        m.patch("notes", theme.as_object().unwrap().clone())
            .unwrap();
        until_ready(&m, "notes").await;
        assert_eq!(
            fake.texts.load(Ordering::SeqCst),
            embedded,
            "an unrelated edit re-embeds nothing"
        );

        let off = serde_json::json!({ "semanticSearch": false });
        m.patch("notes", off.as_object().unwrap().clone()).unwrap();
        assert_eq!(status(&m, "notes").await["backend"], "fulltext");
        let on = serde_json::json!({ "semanticSearch": true });
        m.patch("notes", on.as_object().unwrap().clone()).unwrap();
        until_ready(&m, "notes").await;
        assert_eq!(
            fake.texts.load(Ordering::SeqCst),
            embedded,
            "turned back on, it reloads its file"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_new_page_is_found_by_meaning() {
        let dir = tempfile::tempdir().unwrap();
        let fake = Arc::new(FakeEmbedder::new());
        let m = boot(dir.path(), &fake);
        until_ready(&m, "notes").await;
        std::fs::write(
            dir.path().join("notes/Lichen.md"),
            "lichen crusts on stone\n",
        )
        .unwrap();
        let router = m.instance("notes").unwrap().router.clone().unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let body = get_json(
                &router,
                "POST",
                "/.search/query",
                r#"{"query":"lichen crusts","mode":"natural"}"#,
            )
            .await;
            if body["items"][0]["page"] == "Lichen" && body["notice"].is_null() {
                break;
            }
            assert!(Instant::now() < deadline, "{body}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Review Focus 4: deleting the space removes both of its indexes.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn deleting_a_semantic_space_removes_both_indexes() {
        let dir = tempfile::tempdir().unwrap();
        let fake = Arc::new(FakeEmbedder::new());
        let m = boot(dir.path(), &fake);
        until_ready(&m, "notes").await;
        let space_dir = dir.path().join("search/indexes/notes");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !space_dir.join("semantic-v1/test-fake.bin").is_file() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        m.delete("notes").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while space_dir.exists() {
            assert!(Instant::now() < deadline, "{:?}", walkdir_list(&space_dir));
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        // Edits after the delete reach no sink that could recreate it.
        std::fs::write(dir.path().join("notes/Fern.md"), "fronds unfurl\n").unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(!space_dir.exists(), "{:?}", walkdir_list(&space_dir));
    }

    /// A space already on keeps semantic search above the size limit, and
    /// its status says it has more pages than it is tuned for.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_semantic_space_above_the_limit_reports_the_warning() {
        use silverbullet_server_search::semantic::size::SEMANTIC_MAX_PAGES;
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes");
        std::fs::create_dir_all(&notes).unwrap();
        // With `boot`'s Fern.md, one page over the limit.
        for i in 0..SEMANTIC_MAX_PAGES {
            std::fs::write(notes.join(format!("Orchard {i}.md")), "apple blossom\n").unwrap();
        }
        let fake = Arc::new(FakeEmbedder::new());
        let m = boot(dir.path(), &fake);
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            let s = status(&m, "notes").await;
            if !s["reason"].is_null() {
                assert_eq!(s["backend"], "semantic");
                assert_eq!(
                    s["reason"],
                    "This space has more pages than semantic search is tuned for (5,000); results may be less relevant."
                );
                break;
            }
            assert!(Instant::now() < deadline, "{s}");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(status(&m, "plain").await["reason"].is_null());
    }

    #[tokio::test]
    async fn the_model_comes_from_server_json_and_an_unknown_id_is_ignored() {
        for (model, expected) in [
            ("multilingual-e5-small", Some("multilingual-e5-small")),
            ("no-such-model", None),
        ] {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join("server.json"),
                serde_json::json!({ "search": { "model": model } }).to_string(),
            )
            .unwrap();
            // Downloads go to a local server that has none of the files.
            let files = Arc::new(FileServer::default());
            let base = serve_files(files.clone()).await;
            let factory: crate::search::ServiceFactory = Arc::new(move |spec, root| {
                let store = ModelStore::new(root.models()).with_base_url(base.clone());
                SemanticService::start_with_store(spec.clone(), store)
            });
            let mut deps = deps(dir.path());
            deps.search =
                crate::search::SpaceSearch::in_root(crate::search::search_root(dir.path()))
                    .with_factory(factory);
            let m = MultiManager::boot(dir.path().to_path_buf(), deps, BTreeSet::new()).unwrap();
            assert_eq!(m.search().model().map(|s| s.id), expected, "{model}");
            // The download starts at boot although no space attaches.
            let deadline = Instant::now() + Duration::from_secs(10);
            while expected.is_some() && files.requests.load(Ordering::SeqCst) == 0 {
                assert!(Instant::now() < deadline, "{model}: never downloaded");
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            if expected.is_none() {
                tokio::time::sleep(Duration::from_millis(200)).await;
                assert_eq!(files.requests.load(Ordering::SeqCst), 0, "{model}");
            }
        }
    }
}

/// Choosing the model at runtime (`MultiManager::set_search_model`).
mod model_choice {
    use super::*;
    use crate::search::{ServiceFactory, SpaceSearch};
    use silverbullet_server_search::semantic::download::DownloadState;
    use silverbullet_server_search::semantic::test_model::{offer_test_tiny, FakeEmbedder};
    use silverbullet_server_search::semantic::test_server::TestModelServer;
    use silverbullet_server_search::semantic::SemanticService;
    use std::time::{Duration, Instant};

    /// A data root with `spaces` (id, `semanticSearch`), `server.json` naming
    /// `model`, and semantic services from `factory`.
    fn manager_with(
        spaces: &[(&str, Option<bool>)],
        model: Option<&str>,
        factory: ServiceFactory,
    ) -> (tempfile::TempDir, Arc<MultiManager>) {
        offer_test_tiny();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut config = MultiConfig::default();
        for &(id, semantic) in spaces {
            std::fs::create_dir_all(root.join(id)).unwrap();
            std::fs::write(root.join(id).join("Tomatoes.md"), "tomato seedlings\n").unwrap();
            let prefix = format!("/{id}");
            let mut space = payload(id, Binding::Prefix { prefix });
            space.folder = id.into();
            space.semantic_search = semantic.into();
            config.spaces.insert(id.to_string(), space);
        }
        config.save(&root.join("spaces.json")).unwrap();
        if let Some(model) = model {
            let server = serde_json::json!({ "search": { "model": model } });
            std::fs::write(root.join("server.json"), server.to_string()).unwrap();
        }
        let mut deps = deps(root);
        deps.search = SpaceSearch::in_root(crate::search::search_root(root)).with_factory(factory);
        let m = MultiManager::boot(root.to_path_buf(), deps, BTreeSet::new()).unwrap();
        (dir, m)
    }

    fn manager_with_spaces(
        spaces: &[(&str, Option<bool>)],
        model: Option<&str>,
    ) -> (tempfile::TempDir, Arc<MultiManager>) {
        let fake = Arc::new(FakeEmbedder::new());
        let factory: ServiceFactory =
            Arc::new(move |_, _| SemanticService::with_embedder(fake.clone()));
        manager_with(spaces, model, factory)
    }

    /// The services download from a slow local model server.
    /// A model server whose download never finishes until it is cancelled.
    async fn manager_with_stalled_model_server(
        spaces: &[(&str, Option<bool>)],
    ) -> (tempfile::TempDir, Arc<MultiManager>, Arc<TestModelServer>) {
        let models = Arc::new(TestModelServer::stalled().await);
        let server = models.clone();
        let (dir, m) = manager_with(spaces, None, Arc::new(move |_, _| server.service()));
        (dir, m, models)
    }

    fn backend(m: &MultiManager, id: &str) -> Option<String> {
        let instance = m.instance(id).unwrap();
        instance.search.as_ref().unwrap().status().backend
    }

    async fn until(what: &str, check: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !check() {
            assert!(Instant::now() < deadline, "never {what}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn selecting_a_model_saves_server_json_and_attaches_spaces_that_dont_opt_out() {
        let spaces = [
            ("garden", None),
            ("kitchen", Some(false)),
            ("orchard", Some(true)),
        ];
        let (dir, manager) = manager_with_spaces(&spaces, None);
        assert_eq!(backend(&manager, "garden").as_deref(), Some("fulltext"));
        let kitchen = manager.instance("kitchen").unwrap();
        manager.set_search_model(Some("test-tiny")).unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("server.json")).unwrap())
                .unwrap();
        assert_eq!(saved["search"]["model"], "test-tiny");
        assert_eq!(backend(&manager, "garden").as_deref(), Some("semantic"));
        assert_eq!(backend(&manager, "orchard").as_deref(), Some("semantic"));
        assert_eq!(backend(&manager, "kitchen").as_deref(), Some("fulltext"));
        assert!(
            Arc::ptr_eq(&kitchen, &manager.instance("kitchen").unwrap()),
            "a space that opted out isn't rebuilt"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn choosing_the_same_model_again_rebuilds_nothing() {
        let models = Arc::new(TestModelServer::start().await);
        let server = models.clone();
        let factory: ServiceFactory = Arc::new(move |_, _| server.service());
        let (_dir, manager) = manager_with(&[("garden", None)], Some("test-tiny"), factory);
        let garden = manager.instance("garden").unwrap();
        let service = manager.search().semantic().unwrap();
        manager.set_search_model(Some("test-tiny")).unwrap();
        assert!(Arc::ptr_eq(&service, &manager.search().semantic().unwrap()));
        assert!(Arc::ptr_eq(&garden, &manager.instance("garden").unwrap()));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn choosing_none_turns_semantic_search_off_everywhere() {
        let spaces = [("garden", None), ("orchard", Some(true))];
        let (dir, manager) = manager_with_spaces(&spaces, Some("test-tiny"));
        let spaces_json = || std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        let before = spaces_json();
        assert_eq!(backend(&manager, "garden").as_deref(), Some("semantic"));
        manager.set_search_model(None).unwrap();
        assert_eq!(backend(&manager, "garden").as_deref(), Some("fulltext"));
        assert_eq!(backend(&manager, "orchard").as_deref(), Some("fulltext"));
        assert!(manager.search().model().is_none());
        assert_eq!(spaces_json(), before, "per-space settings are kept");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_unknown_model_is_a_validation_error_and_changes_nothing() {
        let (dir, manager) = manager_with_spaces(&[("garden", None)], None);
        let err = manager.set_search_model(Some("no-such-model")).unwrap_err();
        assert!(matches!(err, ApiError::Validation(ref e) if e[0].field == "model"));
        let server_json = dir.path().join("server.json");
        assert!(
            !server_json.exists()
                || !std::fs::read_to_string(server_json)
                    .unwrap()
                    .contains("no-such-model")
        );
        assert!(manager.search().model().is_none());
    }

    /// The download starts with the choice, so a restart resumes it even
    /// when no space attaches.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_chosen_model_downloads_at_boot_with_every_space_opted_out() {
        let models = Arc::new(TestModelServer::start().await);
        let server = models.clone();
        let factory: ServiceFactory = Arc::new(move |_, _| server.service());
        let (_dir, manager) = manager_with(&[("kitchen", Some(false))], Some("test-tiny"), factory);
        assert_eq!(backend(&manager, "kitchen").as_deref(), Some("fulltext"));
        let service = manager.search().semantic().unwrap();
        until("downloaded", || {
            service.download_state() == DownloadState::Ready
        })
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn choosing_none_during_a_download_cancels_it() {
        let (_dir, manager, models) = manager_with_stalled_model_server(&[("garden", None)]).await;
        manager.set_search_model(Some("test-tiny")).unwrap();
        let service = manager.search().semantic().unwrap();
        until("downloading", || {
            matches!(service.download_state(), DownloadState::Downloading { done, .. } if done > 0)
        })
        .await;
        manager.set_search_model(None).unwrap();
        until("stopped", || {
            !matches!(service.download_state(), DownloadState::Downloading { .. })
        })
        .await;
        assert!(models.partial_exists());
        assert_eq!(backend(&manager, "garden").as_deref(), Some("fulltext"));
    }
}
