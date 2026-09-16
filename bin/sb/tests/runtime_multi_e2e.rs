//! Runs the real CLI against isolated runtimes on a multi-space server.

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

/// Kills the server and its Chrome process on drop, including after test panics.
/// Drain logs continuously: two headless clients can fill the pipe buffer
/// and block the server before the test completes.
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

/// Find the sibling server binary. Missing binaries fail CI to prevent
/// release gates from silently skipping this test; local runs may skip.
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
fn runtime_api_serves_two_spaces_from_isolated_chrome() {
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
        .env("SB_RUNTIME_API", "0")
        .env("RUST_LOG", "info")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data);
    let server_proc = Server::spawn(cmd);

    let base = format!("http://127.0.0.1:{port}");

    // Wait for the multi stack: the admin API answers 401 once it's mounted.
    let probe = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(r) = probe
            .get(format!("{base}/.dashboard/api/admin/spaces"))
            .send()
        {
            if r.status().as_u16() == 401 {
                break;
            }
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(200));
    }

    let admin = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let r = admin
        .post(format!("{base}/.dashboard/api/login"))
        .json(&serde_json::json!({ "username": ADMIN_USER, "password": ADMIN_PASSWORD }))
        .send()
        .unwrap();
    assert!(r.status().is_success(), "admin login failed");

    for (name, prefix, folder) in [
        ("Root", "/root", "spaceRoot"),
        ("Notes", "/notes", "spaceNotes"),
    ] {
        let r = admin
            .post(format!("{base}/.dashboard/api/admin/spaces"))
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

    let r = admin
        .post(format!(
            "{base}/.dashboard/api/admin/users/{ADMIN_USER}/tokens"
        ))
        .json(&serde_json::json!({ "name": "e2e" }))
        .send()
        .unwrap();
    assert!(r.status().is_success(), "token creation failed");
    let token = r.json::<serde_json::Value>().unwrap()["token"]
        .as_str()
        .expect("token in response")
        .to_string();

    let root_url = format!("{base}/root");
    let (code, _, stderr) = run_sb(&["--url", &root_url, "eval", "1 + 1"], sb_config.path());
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
        ("/root", "marker-from-root-space"),
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

    let log = server_proc.finish();
    let launches = log.matches("launching isolated headless Chrome").count();
    assert_eq!(
        launches, 2,
        "expected one isolated Chrome launch per space, saw {launches}\n--- server log ---\n{log}"
    );
}
