//! Real end-to-end test for the headless-Chrome runtime API.
//!
//! Spawns the compiled `silverbullet` binary as a subprocess (so killing the
//! child cleanly tears down the embedded Chrome), boots it with the runtime
//! enabled, and drives `/.runtime/*` over HTTP. Gated on Chrome being available
//! so machines without Chrome skip it cleanly.

use std::io::Read;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Wraps the spawned server process and kills it (plus its Chrome child) on drop,
/// so the server never leaks even if an assertion panics.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Find a free port by binding :0 and dropping the listener (matches smoke.rs).
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Poll `cond` until it returns true or the deadline passes. On timeout, dump the
/// server's captured stdout/stderr and panic with `msg`.
fn wait_until(
    timeout: Duration,
    mut cond: impl FnMut() -> bool,
    server: &mut Server,
    msg: &str,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    dump_and_panic(server, msg);
}

/// Kill the child, drain its captured output, and panic with diagnostics.
fn dump_and_panic(server: &mut Server, msg: &str) -> ! {
    let _ = server.0.kill();
    let _ = server.0.wait();
    let mut out = String::new();
    if let Some(mut s) = server.0.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    let mut err = String::new();
    if let Some(mut s) = server.0.stderr.take() {
        let _ = s.read_to_string(&mut err);
    }
    panic!("{msg}\n--- server stdout ---\n{out}\n--- server stderr ---\n{err}");
}

#[test]
fn runtime_api_evaluates_lua_against_headless_chrome() {
    if silverbullet_server_runtime_chrome::find_chrome().is_none() {
        eprintln!("skipping runtime_e2e: no Chrome/Chromium found on this machine");
        return;
    }

    let space = tempfile::tempdir().unwrap();
    let chrome_data = space.path().join(".chrome-data");
    let port = free_port();

    let child = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(space.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn silverbullet");
    let mut server = Server(child);

    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

    // 1) Server is up.
    wait_until(
        Duration::from_secs(20),
        || {
            http.get(format!("{base}/.ping"))
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        },
        &mut server,
        "server never answered /.ping",
    );

    // 2) Runtime ready: /.runtime/lua returns 200 (not 503 bridge_unavailable)
    //    once the headless client has connected. Body `1 + 1` is an expression;
    //    evalLua prepends `return `, so it evaluates to 2.
    let mut lua_result = String::new();
    wait_until(
        Duration::from_secs(45),
        || match http
            .post(format!("{base}/.runtime/lua"))
            .body("1 + 1")
            .send()
        {
            Ok(r) if r.status().is_success() => {
                lua_result = r.text().unwrap_or_default();
                true
            }
            _ => false,
        },
        &mut server,
        "runtime never became ready (/.runtime/lua kept returning non-200)",
    );
    let v: serde_json::Value = serde_json::from_str(lua_result.trim()).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "result": 2 }),
        "1 + 1 should eval to 2"
    );

    // 3) lua_script: a full script (no implicit `return` prepended).
    let script = http
        .post(format!("{base}/.runtime/lua_script"))
        .body("return 1 + 1")
        .send()
        .unwrap();
    if !script.status().is_success() {
        let status = script.status();
        let body = script.text().unwrap_or_default();
        dump_and_panic(
            &mut server,
            &format!("/.runtime/lua_script returned {status}: {body}"),
        );
    }
    let v: serde_json::Value = serde_json::from_str(script.text().unwrap().trim()).unwrap();
    assert_eq!(v, serde_json::json!({ "result": 2 }));

    // Explicit teardown (also happens on Drop).
    drop(server);
}
