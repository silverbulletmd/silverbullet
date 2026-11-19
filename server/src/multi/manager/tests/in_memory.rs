use super::*;
use silverbullet_server_common::starter_kits::PreparedStarter;
use tower::ServiceExt;

fn in_memory_deps() -> InstanceDeps {
    InstanceDeps {
        root: None,
        assets: AssetFactories {
            client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
        },
        runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        runtime_availability: crate::runtime::RuntimeAvailability::NoChrome,
        runtime_idle_timeout: Default::default(),
        runtime: Arc::new(|_| None),
        metrics: None,
        auth: InstanceAuth::Accounts {
            users: crate::multi::users::UserStore::empty_in_memory(),
            authenticator: Arc::new(crate::auth::Authenticator::in_memory()),
            session: crate::multi::access::SessionPolicy::default(),
        },
        version: "test".into(),
        main_port: 3000,
        disable_service_worker: true,
        shell_disabled: false,
        shutdown: None,
        search: crate::search::SpaceSearch::in_memory(),
    }
}

fn site(folder: &Path) -> MultiConfig {
    let mut space = payload("Site", Binding::Prefix { prefix: "".into() });
    space.folder = folder.to_string_lossy().into_owned();
    space.access = Some(SpaceAccess::Read);
    space.read_only = true;
    MultiConfig {
        spaces: [("site".to_string(), space)].into_iter().collect(),
    }
}

fn boot_site(folder: &Path) -> Result<Arc<MultiManager>, String> {
    MultiManager::boot_in_memory(
        site(folder),
        ServerConfig::default(),
        in_memory_deps(),
        BTreeSet::new(),
    )
}

#[tokio::test]
async fn an_in_memory_manager_serves_its_spaces_and_refuses_every_change() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.md"), "# Site\n").unwrap();
    let before: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();

    let m = boot_site(dir.path()).unwrap();
    assert!(m.data_root().is_err());
    assert!(matches!(
        m.instance("site").unwrap().status,
        InstanceStatus::Running
    ));

    let refused = |result: Result<(), ApiError>| {
        assert!(matches!(result, Err(ApiError::Conflict(_))), "{result:?}");
    };
    refused(m.set_server_config(ServerConfigPatch {
        server_name: Some("Renamed".into()),
        ..Default::default()
    }));
    refused(m.update(
        "site",
        payload("Other", Binding::Prefix { prefix: "".into() }),
    ));
    refused(m.patch("site", serde_json::Map::new()));
    refused(m.delete("site"));
    refused(m.remove_member_everywhere("ada", BTreeSet::new()));
    refused(m.set_search_model(None));
    refused(
        m.create(
            payload(
                "New",
                Binding::Prefix {
                    prefix: "/new".into(),
                },
            ),
            PreparedStarter::None,
        )
        .map(|_| ()),
    );
    refused(m.change_git("site", true, |_, _| Ok(())));
    assert_eq!(m.server_name(), ServerConfig::default().server_name);
    assert!(m.instance("site").is_some());

    let after: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(before, after);
}

#[tokio::test]
async fn an_in_memory_manager_requires_absolute_space_folders() {
    let error = boot_site(Path::new("relative/site")).err().unwrap();
    assert!(error.contains("absolute"), "{error}");
}

/// A content folder that looks like a data root is plain content: its
/// `spaces.json` is served, not hidden or read.
#[tokio::test]
async fn an_in_memory_space_on_a_folder_with_control_files_sees_them() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("spaces.json"), "not json").unwrap();
    std::fs::write(dir.path().join("index.md"), "# Site\n").unwrap();
    let m = boot_site(dir.path()).unwrap();
    let instance = m.instance("site").unwrap();
    assert!(matches!(instance.status, InstanceStatus::Running));
    let response = instance
        .router
        .clone()
        .unwrap()
        .oneshot(
            axum::http::Request::builder()
                .uri("/.fs")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&body);
    assert!(body.contains("\"spaces.json\""), "{body}");
}

#[tokio::test]
async fn an_in_memory_manager_refuses_revisions_at_boot() {
    let dir = tempfile::tempdir().unwrap();
    let mut spaces = site(dir.path());
    spaces.spaces.get_mut("site").unwrap().revisions =
        silverbullet_server_common::RevisionsMode::Managed;
    let error = MultiManager::boot_in_memory(
        spaces,
        ServerConfig::default(),
        in_memory_deps(),
        BTreeSet::new(),
    )
    .err()
    .unwrap();
    assert!(
        error.starts_with("invalid space configuration: site.revisions:"),
        "{error}"
    );
}
