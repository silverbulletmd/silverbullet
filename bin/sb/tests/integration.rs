//! End-to-end integration tests for the `sb` CLI binary.
//!
//! These drive the actual compiled `sb` binary (`CARGO_BIN_EXE_sb`, provided by
//! Cargo for integration tests) as a subprocess. The no-server tests
//! (`version`, `space`) always run. The server-backed tests locate the sibling
//! `silverbullet` server binary in the same target directory and **skip** (with
//! a notice) when it hasn't been built — mirroring the repo's convention of
//! skipping integration cases whose prerequisites are absent (see
//! `runtime_e2e.rs`). Run `cargo test --workspace` (which builds every bin) or
//! `make build-rs` first to exercise the server-backed paths.
//!
//! The server is started with `SB_RUNTIME_API=0`, so the headless-Chrome Lua
//! runtime is disabled and every `/.runtime/*` endpoint returns 503. The
//! runtime-dependent cases therefore assert the *graceful* not-enabled path
//! (the full conn → api → HTTP → error-mapping chain), not a live Lua result —
//! exercising the real wire path without requiring a browser in CI.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

/// Path to the compiled `sb` binary under test.
fn sb_bin() -> &'static str {
    env!("CARGO_BIN_EXE_sb")
}

/// Path to the sibling `silverbullet` server binary in the same target dir, if
/// it has been built.
fn server_bin() -> Option<PathBuf> {
    let dir = PathBuf::from(sb_bin()).parent()?.to_path_buf();
    let name = if cfg!(windows) {
        "silverbullet.exe"
    } else {
        "silverbullet"
    };
    let p = dir.join(name);
    p.exists().then_some(p)
}

// Shared with the silverbullet crate's tests; see that file for why the
// naive "bind :0, read the port, drop the listener" helper is racy.
#[path = "../../silverbullet/tests/common/mod.rs"]
mod common;
use common::free_port;

#[path = "integration/space.rs"]
mod space;
#[path = "integration/writes.rs"]
mod writes;

struct Output {
    code: i32,
    stdout: Vec<u8>,
    stderr: String,
}

impl Output {
    fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.stdout).unwrap_or_else(|error| {
            panic!("invalid JSON stdout: {error}; stdout: {:?}", self.stdout)
        })
    }
}

/// Run the `sb` binary with `args`, an isolated `XDG_CONFIG_HOME` (so we never
/// touch the developer's real config), and capture its output + exit code.
fn run_sb(args: &[&str], config_home: &std::path::Path) -> Output {
    run_sb_with_input(args, config_home, None)
}

