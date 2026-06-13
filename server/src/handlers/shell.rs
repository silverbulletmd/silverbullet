use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::router::run_blocking;
use crate::state::ServerState;

#[derive(serde::Deserialize)]
struct ShellRequest {
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
    stdin: Option<String>,
}

#[derive(serde::Serialize)]
struct ShellResponse {
    stdout: String,
    stderr: String,
    code: i32,
}

fn err_response(status: StatusCode, message: &str) -> (StatusCode, axum::Json<ShellResponse>) {
    (
        status,
        axum::Json(ShellResponse {
            stdout: String::new(),
            stderr: message.into(),
            code: -1,
        }),
    )
}

pub async fn handle_shell(
    State(state): State<Arc<ServerState>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if state.boot_config.read_only {
        return err_response(StatusCode::METHOD_NOT_ALLOWED, "Read-only mode");
    }
    if !state.shell.enabled {
        return err_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Shell commands are disabled",
        );
    }
    let request: ShellRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => return err_response(StatusCode::BAD_REQUEST, &format!("Invalid JSON: {e}")),
    };
    if !state.shell.is_allowed(&request.cmd) {
        return (
            StatusCode::OK,
            axum::Json(ShellResponse {
                stdout: String::new(),
                stderr: "Not allowed, command not in whitelist".into(),
                code: -1,
            }),
        );
    }

    let cwd = state.space_folder_path.clone();
    let result = run_blocking(move || Ok(run_command(request, &cwd))).await;
    match result {
        Ok(resp) => {
            // Count only commands that passed validation and actually ran
            // (increment after execution, not on every POST).
            if let Some(metrics) = state.metrics.as_ref() {
                metrics.shell_executions.inc();
            }
            (StatusCode::OK, axum::Json(resp))
        }
        // run_blocking only errors on a join failure; surface as a shell error.
        Err(e) => err_response(StatusCode::OK, &e.to_string()),
    }
}

/// Upper bound on a shell command's runtime. A hung command would otherwise
/// tie up a blocking-pool thread and its HTTP request indefinitely.
const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Read a child output pipe to completion on its own thread.
fn drain_pipe<R: std::io::Read + Send + 'static>(
    pipe: Option<R>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = pipe {
            let _ = r.read_to_end(&mut buf);
        }
        buf
    })
}

