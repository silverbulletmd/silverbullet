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
        r#"{"serverName":"Notebook"}"#,
        &cookie,
    )
    .await;
    assert_eq!(body_json(response).await["runtimeApi"], false);
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
        json!({ "primaryUrl": null, "serverName": "SilverBullet", "runtimeApi": true })
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
        json!({"primaryUrl":"https://manager.example.test", "serverName":"Notebook Server", "runtimeApi":true})
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
        serde_json::json!({ "runtimeApi": { "status": "no_chrome" }, "runtimeApiEnabled": true, "primaryUrl": null, "searchModel": null }),
    );
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