fn run_sb_with_input(args: &[&str], config_home: &std::path::Path, input: Option<&[u8]>) -> Output {
    let mut command = Command::new(sb_bin());
    command.args(args).env("XDG_CONFIG_HOME", config_home);
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sb");
    if let Some(input) = input {
        child
            .stdin
            .take()
            .expect("piped stdin")
            .write_all(input)
            .expect("write sb stdin");
    }
    let out = child.wait_with_output().expect("wait for sb");
    Output {
        code: out.status.code().unwrap_or(-1),
        stdout: out.stdout,
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn version_prints_without_a_server() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["version"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        !out.stdout_text().trim().is_empty(),
        "version should print something, got empty"
    );
}

/// Spawn the server against a fresh temp space (runtime disabled) and wait for
/// `/.ping`. Returns the managed server + base URL, or `None` if the server binary
/// isn't built (caller skips).
fn start_server(space_dir: &std::path::Path) -> Option<(Server, String)> {
    start_server_with_env(space_dir, &[])
}

fn start_server_with_env(
    space_dir: &std::path::Path,
    extra_env: &[(&str, &str)],
) -> Option<(Server, String)> {
    let bin = server_bin()?;
    let port = free_port();
    let mut command = Command::new(bin);
    command
        .arg(space_dir)
        .arg("-p")
        .arg(port.to_string())
        .args(["-L", "127.0.0.1"])
        .arg("--single")
        .env("SB_RUNTIME_API", "0")
        .env("SB_DISABLE_SERVICE_WORKER", "1");
    for (key, value) in extra_env {
        command.env(key, value);
    }
    let child = command.spawn().expect("spawn silverbullet server");
    let mut server = Server(child);
    let base = format!("http://127.0.0.1:{port}");

    let client = reqwest::blocking::Client::new();
    for _ in 0..300 {
        if client
            .get(format!("{base}/.ping"))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Some((server, base));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = server.0.kill();
    let _ = server.0.wait();
    panic!("server did not become ready");
}

fn require_server(space_dir: &std::path::Path) -> Option<(Server, String)> {
    let server = start_server(space_dir);
    if server.is_none() {
        eprintln!(
            "skip: silverbullet server binary not built (run `make build-rs` or `cargo build --workspace`)"
        );
    }
    server
}

/// One server (runtime disabled, writable, empty space) shared by the
/// read-only tests, so each doesn't boot its own. They must not depend on an
/// empty space: each writes only files of its own names.
static SHARED_SERVER: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
static SHARED_HOLD: std::sync::Mutex<Option<(Server, tempfile::TempDir)>> =
    std::sync::Mutex::new(None);

extern "C" {
    fn atexit(callback: extern "C" fn()) -> i32;
}

/// Stops the shared server when the test binary exits.
extern "C" fn stop_shared_server() {
    if let Ok(mut held) = SHARED_HOLD.lock() {
        drop(held.take());
    }
}

/// The base URL of the shared server, or `None` (with a notice) when the
/// server binary isn't built.
fn require_shared_server() -> Option<String> {
    SHARED_SERVER
        .get_or_init(|| {
            let space = tempfile::tempdir().unwrap();
            let (server, base) = require_server(space.path())?;
            *SHARED_HOLD.lock().unwrap() = Some((server, space));
            // SAFETY: registers a plain function that touches only statics.
            unsafe { atexit(stop_shared_server) };
            Some(base)
        })
        .clone()
}

fn create_file(base: &str, config_home: &std::path::Path, path: &str, bytes: &[u8]) -> Output {
    run_sb_with_input(
        &[
            "--url", base, "--json", "fs", "write", path, "--create", "--file", "-",
        ],
        config_home,
        Some(bytes),
    )
}

#[test]
fn fs_text_journey_uses_listing_revisions_atomic_edit_and_conditional_delete() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let original = b"Status: draft\n- [ ] Review copy\nKeep this line without a final newline";

    let created = create_file(&base, cfg.path(), "Projects/Launch.md", original);
    assert_eq!(created.code, 0, "stderr: {}", created.stderr);
    assert_eq!(created.json()["path"], "Projects/Launch.md");
    let excluded = create_file(&base, cfg.path(), "Projects/Skip.md", b"skip");
    assert_eq!(excluded.code, 0, "stderr: {}", excluded.stderr);
    let non_markdown = create_file(&base, cfg.path(), "Projects/data.txt", b"data");
    assert_eq!(non_markdown.code, 0, "stderr: {}", non_markdown.stderr);

    let listed = run_sb(
        &[
            "--url",
            &base,
            "--text",
            "fs",
            "list",
            ".",
            "--recursive",
            "--glob",
            "Projects/*.md",
            "--glob",
            "!Projects/Skip.md",
        ],
        cfg.path(),
    );
    assert_eq!(listed.code, 0, "stderr: {}", listed.stderr);
    assert_eq!(listed.stdout, b"Projects/Launch.md\n");

    for command in ["stat", "rm"] {
        let directory = run_sb(
            &["--url", &base, "--json", "fs", command, "Projects"],
            cfg.path(),
        );
        assert_eq!(
            directory.code, 2,
            "fs {command} directory stderr: {}",
            directory.stderr
        );
        assert!(directory.stdout.is_empty());
    }
    assert_eq!(
        std::fs::read(space.path().join("Projects/Launch.md")).unwrap(),
        original
    );
    assert_eq!(
        std::fs::read(space.path().join("Projects/Skip.md")).unwrap(),
        b"skip"
    );

    let read = run_sb(
        &["--url", &base, "--json", "fs", "read", "Projects/Launch.md"],
        cfg.path(),
    );
    assert_eq!(read.code, 0, "stderr: {}", read.stderr);
    let read_json = read.json();
    assert_eq!(
        read_json["content"].as_str(),
        std::str::from_utf8(original).ok()
    );
    assert_eq!(read_json["size"], original.len());
    let original_revision = read_json["revision"]
        .as_str()
        .expect("read must return a revision");
    assert!(original_revision.starts_with('"') && original_revision.ends_with('"'));

    let edits = br#"{"edits":[{"old":"Status: draft","new":"Status: ready"},{"old":"- [ ] Review copy","new":"- [x] Review copy"}]}"#;
    let edited = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Projects/Launch.md",
            "--file",
            "-",
            "--if-match",
            original_revision,
        ],
        cfg.path(),
        Some(edits),
    );
    assert_eq!(edited.code, 0, "stderr: {}", edited.stderr);
    let edited_json = edited.json();
    assert_eq!(edited_json["replacements"], 2);
    assert_eq!(edited_json["changed"], true);
    let edited_revision = edited_json["revision"]
        .as_str()
        .expect("edit must return the new revision");
    assert_ne!(edited_revision, original_revision);

    let expected = b"Status: ready\n- [x] Review copy\nKeep this line without a final newline";
    let reread = run_sb(
        &["--url", &base, "fs", "read", "Projects/Launch.md"],
        cfg.path(),
    );
    assert_eq!(reread.code, 0, "stderr: {}", reread.stderr);
    assert_eq!(reread.stdout, expected);
    assert_eq!(
        std::fs::read(space.path().join("Projects/Launch.md")).unwrap(),
        expected
    );

    let deleted = run_sb(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "delete",
            "Projects/Launch.md",
            "--if-match",
            edited_revision,
        ],
        cfg.path(),
    );
    assert_eq!(deleted.code, 0, "stderr: {}", deleted.stderr);
    assert_eq!(deleted.json()["operation"], "delete");

    let missing = run_sb(
        &["--url", &base, "fs", "read", "Projects/Launch.md"],
        cfg.path(),
    );
    assert_eq!(missing.code, 3, "stderr: {}", missing.stderr);
    assert!(missing.stdout.is_empty());
    assert!(!space.path().join("Projects/Launch.md").exists());
}

