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

#[test]
fn space_ls_empty_config() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["space", "ls"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout_text().contains("No spaces configured"),
        "got stdout: {:?}",
        out.stdout
    );
}

#[test]
fn space_rm_missing_errors() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["space", "rm", "does-not-exist"], cfg.path());
    assert_ne!(out.code, 0, "expected non-zero exit");
    assert!(
        out.stderr.contains("not found"),
        "got stderr: {:?}",
        out.stderr
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
    for _ in 0..100 {
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
fn eval_against_server_without_runtime_reports_not_enabled() {
    // `space` is held for the whole test so its tempdir outlives the server.
    let space = tempfile::tempdir().unwrap();
    let Some((_server, base)) = start_server(space.path()) else {
        eprintln!("skip: silverbullet server binary not built (run `make build-rs` or `cargo build --workspace`)");
        return;
    };

    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["--url", &base, "eval", "1+1"], cfg.path());

    assert_ne!(out.code, 0, "expected non-zero exit (runtime disabled)");
    assert!(
        out.stderr.to_lowercase().contains("not enabled")
            || out.stderr.to_lowercase().contains("runtime"),
        "expected a runtime-not-enabled error, got stderr: {:?}",
        out.stderr
    );
}
