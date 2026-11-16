//! Server settings over the admin API: `server-config` (the runtime
//! toggle, validation, the server name) and `server-info`.

use super::*;

#[tokio::test]
async fn runtime_server_toggle_persists_and_preserves_other_settings() {
    let dir = tempfile::tempdir().unwrap();
    let (router, _manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"runtimeApi":false}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["runtimeApi"], false);
    let stored =
        crate::multi::server_config::ServerConfig::load(&dir.path().join("server.json")).unwrap();
    assert!(!stored.runtime_api);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        // What the dashboard's Server settings form sends
        r#"{"primaryUrl":"https://manager.example.test","serverName":"Notebook"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["runtimeApi"], false);
    let stored =
        crate::multi::server_config::ServerConfig::load(&dir.path().join("server.json")).unwrap();
    assert!(!stored.runtime_api);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"runtimeApi":"yes"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn runtime_idle_timeout_persists_and_rejects_bad_values_without_saving() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    assert_eq!(manager.runtime_idle_timeout(), 30);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"runtimeIdleTimeout":5}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["runtimeIdleTimeout"], 5);
    let stored =
        crate::multi::server_config::ServerConfig::load(&dir.path().join("server.json")).unwrap();
    assert_eq!(stored.runtime_idle_timeout, 5);
    for bad in [r#"-1"#, r#"1.5"#, r#""10""#, r#"10081"#] {
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            &format!(r#"{{"serverName":"Changed","runtimeIdleTimeout":{bad}}}"#),
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{bad}");
    }
    assert_eq!(manager.runtime_idle_timeout(), 5);
    assert_eq!(manager.server_name(), "SilverBullet", "nothing saved");
}

#[tokio::test]
async fn mcp_is_off_by_default_and_the_toggle_persists_and_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    assert!(!manager.mcp_enabled(), "a fresh config leaves MCP off");
    let response = authed(&router, "GET", "/api/server-config", "", &cookie).await;
    assert_eq!(body_json(response).await["mcp"], false);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"mcp":true}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["mcp"], true);
    assert_eq!(body["runtimeApi"], true);
    assert!(manager.mcp_enabled());
    let stored =
        crate::multi::server_config::ServerConfig::load(&dir.path().join("server.json")).unwrap();
    assert!(stored.mcp);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"serverName":"Notebook"}"#,
        &cookie,
    )
    .await;
    assert_eq!(body_json(response).await["mcp"], true);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"mcp":"yes"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"mcp":false}"#,
        &cookie,
    )
    .await;
    assert_eq!(body_json(response).await["mcp"], false);
    assert!(!manager.mcp_enabled());
}

#[tokio::test]
async fn server_config_is_admin_gated_and_reports_validation_errors() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    assert_eq!(
        send(&router, get("/api/server-config")).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let cookie = session_cookie(&users, "admin");
    let response = authed(&router, "GET", "/api/server-config", "", &cookie).await;
    assert_eq!(
        body_json(response).await,
        json!({ "primaryUrl": null, "serverName": "SilverBullet", "runtimeApi": true, "runtimeIdleTimeout": 30, "mcp": false })
    );
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"primaryUrl":"ftp://notes.example.test"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        body_json(response).await["errors"][0]["field"],
        "primaryUrl"
    );
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"primaryUrl":"https://Manager.Example.test/"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_json(response).await["primaryUrl"],
        "https://manager.example.test"
    );
    assert_eq!(
        manager.primary_url().as_deref(),
        Some("https://manager.example.test")
    );
}

#[tokio::test]
async fn server_name_updates_preserve_primary_url_and_omitted_name() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    manager
        .set_primary_url("https://manager.example.test")
        .unwrap();
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"serverName":"  Notebook Server  "}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_json(response).await,
        json!({"primaryUrl":"https://manager.example.test", "serverName":"Notebook Server", "runtimeApi":true, "runtimeIdleTimeout":30, "mcp":false})
    );
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"primaryUrl":"https://other.example.test"}"#,
        &cookie,
    )
    .await;
    assert_eq!(body_json(response).await["serverName"], "Notebook Server");
    for value in [
        json!({"serverName":"  "}),
        json!({"serverName":null}),
        json!({"serverName":"x".repeat(101)}),
    ] {
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            &value.to_string(),
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body_json(response).await["errors"][0]["field"],
            "serverName"
        );
    }
    assert_eq!(manager.server_name(), "Notebook Server");
}

