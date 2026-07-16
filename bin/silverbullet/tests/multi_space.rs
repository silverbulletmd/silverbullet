//! Black-box tests for multi-space mode (SB_MULTI_SPACE=1): admin login, space
//! CRUD over the admin API, per-space routing and auth isolation.
//!
//! Each test spawns the compiled `silverbullet` binary as a subprocess against a
//! fresh temp root and drives its HTTP surface with `reqwest::blocking`. The
//! runtime API is disabled (`SB_RUNTIME_API=0`) so no headless Chrome launches.
//!
//! Note: readiness is probed via `/.admin/api/spaces` returning 401 (server up +
//! admin router mounted + gating active) rather than `/.admin/` returning 200 —
//! the admin SPA shell (`.client/admin.html`) is a later deliverable and is not
//! yet embedded in the client bundle. Every assertion below is independent of
//! that shell.

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Wraps the spawned server process and kills + reaps it on drop.
struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Spawn the binary in multi-space mode against a fresh temp root and wait for
/// the admin API to answer (401 on the gated spaces list).
fn start_multi(extra_env: &[(&str, &str)]) -> (Server, tempfile::TempDir, String) {
    let root = tempfile::tempdir().unwrap();
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_MULTI_SPACE", "1")
        .env("SB_USER", "admin:adminpw")
        .env("SB_RUNTIME_API", "0")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().expect("spawn silverbullet");
    let server = Server(child);
    let base = format!("http://127.0.0.1:{port}");

    let client = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(resp) = client.get(format!("{base}/.admin/api/spaces")).send() {
            if resp.status().as_u16() == 401 {
                break;
            }
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }
    (server, root, base)
}

fn admin_client(base: &str) -> reqwest::blocking::Client {
    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let resp = client
        .post(format!("{base}/.admin/api/login"))
        .json(&serde_json::json!({ "username": "admin", "password": "adminpw" }))
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert_eq!(resp.json::<serde_json::Value>().unwrap()["status"], "ok");
    client
}

#[test]
fn boots_empty_root_redirects_to_admin_and_api_is_gated() {
    let (_srv, _root, base) = start_multi(&[]);
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let resp = client.get(format!("{base}/")).send().unwrap();
    assert_eq!(resp.status().as_u16(), 307);
    assert_eq!(resp.headers()["location"], "/.admin/");
    let resp = client
        .get(format!("{base}/.admin/api/spaces"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 401);
}

#[test]
fn refuses_to_boot_without_sb_user() {
    let root = tempfile::tempdir().unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(root.path())
        .arg("-p")
        .arg(free_port().to_string())
        .env("SB_MULTI_SPACE", "1")
        .env_remove("SB_USER")
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("SB_USER"), "{stderr}");
}

#[test]
fn create_spaces_and_verify_routing_and_auth_isolation() {
    let (_srv, root, base) = start_multi(&[]);
    let admin = admin_client(&base);

    // Open space at /open.
    let resp = admin
        .post(format!("{base}/.admin/api/spaces"))
        .json(&serde_json::json!({ "name": "Open", "binding": { "prefix": "/open" }, "auth": { "mode": "none" } }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    // Inherit-auth space at /locked.
    admin
        .post(format!("{base}/.admin/api/spaces"))
        .json(&serde_json::json!({ "name": "Locked", "binding": { "prefix": "/locked" }, "auth": { "mode": "inherit" } }))
        .send()
        .unwrap();

    let anon = reqwest::blocking::Client::new();
    // Open space serves reads and writes.
    assert!(anon
        .get(format!("{base}/open/.ping"))
        .send()
        .unwrap()
        .status()
        .is_success());
    assert!(anon
        .put(format!("{base}/open/.fs/note.md"))
        .body("hello")
        .send()
        .unwrap()
        .status()
        .is_success());
    assert!(anon
        .get(format!("{base}/open/.fs/note.md"))
        .send()
        .unwrap()
        .text()
        .unwrap()
        .contains("hello"));

    // Locked space 401s anonymously.
    assert_eq!(
        anon.get(format!("{base}/locked/.fs"))
            .send()
            .unwrap()
            .status()
            .as_u16(),
        401
    );

    // Config persisted under the root.
    assert!(root.path().join("spaces.json").exists());
    // Index seeded in the default folder.
    let spaces_dir = std::fs::read_dir(root.path().join("spaces"))
        .unwrap()
        .count();
    assert_eq!(spaces_dir, 2);
}
