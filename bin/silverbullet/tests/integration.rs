//! Black-box integration suite for the standalone `silverbullet` server binary.
//!
//! Each test spawns the compiled binary as a subprocess on an ephemeral port
//! against a fresh temp space and drives its HTTP endpoints with
//! `reqwest::blocking`. The runtime API is off in the data root's `server.json`
//! (see `common::provision_data_root`), so no headless Chrome is launched —
//! these tests exercise the HTTP surface only and stay fast and
//! Chrome-independent.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Wraps the spawned server process and kills + reaps it on drop, so a server
/// never leaks even if an assertion panics mid-test.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

mod common;
use common::{free_port, mint_token, provision_data_root};
use silverbullet_server::multi::config::SpaceAccess;

/// The directories a test server runs on: the space folder and its data root.
/// Held for the test's duration so they outlive the server.
type Dirs = (tempfile::TempDir, tempfile::TempDir);

/// Spawn the binary on an accountless data root with one writable space and the
/// given extra env; see [`start_on`].
fn start(extra_env: &[(&str, &str)]) -> (Server, Dirs, String) {
    let space = tempfile::tempdir().unwrap();
    let root = provision_data_root(space.path(), SpaceAccess::Write, None);
    start_on(space, root, extra_env)
}

/// Spawn the binary on `root`, wait for `/.ping` to answer 200 (up to ~20s),
/// and return the running server, the directories it runs on, and the base
/// URL. On a boot timeout the child's stdout/stderr are dumped. The
/// directories are returned (rather than dropped here) so they outlive the
/// server for the duration of the test.
fn start_on(
    space: tempfile::TempDir,
    root: tempfile::TempDir,
    extra_env: &[(&str, &str)],
) -> (Server, Dirs, String) {
    let port = free_port();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(root.path())
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().expect("spawn silverbullet");
    let mut server = Server(child);

    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let up = http
            .get(format!("{base}/.ping"))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if up {
            break;
        }
        if Instant::now() >= deadline {
            dump_and_panic(&mut server, "server never answered /.ping");
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    (server, (space, root), base)
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

/// A reqwest blocking client with a sane timeout.
fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap()
}

/// A reqwest blocking client that does NOT auto-follow redirects, so 302/401
/// responses surface directly for the auth/redirect assertions.
fn no_redirect_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

#[test]
fn ping_reports_server_version() {
    let (_srv, _space, base) = start(&[]);
    let http = client();
    let resp = http.get(format!("{base}/.ping")).send().unwrap();
    assert!(resp.status().is_success(), "ping status {}", resp.status());
    assert!(
        resp.headers().get("x-server-version").is_some(),
        "missing x-server-version header: {:?}",
        resp.headers()
    );
}

#[test]
fn config_returns_boot_config_json() {
    let (_srv, _space, base) = start(&[]);
    let http = client();
    let resp = http.get(format!("{base}/.config")).send().unwrap();
    assert!(resp.status().is_success());
    let v: serde_json::Value = resp.json().unwrap();
    assert!(v.get("indexPage").is_some(), "missing indexPage: {v}");
    assert!(v.get("readOnly").is_some(), "missing readOnly: {v}");
}

#[test]
fn fs_put_get_roundtrip_with_meta_headers() {
    let (_srv, _space, base) = start(&[]);
    let http = client();

    let put = http
        .put(format!("{base}/.fs/test.md"))
        .header("Content-Type", "text/markdown")
        .body("# Hello")
        .send()
        .unwrap();
    assert!(put.status().is_success(), "PUT status {}", put.status());

    let get = http.get(format!("{base}/.fs/test.md")).send().unwrap();
    assert!(get.status().is_success(), "GET status {}", get.status());
    assert!(
        get.headers().get("x-last-modified").is_some(),
        "missing X-Last-Modified"
    );
    assert!(
        get.headers().get("x-created").is_some(),
        "missing X-Created"
    );
    assert!(
        get.headers().get("x-content-length").is_some(),
        "missing X-Content-Length"
    );
    let body = get.text().unwrap();
    assert_eq!(body, "# Hello");

    // A meta-only read has the headers and no body.
    let meta = http
        .get(format!("{base}/.fs/test.md"))
        .header("X-Get-Meta", "true")
        .send()
        .unwrap();
    assert!(meta.status().is_success());
    assert!(meta.headers().get("x-last-modified").is_some());
    let body = meta.bytes().unwrap();
    assert!(body.is_empty(), "X-Get-Meta body should be empty: {body:?}");

    // Nested, URL-encoded and binary paths round-trip byte for byte.
    let blob: Vec<u8> = (0..1024).map(|i| (i % 256) as u8).collect();
    for (path, content_type, content) in [
        ("sub/dir/page.md", "text/markdown", b"nested".to_vec()),
        (
            "file%20with%20spaces.md",
            "text/markdown",
            b"spaced".to_vec(),
        ),
        ("blob.bin", "application/octet-stream", blob),
    ] {
        let put = http
            .put(format!("{base}/.fs/{path}"))
            .header("Content-Type", content_type)
            .body(content.clone())
            .send()
            .unwrap();
        assert!(put.status().is_success(), "PUT {path}");
        let get = http.get(format!("{base}/.fs/{path}")).send().unwrap();
        assert!(get.status().is_success(), "GET {path}");
        assert_eq!(get.bytes().unwrap().as_ref(), content.as_slice(), "{path}");
    }

    // Both listings include the written file.
    for sync_mode in [false, true] {
        let mut list = http.get(format!("{base}/.fs/"));
        if sync_mode {
            list = list.header("X-Sync-Mode", "true");
        }
        let resp = list.send().unwrap();
        assert!(resp.status().is_success(), "list status {}", resp.status());
        let files: serde_json::Value = resp.json().unwrap();
        assert!(
            files
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["name"] == "test.md"),
            "listing missing test.md: {files}"
        );
    }

    // A deleted and a missing file are 404.
    let del = http.delete(format!("{base}/.fs/test.md")).send().unwrap();
    assert!(del.status().is_success(), "DELETE status {}", del.status());
    for path in ["test.md", "nonexistent.md"] {
        let get = http.get(format!("{base}/.fs/{path}")).send().unwrap();
        assert_eq!(get.status(), reqwest::StatusCode::NOT_FOUND, "{path}");
    }
}

