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

/// Guard for the headless-Chrome runtime e2e tests: `true` when the server
/// they spawn will be able to find a browser, `false` when the test should skip.
///
/// The precedence deliberately mirrors `ChromeConfig::from_env` —
/// `SB_CHROME_PATH`, then `CHROMIUM_PATH`, then auto-detection — because that is
/// what the *spawned server* uses. A guard that consults only `find_chrome()`
/// answers a different question: it would skip on a machine where
/// `CHROMIUM_PATH` points at a perfectly good browser (Playwright installs into
/// `~/.cache/ms-playwright/…`, which `find_chrome` does not probe), so pointing
/// CI at Playwright's chromium would not actually stop these tests skipping.
///
/// And in CI a skip is fatal, not a courtesy: `release` and `docker` gate on
/// this job, so a run that skips its way to green would ship code that nothing
/// exercised. Locally, skipping is still the right behaviour — not every
/// developer has Chrome.
///
/// Not used by every test binary that includes this module, hence the `allow`.
#[allow(dead_code)]
pub fn chrome_available_or_skip(test_name: &str) -> bool {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    if env("SB_CHROME_PATH").is_some()
        || env("CHROMIUM_PATH").is_some()
        || silverbullet_server_runtime_chrome::find_chrome().is_some()
    {
        return true;
    }
    if std::env::var("CI").is_ok() {
        panic!(
            "{test_name}: no Chrome/Chromium found — SB_CHROME_PATH, CHROMIUM_PATH and \
             auto-detection all came up empty. Refusing to skip in CI: this job gates the \
             release and docker publishes, so a skipped run would ship untested code."
        );
    }
    eprintln!("skipping {test_name}: no Chrome/Chromium found on this machine");
    false
}
