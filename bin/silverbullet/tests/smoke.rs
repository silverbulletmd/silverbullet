//! Boots the binary's server on a real ephemeral port and drives it over HTTP.
//! (The exhaustive endpoint matrix lands in a follow-up plan.)

mod common;
use common::{free_port, provision_data_root};
use silverbullet_server::multi::config::SpaceAccess;

#[tokio::test]
async fn boots_and_serves_ping_config_and_bundle() {
    let space = tempfile::tempdir().unwrap();
    std::fs::write(
        space.path().join("index.md"),
        include_str!("../../../starter-kits/personal-space/index.md"),
    )
    .unwrap();
    // Visitors may write, but `/.help` is for signed-in accounts.
    let dir = provision_data_root(space.path(), SpaceAccess::Write, Some(("pat", "secret")));
    let port = free_port();

    let folder = dir.path().to_str().unwrap().to_string();
    std::env::set_var("SB_FOLDER", &folder);
    let handle = tokio::spawn(async move {
        // `run` blocks until shutdown; the test process exiting tears it down.
        let _ =
            silverbullet::server::run(Some("127.0.0.1".into()), Some(port), Some(folder), false)
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

    let index = client
        .get(format!("{base}/.fs/index.md"))
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    let index_body = index.text().await.unwrap();
    assert!(
        index_body.contains("Welcome to your personal space"),
        "got: {index_body}"
    );

    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let login = client
        .post(format!("{base}/.auth"))
        .form(&[("username", "pat"), ("password", "secret")])
        .send()
        .await
        .unwrap();
    assert!(login.status().is_success());
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
