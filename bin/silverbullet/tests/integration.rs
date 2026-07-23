//! Black-box integration suite for the standalone `silverbullet` server binary.
//!
//! Each test spawns the compiled binary as a subprocess on an ephemeral port
//! against a fresh temp space and drives its HTTP endpoints with
//! `reqwest::blocking`. The runtime API is disabled (`SB_RUNTIME_API=0`) so no
//! headless Chrome is launched — these tests exercise the HTTP surface only and
//! stay fast and Chrome-independent.

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
use common::free_port;

/// Spawn the binary against a fresh temp space with the given extra env, wait
/// for `/.ping` to answer 200 (up to ~20s), and return the running server, the
/// temp-space handle, and the base URL. On a boot timeout the child's
/// stdout/stderr are dumped. The `TempDir` is returned (rather than dropped
/// here) so the space outlives the server for the duration of the test.
fn start(extra_env: &[(&str, &str)]) -> (Server, tempfile::TempDir, String) {
    let space = tempfile::tempdir().unwrap();
    let port = free_port();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    cmd.arg(space.path())
        .arg("--single")
        .arg("-p")
        .arg(port.to_string())
        .arg("-L")
        .arg("127.0.0.1")
        // Critical: never launch headless Chrome for these HTTP-only tests.
        .env("SB_RUNTIME_API", "0")
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

    (server, space, base)
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

// ---------------------------------------------------------------------------
// Open server (no auth)
// ---------------------------------------------------------------------------

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
    // Metadata headers emitted by fs.rs::set_file_meta_headers.
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
}

#[test]
fn fs_get_meta_returns_empty_body_with_headers() {
    let (_srv, _space, base) = start(&[]);
    let http = client();
    http.put(format!("{base}/.fs/test.md"))
        .header("Content-Type", "text/markdown")
        .body("# Hello")
        .send()
        .unwrap();

    let resp = http
        .get(format!("{base}/.fs/test.md"))
        .header("X-Get-Meta", "true")
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert!(resp.headers().get("x-last-modified").is_some());
    assert!(resp.headers().get("x-content-length").is_some());
    let body = resp.bytes().unwrap();
    assert!(body.is_empty(), "X-Get-Meta body should be empty: {body:?}");
}

#[test]
fn fs_list_includes_written_file() {
    let (_srv, _space, base) = start(&[]);
    let http = client();
    http.put(format!("{base}/.fs/test.md"))
        .header("Content-Type", "text/markdown")
        .body("# Hello")
        .send()
        .unwrap();

    // Without X-Sync-Mode.
    let resp = http.get(format!("{base}/.fs/")).send().unwrap();
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

    // With X-Sync-Mode: true.
    let resp = http
        .get(format!("{base}/.fs/"))
        .header("X-Sync-Mode", "true")
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    let files: serde_json::Value = resp.json().unwrap();
    assert!(files
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["name"] == "test.md"));
}

#[test]
fn fs_delete_then_get_is_404_and_missing_is_404() {
    let (_srv, _space, base) = start(&[]);
    let http = client();
    http.put(format!("{base}/.fs/test.md"))
        .header("Content-Type", "text/markdown")
        .body("# Hello")
        .send()
        .unwrap();

    let del = http.delete(format!("{base}/.fs/test.md")).send().unwrap();
    assert!(del.status().is_success(), "DELETE status {}", del.status());

    let get = http.get(format!("{base}/.fs/test.md")).send().unwrap();
    assert_eq!(get.status(), reqwest::StatusCode::NOT_FOUND);

    let missing = http
        .get(format!("{base}/.fs/nonexistent.md"))
        .send()
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
}

#[test]
fn fs_nested_and_url_encoded_paths_roundtrip() {
    let (_srv, _space, base) = start(&[]);
    let http = client();

    // Nested path.
    let put = http
        .put(format!("{base}/.fs/sub/dir/page.md"))
        .header("Content-Type", "text/markdown")
        .body("nested")
        .send()
        .unwrap();
    assert!(put.status().is_success());
    let get = http
        .get(format!("{base}/.fs/sub/dir/page.md"))
        .send()
        .unwrap();
    assert!(get.status().is_success());
    assert_eq!(get.text().unwrap(), "nested");

    // Path containing a space (URL-encoded).
    let put = http
        .put(format!("{base}/.fs/file%20with%20spaces.md"))
        .header("Content-Type", "text/markdown")
        .body("spaced")
        .send()
        .unwrap();
    assert!(put.status().is_success());
    let get = http
        .get(format!("{base}/.fs/file%20with%20spaces.md"))
        .send()
        .unwrap();
    assert!(get.status().is_success());
    assert_eq!(get.text().unwrap(), "spaced");
}

#[test]
fn fs_binary_content_roundtrips_byte_for_byte() {
    let (_srv, _space, base) = start(&[]);
    let http = client();

    let blob: Vec<u8> = (0..1024).map(|i| (i % 256) as u8).collect();
    let put = http
        .put(format!("{base}/.fs/blob.bin"))
        .header("Content-Type", "application/octet-stream")
        .body(blob.clone())
        .send()
        .unwrap();
    assert!(put.status().is_success());

    let get = http.get(format!("{base}/.fs/blob.bin")).send().unwrap();
    assert!(get.status().is_success());
    let got = get.bytes().unwrap();
    assert_eq!(got.as_ref(), blob.as_slice(), "binary blob mismatch");
}

#[test]
fn shell_echo_and_stdin_pipe() {
    let (_srv, _space, base) = start(&[]);
    let http = client();

    // echo hello → code 0, stdout contains hello.
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

    // stdin piped to cat → stdout echoes the stdin.
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
    // Hand-rolled raw-TCP upstream: accept one connection, read the request,
    // reply with a fixed HTTP/1.1 200 carrying the body `ok`.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        if let Ok((mut conn, _)) = upstream.accept() {
            // Drain the request headers (read until we've seen the blank line).
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
    // The proxy returns 200 and surfaces the upstream status in a header.
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

// ---------------------------------------------------------------------------
// Auth server (SB_USER + SB_AUTH_TOKEN)
// ---------------------------------------------------------------------------

/// Spawn a server with a single user `alice:s3cret` and a static bearer token.
fn start_auth() -> (Server, tempfile::TempDir, String) {
    start(&[("SB_USER", "alice:s3cret"), ("SB_AUTH_TOKEN", "tok123")])
}

#[test]
fn auth_unauthenticated_config_is_401_with_auth_location() {
    let (_srv, _space, base) = start_auth();
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
    let (_srv, _space, base) = start_auth();
    let http = no_redirect_client();
    let resp = http
        .get(format!("{base}/.config"))
        .header("Authorization", "Bearer tok123")
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
    let (_srv, _space, base) = start_auth();
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
    let (_srv, _space, base) = start_auth();
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
    // Host-derived cookie name starts with `auth_`.
    assert!(
        set_cookie.starts_with("auth_"),
        "cookie name should start with auth_: {set_cookie}"
    );

    let v: serde_json::Value = resp.json().unwrap();
    assert_eq!(v["status"], "ok", "login JSON: {v}");

    // Replay the cookie (name=value before the first `;`) against /.config.
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
    let (_srv, _space, base) = start_auth();
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
    let (_srv, _space, base) = start_auth();
    let http = no_redirect_client();
    let resp = http.get(format!("{base}/.logout")).send().unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FOUND);
    assert_eq!(
        resp.headers().get("location").map(|v| v.to_str().unwrap()),
        Some("/.auth")
    );
}
