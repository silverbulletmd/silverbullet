use std::path::Path;
use std::process::Stdio;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use super::limits;
use crate::{RequestCx, SearchError};

#[derive(Debug, Default)]
pub struct ExecOutput {
    /// `None` when the process was killed (deadline, cancellation, output cap)
    /// or did not exit in time: the status then says nothing about the search.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
    pub timed_out: bool,
}

/// Arguments placed before any caller-supplied ones. `args::parse` refuses
/// every flag that could override them.
pub fn enforced_args() -> Vec<String> {
    vec![
        "--no-config".into(),
        "--no-ignore-global".into(),
        "--no-ignore-parent".into(),
        "--threads=1".into(),
        "--regex-size-limit=1M".into(),
        "--dfa-size-limit=1M".into(),
        format!("--max-filesize={}", limits::MAX_FILE_BYTES),
        format!("--max-columns={}", limits::MAX_COLUMNS),
        "--path-separator=/".into(),
    ]
}

/// Reads `stream` until EOF or `cap` bytes. `hit_cap` is set the moment the cap
/// is reached so it survives the surrounding future being dropped.
async fn read_capped(
    mut stream: impl tokio::io::AsyncRead + Unpin,
    cap: usize,
    out: &mut Vec<u8>,
    hit_cap: &mut bool,
) -> std::io::Result<()> {
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        let room = cap - out.len();
        if n >= room {
            out.extend_from_slice(&buf[..room]);
            *hit_cap = true;
            return Ok(());
        }
        out.extend_from_slice(&buf[..n]);
    }
}

pub async fn run(
    binary: &Path,
    root: &Path,
    args: &[String],
    stdin: Option<Vec<u8>>,
    cx: &RequestCx,
) -> Result<ExecOutput, SearchError> {
    run_capped(binary, root, limits::MAX_OUTPUT_BYTES, args, stdin, cx).await
}

/// `run` with stdout capped at `cap` bytes (tests use a small cap).
async fn run_capped(
    binary: &Path,
    root: &Path,
    cap: usize,
    args: &[String],
    stdin: Option<Vec<u8>>,
    cx: &RequestCx,
) -> Result<ExecOutput, SearchError> {
    let (out, cancelled) = run_inner(binary, root, cap, args, stdin, cx)
        .await
        .map_err(|e| SearchError::Failed(e.to_string()))?;
    if cancelled {
        return Err(SearchError::Cancelled);
    }
    Ok(out)
}