#[tokio::test]
async fn server_info_reports_runtime_availability_and_is_admin_gated() {
    let dir = tempfile::tempdir().unwrap();
    let (router, _manager, users) =
        admin_router_with_runtime(&dir, crate::runtime::RuntimeAvailability::NoChrome);

    let resp = send(&router, get("/api/server-info")).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let cookie = session_cookie(&users, "admin");
    let resp = authed(&router, "GET", "/api/server-info", "", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        body_json(resp).await,
        serde_json::json!({ "runtimeApi": { "status": "no_chrome" }, "runtimeApiEnabled": true, "mcp": { "status": "available" }, "mcpEnabled": false, "primaryUrl": null, "searchModel": null, "updateCheck": { "update": null, "security": [] } }),
    );
}

fn router_with_update_check(
    dir: &tempfile::TempDir,
    update_check: Arc<crate::update_check::UpdateCheck>,
) -> (axum::Router, Arc<UserStore>) {
    let users = UserStore::create_empty(dir.path()).unwrap();
    users
        .create_user("admin", "adminpw1", true, Profile::default())
        .unwrap();
    let authenticator = test_authenticator();
    let manager = MultiManager::boot(
        dir.path().to_path_buf(),
        deps(dir.path(), users.clone(), authenticator.clone()),
        std::collections::BTreeSet::new(),
    )
    .unwrap();
    let state = Arc::new(
        AdminState::new(
            manager,
            users.clone(),
            authenticator,
            crate::runtime::RuntimeAvailability::Available,
        )
        .with_update_check(update_check),
    );
    (
        axum::Router::new().nest("/api", build_admin_api_router(state)),
        users,
    )
}

#[tokio::test]
async fn server_info_reports_update_check_disabled() {
    let dir = tempfile::tempdir().unwrap();
    let (router, _manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    let resp = authed(&router, "GET", "/api/server-info", "", &cookie).await;
    assert_eq!(
        body_json(resp).await["updateCheck"],
        serde_json::json!({ "update": null, "security": [] })
    );
}

#[tokio::test]
async fn server_info_reports_stored_update() {
    let dir = tempfile::tempdir().unwrap();
    let state_dir = tempfile::tempdir().unwrap();
    std::fs::write(
        state_dir.path().join(crate::update_check::STATE_FILE),
        serde_json::json!({
            "version": "2.8.0-0-g4d5eac537-2026-11-02T07-41-34Z",
            "checkedAt": 1_700_000_000u64,
            "answer": {
                "update": { "version": "2.9.0", "url": "https://example.test/release", "title": "SilverBullet 2.9" },
                "security": [{ "id": "SB-1", "fixedIn": "2.8.1", "severity": "high", "summary": "Bad", "url": "https://example.test/SB-1" }]
            }
        })
        .to_string(),
    )
    .unwrap();
    let update_check = crate::update_check::UpdateCheck::load(
        state_dir.path(),
        "2.8.0-0-g4d5eac537-2026-11-02T07-41-34Z",
        "http://127.0.0.1:1/unused".into(),
        "binary".into(),
    );
    let (router, users) = router_with_update_check(&dir, update_check);
    let cookie = session_cookie(&users, "admin");
    let resp = authed(&router, "GET", "/api/server-info", "", &cookie).await;
    let info = body_json(resp).await["updateCheck"].clone();
    assert_eq!(info["update"]["version"], "2.9.0");
    assert_eq!(info["security"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn server_info_names_the_search_model() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("server.json"),
        r#"{"search":{"model":"multilingual-e5-small"}}"#,
    )
    .unwrap();
    let (router, _manager, users) = admin_router_on(
        &dir,
        crate::runtime::RuntimeAvailability::Available,
        SpaceSearch::in_root(crate::search::search_root(dir.path())),
    );
    let cookie = session_cookie(&users, "admin");
    let resp = authed(&router, "GET", "/api/server-info", "", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        body_json(resp).await["searchModel"],
        serde_json::json!({ "id": "multilingual-e5-small", "displayName": "Multilingual E5 Small" })
    );
}

#[tokio::test]
async fn a_rejected_field_saves_nothing_else_from_the_same_request() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    let response = authed(
        &router,
        "PUT",
        "/api/server-config",
        r#"{"serverName":"Garden","runtimeIdleTimeout":5,"primaryUrl":"ftp://notes.example.test"}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(manager.server_name(), "SilverBullet");
    assert_eq!(manager.runtime_idle_timeout(), 30);
    let stored =
        crate::multi::server_config::ServerConfig::load(&dir.path().join("server.json")).unwrap();
    assert_eq!(stored.server_name, "SilverBullet");
}
