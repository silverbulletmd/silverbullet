//! Black-box tests for multi-space mode: login on the unified `/.dashboard`
//! surface, space CRUD over the admin API nested at `/.dashboard/api/admin`,
//! shared sessions, per-space authorization, and boot detection around a
//! provisioned (`spaces.json`) root.
//!
//! Each test provisions a temp root by spawning the compiled `silverbullet`
//! binary's `setup` subcommand (the same code path the setup wizard uses
//! under the hood, but exercised here through the real CLI surface) and then
//! spawns the binary again as a subprocess against the provisioned root,
//! driving its HTTP surface with `reqwest::blocking`. The runtime API is
//! off in each root's `server.json`, so no headless Chrome launches.
//!
//! Readiness is probed via `/.dashboard/api/admin/spaces` returning 401 (server
//! up, the Dashboard router mounted, gating active), keeping the assertions
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

#[path = "multi_space/mcp.rs"]
mod mcp;

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
    runtime_off(root);
}

/// Turn the runtime API off in `root`'s `server.json`, keeping its other
/// settings, so the server never launches a headless Chrome.
fn runtime_off(root: &std::path::Path) {
    let path = root.join("server.json");
    let mut config: serde_json::Value = std::fs::read(&path)
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
        .unwrap_or_else(|_| serde_json::json!({}));
    config["runtimeApi"] = serde_json::Value::Bool(false);
    std::fs::write(&path, config.to_string()).unwrap();
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
fn start_multi_with_service_worker(
    extra_env: &[(&str, &str)],
    service_worker_enabled: bool,
) -> (Server, tempfile::TempDir, String) {
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
        .env_remove("SB_DISABLE_SERVICE_WORKER")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !service_worker_enabled {
        cmd.env("SB_DISABLE_SERVICE_WORKER", "1");
    }
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
            .get(format!("{base}/.dashboard/api/admin/spaces"))
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

fn start_multi(extra_env: &[(&str, &str)]) -> (Server, tempfile::TempDir, String) {
    start_multi_with_service_worker(extra_env, false)
}

fn admin_client(base: &str) -> reqwest::blocking::Client {
    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let resp = client
        .post(format!("{base}/.dashboard/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert_eq!(resp.json::<serde_json::Value>().unwrap()["status"], "ok");
    client
}

#[test]
fn boots_empty_root_with_authenticated_dashboard() {
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
    assert_eq!(resp.headers()["location"], "/.dashboard");

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(format!("{base}/.dashboard/api/spaces"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 401);
    let resp = client
        .get(format!("{base}/.dashboard/api/session"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 401);

    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let resp = client
        .post(format!("{base}/.dashboard/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert_eq!(resp.json::<serde_json::Value>().unwrap()["status"], "ok");

    // One login, both halves of the surface: the session reports admin-ness
    // and the admin-only API accepts the very same cookie.
    let session = client
        .get(format!("{base}/.dashboard/api/session"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(session["username"], ADMIN_USER);
    assert_eq!(session["admin"], true);

    // The space list is the visible-space array itself, with no envelope.
    let body = client
        .get(format!("{base}/.dashboard/api/spaces"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(body, serde_json::json!([]));

    assert!(client
        .get(format!("{base}/.dashboard/api/admin/spaces"))
        .send()
        .unwrap()
        .status()
        .is_success());
}

/// Leftover single-space settings (`SB_USER`, `SB_AUTH_TOKEN`,
/// `SB_RUNTIME_API`) next to a provisioned root are logged as ignored: the
/// server boots from `users.json` and `server.json` as usual.
#[test]
fn spaces_json_with_legacy_settings_boots_and_warns() {
    let (mut server, _root, _base) = start_multi(&[
        ("SB_USER", "admin:adminpw1"),
        ("SB_AUTH_TOKEN", "sometoken"),
        ("SB_RUNTIME_API", "0"),
    ]);
    let _ = server.0.kill();
    let _ = server.0.wait();
    let mut stdout = String::new();
    std::io::Read::read_to_string(&mut server.0.stdout.take().unwrap(), &mut stdout).unwrap();
    assert!(stdout.contains("SB_USER is ignored"), "{stdout}");
    assert!(stdout.contains("SB_AUTH_TOKEN is ignored"), "{stdout}");
    assert!(stdout.contains("SB_RUNTIME_API is ignored"), "{stdout}");
}

#[test]
fn fresh_folder_serves_setup_and_hot_swaps_into_multi() {
    let root = tempfile::tempdir().unwrap();
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env_remove("SB_MULTI_SPACE")
        .env_remove("SB_USER")
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
        .get(format!("{base}/.dashboard/api/admin/spaces"))
        .send()
        .unwrap();
    assert_eq!(resp.status().as_u16(), 307, "admin API absent pre-setup");

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

    assert!(root.path().join("users.json").exists());
    assert!(root.path().join("spaces.json").exists());

    // Within a few seconds the same port serves the multi stack: the admin API
    // now exists and is gated (401 instead of the pre-setup 307 redirect).
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(resp) = no_redirect
            .get(format!("{base}/.dashboard/api/admin/spaces"))
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

    let resp = admin
        .post(format!("{base}/.dashboard/api/admin/spaces"))
        .json(&serde_json::json!({ "name": "Open", "binding": { "prefix": "/open" }, "public": true }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    // Private (default) space at /locked — no `public`, no `members`: only
    // the admin account (via users.json) can authenticate against it.
    admin
        .post(format!("{base}/.dashboard/api/admin/spaces"))
        .json(&serde_json::json!({ "name": "Locked", "binding": { "prefix": "/locked" } }))
        .send()
        .unwrap();

    let anon = reqwest::blocking::Client::new();
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

    assert_eq!(
        anon.get(format!("{base}/locked/.fs"))
            .send()
            .unwrap()
            .status()
            .as_u16(),
        401
    );
    // The session established under /.dashboard is server-wide, so the same
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
            ("from", ""),
        ])
        .send()
        .unwrap()
        .status()
        .is_success());
    assert!(space_admin
        .get(format!("{base}/.dashboard/api/admin/spaces"))
        .send()
        .unwrap()
        .status()
        .is_success());

    assert!(root.path().join("spaces.json").exists());
    let spaces_dir = std::fs::read_dir(root.path().join("spaces"))
        .unwrap()
        .count();
    assert_eq!(spaces_dir, 2);
}

#[test]
fn custom_hostname_prefixes_route_without_cross_host_fallback() {
    let (_srv, _root, base) = start_multi_with_service_worker(&[], true);
    let admin = admin_client(&base);
    let create = |name: &str, binding: serde_json::Value| {
        admin
            .post(format!("{base}/.dashboard/api/admin/spaces"))
            .json(&serde_json::json!({
                "name": name,
                "binding": binding,
                "access": "write"
            }))
            .send()
            .unwrap()
    };

    for (name, binding) in [
        ("Default", serde_json::json!({ "prefix": "/missing" })),
        (
            "Work",
            serde_json::json!({ "host": "team.localhost", "prefix": "/work" }),
        ),
        (
            "Wiki",
            serde_json::json!({ "host": "TEAM.LOCALHOST.", "prefix": "/wiki" }),
        ),
        (
            "Elsewhere",
            serde_json::json!({ "host": "other.localhost", "prefix": "/elsewhere" }),
        ),
    ] {
        let response = create(name, binding);
        assert!(
            response.status().is_success(),
            "{}",
            response.text().unwrap()
        );
    }

    let request = |host: &str, path: &str| {
        reqwest::blocking::Client::new()
            .get(format!("{base}{path}"))
            .header(reqwest::header::HOST, host)
            .send()
            .unwrap()
    };
    for path in ["/work/.ping", "/wiki/.ping"] {
        assert!(
            request("team.localhost", path).status().is_success(),
            "{path}"
        );
    }
    assert_eq!(request("team.localhost", "/missing/.ping").status(), 404);
    assert_eq!(request("team.localhost", "/").status(), 404);
    assert!(request("127.0.0.1", "/missing/.ping").status().is_success());

    let work_manifest = request("team.localhost", "/work/.client/manifest.json")
        .json::<serde_json::Value>()
        .unwrap();
    let wiki_manifest = request("team.localhost", "/wiki/.client/manifest.json")
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(work_manifest["name"], "Work");
    assert_eq!(work_manifest["start_url"], "/work/#boot");
    assert_eq!(wiki_manifest["name"], "Wiki");
    assert_eq!(wiki_manifest["start_url"], "/wiki/#boot");

    let config = request("team.localhost", "/work/.config")
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(config["disableServiceWorker"], false);
    assert_eq!(
        config["spacePrefixes"],
        serde_json::json!(["/wiki", "/work"])
    );

    // A host's prefixes cannot repeat, nest or be shadowed by its root.
    for (name, binding) in [
        (
            "Duplicate",
            serde_json::json!({ "host": "TEAM.LOCALHOST.", "prefix": "/work" }),
        ),
        (
            "Nested",
            serde_json::json!({ "host": "team.localhost", "prefix": "/work/private" }),
        ),
        ("Root", serde_json::json!({ "host": "team.localhost" })),
    ] {
        let response = create(name, binding);
        assert_eq!(
            response.status(),
            400,
            "{name}: {}",
            response.text().unwrap()
        );
    }
}

/// A server whose `users.json` is `{}` has no accounts: its public spaces are
/// served, and the Dashboard only explains there is nothing to log in to.
#[test]
fn accountless_server_serves_public_space() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("spaces/root")).unwrap();
    std::fs::create_dir_all(root.path().join("spaces/hidden")).unwrap();
    std::fs::write(root.path().join("spaces/root/index.md"), "# Public").unwrap();
    std::fs::write(
        root.path().join("spaces.json"),
        serde_json::json!({
            "root": { "name": "Root", "binding": { "prefix": "" }, "access": "read" },
            "hidden": { "name": "Hidden", "binding": { "prefix": "/hidden" }, "access": "none" }
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(root.path().join("users.json"), "{}").unwrap();
    runtime_off(root.path());

    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env_remove("SB_USER")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let _server = Server(cmd.spawn().unwrap());
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if client.get(format!("{base}/.instance")).send().is_ok() {
            break;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }

    let page = client.get(format!("{base}/.fs/index.md")).send().unwrap();
    assert_eq!(page.status().as_u16(), 200);
    assert_eq!(page.text().unwrap(), "# Public");

    // No accounts, so the client offers no account UI.
    let config = client.get(format!("{base}/.config")).send().unwrap();
    let config: serde_json::Value = serde_json::from_str(&config.text().unwrap()).unwrap();
    assert_eq!(config["accountManaged"], false, "{config}");

    let dashboard = client.get(format!("{base}/.dashboard/")).send().unwrap();
    assert_eq!(dashboard.status().as_u16(), 200);
    let html = dashboard.text().unwrap();
    assert!(html.contains("no accounts"), "{html}");
    assert!(html.contains("editing spaces.json"), "{html}");

    // The space's own sign-in page says the same instead of offering a form.
    let auth = client.get(format!("{base}/.auth")).send().unwrap();
    assert_eq!(auth.status().as_u16(), 200);
    let html = auth.text().unwrap();
    assert!(html.contains("no accounts"), "{html}");
    assert!(html.contains("editing spaces.json"), "{html}");
    assert!(!html.contains("password"), "{html}");
    assert!(!html.contains("<form"), "{html}");

    // A space with no visitor access shows it too, and its stylesheet loads
    // for an anonymous visitor.
    let auth = client.get(format!("{base}/hidden/.auth")).send().unwrap();
    assert_eq!(auth.status().as_u16(), 200);
    let html = auth.text().unwrap();
    assert!(html.contains("no accounts"), "{html}");
    assert!(
        html.contains("&#x2f;hidden&#x2f;.client&#x2f;app.css"),
        "{html}"
    );
    let css = client
        .get(format!("{base}/hidden/.client/app.css"))
        .send()
        .unwrap();
    assert_eq!(css.status().as_u16(), 200);
}

#[test]
fn primary_hostname_bindings_share_routing_and_service_worker_scope_with_prefix_bindings() {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    let port = free_port();
    for id in ["root", "notes"] {
        std::fs::create_dir_all(root.path().join("spaces").join(id)).unwrap();
    }
    std::fs::write(
        root.path().join("server.json"),
        serde_json::json!({
            "primaryUrl": format!("http://manager.localhost:{port}"),
            "runtimeApi": false,
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        root.path().join("spaces.json"),
        serde_json::json!({
            "root": { "name": "Root", "binding": { "host": format!("MANAGER.LOCALHOST.:{port}") }, "access": "read" },
            "notes": { "name": "Notes", "binding": { "prefix": "/notes" }, "access": "read" }
        }).to_string(),
    ).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    child
        .arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let _server = Server(child.spawn().unwrap());
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if client.get(format!("{base}/.instance")).send().is_ok() {
            break;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }
    let get = |path: &str| {
        client
            .get(format!("{base}{path}"))
            .header(reqwest::header::HOST, format!("manager.localhost:{port}"))
            .send()
            .unwrap()
    };
    assert_eq!(
        get("/.client/manifest.json")
            .json::<serde_json::Value>()
            .unwrap()["name"],
        "Root"
    );
    assert_eq!(
        get("/notes/.client/manifest.json")
            .json::<serde_json::Value>()
            .unwrap()["name"],
        "Notes"
    );
    assert_eq!(
        get("/notes/.config").json::<serde_json::Value>().unwrap()["spacePrefixes"],
        serde_json::json!(["/notes"])
    );
}

#[test]
fn grandfathered_root_prefix_scope_warns_and_allows_only_conflict_reduction() {
    let root = tempfile::tempdir().unwrap();
    provision(root.path(), None);
    for id in ["root", "work"] {
        std::fs::create_dir_all(root.path().join("spaces").join(id)).unwrap();
    }
    std::fs::write(
        root.path().join("spaces.json"),
        serde_json::json!({
            "root": { "name": "Root", "binding": { "host": "team.localhost" } },
            "work": { "name": "Work", "binding": { "host": "team.localhost", "prefix": "/work" } }
        })
        .to_string(),
    )
    .unwrap();

    let port = free_port();
    let mut child = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    child
        .arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let server = Server(child.spawn().expect("spawn grandfathered server"));
    let base = format!("http://127.0.0.1:{port}");
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if reqwest::blocking::Client::new()
            .get(format!("{base}/.dashboard/api/admin/spaces"))
            .send()
            .is_ok_and(|response| response.status().as_u16() == 401)
        {
            break;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }
    let _server = server;
    let admin = admin_client(&base);
    let spaces = admin
        .get(format!("{base}/.dashboard/api/admin/spaces"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    for id in ["root", "work"] {
        assert!(
            spaces[id]["bindingWarning"]
                .as_str()
                .is_some_and(|warning| warning.contains("team.localhost")),
            "missing warning for {id}: {spaces}"
        );
    }

    let unrelated = admin
        .patch(format!("{base}/.dashboard/api/admin/spaces/work"))
        .json(&serde_json::json!({ "description": "Updated while resolving binding" }))
        .send()
        .unwrap();
    assert!(
        unrelated.status().is_success(),
        "{}",
        unrelated.text().unwrap()
    );
    let spaces_after_patch = admin
        .get(format!("{base}/.dashboard/api/admin/spaces"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();
    assert_eq!(
        spaces_after_patch["work"]["description"],
        "Updated while resolving binding"
    );
    for id in ["root", "work"] {
        assert!(
            spaces_after_patch[id]["bindingWarning"]
                .as_str()
                .is_some_and(|warning| warning.contains("team.localhost")),
            "patch cleared the warning for {id}: {spaces_after_patch}"
        );
    }

    let rejected = admin
        .post(format!("{base}/.dashboard/api/admin/spaces"))
        .json(&serde_json::json!({
            "name": "Wiki",
            "binding": { "host": "team.localhost", "prefix": "/wiki" }
        }))
        .send()
        .unwrap();
    assert_eq!(rejected.status(), 400, "{}", rejected.text().unwrap());

    let removed = admin
        .delete(format!("{base}/.dashboard/api/admin/spaces/root"))
        .send()
        .unwrap();
    assert!(removed.status().is_success(), "{}", removed.text().unwrap());
    assert!(admin
        .post(format!("{base}/.dashboard/api/admin/spaces"))
        .json(&serde_json::json!({
            "name": "Wiki",
            "binding": { "host": "team.localhost", "prefix": "/wiki" }
        }))
        .send()
        .unwrap()
        .status()
        .is_success());
}

#[test]
fn login_in_one_prefix_is_shared_and_password_change_revokes_only_that_user() {
    let (_srv, _root, base) = start_multi(&[]);
    let admin = admin_client(&base);

    let resp = admin
        .post(format!("{base}/.dashboard/api/admin/users"))
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
            .post(format!("{base}/.dashboard/api/admin/spaces"))
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
    // Valid sessions lacking admin access receive 403; 401 would send
    // the signed-in user through an unresolvable login loop.
    assert_eq!(
        alice
            .get(format!("{base}/.dashboard/api/admin/spaces"))
            .send()
            .unwrap()
            .status()
            .as_u16(),
        403
    );

    let resp = admin
        .post(format!("{base}/.dashboard/api/admin/users/alice/password"))
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

/// Multi-space sessions are server-wide, so `SB_SESSION_DAYS` must size the
/// session on both account-managed login surfaces: the unified `/.dashboard`
/// JSON login and a space's own `/.auth` form post.
#[test]
fn session_days_applies_to_both_multi_space_login_surfaces() {
    let (_srv, _root, base) = start_multi(&[("SB_SESSION_DAYS", "2")]);

    let admin = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let login = admin
        .post(format!("{base}/.dashboard/api/login"))
        .json(&serde_json::json!({
            "username": ADMIN_USER,
            "password": ADMIN_PASSWORD
        }))
        .send()
        .unwrap();
    assert!(login.status().is_success());
    assert!(
        max_ages(&login).iter().all(|age| near_two_days(age)),
        "/.dashboard session must last SB_SESSION_DAYS=2, got {:?}",
        max_ages(&login)
    );

    let resp = admin
        .post(format!("{base}/.dashboard/api/admin/spaces"))
        .json(&serde_json::json!({
            "name": "Private",
            "binding": { "prefix": "/private" }
        }))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.text().unwrap());

    let via_space = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap()
        .post(format!("{base}/private/.auth"))
        .form(&[
            ("username", ADMIN_USER),
            ("password", ADMIN_PASSWORD),
            ("from", ""),
        ])
        .send()
        .unwrap();
    assert!(via_space.status().is_success());
    assert!(
        max_ages(&via_space).iter().all(|age| near_two_days(age)),
        "space session must last SB_SESSION_DAYS=2, got {:?}",
        max_ages(&via_space)
    );
}

/// The cookie's lifetime is computed from the session's expiry, so it may be
/// a second short of the full window.
fn near_two_days(age: &str) -> bool {
    age.parse::<u64>()
        .is_ok_and(|age| age.abs_diff(2 * 86_400) <= 2)
}

/// Same contract for the lockout pair: with a limit of one, the very first bad
/// password locks the surface, so the next attempt is rejected as locked out
/// even though its credentials are correct.
#[test]
fn lockout_env_vars_apply_in_multi_space_mode() {
    let (_srv, _root, base) = start_multi(&[
        ("SB_LOCKOUT_LIMIT", "1"),
        // A long window so the wall-clock bucket can't roll between the two
        // requests below (they are milliseconds apart).
        ("SB_LOCKOUT_TIME", "3600"),
    ]);
    let client = reqwest::blocking::Client::new();
    let attempt = |password: &str| -> String {
        client
            .post(format!("{base}/.dashboard/api/login"))
            .json(&serde_json::json!({ "username": ADMIN_USER, "password": password }))
            .send()
            .unwrap()
            .json::<serde_json::Value>()
            .unwrap()["error"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    assert!(attempt("wrongpw").contains("Invalid username"));
    assert!(
        attempt(ADMIN_PASSWORD).contains("Too many failed attempts"),
        "SB_LOCKOUT_LIMIT=1 must lock the surface after a single failure"
    );
}

/// Every `Max-Age` on the response's `Set-Cookie` headers.
fn max_ages(response: &reqwest::blocking::Response) -> Vec<String> {
    let ages: Vec<String> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|cookie| {
            cookie
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix("Max-Age="))
                .map(str::to_string)
        })
        .collect();
    assert!(!ages.is_empty(), "login set no Max-Age cookie");
    ages
}

/// `SB_UNIX_SOCKET` makes the multi-space listener a Unix socket instead of a
/// TCP port; `GET /.instance` over it answers 200.
#[cfg(unix)]
#[test]
fn multi_serves_on_unix_socket() {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;

    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("spaces.json"),
        serde_json::json!({
            "root": { "name": "Root", "binding": { "prefix": "" }, "access": "read" }
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(root.path().join("users.json"), "{}").unwrap();
    runtime_off(root.path());
    let sock_dir = tempfile::tempdir().unwrap();
    let socket = sock_dir.path().join("sb.sock");

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .env_remove("SB_USER")
        .env("SB_UNIX_SOCKET", &socket)
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let _server = Server(cmd.spawn().unwrap());

    let deadline = Instant::now() + Duration::from_secs(20);
    let response = loop {
        if let Ok(mut stream) = UnixStream::connect(&socket) {
            stream
                .write_all(
                    b"GET /.instance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            let mut out = String::new();
            stream.read_to_string(&mut out).unwrap();
            break out;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    };
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
}

/// An empty data folder with `SB_UNIX_SOCKET` boots the setup wizard on the
/// socket, not single-space mode.
#[cfg(unix)]
#[test]
fn setup_serves_on_unix_socket() {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;

    let root = tempfile::tempdir().unwrap();
    let sock_dir = tempfile::tempdir().unwrap();
    let socket = sock_dir.path().join("sb.sock");

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .env_remove("SB_USER")
        .env("SB_UNIX_SOCKET", &socket)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let _server = Server(cmd.spawn().unwrap());

    let deadline = Instant::now() + Duration::from_secs(20);
    let response = loop {
        if let Ok(mut stream) = UnixStream::connect(&socket) {
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            stream
                .write_all(b"GET /.setup/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .unwrap();
            let mut out = String::new();
            stream.read_to_string(&mut out).unwrap();
            break out;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    };
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
}