async fn run_inner(
    binary: &Path,
    root: &Path,
    cap: usize,
    args: &[String],
    stdin: Option<Vec<u8>>,
    cx: &RequestCx,
) -> std::io::Result<(ExecOutput, bool)> {
    let mut command = Command::new(binary);
    command
        .args(enforced_args())
        .args(args)
        .current_dir(root)
        .env_clear()
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        let cpu = limits::CPU_SECONDS as libc::rlim_t;
        // SAFETY: only async-signal-safe libc calls run between fork and exec;
        // their results are deliberately ignored (limits are best effort).
        unsafe {
            command.pre_exec(move || {
                libc::setpriority(libc::PRIO_PROCESS as _, 0, limits::NICENESS);
                let limit = libc::rlimit {
                    rlim_cur: cpu,
                    rlim_max: cpu,
                };
                libc::setrlimit(libc::RLIMIT_CPU as _, &limit);
                Ok(())
            });
        }
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let input = child.stdin.take();

    let mut out = ExecOutput::default();
    // Buffers live outside the select so output gathered before a deadline or
    // cancellation is kept.
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut truncated = false;
    let mut ignored = false;
    let mut cancelled = false;
    let outcome = {
        let work = async {
            let write = async {
                if let (Some(mut pipe), Some(data)) = (input, stdin) {
                    if let Err(e) = pipe.write_all(&data).await {
                        if e.kind() != std::io::ErrorKind::BrokenPipe {
                            return Err(e);
                        }
                    }
                }
                Ok(())
            };
            tokio::try_join!(
                read_capped(stdout, cap, &mut stdout_buf, &mut truncated),
                read_capped(stderr, 64 * 1024, &mut stderr_buf, &mut ignored),
                write
            )?;
            Ok::<_, std::io::Error>(())
        };
        tokio::select! {
            result = work => Some(result),
            _ = tokio::time::sleep_until(cx.deadline) => { out.timed_out = true; None }
            _ = cx.cancel.cancelled() => { cancelled = true; None }
        }
    };
    if let Some(result) = outcome {
        result?;
    }
    out.truncated = truncated;
    // The reader stops at the cap without draining, so kill before waiting or
    // a still-writing child could block on a full pipe.
    let killed = out.truncated || out.timed_out || cancelled;
    if killed {
        let _ = child.start_kill();
    }
    // A child that closed its pipes but keeps running must not hang the
    // request; kill_on_drop reaps it when `child` drops.
    // A normally finishing child may need the rest of the request's time on a
    // loaded machine; a killed one only needs to be reaped.
    let grace = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    let wait_until = if killed {
        grace
    } else {
        std::cmp::max(cx.deadline, grace)
    };
    if let Ok(status) = tokio::time::timeout_at(wait_until, child.wait()).await {
        let status = status?;
        if !killed {
            out.code = status.code();
        }
    }
    out.stdout = stdout_buf;
    out.stderr = stderr_buf;
    Ok((out, cancelled))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{Admission, Gate, RequestCx, SearchError};
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    fn script(dir: &Path, body: &str) -> std::path::PathBuf {
        let path = dir.join("fake-rg");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn cx(ms: u64) -> RequestCx {
        RequestCx::unlimited(Duration::from_millis(ms))
    }

    /// A small output cap, so the cap tests stay fast.
    const CAP: usize = 1024;

    #[tokio::test]
    async fn returns_output_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "echo found; exit 1");
        let out = run_capped(&bin, dir.path(), CAP, &[], None, &cx(5000))
            .await
            .unwrap();
        assert_eq!(out.code, Some(1));
        assert_eq!(out.stdout, b"found\n");
        assert!(!out.timed_out && !out.truncated);
    }

    #[tokio::test]
    async fn kills_the_process_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "echo early; sleep 30");
        let started = std::time::Instant::now();
        let out = run_capped(&bin, dir.path(), CAP, &[], None, &cx(500))
            .await
            .unwrap();
        assert!(out.timed_out);
        assert_eq!(out.stdout, b"early\n");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn stops_reading_at_the_output_cap() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "yes match");
        let out = run_capped(&bin, dir.path(), CAP, &[], None, &cx(10_000))
            .await
            .unwrap();
        assert!(out.truncated);
        assert_eq!(out.stdout.len(), 1024);
    }

    #[tokio::test]
    async fn a_superseded_request_kills_its_process() {
        let gate = Gate::new();
        let query = || Admission {
            space: "s",
            user: Some("alice"),
            writer: true,
            tab: "tab-1",
            supersede: true,
            deadline: Duration::from_secs(20),
        };
        let rcx = gate.admit(query()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "sleep 30");
        let running = run(&bin, dir.path(), &[], None, &rcx);
        tokio::pin!(running);
        tokio::select! {
            _ = &mut running => panic!("finished before being superseded"),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
        let _newer = gate.admit(query()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), running)
            .await
            .unwrap();
        assert!(
            matches!(result, Err(SearchError::Cancelled)),
            "got {result:?}"
        );
    }

    #[tokio::test]
    async fn passes_stdin_and_runs_with_a_clean_environment() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "cat; echo \"[$HOME]\"");
        let out = run_capped(
            &bin,
            dir.path(),
            CAP,
            &[],
            Some(b"pattern\n".to_vec()),
            &cx(5000),
        )
        .await
        .unwrap();
        assert_eq!(out.stdout, b"pattern\n[]\n");
    }

    #[tokio::test]
    async fn keeps_truncated_when_the_deadline_fires_afterwards() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "yes match | head -c 4096; exec sleep 30");
        let out = run_capped(&bin, dir.path(), CAP, &[], None, &cx(500))
            .await
            .unwrap();
        assert!(out.truncated && out.timed_out);
        assert_eq!(out.code, None);
    }

    #[tokio::test]
    async fn run_prepends_the_enforced_args() {
        let dir = tempfile::tempdir().unwrap();
        let bin = script(dir.path(), "echo \"$@\"");
        let out = run(&bin, dir.path(), &["--files".to_string()], None, &cx(5000))
            .await
            .unwrap();
        let printed = String::from_utf8(out.stdout).unwrap();
        for expected in ["--no-config", "--threads=1", "--files"] {
            assert!(
                printed.contains(expected),
                "missing {expected} in {printed}"
            );
        }
        assert!(printed.find("--no-config") < printed.find("--files"));
    }

    #[test]
    fn enforced_args_carry_the_resource_limits() {
        let args = enforced_args();
        for expected in [
            "--no-config",
            "--threads=1",
            "--regex-size-limit=1M",
            "--dfa-size-limit=1M",
            "--max-filesize=1048576",
            "--max-columns=500",
            "--path-separator=/",
        ] {
            assert!(args.iter().any(|a| a == expected), "missing {expected}");
        }
    }
}