#[test]
fn shell_echo_and_stdin_pipe() {
    let (_srv, _space, base) = start(&[]);
    let http = client();

    let resp = http
        .post(format!("{base}/.shell"))
        .header("Content-Type", "application/json")
        .body(r#"{"cmd":"echo","args":["hello"]}"#)
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "shell status {}", resp.status());
    let v: serde_json::Value = resp.json().unwrap();
    assert_eq!(v["code"], 0, "echo exit code: {v}");
    assert!(
        v["stdout"].as_str().unwrap().contains("hello"),
        "echo stdout: {v}"
    );

    let resp = http
        .post(format!("{base}/.shell"))
        .header("Content-Type", "application/json")
        .body(r#"{"cmd":"cat","args":[],"stdin":"piped"}"#)
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    let v: serde_json::Value = resp.json().unwrap();
    assert_eq!(v["code"], 0, "cat exit code: {v}");
    assert!(
        v["stdout"].as_str().unwrap().contains("piped"),
        "cat should echo stdin: {v}"
    );
}

#[test]
fn proxy_forwards_to_a_throwaway_upstream() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        if let Ok((mut conn, _)) = upstream.accept() {
            let mut buf = [0u8; 1024];
            let _ = conn.read(&mut buf);
            let body = b"ok";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = conn.write_all(response.as_bytes());
            let _ = conn.write_all(body);
            let _ = conn.flush();
        }
    });

    let (_srv, _space, base) = start(&[]);
    let http = client();
    let resp = http
        .get(format!("{base}/.proxy/127.0.0.1:{upstream_port}/x"))
        .send()
        .unwrap();
    assert!(resp.status().is_success(), "proxy status {}", resp.status());
    assert_eq!(
        resp.headers()
            .get("x-proxy-status-code")
            .map(|v| v.to_str().unwrap()),
        Some("200"),
        "upstream status not surfaced: {:?}",
        resp.headers()
    );
    let body = resp.text().unwrap();
    assert_eq!(body, "ok", "proxied body mismatch");

    let _ = handle.join();
}

/// Spawn a server whose only space needs an account: `alice:s3cret`, who also
/// has an API token. Returns the token as the last element.
fn start_auth() -> (Server, Dirs, String, String) {
    let space = tempfile::tempdir().unwrap();
    let root = provision_data_root(space.path(), SpaceAccess::None, Some(("alice", "s3cret")));
    let token = mint_token(root.path(), "alice", "test");
    let (server, dirs, base) = start_on(space, root, &[]);
    (server, dirs, base, token)
}