#[test]
fn fs_edit_with_lf_text_keeps_a_crlf_page_crlf() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let created = create_file(&base, cfg.path(), "Lines.md", b"one\r\ntwo\r\nthree\r\n");
    assert_eq!(created.code, 0, "stderr: {}", created.stderr);

    let edited = run_sb(
        &[
            "--url", &base, "--json", "fs", "edit", "Lines.md", "--old", "one\ntwo", "--new",
            "1\n2",
        ],
        cfg.path(),
    );
    assert_eq!(edited.code, 0, "stderr: {}", edited.stderr);
    assert_eq!(
        std::fs::read(space.path().join("Lines.md")).unwrap(),
        b"1\r\n2\r\nthree\r\n"
    );
}

#[test]
fn fs_stale_revision_rejects_edit_without_touching_newer_bytes() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let created = create_file(&base, cfg.path(), "Shared.md", b"Version one");
    assert_eq!(created.code, 0, "stderr: {}", created.stderr);

    let inspected = run_sb(
        &["--url", &base, "--json", "fs", "read", "Shared.md"],
        cfg.path(),
    );
    assert_eq!(inspected.code, 0, "stderr: {}", inspected.stderr);
    let stale_revision = inspected.json()["revision"].as_str().unwrap().to_string();

    let replaced = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "write",
            "Shared.md",
            "--overwrite",
        ],
        cfg.path(),
        Some(b"Version two from another writer"),
    );
    assert_eq!(replaced.code, 0, "stderr: {}", replaced.stderr);

    let stale_edit = run_sb(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Shared.md",
            "--old",
            "Version one",
            "--new",
            "Version three",
            "--if-match",
            &stale_revision,
        ],
        cfg.path(),
    );
    assert_eq!(stale_edit.code, 5, "stderr: {}", stale_edit.stderr);
    assert!(stale_edit.stdout.is_empty());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stale_edit.stderr).unwrap()["error"]["code"],
        "revision_conflict"
    );

    let actual = run_sb(&["--url", &base, "fs", "read", "Shared.md"], cfg.path());
    assert_eq!(actual.code, 0, "stderr: {}", actual.stderr);
    assert_eq!(actual.stdout, b"Version two from another writer");
    assert_eq!(
        std::fs::read(space.path().join("Shared.md")).unwrap(),
        b"Version two from another writer"
    );
}

