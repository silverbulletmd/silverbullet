//! Boots the binary's server on a real ephemeral port and drives it over HTTP.
//! (The exhaustive endpoint matrix lands in a follow-up plan.)

mod common;
use common::free_port;

#[tokio::test]
async fn boots_and_serves_ping_config_and_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();

    let folder = dir.path().to_str().unwrap().to_string();
    std::env::set_var("SB_FOLDER", &folder);
    // Disable the headless-Chrome runtime so the test never launches a browser.
    std::env::set_var("SB_RUNTIME_API", "0");
    let handle = tokio::spawn(async move {
        // `run` blocks until shutdown; the test process exiting tears it down.
        let _ = silverbullet::server::run(Some("127.0.0.1".into()), Some(port), Some(folder), true)
            .await;
    });

    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let mut up = false;
    for _ in 0..50 {
        if client.get(format!("{base}/.ping")).send().await.is_ok() {
            up = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(up, "server did not start");

    // MCP exists only in multi-space mode.
    let mcp = client.get(format!("{base}/.mcp")).send().await.unwrap();
    assert_eq!(mcp.status().as_u16(), 404);
    let mcp = client
        .post(format!("{base}/.mcp"))
        .json(&serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "ping"}))
        .send()
        .await
        .unwrap();
    assert_eq!(mcp.status().as_u16(), 404);
    let mut statuses = Vec::new();
    for path in [
        "/.well-known/oauth-protected-resource/.mcp",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/.auth/mcp/authorize",
    ] {
        let resp = client.get(format!("{base}{path}")).send().await.unwrap();
        statuses.push((format!("GET {path}"), resp.status().as_u16()));
    }
    for path in [
        "/.auth/mcp/authorize",
        "/.auth/mcp/token",
        "/.auth/register",
        "/.auth/revoke",
    ] {
        let resp = client
            .post(format!("{base}{path}"))
            .form(&[("token", "unknown")])
            .send()
            .await
            .unwrap();
        statuses.push((format!("POST {path}"), resp.status().as_u16()));
    }
    assert!(
        statuses.iter().all(|(_, status)| *status == 404),
        "{statuses:?}"
    );

    let cfg: serde_json::Value = client
        .get(format!("{base}/.config"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cfg["indexPage"], "index");

    let html = client
        .get(format!("{base}/"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        html.contains("<!doctype html"),
        "got: {}",
        &html[..html.len().min(200)]
    );
    assert!(!html.contains("{{"), "unresolved placeholder in shell");

    // An empty space receives the rich index template.
    let index = client
        .get(format!("{base}/.fs/index.md"))
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    let index_body = index.text().await.unwrap();
    assert!(
        index_body.contains("Welcome to the wondrous world of SilverBullet"),
        "got: {index_body}"
    );

    get_help_answers_json(&client, &base).await;

    handle.abort();
}

/// Part of the test above, which owns the process environment the server reads.
async fn get_help_answers_json(client: &reqwest::Client, base: &str) {
    let resp = client.get(format!("{base}/.help")).send().await.unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert_eq!(
        resp.headers()["content-type"].to_str().unwrap(),
        "application/json"
    );
    let help: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(help["version"], 1);
    assert!(help["runtime"].is_boolean(), "{help}");
    let skills = help["skills"].as_array().unwrap();
    assert!(
        skills
            .iter()
            .any(|s| s["source"] == "std" && s["page"] == "Library/Std/Docs/Querying"),
        "{skills:?}"
    );
    assert!(
        help["outline"]["pages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "index"),
        "{help}"
    );
}
