//! Boots the binary's server on a real ephemeral port and drives it over HTTP.
//! (The exhaustive endpoint matrix lands in a follow-up plan.)

use std::net::TcpListener;

/// Find a free port by binding :0 and dropping the listener.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn boots_and_serves_ping_config_and_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();

    // Run the server in the background against a fresh temp space.
    let folder = dir.path().to_str().unwrap().to_string();
    std::env::set_var("SB_FOLDER", &folder);
    // Disable the headless-Chrome runtime so the test never launches a browser.
    std::env::set_var("SB_RUNTIME_API", "0");
    let handle = tokio::spawn(async move {
        // `run` blocks until shutdown; the test process exiting tears it down.
        let _ = silverbullet::server::run(Some("127.0.0.1".into()), Some(port), Some(folder)).await;
    });

    // Wait for the listener to come up.
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

    // /.config returns the BootConfig JSON.
    let cfg: serde_json::Value = client
        .get(format!("{base}/.config"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cfg["indexPage"], "index");

    // The SPA shell is served (templated, no leftover placeholders).
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

    // The empty space was seeded with index.md.
    let index = client
        .get(format!("{base}/.fs/index.md"))
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);

    handle.abort();
}