#[test]
fn fs_invalid_late_batch_and_dry_run_leave_original_bytes_unchanged() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let original = b"alpha\nbeta\ngamma\n";
    let created = create_file(&base, cfg.path(), "Atomic.md", original);
    assert_eq!(created.code, 0, "stderr: {}", created.stderr);

    let invalid_batch =
        br#"{"edits":[{"old":"alpha","new":"ALPHA"},{"old":"missing","new":"MISSING"}]}"#;
    let rejected = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Atomic.md",
            "--file",
            "-",
        ],
        cfg.path(),
        Some(invalid_batch),
    );
    assert_eq!(rejected.code, 6, "stderr: {}", rejected.stderr);
    assert!(rejected.stdout.is_empty());

    let dry_run_batch =
        br#"{"edits":[{"old":"alpha","new":"ALPHA"},{"old":"gamma","new":"GAMMA"}]}"#;
    let dry_run = run_sb_with_input(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "edit",
            "Atomic.md",
            "--file",
            "-",
            "--dry-run",
        ],
        cfg.path(),
        Some(dry_run_batch),
    );
    assert_eq!(dry_run.code, 0, "stderr: {}", dry_run.stderr);
    let dry_run_json = dry_run.json();
    assert_eq!(dry_run_json["replacements"], 2);
    assert_eq!(dry_run_json["changed"], true);
    assert_eq!(dry_run_json["dryRun"], true);
    assert!(dry_run_json["revision"].is_null());
    assert!(dry_run_json["diff"].as_str().unwrap().contains("+ALPHA"));

    let actual = run_sb(&["--url", &base, "fs", "read", "Atomic.md"], cfg.path());
    assert_eq!(actual.code, 0, "stderr: {}", actual.stderr);
    assert_eq!(actual.stdout, original);
    assert_eq!(
        std::fs::read(space.path().join("Atomic.md")).unwrap(),
        original
    );
}

#[test]
fn fs_binary_roundtrip_and_oversize_read_never_emit_partial_stdout() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let bytes = [0, 255, 2, b'\n', b'\r', 128, 42];

    let created = create_file(&base, cfg.path(), "Assets/blob.bin", &bytes);
    assert_eq!(created.code, 0, "stderr: {}", created.stderr);
    let read = run_sb(
        &["--url", &base, "fs", "read", "Assets/blob.bin"],
        cfg.path(),
    );
    assert_eq!(read.code, 0, "stderr: {}", read.stderr);
    assert_eq!(read.stdout, bytes);
    assert_eq!(
        std::fs::read(space.path().join("Assets/blob.bin")).unwrap(),
        bytes
    );

    let limited = run_sb(
        &[
            "--url",
            &base,
            "fs",
            "read",
            "Assets/blob.bin",
            "--max-bytes",
            "4",
        ],
        cfg.path(),
    );
    assert_eq!(limited.code, 8, "stderr: {}", limited.stderr);
    assert!(
        limited.stdout.is_empty(),
        "partial stdout: {:?}",
        limited.stdout
    );
    assert!(limited.stderr.contains("response_too_large"));
}

#[test]
fn fs_read_only_server_allows_reads_and_rejects_writes() {
    let space = tempfile::tempdir().unwrap();
    std::fs::write(space.path().join("Public.md"), b"Visible but immutable").unwrap();
    let Some((_server, base)) = start_server_with_env(space.path(), &[("SB_READ_ONLY", "1")])
    else {
        eprintln!(
            "skip: silverbullet server binary not built (run `make build-rs` or `cargo build --workspace`)"
        );
        return;
    };
    let cfg = tempfile::tempdir().unwrap();

    let read = run_sb(&["--url", &base, "fs", "read", "Public.md"], cfg.path());
    assert_eq!(read.code, 0, "stderr: {}", read.stderr);
    assert_eq!(read.stdout, b"Visible but immutable");

    let write = create_file(&base, cfg.path(), "Denied.md", b"must not be written");
    assert_eq!(write.code, 4, "stderr: {}", write.stderr);
    assert!(write.stdout.is_empty());
    assert!(!space.path().join("Denied.md").exists());
}

#[test]
fn screenshot_against_server_without_runtime_reports_not_enabled() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let target = cfg.path().join("shot.png");
    let out = run_sb(
        &["--url", &base, "screenshot", target.to_str().unwrap()],
        cfg.path(),
    );
    assert_ne!(out.code, 0, "expected non-zero exit (runtime disabled)");
    assert!(
        out.stderr.to_lowercase().contains("not enabled")
            || out.stderr.to_lowercase().contains("runtime"),
        "{:?}",
        out.stderr
    );
    assert!(!target.exists(), "no file should be written on failure");
}

