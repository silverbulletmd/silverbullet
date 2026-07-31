//! End-to-end test for the Runtime API in **multi-space** mode, driven through
//! the real `sb` CLI.
//!
//! Two spaces are created on one authenticated server — one bound at the root
//! prefix, one at `/notes` — each holding a different marker page. The test then
//! evaluates Lua in each space through `sb eval` and asserts each answers with
//! its *own* content. That is the assertion that matters: a shared browser must
//! not collapse two spaces into one client.
//!
//! It also asserts the shared browser is genuinely shared, by requiring the
//! server to log its launch line exactly once across both spaces.
//!
//! Skips cleanly when Chrome is absent or when the sibling `silverbullet`
//! server binary hasn't been built (run `cargo test --workspace`, which builds
//! every bin) — except under `CI`, where either missing prerequisite is a hard
//! failure rather than a silent skip (see `common::chrome_available_or_skip`
//! and `server_bin_or_skip`).

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const ADMIN_USER: &str = "admin";
const ADMIN_PASSWORD: &str = "adminpw1";

#[path = "../../silverbullet/tests/common/mod.rs"]
mod common;
use common::{chrome_available_or_skip, free_port};

/// Wraps the spawned server and kills it (plus the shared Chrome it owns) on
/// drop, so nothing leaks even if an assertion panics.
///
/// stdout/stderr are drained continuously by background threads into `log`,
/// rather than read once at the end. Two headless clients (root + notes) each
/// forward their full `console.*` output into the server's log at INFO level
/// (see `ChromeConfig::log_console`), which is enough volume to fill the OS
/// pipe buffer within seconds; an unread `Stdio::piped()` handle would then
/// make the server block on its own log write, wedging the whole process —
/// including the HTTP listener — with no exception or panic to show for it.
struct Server {
    child: Child,
    log: Arc<Mutex<String>>,
    readers: Vec<std::thread::JoinHandle<()>>,
}

/// Continuously copy `reader` into `log` until EOF/error (the process exited
/// and closed the pipe).
fn drain(mut reader: impl Read, log: Arc<Mutex<String>>) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => return,
            Ok(n) => log
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push_str(&String::from_utf8_lossy(&buf[..n])),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    /// Spawn `cmd` with piped stdout/stderr, immediately handing both to
    /// dedicated reader threads so the child never blocks on a full pipe.
    fn spawn(mut cmd: Command) -> Self {
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn silverbullet");
        let log = Arc::new(Mutex::new(String::new()));
        let mut readers = Vec::with_capacity(2);
        if let Some(out) = child.stdout.take() {
            let log = log.clone();
            readers.push(std::thread::spawn(move || drain(out, log)));
        }
        if let Some(err) = child.stderr.take() {
            let log = log.clone();
            readers.push(std::thread::spawn(move || drain(err, log)));
        }
        Server {
            child,
            log,
            readers,
        }
    }

    /// Kill the server and return everything captured. Joining the reader
    /// threads (rather than sleeping a guessed amount) blocks exactly until
    /// each has drained its pipe to EOF, which follows promptly once `wait()`
    /// confirms the process has exited and closed its ends.
    fn finish(mut self) -> String {
        let _ = self.child.kill();
        let _ = self.child.wait();
        for r in self.readers.drain(..) {
            let _ = r.join();
        }
        self.log.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

fn sb_bin() -> &'static str {
    env!("CARGO_BIN_EXE_sb")
}

/// The sibling `silverbullet` server binary in the same target dir, if built.
///
/// `None` means this test cannot run at all. Under `CI` that is a hard failure
/// rather than a silent skip, for the same reason as
/// `common::chrome_available_or_skip`: this job gates the release and docker
/// publishes, and a skipped run reads as a pass. It cannot trigger under the
/// current CI command (`cargo test --workspace --all-features` builds every bin
/// into the probed target dir), which is precisely why a silent skip here would
/// go unnoticed the day somebody narrows that command.
fn server_bin_or_skip() -> Option<PathBuf> {
    let dir = PathBuf::from(sb_bin()).parent()?.to_path_buf();
    let name = if cfg!(windows) {
        "silverbullet.exe"
    } else {
        "silverbullet"
    };
    let p = dir.join(name);
    if p.exists() {
        return Some(p);
    }
    if std::env::var("CI").is_ok() {
        panic!(
            "runtime_multi_e2e: no `silverbullet` server binary at {} — this test drives the \
             real server, so it cannot run without one. Refusing to skip in CI: run the suite as \
             `cargo test --workspace --all-features`, which builds every bin into that directory.",
            p.display()
        );
    }
    eprintln!("skipping runtime_multi_e2e: silverbullet server binary not built");
    None
}

