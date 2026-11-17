//! The multi-space stack built from an in-memory configuration: it serves a
//! public read-only space and writes nothing to disk.

use std::path::Path;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use silverbullet::multi::{build_multi_stack, InMemoryStack, StackSource};
use silverbullet_server::multi::config::MultiConfig;
use silverbullet_server::multi::server_config::ServerConfig;
use tower::ServiceExt;

mod common;
use common::snapshot;

const CHILD_ENV: &str = "SB_TEST_IN_MEMORY_CONTENT";

fn source(content: &Path) -> StackSource {
    let spaces = MultiConfig::from_json(
        &serde_json::json!({
            "site": {
                "name": "Site",
                "folder": content.to_string_lossy(),
                "binding": { "prefix": "/" },
                "access": "read",
                "readOnly": true,
                "revisions": "disabled",
            }
        })
        .to_string(),
    )
    .unwrap();
    let server: ServerConfig =
        serde_json::from_value(serde_json::json!({ "runtimeApi": false })).unwrap();
    StackSource::InMemory(InMemoryStack { spaces, server })
}

async fn send(router: &axum::Router, method: &str, uri: &str, body: &str) -> (StatusCode, String) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("host", "localhost")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

/// Serves `content` from an in-memory stack: the index page, a refused PUT,
/// the file listing, the sign-in page and a search that waits for indexing.
async fn exercise(content: &Path) {
    let config = silverbullet::config::Config::from_env(
        None,
        Some(3000),
        Some(content.to_string_lossy().into_owned()),
    )
    .unwrap();
    let (router, _) = build_multi_stack(&config, source(content), None)
        .await
        .unwrap();

    let (status, body) = send(&router, "GET", "/", "").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("Hello published"), "{body}");

    let (status, _) = send(&router, "PUT", "/.fs/new.md", "# New").await;
    assert!(
        status.is_client_error(),
        "a PUT must be refused, got {status}"
    );
    assert!(!content.join("new.md").exists());

    let (status, _) = send(&router, "GET", "/.fs", "").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(&router, "GET", "/.auth", "").await;
    assert!(status.is_success(), "{status}");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let (status, body) = send(&router, "POST", "/.search/query", r#"{"query":"one"}"#).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        if body["items"][0]["page"] == "notes/one" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "never indexed: {body}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    // Room for background work (watcher, index commits) to show itself.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
}

fn content_folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.md"), "# Hello published\n").unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/one.md"), "One").unwrap();
    dir
}

#[tokio::test]
async fn in_memory_stack_serves_a_public_read_only_space() {
    if std::env::var_os(CHILD_ENV).is_some() {
        return;
    }
    let content = content_folder();
    exercise(content.path()).await;
}

/// Runs the flow in a child process whose `TMPDIR`, `HOME` and current
/// directory are fresh empty folders and which sees no `SB_*` variables, so
/// this process's environment stays untouched.
#[tokio::test]
async fn in_memory_stack_writes_no_files() {
    if let Some(content) = std::env::var_os(CHILD_ENV) {
        exercise(Path::new(&content)).await;
        return;
    }
    let content = content_folder();
    let tmp = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let watched = [content.path(), tmp.path(), cwd.path(), home.path()];
    let before: Vec<_> = watched.iter().map(|dir| snapshot(dir)).collect();
    // Writes within the filesystem's mtime granularity would go unseen.
    std::thread::sleep(std::time::Duration::from_millis(50));

    let mut child = std::process::Command::new(std::env::current_exe().unwrap());
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("SB_") {
            child.env_remove(key);
        }
    }
    let output = child
        .args(["--exact", "in_memory_stack_writes_no_files", "--nocapture"])
        .env(CHILD_ENV, content.path())
        .env("TMPDIR", tmp.path())
        .env("HOME", home.path())
        .current_dir(cwd.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "child failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("1 passed"),
        "the child ran no test"
    );

    let after: Vec<_> = watched.iter().map(|dir| snapshot(dir)).collect();
    for (name, (before, after)) in [
        "the content folder",
        "TMPDIR",
        "the current directory",
        "HOME",
    ]
    .iter()
    .zip(before.iter().zip(&after))
    {
        assert_eq!(before, after, "{name} changed");
    }
}
