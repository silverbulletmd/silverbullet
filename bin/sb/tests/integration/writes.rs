//! `sb fs write` of pages with scripts: the reload that follows, and revision conflicts.

use super::*;

const SCRIPT_PAGE: &[u8] = b"# Tools\n```space-lua\nfunction tools_ping() return 1 end\n```\n";

#[test]
fn script_write_without_runtime_succeeds_and_reports_no_runtime() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb_with_input(
        &[
            "--url",
            &base,
            "--text",
            "fs",
            "write",
            "Library/Tools.md",
            "--create",
            "--file",
            "-",
        ],
        cfg.path(),
        Some(SCRIPT_PAGE),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let stdout = out.stdout_text();
    assert!(
        stdout.starts_with("Wrote Library/Tools.md (revision \""),
        "{stdout}"
    );
    assert!(stdout.ends_with("\")\n"), "{stdout}");
    assert_eq!(
        out.stderr,
        "The page has Space Lua or Space Style; it takes effect when the space reloads.\n"
    );
    assert_eq!(
        std::fs::read(space.path().join("Library/Tools.md")).unwrap(),
        SCRIPT_PAGE
    );

    let dry_run = run_sb(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Library/Tools.md",
            "--old",
            "return 1",
            "--new",
            "return 2",
            "--dry-run",
        ],
        cfg.path(),
    );
    assert_eq!(dry_run.code, 0, "stderr: {}", dry_run.stderr);
    assert!(dry_run.stderr.is_empty(), "{}", dry_run.stderr);
    assert!(
        dry_run.json().get("reload").is_none(),
        "{}",
        dry_run.stdout_text()
    );

    let revision = stdout
        .trim_start_matches("Wrote Library/Tools.md (revision ")
        .trim_end_matches(")\n");
    let json = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "write",
            "Library/Tools.md",
            "--revision",
            revision,
            "--file",
            "-",
        ],
        cfg.path(),
        Some(b"# Tools\nno scripts any more\n"),
    );
    assert_eq!(json.code, 0, "stderr: {}", json.stderr);
    assert!(json.stderr.is_empty(), "{}", json.stderr);
    let value = json.json();
    assert_eq!(value["reload"]["status"], "no_runtime", "{value}");
    assert_eq!(value["reload"]["loadErrors"], serde_json::json!([]));

    let edit = run_sb(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Library/Tools.md",
            "--old",
            "any more",
            "--new",
            "at all",
        ],
        cfg.path(),
    );
    assert_eq!(edit.code, 0, "stderr: {}", edit.stderr);
    assert!(
        edit.json().get("reload").is_none(),
        "{}",
        edit.stdout_text()
    );
}

#[test]
fn no_reload_skips_the_reload() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "write",
            "Library/Tools.md",
            "--create",
            "--no-reload",
            "--file",
            "-",
        ],
        cfg.path(),
        Some(SCRIPT_PAGE),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    assert!(out.json().get("reload").is_none(), "{}", out.stdout_text());

    let edit = run_sb(
        &[
            "--url",
            &base,
            "--text",
            "fs",
            "edit",
            "Library/Tools.md",
            "--old",
            "return 1",
            "--new",
            "return 2",
            "--no-reload",
        ],
        cfg.path(),
    );
    assert_eq!(edit.code, 0, "stderr: {}", edit.stderr);
    assert!(edit.stderr.is_empty(), "{}", edit.stderr);
    assert!(
        edit.stdout_text()
            .starts_with("1 replacement(s) in Library/Tools.md (revision \""),
        "{}",
        edit.stdout_text()
    );
}