/// `sb search` retries while the server's first index build runs.
fn search_until_found(base: &str, cfg: &std::path::Path, args: &[&str]) -> Output {
    let mut out = run_sb(args, cfg);
    for _ in 0..100 {
        if out.code != 0 || !out.json()["items"].as_array().unwrap().is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        out = run_sb(args, cfg);
    }
    let _ = base;
    out
}

#[test]
fn search_status_search_and_related_use_the_native_endpoints() {
    let space = tempfile::tempdir().unwrap();
    std::fs::write(
        space.path().join("Garden.md"),
        "# Herbs\nPlant the basil next to the fern.\n",
    )
    .unwrap();
    std::fs::write(
        space.path().join("Index.md"),
        "Nothing about plants here.\n",
    )
    .unwrap();
    let Some((_server, base)) = start_server(space.path()) else {
        eprintln!("skip: silverbullet server binary not built (run `make build-rs` or `cargo build --workspace`)");
        return;
    };
    let cfg = tempfile::tempdir().unwrap();

    let status = run_sb(
        &["--url", &base, "search", "--status", "--json"],
        cfg.path(),
    );
    assert_eq!(status.code, 0, "stderr: {}", status.stderr);
    let status = status.json();
    assert!(status["capabilities"]["modes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m == "words"));
    let text = run_sb(
        &["--url", &base, "search", "--status", "--text"],
        cfg.path(),
    );
    assert_eq!(text.code, 0, "stderr: {}", text.stderr);
    assert!(text
        .stdout_text()
        .contains("Semantic search: not available"));

    let found = search_until_found(
        &base,
        cfg.path(),
        &[
            "--url", &base, "search", "basil", "--mode", "words", "--limit", "5", "--json",
        ],
    );
    assert_eq!(found.code, 0, "stderr: {}", found.stderr);
    let items = found.json()["items"].clone();
    assert_eq!(items.as_array().unwrap().len(), 1, "{items}");
    assert_eq!(items[0]["page"], "Garden");

    let line = run_sb(&["--url", &base, "search", "basil", "--text"], cfg.path());
    assert_eq!(line.code, 0, "stderr: {}", line.stderr);
    assert!(
        line.stdout_text().starts_with("Garden:2  Plant the basil"),
        "{:?}",
        line.stdout_text()
    );

    // The word "status" is searched for, not mistaken for the subcommand.
    let word = run_sb(&["--url", &base, "search", "status", "--json"], cfg.path());
    assert_eq!(word.code, 0, "stderr: {}", word.stderr);
    assert!(word.json()["items"].is_array());

    // Semantic search is not part of a full-text-only server.
    let semantic = run_sb(
        &["--url", &base, "search", "basil", "--mode", "semantic"],
        cfg.path(),
    );
    assert_ne!(semantic.code, 0);
    assert!(!semantic.stderr.is_empty());

    let related = run_sb(&["--url", &base, "related", "Garden", "--json"], cfg.path());
    assert_ne!(
        related.code, 0,
        "full-text-only servers have no related pages"
    );
    assert!(!related.stderr.is_empty());
}

#[test]
fn eval_reports_runtime_disabled_hint() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["--url", &base, "eval", "1 + 1"], cfg.path());
    assert_eq!(out.code, 1, "stderr: {}", out.stderr);
    assert!(out.stdout.is_empty(), "{:?}", out.stdout_text());
    assert_eq!(
        out.stderr,
        "Error: The runtime API is disabled for this space; you can still use sb fs and sb search.\n"
    );
}

#[test]
fn several_paths_print_sections_with_revisions() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    assert_eq!(
        create_file(&base, cfg.path(), "One.md", b"# One\nfirst\n").code,
        0
    );
    assert_eq!(create_file(&base, cfg.path(), "Two.md", b"second").code, 0);
    let out = run_sb(
        &["--url", &base, "fs", "read", "One.md", "Two.md"],
        cfg.path(),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let text = out.stdout_text();
    assert!(text.starts_with("=== One.md (revision "), "{text}");
    assert!(
        text.contains(") ===\n# One\nfirst\n\n=== Two.md (revision "),
        "{text}"
    );
    assert!(text.ends_with(") ===\nsecond\n"), "{text}");

    let outline = run_sb(
        &["--url", &base, "fs", "read", "One.md", "--outline"],
        cfg.path(),
    );
    assert_eq!(outline.code, 0, "stderr: {}", outline.stderr);
    assert_eq!(
        outline.stdout_text(),
        "    1\t# One\n\n2 lines in all; read a part with --offset and --limit.\n"
    );
    let part = run_sb(
        &[
            "--url", &base, "fs", "read", "One.md", "--offset", "2", "--limit", "1",
        ],
        cfg.path(),
    );
    assert_eq!(part.stdout_text(), "    2\tfirst\n");
}