#[test]
fn auth_unauthenticated_config_is_401_with_auth_location() {
    let (_srv, _space, base, _token) = start_auth();
    let http = no_redirect_client();
    let resp = http.get(format!("{base}/.config")).send().unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert_eq!(
        resp.headers().get("location").map(|v| v.to_str().unwrap()),
        Some("/.auth"),
        "expected Location: /.auth"
    );
}

#[test]
fn auth_bearer_token_grants_config() {
    let (_srv, _space, base, token) = start_auth();
    let http = no_redirect_client();
    let resp = http
        .get(format!("{base}/.config"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .unwrap();
    assert!(
        resp.status().is_success(),
        "bearer-authed config status {}",
        resp.status()
    );
}

#[test]
fn auth_get_renders_login_page_as_html() {
    let (_srv, _space, base, _token) = start_auth();
    let http = no_redirect_client();
    let resp = http.get(format!("{base}/.auth")).send().unwrap();
    assert!(
        resp.status().is_success(),
        "auth GET status {}",
        resp.status()
    );
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(ct.starts_with("text/html"), "content-type: {ct}");
}

#[test]
fn auth_post_good_credentials_sets_cookie_and_cookie_round_trips() {
    let (_srv, _space, base, _token) = start_auth();
    let http = no_redirect_client();

    let resp = http
        .post(format!("{base}/.auth"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("username=alice&password=s3cret")
        .send()
        .unwrap();
    assert!(
        resp.status().is_success(),
        "auth POST status {}",
        resp.status()
    );

    let set_cookie = resp
        .headers()
        .get("set-cookie")
        .expect("Set-Cookie present on success")
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        set_cookie.starts_with("auth_"),
        "cookie name should start with auth_: {set_cookie}"
    );

    let v: serde_json::Value = resp.json().unwrap();
    assert_eq!(v["status"], "ok", "login JSON: {v}");

    let cookie = set_cookie.split(';').next().unwrap().to_string();
    let resp = http
        .get(format!("{base}/.config"))
        .header("Cookie", cookie)
        .send()
        .unwrap();
    assert!(
        resp.status().is_success(),
        "cookie replay status {}",
        resp.status()
    );
}

#[test]
fn auth_post_wrong_password_errors_with_no_cookie() {
    let (_srv, _space, base, _token) = start_auth();
    let http = no_redirect_client();
    let resp = http
        .post(format!("{base}/.auth"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("username=alice&password=wrong")
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert!(
        resp.headers().get("set-cookie").is_none(),
        "no Set-Cookie on failed login"
    );
    let v: serde_json::Value = resp.json().unwrap();
    assert_eq!(v["status"], "error", "login JSON: {v}");
}

#[test]
fn auth_logout_redirects_to_auth() {
    let (_srv, _space, base, _token) = start_auth();
    let http = no_redirect_client();
    let resp = http.get(format!("{base}/.logout")).send().unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FOUND);
    assert_eq!(
        resp.headers().get("location").map(|v| v.to_str().unwrap()),
        Some("/.auth")
    );
}

/// Polls `/.search/query` for `query` until `done(body)` or `within` passes.
fn search_until(
    http: &reqwest::blocking::Client,
    base: &str,
    query: &str,
    within: Duration,
    done: impl Fn(&serde_json::Value) -> bool,
) -> serde_json::Value {
    let deadline = Instant::now() + within;
    loop {
        let resp = http
            .post(format!("{base}/.search/query"))
            .json(&serde_json::json!({ "query": query }))
            .send()
            .unwrap();
        assert!(
            resp.status().is_success(),
            "search status {}",
            resp.status()
        );
        let body: serde_json::Value = resp.json().unwrap();
        if done(&body) || Instant::now() >= deadline {
            return body;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// With the file watcher off, the server's own writes and deletes still
/// reach the full-text index at once.
#[test]
fn search_follows_api_writes_with_the_watcher_off() {
    let (_srv, _space, base) = start(&[("SB_FS_WATCH", "off")]);
    let http = client();
    let ready = Instant::now() + Duration::from_secs(10);
    while !http
        .get(format!("{base}/.search/status"))
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap()["ready"]
        .as_bool()
        .unwrap_or(false)
    {
        assert!(Instant::now() < ready, "the index never became ready");
        std::thread::sleep(Duration::from_millis(50));
    }
    let put = http
        .put(format!("{base}/.fs/Bracken.md"))
        .header("Content-Type", "text/markdown")
        .body("bracken uncurls\n")
        .send()
        .unwrap();
    assert!(put.status().is_success(), "PUT status {}", put.status());
    let body = search_until(&http, &base, "bracken", Duration::from_secs(2), |b| {
        b["items"][0]["page"] == "Bracken"
    });
    assert_eq!(body["items"][0]["page"], "Bracken", "{body}");

    let del = http
        .delete(format!("{base}/.fs/Bracken.md"))
        .send()
        .unwrap();
    assert!(del.status().is_success(), "DELETE status {}", del.status());
    let body = search_until(&http, &base, "bracken", Duration::from_secs(2), |b| {
        b["total"] == 0
    });
    assert_eq!(body["total"], 0, "{body}");
}

/// `--single` is gone: it fails and points at the migration instead.
#[test]
fn single_flag_points_at_the_migration() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("index.md"), "# Legacy").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(folder.path())
        .arg("--single")
        .arg("-p")
        .arg(free_port().to_string())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("migration"), "{stderr}");
}

/// A legacy single-space folder boots into the migration flow; once it runs,
/// the same process serves the migrated space, where the old `SB_USER`
/// credentials are an account, `SB_RUNTIME_API=0` keeps the Runtime API off
/// and clients keep their identity path.
#[test]
fn migration_boot() {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("legacy");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("index.md"), "# Legacy").unwrap();
    let folder_arg = folder.to_str().unwrap().to_string();

    let port = free_port();
    let mut child = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
        .arg(&folder_arg)
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        .env("SB_USER", "pat:secret")
        .env("SB_RUNTIME_API", "0")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn silverbullet");
    let log = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let stdout = child.stdout.take().unwrap();
    let sink = log.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
        {
            let mut log = sink.lock().unwrap();
            log.push_str(&line);
            log.push('\n');
        }
    });
    let _server = Server(child);
    let base = format!("http://127.0.0.1:{port}");
    let http = no_redirect_client();

    let flow_url = format!("http://localhost:{port}/.setup/migrate/");
    let deadline = Instant::now() + Duration::from_secs(20);
    while !log.lock().unwrap().contains(&flow_url) {
        assert!(
            Instant::now() < deadline,
            "migration URL never logged:\n{}",
            log.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    while http.get(format!("{base}/.instance")).send().is_err() {
        assert!(Instant::now() < deadline, "server never answered");
        std::thread::sleep(Duration::from_millis(100));
    }

    let resp = http.get(format!("{base}/.fs/")).send().unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert_eq!(resp.headers()["location"], "/.setup/migrate/");

    let resp = http
        .post(format!("{base}/.setup/migrate/api/login"))
        .json(&serde_json::json!({ "username": "pat", "password": "secret" }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let cookie = resp.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let status: serde_json::Value = http
        .get(format!("{base}/.setup/migrate/api/status"))
        .header("Cookie", &cookie)
        .send()
        .unwrap()
        .json()
        .unwrap();
    let resp = http
        .post(format!("{base}/.setup/migrate/api/run"))
        .header("Cookie", &cookie)
        .json(&serde_json::json!({ "edits": status["defaults"], "backupConfirmed": true }))
        .send()
        .unwrap();
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "{}",
        resp.text().unwrap()
    );
    let server_json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("server.json")).unwrap()).unwrap();
    assert_eq!(server_json["runtimeApi"], false, "{server_json}");

    let deadline = Instant::now() + Duration::from_secs(20);
    let session = loop {
        let resp = http
            .post(format!("{base}/.auth"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body("username=pat&password=secret")
            .send()
            .unwrap();
        if let Some(cookie) = resp.headers().get("set-cookie") {
            break cookie
                .to_str()
                .unwrap()
                .split(';')
                .next()
                .unwrap()
                .to_string();
        }
        assert!(Instant::now() < deadline, "never signed in after migrating");
        std::thread::sleep(Duration::from_millis(100));
    };
    let resp = http
        .get(format!("{base}/.fs/index.md"))
        .header("Cookie", &session)
        .send()
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert_eq!(resp.text().unwrap(), "# Legacy");
    // Clients compare this to the path they synced from (only the listing
    // and `/.ping` carry it).
    let resp = http
        .get(format!("{base}/.fs/"))
        .header("Cookie", &session)
        .send()
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert_eq!(resp.headers()["x-space-path"].to_str().unwrap(), folder_arg);
}
