//! Admin MCP grant management, `server-info`'s MCP fields and the sweep
//! that runs when a user is deleted.

use super::*;
use crate::auth::mcp::grants::{ClientKind, GrantStore, NewGrant};
use crate::multi::admin_api::McpAvailability;

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn new_grant(username: &str, spaces: Vec<String>) -> NewGrant {
    NewGrant {
        username: username.into(),
        client_id: "https://client.example.test/meta.json".into(),
        client_name: "Example client".into(),
        client_kind: ClientKind::Cimd,
        verified_host: Some("client.example.test".into()),
        redirect_host: "client.example.test".into(),
        resource: "http://localhost/.mcp".into(),
        spaces,
        scope: "mcp".into(),
        access: "write".into(),
        credential_version: None,
    }
}

fn router_with_grants(
    dir: &tempfile::TempDir,
    availability: McpAvailability,
) -> (axum::Router, Arc<UserStore>, Arc<GrantStore>) {
    router_with_grants_in(dir, dir.path(), availability)
}

fn router_with_grants_in(
    dir: &tempfile::TempDir,
    grants_dir: &std::path::Path,
    availability: McpAvailability,
) -> (axum::Router, Arc<UserStore>, Arc<GrantStore>) {
    let users = UserStore::create_empty(dir.path()).unwrap();
    users
        .create_user("admin", "adminpw1", true, Profile::default())
        .unwrap();
    users
        .create_user("alice", "alicepw1", false, Profile::default())
        .unwrap();
    let authenticator = test_authenticator();
    let manager = MultiManager::boot(
        dir.path().to_path_buf(),
        deps(dir.path(), users.clone(), authenticator.clone()),
        std::collections::BTreeSet::new(),
    )
    .unwrap();
    let grants = Arc::new(GrantStore::load(grants_dir).unwrap());
    let state = Arc::new(
        AdminState::new(
            manager,
            users.clone(),
            authenticator,
            crate::runtime::RuntimeAvailability::Available,
        )
        .with_mcp(grants.clone(), availability),
    );
    let router = axum::Router::new().nest("/api", build_admin_api_router(state));
    (router, users, grants)
}

#[tokio::test]
async fn admin_lists_all_grants_with_usernames() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, grants) = router_with_grants(&dir, McpAvailability::Available);
    grants.create(new_grant("alice", vec![]), now()).unwrap();
    grants.create(new_grant("admin", vec![]), now()).unwrap();
    let cookie = session_cookie(&users, "admin");
    let response = authed(&router, "GET", "/api/mcp/grants", "", &cookie).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    let mut names: Vec<_> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| grant["username"].as_str().unwrap().to_string())
        .collect();
    names.sort();
    assert_eq!(names, ["admin", "alice"]);
    let id = body[0]["id"].as_str().unwrap();
    let uri = format!("/api/mcp/grants/{id}");
    let response = authed(&router, "DELETE", &uri, "", &cookie).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(grants.list_all().len(), 1);
    let response = authed(&router, "DELETE", &uri, "", &cookie).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn non_admin_gets_403_from_admin_grants() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, grants) = router_with_grants(&dir, McpAvailability::Available);
    let id = grants.create(new_grant("alice", vec![]), now()).unwrap().id;
    let cookie = session_cookie(&users, "alice");
    let response = authed(&router, "GET", "/api/mcp/grants", "", &cookie).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let uri = format!("/api/mcp/grants/{id}");
    let response = authed(&router, "DELETE", &uri, "", &cookie).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(grants.list_all().len(), 1);
}

#[tokio::test]
async fn server_info_reports_mcp_disabled_by_env() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, _grants) = router_with_grants(&dir, McpAvailability::DisabledByEnv);
    let cookie = session_cookie(&users, "admin");
    let body = body_json(authed(&router, "GET", "/api/server-info", "", &cookie).await).await;
    assert_eq!(body["mcp"]["status"], "disabled_by_env");
    assert_eq!(body["mcpEnabled"], false);

    let dir = tempfile::tempdir().unwrap();
    let (router, users, _grants) = router_with_grants(&dir, McpAvailability::Available);
    let cookie = session_cookie(&users, "admin");
    let body = body_json(authed(&router, "GET", "/api/server-info", "", &cookie).await).await;
    assert_eq!(body["mcp"]["status"], "available");
}

#[tokio::test]
async fn deleting_user_revokes_their_grants() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, grants) = router_with_grants(&dir, McpAvailability::Available);
    grants.create(new_grant("alice", vec![]), now()).unwrap();
    grants.create(new_grant("admin", vec![]), now()).unwrap();
    let cookie = session_cookie(&users, "admin");
    let response = authed(&router, "DELETE", "/api/users/alice", "", &cookie).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(grants.list_for_user("alice").is_empty());
    assert_eq!(grants.list_for_user("admin").len(), 1);
}