#[test]
fn several_paths_json_reports_missing_file_inline_and_exits_3() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    assert_eq!(
        create_file(&base, cfg.path(), "Inline.md", b"first").code,
        0
    );
    let out = run_sb(
        &[
            "--url",
            &base,
            "--json",
            "fs",
            "read",
            "Inline.md",
            "Gone.md",
        ],
        cfg.path(),
    );
    assert_eq!(out.code, 3, "stderr: {}", out.stderr);
    let files = out.json()["files"].as_array().unwrap().clone();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0]["content"], "first");
    assert_eq!(files[1]["path"], "Gone.md");
    assert_eq!(files[1]["error"]["code"], "not_found");
}

#[test]
fn rendered_read_without_runtime_reports_the_hint() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    assert_eq!(
        create_file(&base, cfg.path(), "Rendered.md", b"first").code,
        0
    );
    let out = run_sb(
        &["--url", &base, "fs", "read", "Rendered.md", "--rendered"],
        cfg.path(),
    );
    assert_eq!(out.code, 8, "stderr: {}", out.stderr);
    assert!(out.stdout.is_empty(), "{:?}", out.stdout_text());
    // Piped stderr is structured, like every fs error.
    let error: serde_json::Value = serde_json::from_str(&out.stderr).unwrap();
    assert_eq!(error["error"]["code"], "operation_failed");
    let message = error["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("you can still use sb fs and sb search")
            || message.contains("starting or unavailable"),
        "{message}"
    );
}

#[test]
fn rendered_read_of_a_missing_page_exits_3() {
    let Some(base) = require_shared_server() else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(
        &["--url", &base, "fs", "read", "Gone.md", "--rendered"],
        cfg.path(),
    );
    assert_eq!(out.code, 3, "stderr: {}", out.stderr);
    let error: serde_json::Value = serde_json::from_str(&out.stderr).unwrap();
    assert_eq!(error["error"]["code"], "not_found");
}

#[test]
fn help_shows_space_skills_and_outline() {
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = require_server(space.path()) else {
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let page = b"---\ntags: meta/skill\ndescription: House rules for notes. Use when filing a note in this space.\n---\nFile every note under Inbox first.\n";
    assert_eq!(
        create_file(&base, cfg.path(), "Guides/Filing.md", page).code,
        0
    );

    // The space's catalog picks the new page up from the watcher.
    let mut out = run_sb(&["--url", &base, "help"], cfg.path());
    for _ in 0..50 {
        if out.stdout_text().contains("**Filing**") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        out = run_sb(&["--url", &base, "help"], cfg.path());
    }
    let text = out.stdout_text();
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(text.contains(&format!("## In {base}")), "{text}");
    assert!(
        text.contains("- **Filing**: Use when filing a note in this space."),
        "{text}"
    );
    assert!(text.contains("## Built in"), "{text}");
    assert!(text.contains("- **Querying**"), "{text}");
    assert!(text.contains("Folders: Guides/ (1)"), "{text}");
    assert!(text.contains("# Operations"), "{text}");

    let out = run_sb(&["--url", &base, "help", "Filing"], cfg.path());
    let text = out.stdout_text();
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(text.starts_with("Source: Guides/Filing — "), "{text}");
    assert!(
        text.contains("File every note under Inbox first."),
        "{text}"
    );

    let out = run_sb(&["--url", &base, "help", "--json"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert_eq!(out.json()["help"]["version"], 1);
}

#[test]
fn help_without_a_space_lists_built_in_skills() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["help"], cfg.path());
    let text = out.stdout_text();
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(text.contains("## Built in"), "{text}");
    assert!(
        text.contains("Add a space with `sb space add <url or folder>`"),
        "{text}"
    );
    let out = run_sb(&["help", "fs"], cfg.path());
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("run `sb fs --help`"), "{}", out.stderr);
}
