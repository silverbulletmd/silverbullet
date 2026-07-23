//! Black-box tests for multi-space mode: login on the unified `/.spaces`
//! surface, space CRUD over the admin API nested at `/.spaces/api/admin`,
//! shared sessions, per-space authorization, and the boot-detection error
//! cases around a provisioned (`spaces.json`) root.
//!
//! Each test provisions a temp root by spawning the compiled `silverbullet`
//! binary's `setup` subcommand (the same code path the setup wizard uses
//! under the hood, but exercised here through the real CLI surface) and then
//! spawns the binary again as a subprocess against the provisioned root,
//! driving its HTTP surface with `reqwest::blocking`. The runtime API is
//! disabled (`SB_RUNTIME_API=0`) so no headless Chrome launches.
//!
//! Readiness is probed via `/.spaces/api/admin/spaces` returning 401 (server
//! up, the spaces router mounted, gating active), keeping the assertions
//! independent of browser-side rendering.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use silverbullet_server::multi::setup::FirstSpace;

const ADMIN_USER: &str = "admin";
const ADMIN_PASSWORD: &str = "adminpw1";

/// Wraps the spawned server process and kills + reaps it on drop.
struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

mod common;
use common::free_port;

/// Provision `root` the same way an operator scripting a deployment would:
/// by running the real `silverbullet setup` subcommand as a subprocess
/// (writing `users.json` with a single admin account and `spaces.json`,
/// optionally seeded with one first space).
fn provision(root: &std::path::Path, space: Option<FirstSpace>) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg("setup")
        .arg(root)
        .arg("--admin")
        .arg(format!("{ADMIN_USER}:{ADMIN_PASSWORD}"));
    if let Some(first_space) = &space {
        cmd.arg("--space")
            .arg(&first_space.name)
            .arg("--at")
            .arg(&first_space.prefix);
        if !first_space.folder.is_empty() {
            cmd.arg("--space-folder").arg(&first_space.folder);
        }
    }
    let output = cmd.output().expect("spawn silverbullet setup");
    assert!(
        output.status.success(),
        "silverbullet setup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// `silverbullet setup` on a fresh temp dir provisions it (exit 0, both
/// config files written) and refuses to run a second time against the same
/// now-configured root (non-zero exit, nothing clobbered).
#[test]
fn setup_subcommand_provisions_root_then_refuses_a_second_run() {
    let root = tempfile::tempdir().unwrap();

    let first = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg("setup")
        .arg(root.path())
        .arg("--admin")
        .arg("admin:adminpw1")
        .arg("--space")
        .arg("Notes")
        .output()
        .expect("spawn silverbullet setup");
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let stdout = String::from_utf8_lossy(&first.stdout);
    assert!(stdout.contains("Setup complete"), "{stdout}");
    assert!(root.path().join("users.json").exists());
    assert!(root.path().join("spaces.json").exists());

    let second = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg("setup")
        .arg(root.path())
        .arg("--admin")
        .arg("someoneelse:otherpw1")
        .output()
        .expect("spawn silverbullet setup");
    assert!(!second.status.success());
    let stderr = String::from_utf8_lossy(&second.stderr);
    assert!(stderr.contains("already configured"), "{stderr}");
}

/// Provision a fresh temp root (admin account, no first space) and spawn the
/// binary against it with no boot-mode env switches at all — `boot::detect`
/// must pick multi-space mode purely from `spaces.json`/`users.json` being on
/// disk. Waits for the admin API to answer (401 on the gated spaces list).
fn start_multi(extra_env: &[(&str, &str)]) -> (Server, tempfile::TempDir, String) {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env_remove("SB_MULTI_SPACE")
        .env_remove("SB_USER")
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
        if let Ok(resp) = client
            .get(format!("{base}/.spaces/api/admin/spaces"))
            .send()
        {
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
        .post(format!("{base}/.spaces/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert_eq!(resp.json::<serde_json::Value>().unwrap()["status"], "ok");
    client
}

#[test]
fn boots_empty_root_with_authenticated_space_index() {
    let (_srv, _root, base) = start_multi(&[]);

    // With no space bound at `/`, the root points the browser at the one
    // logged-in surface. (What that surface *renders* is asserted by the e2e
    // suite, not here.)
    let no_redirect = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let resp = no_redirect.get(format!("{base}/")).send().unwrap();
    assert_eq!(resp.status().as_u16(), 307);
    assert_eq!(resp.headers()["location"], "/.spaces");

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(format!("{base}/.spaces/api/spaces"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 401);
    let resp = client
        .get(format!("{base}/.spaces/api/session"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 401);

    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let resp = client
        .post(format!("{base}/.spaces/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert_eq!(resp.json::<serde_json::Value>().unwrap()["status"], "ok");

    // One login, both halves of the surface: the session reports admin-ness
    // and the admin-only API accepts the very same cookie.
    let session = client
        .get(format!("{base}/.spaces/api/session"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(session["username"], ADMIN_USER);
    assert_eq!(session["admin"], true);

    // The space list is the visible-space array itself, with no envelope.
    let body = client
        .get(format!("{base}/.spaces/api/spaces"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(body, serde_json::json!([]));

    assert!(client
        .get(format!("{base}/.spaces/api/admin/spaces"))
        .send()
        .unwrap()
        .status()
        .is_success());
}

/// `boot::detect` errors when a provisioned root (`spaces.json` present) is
/// booted with the legacy `SB_USER` credential env var set — accounts now
/// live in `users.json`, so this must exit non-zero rather than silently
/// ignoring the account data already on disk.
#[test]
fn spaces_json_with_sb_user_refuses_to_boot() {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    let out = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(root.path())
        .arg("-p")
        .arg(free_port().to_string())
        .env("SB_USER", "admin:adminpw1")
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("users.json"), "{stderr}");
    assert!(stderr.contains("SB_USER"), "{stderr}");
}

/// Same provisioned-root gate, but for the legacy `SB_AUTH_TOKEN` env var:
/// API tokens now live in `users.json` and are managed through the admin UI,
/// so a provisioned root booted with `SB_AUTH_TOKEN` set must refuse rather
/// than silently ignore it.
#[test]
fn spaces_json_with_sb_auth_token_refuses_to_boot() {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    let out = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(root.path())
        .arg("-p")
        .arg(free_port().to_string())
        .env_remove("SB_USER")
        .env("SB_AUTH_TOKEN", "sometoken")
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("SB_AUTH_TOKEN"), "{stderr}");
}

/// Same provisioned-root gate, but for `--single` instead of `SB_USER`: a
/// folder with `spaces.json` cannot also be forced into single-space mode.
#[test]
fn spaces_json_with_single_flag_refuses_to_boot() {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    let out = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(root.path())
        .arg("-p")
        .arg(free_port().to_string())
        .arg("--single")
        .env_remove("SB_USER")
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("--single"), "{stderr}");
}

#[test]
fn fresh_folder_serves_setup_and_hot_swaps_into_multi() {
    let root = tempfile::tempdir().unwrap();
    let port = free_port();
    // No env switch, no --single, empty folder: `boot::detect` picks setup mode.
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env_remove("SB_MULTI_SPACE")
        .env_remove("SB_USER")
        .env("SB_RUNTIME_API", "0")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn().expect("spawn silverbullet");
    let _server = Server(child);
    let base = format!("http://127.0.0.1:{port}");

    let no_redirect = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    // Wait for the setup wizard to come up: the root redirects to /.setup/.
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(resp) = no_redirect.get(format!("{base}/")).send() {
            if resp.status().as_u16() == 307
                && resp
                    .headers()
                    .get("location")
                    .map(|v| v == "/.setup/")
                    .unwrap_or(false)
            {
                break;
            }
        }
        assert!(
            Instant::now() < deadline,
            "setup wizard did not boot in time"
        );
        std::thread::sleep(Duration::from_millis(200));
    }

    // The admin API isn't mounted yet: it falls through to the setup redirect,
    // not the gated 401 the live multi stack returns.
    let resp = no_redirect
        .get(format!("{base}/.spaces/api/admin/spaces"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 307, "admin API absent pre-setup");

    // Complete setup: admin account + a root-bound first space.
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{base}/.setup/api/complete"))
        .json(&serde_json::json!({
            "adminUsername": "admin", "adminPassword": "adminpw123",
            "space": { "name": "Notes", "prefix": "/", "folder": "" }
        }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    // Provisioning wrote the config to disk.
    assert!(root.path().join("users.json").exists());
    assert!(root.path().join("spaces.json").exists());

    // Within a few seconds the same port serves the multi stack: the admin API
    // now exists and is gated (401 instead of the pre-setup 307 redirect).
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(resp) = no_redirect
            .get(format!("{base}/.spaces/api/admin/spaces"))
            .send()
        {
            if resp.status().as_u16() == 401 {
                break;
            }
        }
        assert!(
            Instant::now() < deadline,
            "multi stack did not take over the port after setup"
        );
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[test]
fn create_spaces_and_verify_routing_and_auth_isolation() {
    let (_srv, root, base) = start_multi(&[]);
    let admin = admin_client(&base);

    // Open (public) space at /open.
    let resp = admin
        .post(format!("{base}/.spaces/api/admin/spaces"))
        .json(&serde_json::json!({ "name": "Open", "binding": { "prefix": "/open" }, "public": true }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    // Private (default) space at /locked — no `public`, no `members`: only
    // the admin account (via users.json) can authenticate against it.
    admin
        .post(format!("{base}/.spaces/api/admin/spaces"))
        .json(&serde_json::json!({ "name": "Locked", "binding": { "prefix": "/locked" } }))
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
    // The session established under /.spaces is server-wide, so the same
    // client reaches every private space the admin is authorized for.
    assert!(admin
        .get(format!("{base}/locked/.fs"))
        .send()
        .unwrap()
        .status()
        .is_success());

    // The direction is symmetric: an admin who logs in through a space is
    // already authenticated for the server-level admin API.
    let space_admin = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    assert!(space_admin
        .post(format!("{base}/locked/.auth"))
        .form(&[
            ("username", ADMIN_USER),
            ("password", ADMIN_PASSWORD),
            ("rememberMe", ""),
            ("from", ""),
        ])
        .send()
        .unwrap()
        .status()
        .is_success());
    assert!(space_admin
        .get(format!("{base}/.spaces/api/admin/spaces"))
        .send()
        .unwrap()
        .status()
        .is_success());

    // Config persisted under the root.
    assert!(root.path().join("spaces.json").exists());
    // Index seeded in the default folder.
    let spaces_dir = std::fs::read_dir(root.path().join("spaces"))
        .unwrap()
        .count();
    assert_eq!(spaces_dir, 2);
}

#[test]
fn login_in_one_prefix_is_shared_and_password_change_revokes_only_that_user() {
    let (_srv, _root, base) = start_multi(&[]);
    let admin = admin_client(&base);

    let resp = admin
        .post(format!("{base}/.spaces/api/admin/users"))
        .json(&serde_json::json!({
            "username": "alice",
            "password": "alicepw1",
            "admin": false
        }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    for prefix in ["/a", "/b"] {
        let resp = admin
            .post(format!("{base}/.spaces/api/admin/spaces"))
            .json(&serde_json::json!({
                "name": prefix,
                "binding": { "prefix": prefix },
                "members": { "alice": {} }
            }))
            .send()
            .unwrap();
        assert!(resp.status().is_success(), "{}", resp.text().unwrap());
    }

    let alice = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let login = alice
        .post(format!("{base}/a/.auth"))
        .form(&[
            ("username", "alice"),
            ("password", "alicepw1"),
            ("rememberMe", ""),
            ("from", ""),
        ])
        .send()
        .unwrap();
    assert!(login.status().is_success());
    let set_cookie = login.headers()[reqwest::header::SET_COOKIE]
        .to_str()
        .unwrap();
    assert!(set_cookie.contains("Path=/;"), "{set_cookie}");
    assert!(
        !set_cookie.contains("_a="),
        "cookie must not contain a space prefix: {set_cookie}"
    );

    // A login performed through /a authenticates /b, while /b's membership
    // check still decides whether this user is authorized there.
    assert!(alice
        .get(format!("{base}/b/.fs"))
        .send()
        .unwrap()
        .status()
        .is_success());
    // 403, not 401: alice holds a valid session (she just reached /b/.fs with
    // it), she simply isn't an administrator. The admin API distinguishes the
    // two so a client can tell "log in again" from "this account can't do this"
    // — conflating them is what previously bounced non-admins into a login loop.
    assert_eq!(
        alice
            .get(format!("{base}/.spaces/api/admin/spaces"))
            .send()
            .unwrap()
            .status()
            .as_u16(),
        403
    );

    let resp = admin
        .post(format!("{base}/.spaces/api/admin/users/alice/password"))
        .json(&serde_json::json!({ "password": "newalicepw1" }))
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert_eq!(
        alice
            .get(format!("{base}/b/.fs"))
            .send()
            .unwrap()
            .status()
            .as_u16(),
        401,
        "password changes must revoke existing sessions immediately"
    );
}