#[test]
fn revision_conflict_says_how_to_reread() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    assert_eq!(create_file(&base, cfg.path(), "Draft.md", b"one").code, 0);
    let stale = "\"sha256:0000000000000000000000000000000000000000000000000000000000000000\"";
    let out = run_sb_with_input(
        &[
            "--url",
            &base,
            "--text",
            "fs",
            "write",
            "Draft.md",
            "--if-match",
            stale,
            "--file",
            "-",
        ],
        cfg.path(),
        Some(b"two"),
    );
    assert_eq!(out.code, 5, "stderr: {}", out.stderr);
    assert!(
        out.stderr.starts_with(&format!(
            "Error: Draft.md changed since revision {stale}; the current revision is \""
        )),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr
            .ends_with(". Read it again (sb fs read Draft.md --json) and retry.\n"),
        "{}",
        out.stderr
    );

    let missing = run_sb_with_input(
        &[
            "--url",
            &base,
            "--text",
            "fs",
            "write",
            "Gone.md",
            "--revision",
            stale,
            "--file",
            "-",
        ],
        cfg.path(),
        Some(b"two"),
    );
    assert_eq!(missing.code, 5, "stderr: {}", missing.stderr);
    assert_eq!(
        missing.stderr,
        format!(
            "Error: Gone.md changed since revision {stale}; it no longer exists or the revision is not valid. Read it again (sb fs read Gone.md --json) and retry.\n"
        )
    );
    assert!(!space.path().join("Gone.md").exists());
}

/// A stand-in for a Desktop space server whose runtime never becomes ready:
/// `/.runtime/ready` answers 503, everything else 200 with a revision.
/// Records each request line.
fn booting_desktop_space() -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
    use std::io::{BufRead, BufReader, Read};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(&stream);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap_or_default();
            let mut length = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or_default() == 0 || line.trim().is_empty() {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                }
            }
            let mut body = vec![0; length];
            let _ = reader.read_exact(&mut body);
            let status = if request.starts_with("GET /.runtime/ready ") {
                "503 Service Unavailable"
            } else {
                "200 OK"
            };
            log.lock().unwrap().push(request.trim().to_owned());
            let _ = (&stream).write_all(
                format!(
                    "HTTP/1.1 {status}\r\nX-SilverBullet-Revision: \"sha256:new\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            );
        }
    });
    (base, seen)
}

/// A folder space that Desktop reports running at `base`, with a launcher
/// that does nothing.
fn desktop_folder_space(config_home: &std::path::Path, base: &str, folder: &std::path::Path) {
    let dir = config_home.join("silverbullet");
    std::fs::create_dir_all(&dir).unwrap();
    let runtime = dir.join("runtime.json");
    std::fs::write(
        dir.join("desktop-host.json"),
        serde_json::json!({
            "version": 1,
            "runtime": runtime,
            "launch": ["/usr/bin/true"],
            "open": "silverbullet://open?path={path}",
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        &runtime,
        serde_json::json!({"version": 1, "spaces": [{"id": "id-harbor", "origin": base, "token": "t"}]})
            .to_string(),
    )
    .unwrap();
    std::fs::write(
        dir.join("config.json"),
        serde_json::json!({"spaces": [
            {"id": "id-harbor", "name": "harbor", "folderPath": folder, "auth": {"method": "none"}},
        ]})
        .to_string(),
    )
    .unwrap();
}

#[cfg(unix)]
#[test]
fn desktop_folder_space_reload_waits_for_the_runtime_then_reports_no_runtime() {
    let (base, seen) = booting_desktop_space();
    let cfg = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    desktop_folder_space(cfg.path(), &base, folder.path());
    let out = run_sb_with_input(
        &[
            "--space",
            "harbor",
            "--timeout",
            "1",
            "--json",
            "fs",
            "write",
            "Library/Tools.md",
            "--create",
            "--file",
            "-",
        ],
        cfg.path(),
        Some(SCRIPT_PAGE),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let value = out.json();
    assert_eq!(value["revision"], "\"sha256:new\"", "{value}");
    assert_eq!(value["reload"]["status"], "no_runtime", "{value}");
    // The reload asked for the runtime again and waited for it, instead of
    // rebooting a runtime that is not ready.
    assert!(
        out.stderr.contains("Waiting for SilverBullet"),
        "{}",
        out.stderr
    );
    let seen = seen.lock().unwrap().clone();
    assert!(
        seen.iter()
            .any(|r| r.starts_with("PUT /.fs/Library/Tools.md ")),
        "{seen:?}"
    );
    assert!(
        seen.iter().any(|r| r.starts_with("GET /.runtime/ready ")),
        "{seen:?}"
    );
    assert!(
        !seen.iter().any(|r| r.starts_with("POST /.runtime/")),
        "{seen:?}"
    );
}
