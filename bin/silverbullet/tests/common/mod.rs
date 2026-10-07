//! Helpers shared by the integration tests. Lives in a subdirectory of
//! `tests/` so cargo treats it as a module to include rather than as its own
//! test binary. `bin/sb`'s tests pull it in with an explicit `#[path]`.

use std::collections::HashSet;
use std::net::TcpListener;
use std::sync::Mutex;

/// Ports already handed out in this process.
static ISSUED: Mutex<Option<HashSet<u16>>> = Mutex::new(None);

/// An unused TCP port for a server under test.
///
/// Binding `127.0.0.1:0` asks the OS for a free ephemeral port, but the
/// listener has to be dropped before the child process can bind it — and the
/// moment it is, the OS may hand that same port to the very next caller.
/// Tests within one binary run in parallel threads, so two of them racing here
/// would both be told to use the same port and the second server to start
/// would die with "Address already in use".
///
/// Remembering every port we've issued closes that same-binary race, which is
/// the dominant one. The bind probe itself covers the cross-binary case: a
/// port another test binary's server currently holds won't bind, so the OS
/// won't offer it. What remains is a narrow window (probe close → child bind)
/// against a *different* test binary picking that exact port; retrying keeps
/// that from being fatal here, and it is orders of magnitude rarer.
pub fn free_port() -> u16 {
    for _ in 0..100 {
        let port = TcpListener::bind("127.0.0.1:0")
            .expect("bind an ephemeral port")
            .local_addr()
            .expect("read the bound address")
            .port();
        // Tolerate a poisoned lock: a test panicking elsewhere says nothing
        // about the integrity of this set.
        let mut guard = ISSUED.lock().unwrap_or_else(|e| e.into_inner());
        if guard.get_or_insert_with(HashSet::new).insert(port) {
            return port;
        }
    }
    panic!("no unused port found after 100 attempts");
}

/// Opt-in for running the runtime e2e tests against a browser installed for
/// everyday use (see [`test_chrome_or_skip`]).
#[allow(dead_code)]
pub const ALLOW_SYSTEM_CHROME: &str = "SB_TEST_ALLOW_SYSTEM_CHROME";

/// Browser for the headless-Chrome runtime e2e tests, or `None` when the test
/// should skip. Pass the result to the spawned server as `SB_CHROME_PATH`.
///
/// Only an explicit `SB_CHROME_PATH` (then `CHROMIUM_PATH`) counts: the tests
/// never fall back to auto-detection, which on a developer's Mac finds
/// `/Applications/Google Chrome.app`. A headless instance of that bundle that
/// outlives its test takes over the developer's real Chrome, so such paths are
/// refused too unless `SB_TEST_ALLOW_SYSTEM_CHROME=1`. Point the variable at a
/// `chrome-headless-shell` instead.
///
/// In CI a skip is fatal, not a courtesy: `release` and `docker` gate on this
/// job, so a run that skips its way to green would ship code that nothing
/// exercised. Locally, skipping is the right behaviour.
#[allow(dead_code)]
pub fn test_chrome_or_skip(test_name: &str) -> Option<String> {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let allow_system = env(ALLOW_SYSTEM_CHROME).as_deref() == Some("1");
    match resolve_test_chrome(env("SB_CHROME_PATH"), env("CHROMIUM_PATH"), allow_system) {
        Ok(path) => Some(path),
        Err(reason) => {
            if std::env::var("CI").is_ok() {
                panic!(
                    "{test_name}: {reason}. Refusing to skip in CI: this job gates the release \
                     and docker publishes, so a skipped run would ship untested code."
                );
            }
            eprintln!("skipping {test_name}: {reason}");
            None
        }
    }
}

/// Pure policy behind [`test_chrome_or_skip`].
#[allow(dead_code)]
pub fn resolve_test_chrome(
    sb_chrome_path: Option<String>,
    chromium_path: Option<String>,
    allow_system: bool,
) -> Result<String, String> {
    let Some(path) = sb_chrome_path.or(chromium_path) else {
        return Err(
            "SB_CHROME_PATH/CHROMIUM_PATH not set (tests never auto-detect a \
                    browser; point SB_CHROME_PATH at a chrome-headless-shell)"
                .into(),
        );
    };
    if !allow_system && silverbullet_server_runtime_chrome::is_system_browser(&path) {
        return Err(format!(
            "refusing system browser {path:?}: a leftover headless instance of it would take \
             over your own Chrome. Use a chrome-headless-shell, or set \
             {ALLOW_SYSTEM_CHROME}=1 to override"
        ));
    }
    Ok(path)
}

/// Put the server in its own process group, so [`stop_server`] can reach the
/// browser processes it spawned even if it dies without cleaning up.
#[allow(dead_code)]
pub fn own_process_group(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

/// Ask a server to shut down the way an operator would (SIGTERM) and wait up
/// to `grace` for it to exit. Returns whether it exited.
#[allow(dead_code)]
pub fn terminate(child: &mut std::process::Child, grace: std::time::Duration) -> bool {
    if child.try_wait().ok().flatten().is_some() {
        return true;
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status();
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    false
}

/// SIGKILL a server spawned with [`own_process_group`] together with
/// everything left in its process group, then reap it.
#[allow(dead_code)]
pub fn kill_group(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// [`terminate`], then [`kill_group`]: what a test's `Drop` should do so a
/// panicking test still leaves no server or browser behind.
#[allow(dead_code)]
pub fn stop_server(child: &mut std::process::Child) {
    terminate(child, std::time::Duration::from_secs(10));
    kill_group(child);
}

/// PIDs and command lines of browser processes started with a profile under
/// `profile_root` (the server's `SB_CHROME_DATA_DIR`). Unique per test, so
/// browsers of concurrently running tests are never counted.
#[allow(dead_code)]
pub fn browsers_using(profile_root: &std::path::Path) -> Vec<(u32, String)> {
    if !cfg!(unix) {
        return Vec::new();
    }
    let Ok(out) = std::process::Command::new("ps")
        .args(["-axww", "-o", "pid=,command="])
        .output()
    else {
        return Vec::new();
    };
    let needle = format!("--user-data-dir={}", profile_root.display());
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|line| line.contains(&needle))
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(' ')?;
            Some((pid.parse().ok()?, command.to_string()))
        })
        .collect()
}

/// Browser processes launched for `profile_root` that are still running once
/// their server has exited, after giving them a few seconds to wind down.
/// Formatted for a failure message; empty means nothing leaked.
#[allow(dead_code)]
pub fn leftover_browsers(profile_root: &std::path::Path) -> Vec<String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut left = browsers_using(profile_root);
    while !left.is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(100));
        left = browsers_using(profile_root);
    }
    left.iter()
        .map(|(pid, command)| format!("{pid} {}", command.chars().take(160).collect::<String>()))
        .collect()
}

/// Kill every browser process launched for `profile_root`.
#[allow(dead_code)]
pub fn kill_browsers(profile_root: &std::path::Path) {
    for (pid, _) in browsers_using(profile_root) {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }
}