/// Run the command synchronously (on the blocking pool), capturing output.
///
/// stdin is fed from its own thread while stdout/stderr are drained
/// concurrently: writing stdin inline before reading output can deadlock
/// once the child fills the (~64KB) output pipe while still consuming its
/// input. The child is killed if it outlives `COMMAND_TIMEOUT`.
fn run_command(request: ShellRequest, cwd: &str) -> ShellResponse {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let spawn_failure = |e: std::io::Error| ShellResponse {
        stdout: String::new(),
        stderr: e.to_string(),
        code: -1,
    };

    tracing::info!("Running shell command: {} {:?}", request.cmd, request.args);
    let mut cmd = Command::new(&request.cmd);
    cmd.args(&request.args).current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.stdin(if request.stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return spawn_failure(e),
    };

    let stdin_writer = request.stdin.and_then(|data| {
        child.stdin.take().map(|mut stdin| {
            std::thread::spawn(move || {
                if let Err(e) = stdin.write_all(data.as_bytes()) {
                    tracing::warn!("Failed to write shell command stdin: {e}");
                }
                // `stdin` drops here, closing the pipe so the child sees EOF.
            })
        })
    });
    let stdout_handle = drain_pipe(child.stdout.take());
    let stderr_handle = drain_pipe(child.stderr.take());

    let start = std::time::Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if start.elapsed() >= COMMAND_TIMEOUT {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait();
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(e) => break Err(e),
        }
    };

    // Killing (or exiting) the child closes its pipes, so these all finish.
    if let Some(h) = stdin_writer {
        let _ = h.join();
    }
    let stdout = stdout_handle.join().unwrap_or_default();
    let mut stderr = stderr_handle.join().unwrap_or_default();
    if timed_out {
        if !stderr.is_empty() {
            stderr.push(b'\n');
        }
        stderr.extend_from_slice(
            format!(
                "Command timed out after {}s and was killed",
                COMMAND_TIMEOUT.as_secs()
            )
            .as_bytes(),
        );
    }

    match status {
        Ok(status) => ShellResponse {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            code: if timed_out {
                -1
            } else {
                status.code().unwrap_or(-1)
            },
        },
        Err(e) => ShellResponse {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: e.to_string(),
            code: -1,
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::shell::ShellConfig;
    use crate::state::ServerState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    fn state_with(shell: ShellConfig, read_only: bool) -> Arc<ServerState> {
        let mut s = test_state();
        s.shell = shell;
        s.boot_config.read_only = read_only;
        Arc::new(s)
    }

    async fn post_shell(state: Arc<ServerState>, json: &str) -> (StatusCode, String) {
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.shell")
                    .body(Body::from(json.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn read_only_rejects() {
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            true,
        );
        let (status, _) = post_shell(st, r#"{"cmd":"echo","args":["hi"]}"#).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn disabled_rejects() {
        let st = state_with(ShellConfig::disabled(), false);
        let (status, _) = post_shell(st, r#"{"cmd":"echo","args":["hi"]}"#).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn non_whitelisted_command_is_refused() {
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec!["git".into()],
            },
            false,
        );
        let (status, body) = post_shell(st, r#"{"cmd":"rm","args":["-rf","/"]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("whitelist"), "got: {body}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_an_allowed_command() {
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            false,
        );
        let (status, body) = post_shell(st, r#"{"cmd":"echo","args":["hello"]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("hello"), "got: {body}");
        assert!(body.contains("\"code\":0"), "got: {body}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pipes_stdin_to_the_command() {
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            false,
        );
        // `cat` with no args echoes its stdin to stdout.
        let (status, body) =
            post_shell(st, r#"{"cmd":"cat","args":[],"stdin":"piped-in-data"}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body.contains("piped-in-data"),
            "stdout should echo stdin: {body}"
        );
        assert!(body.contains("\"code\":0"), "got: {body}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn large_stdin_does_not_deadlock() {
        // Regression: stdin used to be written to completion before any
        // output was drained; with more than ~2 pipe buffers (~128KB)
        // round-tripped through `cat`, parent and child would block on each
        // other's full pipes forever. stdin now feeds from its own thread.
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            false,
        );
        let big = "x".repeat(256 * 1024);
        let cmd = serde_json::json!({"cmd":"cat","args":[],"stdin":big}).to_string();
        let (status, body) = post_shell(st, &cmd).await;
        assert_eq!(status, StatusCode::OK);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["stdout"].as_str().unwrap().len(), 256 * 1024);
        assert_eq!(v["code"], 0);
    }

    /// Build state whose space folder (the shell cwd) is `cwd`, with shell on.
    fn state_in_dir(cwd: &str) -> Arc<ServerState> {
        let mut s = test_state();
        s.shell = ShellConfig {
            enabled: true,
            whitelist: vec![],
        };
        s.space_folder_path = cwd.to_string();
        Arc::new(s)
    }

    // A nonexistent command returns an exit code of -1 rather than erroring.
    #[tokio::test]
    async fn nonexistent_command_returns_minus_one() {
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            false,
        );
        let (status, body) = post_shell(st, r#"{"cmd":"nonexistent_cmd_12345","args":[]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body.contains("\"code\":-1"),
            "spawn failure → code -1: {body}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn whitelisted_command_is_allowed() {
        // A command on the whitelist is allowed to run.
        let st = state_with(
            ShellConfig {
                enabled: true,
                whitelist: vec!["echo".into()],
            },
            false,
        );
        let (status, body) = post_shell(st, r#"{"cmd":"echo","args":["ok"]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body.contains("ok") && body.contains("\"code\":0"),
            "got: {body}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_in_the_space_folder() {
        // The command's cwd is the space folder.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), b"x").unwrap();
        let st = state_in_dir(dir.path().to_str().unwrap());
        let (status, body) = post_shell(st, r#"{"cmd":"ls","args":[]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body.contains("marker.txt"),
            "ls should run in the space folder: {body}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn captures_both_stdout_and_stderr() {
        // Both stdout and stderr are captured.
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("both.sh");
        std::fs::write(&script, b"#!/bin/sh\necho out\necho err >&2\nexit 0\n").unwrap();
        let st = state_in_dir(dir.path().to_str().unwrap());
        let cmd = serde_json::json!({"cmd": "sh", "args": [script.to_str().unwrap()]}).to_string();
        let (status, body) = post_shell(st, &cmd).await;
        assert_eq!(status, StatusCode::OK);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["stdout"].as_str().unwrap().trim(), "out");
        assert_eq!(v["stderr"].as_str().unwrap().trim(), "err");
    }

    // The shell handler is cross-platform (the same `std::process::Command` path
    // the App uses, plus the `CREATE_NO_WINDOW` flag), so it must also work on
    // Windows. The exec logic (stdin piping, stream capture) is OS-agnostic and
    // already verified on Unix above; these confirm the `Command` + cwd path on
    // Windows itself. A real temp dir is used because the default test cwd is
    // Unix-style.
    #[cfg(windows)]
    #[tokio::test]
    async fn runs_an_allowed_command_windows() {
        let dir = tempfile::tempdir().unwrap();
        let st = state_in_dir(dir.path().to_str().unwrap());
        let (status, body) = post_shell(st, r#"{"cmd":"cmd","args":["/C","echo","hello"]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("hello"), "got: {body}");
        assert!(body.contains("\"code\":0"), "got: {body}");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn runs_in_the_space_folder_windows() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), b"x").unwrap();
        let st = state_in_dir(dir.path().to_str().unwrap());
        let (status, body) = post_shell(st, r#"{"cmd":"cmd","args":["/C","dir","/B"]}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            body.contains("marker.txt"),
            "dir should run in the space folder: {body}"
        );
    }
}
