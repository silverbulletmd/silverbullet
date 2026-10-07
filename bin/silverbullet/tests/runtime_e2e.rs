//! Real end-to-end test for the headless-Chrome runtime API.
//!
//! Spawns the compiled `silverbullet` binary as a subprocess (so killing the
//! child cleanly tears down the embedded Chrome), boots it with the runtime
//! enabled, and drives `/.runtime/*` over HTTP. Gated on an explicit
//! `SB_CHROME_PATH`/`CHROMIUM_PATH` so machines without one skip cleanly —
//! except under `CI`, where a missing browser fails the test instead (see
//! `common::test_chrome_or_skip`). Each test ends by stopping the server with
//! SIGTERM and failing if any of its browsers outlived it.

use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Wraps the spawned server process and stops it (plus its Chrome processes)
/// on drop, so the server never leaks even if an assertion panics.
struct Server(Child);

impl Server {
    /// Spawn the server in its own process group, pinned to the test browser.
    fn spawn(cmd: &mut Command, chrome: &str) -> Self {
        let child = own_process_group(cmd)
            .env("SB_CHROME_PATH", chrome)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn silverbullet");
        Server(child)
    }

    fn stop(&mut self) {
        stop_server(&mut self.0);
    }

    /// Shut the server down with SIGTERM and fail if it ignored the signal or
    /// left browsers running for `profile_root`: in production that browser
    /// would outlive the server too.
    fn finish(mut self, profile_root: &Path) {
        let exited = terminate(&mut self.0, Duration::from_secs(10));
        let leftovers = if exited {
            leftover_browsers(profile_root)
        } else {
            Vec::new()
        };
        kill_group(&mut self.0);
        kill_browsers(profile_root);
        assert!(exited, "server ignored SIGTERM");
        assert!(
            leftovers.is_empty(),
            "Chrome outlived the server:\n{}",
            leftovers.join("\n")
        );
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

mod common;
use common::{
    free_port, kill_browsers, kill_group, leftover_browsers, own_process_group, stop_server,
    terminate, test_chrome_or_skip,
};

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
    server.stop();
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

fn png_size(bytes: &[u8]) -> (u32, u32) {
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"), "not a PNG");
    (
        u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
        u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
    )
}

#[test]
fn runtime_api_evaluates_lua_against_headless_chrome() {
    let Some(chrome) = test_chrome_or_skip("runtime_e2e") else {
        return;
    };

    let space = tempfile::tempdir().unwrap();
    let long_page: String = (1..=200).map(|i| format!("Line {i}\n\n")).collect();
    std::fs::write(space.path().join("index.md"), long_page).unwrap();
    let chrome_data = space.path().join(".chrome-data");
    let port = free_port();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(space.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .arg("--single")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data);
    let mut server = Server::spawn(&mut cmd, &chrome);

    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

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

    let full = http
        .get(format!("{base}/.runtime/screenshot"))
        .send()
        .unwrap();
    if !full.status().is_success() {
        let status = full.status();
        let body = full.text().unwrap_or_default();
        dump_and_panic(
            &mut server,
            &format!("/.runtime/screenshot returned {status}: {body}"),
        );
    }
    assert_eq!(full.headers()["content-type"], "image/png");
    let (fw, fh) = png_size(&full.bytes().unwrap());

    let top = http
        .get(format!("{base}/.runtime/screenshot?selector=%23sb-top"))
        .send()
        .unwrap();
    assert_eq!(top.status(), 200);
    let (tw, th) = png_size(&top.bytes().unwrap());
    assert!(
        tw * th < fw * fh,
        "clipped {tw}x{th} should be smaller than {fw}x{fh}"
    );

    let tall = http
        .get(format!("{base}/.runtime/screenshot?selector=.cm-content"))
        .send()
        .unwrap();
    assert_eq!(tall.status(), 200);
    let (cw, ch) = png_size(&tall.bytes().unwrap());
    assert!(
        cw <= fw && ch <= fh,
        "clip taller than the viewport must be clamped: {cw}x{ch} vs {fw}x{fh}"
    );

    for (query, status, code) in [
        ("%23does-not-exist", 404, "selector_not_found"),
        ("%5B%5B", 400, "invalid_selector"),
    ] {
        let resp = http
            .get(format!("{base}/.runtime/screenshot?selector={query}"))
            .send()
            .unwrap();
        assert_eq!(resp.status(), status, "selector {query}");
        let v: serde_json::Value = serde_json::from_str(&resp.text().unwrap()).unwrap();
        assert_eq!(v["code"], code);
    }

    // Full page: the 200-line page is far taller than the viewport, so the
    // stitched image must be too, at the same width.
    let full_page = http
        .get(format!("{base}/.runtime/screenshot?fullPage=1"))
        .header("X-Timeout", "60")
        .timeout(Duration::from_secs(70))
        .send()
        .unwrap();
    if !full_page.status().is_success() {
        let status = full_page.status();
        let body = full_page.text().unwrap_or_default();
        dump_and_panic(
            &mut server,
            &format!("/.runtime/screenshot?fullPage=1 returned {status}: {body}"),
        );
    }
    let (pw, ph) = png_size(&full_page.bytes().unwrap());
    assert!(
        pw <= fw && ph > 2 * fh,
        "full page {pw}x{ph} should be much taller than the viewport {fw}x{fh}"
    );
    let combined = http
        .get(format!(
            "{base}/.runtime/screenshot?fullPage=1&selector=%23sb-top"
        ))
        .send()
        .unwrap();
    assert_eq!(combined.status(), 400);

    server.finish(&chrome_data);
}

/// Query results cross CDP by value, which rejects the SLIQ null sentinel and
/// silently turns functions and Dates into `{}`. Playwright's own serializer
/// tolerates both, so only a test through the HTTP runtime endpoint catches it.
#[test]
fn runtime_api_returns_plain_json_for_query_rows_and_lua_values() {
    let Some(chrome) = test_chrome_or_skip("runtime_json_e2e") else {
        return;
    };

    let space = tempfile::tempdir().unwrap();
    let books = space.path().join("Books");
    std::fs::create_dir(&books).unwrap();
    std::fs::write(
        books.join("Alpha.md"),
        "---\ntags: book\nauthor: A. Writer\nrating: 4\n---\n# Alpha\n",
    )
    .unwrap();
    std::fs::write(
        books.join("Beta.md"),
        "---\ntags: book\nauthor: B. Writer\n---\n# Beta\n",
    )
    .unwrap();
    let chrome_data = space.path().join(".chrome-data");
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(space.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .arg("--single")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data);
    let mut server = Server::spawn(&mut cmd, &chrome);
    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    wait_until(
        Duration::from_secs(45),
        || {
            http.post(format!("{base}/.runtime/lua"))
                .body("1")
                .send()
                .is_ok_and(|r| r.status().is_success())
        },
        &mut server,
        "runtime never became ready",
    );

    let script = |code: &str| -> (u16, serde_json::Value) {
        let resp = http
            .post(format!("{base}/.runtime/lua_script"))
            .body(code.to_string())
            .send()
            .unwrap();
        let status = resp.status().as_u16();
        let body = resp.text().unwrap();
        let v = serde_json::from_str(body.trim())
            .unwrap_or_else(|_| serde_json::Value::String(body.clone()));
        (status, v)
    };

    let (status, v) = script(
        r#"return query[[from p = index.pages("book") order by p.name select {name=p.name, rating=p.rating}]]"#,
    );
    assert_eq!(
        (status, v),
        (
            200,
            serde_json::json!({ "result": [
                { "name": "Books/Alpha", "rating": 4 },
                { "name": "Books/Beta", "rating": null },
            ]})
        )
    );

    // A query collection is materialized into its rows, also when nested.
    let names = |rows: &serde_json::Value| -> Vec<String> {
        let mut names: Vec<String> = rows
            .as_array()
            .unwrap_or_else(|| panic!("expected rows, got {rows}"))
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        names.sort();
        names
    };
    let (status, v) = script(r#"return index.pages("book")"#);
    assert_eq!(status, 200, "{v}");
    assert_eq!(names(&v["result"]), ["Books/Alpha", "Books/Beta"], "{v}");
    let alpha = v["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == "Books/Alpha")
        .unwrap();
    assert_eq!(alpha["author"], "A. Writer", "{v}");
    let (status, v) = script(r#"return {pages = index.pages("book")}"#);
    assert_eq!(status, 200, "{v}");
    assert_eq!(
        names(&v["result"]["pages"]),
        ["Books/Alpha", "Books/Beta"],
        "{v}"
    );

    let (status, v) = script(
        r#"return {f = print, d = js.new(js.window.Date, 0), n = 0/0, big = js.window.BigInt(10)}"#,
    );
    assert_eq!(
        (status, v),
        (
            200,
            serde_json::json!({ "result": {
                "f": "<function>",
                "d": "1970-01-01T00:00:00.000Z",
                "n": "NaN",
                "big": 10,
            }})
        )
    );

    server.finish(&chrome_data);
}

#[test]
fn host_bound_runtime_boots_core_and_reads_its_space() {
    let Some(chrome) = test_chrome_or_skip("host_bound_runtime_e2e") else {
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let users = silverbullet_server::multi::users::UserStore::create_empty(root.path()).unwrap();
    users
        .create_user("keeper", "fixture-password", true, Default::default())
        .unwrap();
    let token = users.create_token("keeper", "smoke-test").unwrap();
    let folder = root.path().join("notes");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("Welcome.md"), "# Fictional runtime notes\n").unwrap();
    std::fs::write(root.path().join("spaces.json"), serde_json::json!({
        "host-smoke": {"name": "Notes", "folder": "notes", "binding": {"host": "notes.example.test", "prefix": "/work"}, "indexPage": "Welcome"}
    }).to_string()).unwrap();
    let chrome_data = root.path().join("chrome-data");
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .env("SB_CHROME_DATA_DIR", &chrome_data);
    let mut server = Server::spawn(&mut cmd, &chrome);
    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    wait_until(
        Duration::from_secs(20),
        || {
            http.get(format!("{base}/.instance"))
                .send()
                .is_ok_and(|response| response.status().is_success())
        },
        &mut server,
        "server did not start",
    );
    let mut result = String::new();
    wait_until(
        Duration::from_secs(45),
        || match http
            .post(format!("{base}/work/.runtime/lua"))
            .header("host", "notes.example.test")
            .bearer_auth(&token)
            .body("space.readPage('Welcome')")
            .send()
        {
            Ok(response) if response.status().is_success() => {
                result = response.text().unwrap();
                true
            }
            _ => false,
        },
        &mut server,
        "host-bound Core runtime did not boot",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&result).unwrap(),
        serde_json::json!({"result": "# Fictional runtime notes\n"})
    );
    let response = http
        .put(format!("{base}/.dashboard/api/admin/server-config"))
        .bearer_auth(&token)
        .header("content-type", "application/json")
        .body(r#"{"runtimeApi":false}"#)
        .send()
        .unwrap();
    assert!(
        response.status().is_success(),
        "runtime shutdown: {}",
        response.status()
    );
    server.finish(&chrome_data);
}

#[test]
fn test_browser_must_be_explicit_and_not_the_system_chrome() {
    use common::resolve_test_chrome;
    let shell = "/opt/browsers/chrome-headless-shell-mac-arm64/chrome-headless-shell";
    let system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

    assert!(resolve_test_chrome(None, None, false).is_err());
    assert!(resolve_test_chrome(None, None, true).is_err());
    assert_eq!(
        resolve_test_chrome(Some(shell.into()), Some(system.into()), false).as_deref(),
        Ok(shell)
    );
    assert_eq!(
        resolve_test_chrome(None, Some(shell.into()), false).as_deref(),
        Ok(shell)
    );
    let refused = resolve_test_chrome(Some(system.into()), None, false).unwrap_err();
    assert!(refused.contains("SB_TEST_ALLOW_SYSTEM_CHROME"), "{refused}");
    assert_eq!(
        resolve_test_chrome(Some(system.into()), None, true).as_deref(),
        Ok(system)
    );
}