/// Run `sb` with an isolated config home and capture stdout/stderr/exit code.
fn run_sb(args: &[&str], config_home: &std::path::Path) -> (i32, String, String) {
    let out = Command::new(sb_bin())
        .args(args)
        .env("XDG_CONFIG_HOME", config_home)
        .output()
        .expect("spawn sb");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn runtime_api_serves_two_spaces_from_one_shared_chrome() {
    if !chrome_available_or_skip("runtime_multi_e2e") {
        return;
    }
    let Some(server) = server_bin_or_skip() else {
        return;
    };

    let root = tempfile::tempdir().unwrap();
    let sb_config = tempfile::tempdir().unwrap();
    let chrome_data = root.path().join(".chrome-data");

    // Provision the root through the real `setup` subcommand: admin account +
    // spaces.json, no first space (both spaces are created over the admin API).
    let out = Command::new(&server)
        .arg("setup")
        .arg(root.path())
        .arg("--admin")
        .arg(format!("{ADMIN_USER}:{ADMIN_PASSWORD}"))
        .output()
        .expect("spawn silverbullet setup");
    assert!(
        out.status.success(),
        "setup failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let port = free_port();
    let mut cmd = Command::new(&server);
    cmd.arg(root.path())
        .args(["-p", &port.to_string(), "-L", "127.0.0.1"])
        .env_remove("SB_MULTI_SPACE")
        .env_remove("SB_USER")
        .env_remove("SB_RUNTIME_API")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data);
    let server_proc = Server::spawn(cmd);

    let base = format!("http://127.0.0.1:{port}");

    // Wait for the multi stack: the admin API answers 401 once it's mounted.
    let probe = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(r) = probe.get(format!("{base}/.spaces/api/admin/spaces")).send() {
            if r.status().as_u16() == 401 {
                break;
            }
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }

    // Log in as the admin.
    let admin = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let r = admin
        .post(format!("{base}/.spaces/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert!(r.status().is_success(), "admin login failed");

    // Two spaces with the runtime API on. One is bound at the ROOT prefix, so
    // its auth cookie is set with Path=/ and rides along on the other space's
    // requests — exactly the case per-space cookie names exist to handle.
    for (name, prefix, folder) in [
        ("Root", "/", "spaceRoot"),
        ("Notes", "/notes", "spaceNotes"),
    ] {
        let r = admin
            .post(format!("{base}/.spaces/api/admin/spaces"))
            .json(&serde_json::json!({
                "name": name,
                "folder": folder,
                "binding": { "prefix": prefix },
                "runtimeApi": true
            }))
            .send()
            .unwrap();
        assert!(
            r.status().is_success(),
            "creating space {name} failed: {}",
            r.text().unwrap_or_default()
        );
    }

    // A distinguishing page per space, written before any runtime call so the
    // headless client picks it up on its initial sync.
    std::fs::write(
        root.path().join("spaceRoot").join("Marker.md"),
        "marker-from-root-space\n",
    )
    .unwrap();
    std::fs::write(
        root.path().join("spaceNotes").join("Marker.md"),
        "marker-from-notes-space\n",
    )
    .unwrap();

    // An admin API token for `sb --token`.
    let r = admin
        .post(format!(
            "{base}/.spaces/api/admin/users/{ADMIN_USER}/tokens"
        ))
        .json(&serde_json::json!({ "name": "e2e" }))
        .send()
        .unwrap();
    assert!(r.status().is_success(), "token creation failed");
    let token = r.json::<serde_json::Value>().unwrap()["token"]
        .as_str()
        .expect("token in response")
        .to_string();

    // Anonymous `sb` must be rejected.
    let (code, _, stderr) = run_sb(&["--url", &base, "eval", "1 + 1"], sb_config.path());
    assert_ne!(code, 0, "anonymous eval should fail");
    assert!(
        stderr.contains("401")
            || stderr.to_lowercase().contains("unauthor")
            || stderr.contains("authentication required"),
        "expected an auth error, got: {stderr}"
    );

    // Each space answers with its own marker. The first call also pays for the
    // browser launch and the client's first sync, so allow a generous window.
    for (prefix, expected) in [
        ("", "marker-from-root-space"),
        ("/notes", "marker-from-notes-space"),
    ] {
        let url = format!("{base}{prefix}");
        // Must stay comfortably above the pool's LAUNCH_TIMEOUT (120s in
        // server-runtime-chrome/src/pool.rs): the first space's eval pays for
        // the browser launch plus a full client boot and sync.
        let deadline = Instant::now() + Duration::from_secs(180);
        #[allow(unused_assignments)]
        let mut last = String::new();
        loop {
            let (code, stdout, stderr) = run_sb(
                &[
                    "--url",
                    &url,
                    "--token",
                    &token,
                    "eval",
                    "space.readPage(\"Marker\")",
                ],
                sb_config.path(),
            );
            if code == 0 && stdout.contains(expected) {
                break;
            }
            last = format!("code={code} stdout={stdout:?} stderr={stderr:?}");
            if Instant::now() >= deadline {
                let log = server_proc.finish();
                panic!(
                    "space at {url:?} never returned {expected:?}\nlast: {last}\n\
                     --- server log ---\n{log}"
                );
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    // One browser served both spaces.
    let log = server_proc.finish();
    let launches = log.matches("launching shared headless Chrome").count();
    assert_eq!(
        launches, 1,
        "expected exactly one shared Chrome launch, saw {launches}\n--- server log ---\n{log}"
    );
}
