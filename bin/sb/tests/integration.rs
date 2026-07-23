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

use std::path::PathBuf;
use std::process::{Child, Command};

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
    stdout: String,
    stderr: String,
}

/// Run the `sb` binary with `args`, an isolated `XDG_CONFIG_HOME` (so we never
/// touch the developer's real config), and capture its output + exit code.
fn run_sb(args: &[&str], config_home: &std::path::Path) -> Output {
    let out = Command::new(sb_bin())
        .args(args)
        .env("XDG_CONFIG_HOME", config_home)
        .output()
        .expect("spawn sb");
    Output {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

#[test]
fn version_prints_without_a_server() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["version"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        !out.stdout.trim().is_empty(),
        "version should print something, got empty"
    );
}

#[test]
fn space_ls_empty_config() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["space", "ls"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout.contains("No spaces configured"),
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
/// `/.ping`. Returns the child + base URL, or `None` if the server binary
/// isn't built (caller skips).
fn start_server(space_dir: &std::path::Path) -> Option<(Child, String)> {
    let bin = server_bin()?;
    let port = free_port();
    let child = Command::new(bin)
        .arg(space_dir)
        .args(["-p", &port.to_string(), "-L", "127.0.0.1"])
        .arg("--single")
        .env("SB_RUNTIME_API", "0")
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .spawn()
        .expect("spawn silverbullet server");
    let base = format!("http://127.0.0.1:{port}");

    // Wait for the listener.
    let client = reqwest::blocking::Client::new();
    for _ in 0..100 {
        if client
            .get(format!("{base}/.ping"))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Some((child, base));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // Failed to come up — tear down and treat as a hard failure.
    let mut child = child;
    let _ = child.kill();
    panic!("server did not become ready");
}

#[test]
fn eval_against_server_without_runtime_reports_not_enabled() {
    // `space` is held for the whole test so its tempdir outlives the server.
    let space = tempfile::tempdir().unwrap();
    let Some((mut child, base)) = start_server(space.path()) else {
        eprintln!("skip: silverbullet server binary not built (run `make build-rs` or `cargo build --workspace`)");
        return;
    };

    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["--url", &base, "eval", "1+1"], cfg.path());
    let _ = child.kill();

    assert_ne!(out.code, 0, "expected non-zero exit (runtime disabled)");
    assert!(
        out.stderr.to_lowercase().contains("not enabled")
            || out.stderr.to_lowercase().contains("runtime"),
        "expected a runtime-not-enabled error, got stderr: {:?}",
        out.stderr
    );
}