#[tokio::test]
async fn server_info_reports_mcp_failed_when_store_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, _grants) = router_with_grants(
        &dir,
        McpAvailability::Failed {
            message: "could not load MCP grants: corrupt".into(),
        },
    );
    let cookie = session_cookie(&users, "admin");
    let body = body_json(authed(&router, "GET", "/api/server-info", "", &cookie).await).await;
    assert_eq!(
        body["mcp"],
        serde_json::json!({ "status": "failed", "message": "could not load MCP grants: corrupt" })
    );
}

#[tokio::test]
async fn deleting_user_still_sweeps_memberships_when_grant_revocation_fails() {
    let dir = tempfile::tempdir().unwrap();
    let grants_dir = tempfile::tempdir().unwrap();
    let (router, users, grants) =
        router_with_grants_in(&dir, grants_dir.path(), McpAvailability::Available);
    grants.create(new_grant("carol", vec![]), now()).unwrap();
    let cookie = session_cookie(&users, "admin");
    let response = authed(
        &router,
        "POST",
        "/api/users",
        r#"{"username":"carol","password":"pw123456","admin":false}"#,
        &cookie,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let created = body_json(
        authed(
            &router,
            "POST",
            "/api/spaces",
            r#"{"name":"Team","binding":{"prefix":"/team"},"members":{"carol":{}}}"#,
            &cookie,
        )
        .await,
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();
    // Dropping the directory makes the next grant write fail.
    drop(grants_dir);
    assert!(grants.revoke_for_user("carol").is_err());

    let response = authed(&router, "DELETE", "/api/users/carol", "", &cookie).await;
    assert_eq!(response.status(), StatusCode::OK);
    let spaces = body_json(authed(&router, "GET", "/api/spaces", "", &cookie).await).await;
    assert!(!spaces[&id]["members"]
        .as_object()
        .is_some_and(|members| members.contains_key("carol")));
    let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
    assert!(!raw.contains("carol"), "{raw}");
}

#[tokio::test]
async fn sign_in_changes_revoke_the_users_grants() {
    let cases = [
        (
            "POST",
            "/api/users/alice/password",
            r#"{"password":"alicepw2"}"#,
        ),
        ("DELETE", "/api/users/alice/sessions", ""),
        ("POST", "/api/users/alice/disabled", r#"{"disabled":true}"#),
    ];
    for (method, uri, body) in cases {
        let dir = tempfile::tempdir().unwrap();
        let (router, users, grants) = router_with_grants(&dir, McpAvailability::Available);
        grants.create(new_grant("alice", vec![]), now()).unwrap();
        grants.create(new_grant("admin", vec![]), now()).unwrap();
        let cookie = session_cookie(&users, "admin");
        let response = authed(&router, method, uri, body, &cookie).await;
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert!(grants.list_for_user("alice").is_empty(), "{uri}");
        assert_eq!(grants.list_for_user("admin").len(), 1, "{uri}");
    }
}

#[tokio::test]
async fn enabling_an_account_keeps_its_grants() {
    let dir = tempfile::tempdir().unwrap();
    let (router, users, grants) = router_with_grants(&dir, McpAvailability::Available);
    grants.create(new_grant("alice", vec![]), now()).unwrap();
    let cookie = session_cookie(&users, "admin");
    let body = r#"{"disabled":false}"#;
    let response = authed(&router, "POST", "/api/users/alice/disabled", body, &cookie).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(grants.list_for_user("alice").len(), 1);
}

#[tokio::test]
async fn sign_in_changes_succeed_when_grant_revocation_fails() {
    let cases = [
        (
            "POST",
            "/api/users/alice/password",
            r#"{"password":"alicepw2"}"#,
        ),
        ("DELETE", "/api/users/alice/sessions", ""),
        ("POST", "/api/users/alice/disabled", r#"{"disabled":true}"#),
    ];
    for (method, uri, body) in cases {
        let dir = tempfile::tempdir().unwrap();
        let grants_dir = tempfile::tempdir().unwrap();
        let (router, users, grants) =
            router_with_grants_in(&dir, grants_dir.path(), McpAvailability::Available);
        grants.create(new_grant("alice", vec![]), now()).unwrap();
        let version = users.credential_version("alice");
        // Dropping the directory makes the next grant write fail.
        drop(grants_dir);
        let cookie = session_cookie(&users, "admin");
        let response = authed(&router, method, uri, body, &cookie).await;
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert_ne!(users.credential_version("alice"), version, "{uri}");
    }
}
