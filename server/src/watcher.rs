//! File-system watcher backing the `/.events` SSE endpoint.
//!
//! notify (OS watcher) -> mpsc -> debounce/coalesce thread -> validation via
//! DiskSpacePrimitives (same visibility rules as the /.fs API) -> tokio
//! broadcast channel consumed by SSE subscribers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tokio::sync::broadcast;

use silverbullet_server_common::space::disk::DiskSpacePrimitives;
use silverbullet_server_common::SpaceError;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FsEvent {
    pub name: String,
    pub action: FsAction,
    #[serde(rename = "lastModified")]
    pub last_modified: i64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FsAction {
    Change,
    Delete,
    /// Too many changes to enumerate (bulk rewrite, git checkout): clients
    /// should run a full file-list refresh instead of per-file handling.
    /// Sent with an empty `name` and `last_modified: 0`.
    Resync,
}

/// Watcher backend selection, from `SB_FS_WATCH`.
/// `Auto` = native OS watcher (inotify/FSEvents/Windows). `Poll` = notify's
/// PollWatcher (~2s mtime scan) for network mounts (NFS/SMB/FUSE) where writes
/// from other machines produce no native events. `Off` = no watcher; the
/// /.events endpoint 404s and clients rely on their own polling.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WatchMode {
    Auto,
    Poll,
    Off,
}

impl WatchMode {
    pub fn from_env() -> Self {
        match std::env::var("SB_FS_WATCH").as_deref() {
            Ok("poll") => WatchMode::Poll,
            Ok("off") => WatchMode::Off,
            Ok("auto") | Err(_) => WatchMode::Auto,
            Ok(other) => {
                tracing::warn!("Unknown SB_FS_WATCH value {other:?}, using auto");
                WatchMode::Auto
            }
        }
    }
}

const DEBOUNCE: Duration = Duration::from_millis(75);
/// A single debounce flush holding more than this many paths collapses into
/// one Resync event (flood control).
const FLOOD_THRESHOLD: usize = 20;
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const CHANNEL_CAPACITY: usize = 256;
/// Minimum gap between logged watcher-callback errors, so a sustained
/// failure (e.g. an exhausted inotify watch limit, which can otherwise
/// re-fire on every subsequent fs change) doesn't flood the log.
const ERROR_LOG_INTERVAL: Duration = Duration::from_secs(30);
/// How long the debounce loop can block when idle before re-checking whether
/// its broadcast::WeakSender has been abandoned (see debounce_loop's comment
/// on why that check, not mpsc disconnection, is what ends this thread).
const ABANDONMENT_CHECK_INTERVAL: Duration = Duration::from_secs(2);

/// Start watching `root`. Returns the broadcast sender (subscribe for events),
/// or None if the watcher is off or could not be started (callers degrade to
/// polling). `gitignore` must match the space's configured ignore rules, so
/// watcher visibility agrees with the /.fs API.
pub fn start_watcher(
    root: &Path,
    gitignore: &str,
    mode: WatchMode,
) -> Option<broadcast::Sender<FsEvent>> {
    if mode == WatchMode::Off {
        return None;
    }
    // Canonicalize so that native backends (which report resolved paths) and
    // our prefix-stripping agree even when the space root is reached through a
    // symlink (macOS /tmp -> /private/tmp, ~/notes -> /Volumes/...).
    let root = match std::fs::canonicalize(root) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Not starting fs watcher, cannot canonicalize root: {e}");
            return None;
        }
    };
    let validator = match DiskSpacePrimitives::new(&root, gitignore) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Not starting fs watcher, disk primitives failed: {e}");
            return None;
        }
    };
    let (broadcast_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
    let (raw_tx, raw_rx) = mpsc::channel::<PathBuf>();

    let watcher_tx = raw_tx.clone();
    let mut last_error_log: Option<Instant> = None;
    // Only the path is forwarded, not the raw event kind: the debounce loop
    // decides Change vs. Delete from actual on-disk state at flush time (see
    // its comment) rather than trusting which notify::EventKind fired.
    let event_handler = move |res: notify::Result<Event>| {
        let event = match res {
            Ok(event) => event,
            Err(e) => {
                let now = Instant::now();
                let should_log = last_error_log
                    .map(|t| now.duration_since(t) >= ERROR_LOG_INTERVAL)
                    .unwrap_or(true);
                if should_log {
                    tracing::warn!("fs watcher error: {e}");
                    last_error_log = Some(now);
                }
                return;
            }
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in event.paths {
            let _ = watcher_tx.send(path);
        }
    };

    // Both variants are kept alive by moving them into the debounce thread;
    // neither field is read again, only dropped when the thread exits.
    #[allow(dead_code)]
    enum AnyWatcher {
        Native(notify::RecommendedWatcher),
        Poll(notify::PollWatcher),
    }
    let watcher = match mode {
        WatchMode::Auto => match notify::recommended_watcher(event_handler) {
            Ok(mut w) => match w.watch(&root, RecursiveMode::Recursive) {
                Ok(()) => AnyWatcher::Native(w),
                Err(e) => {
                    tracing::warn!("Not starting fs watcher: {e}");
                    return None;
                }
            },
            Err(e) => {
                tracing::warn!("Not starting fs watcher: {e}");
                return None;
            }
        },
        WatchMode::Poll => {
            let config = notify::Config::default().with_poll_interval(POLL_INTERVAL);
            match notify::PollWatcher::new(event_handler, config) {
                Ok(mut w) => match w.watch(&root, RecursiveMode::Recursive) {
                    Ok(()) => AnyWatcher::Poll(w),
                    Err(e) => {
                        tracing::warn!("Not starting poll watcher: {e}");
                        return None;
                    }
                },
                Err(e) => {
                    tracing::warn!("Not starting poll watcher: {e}");
                    return None;
                }
            }
        }
        WatchMode::Off => unreachable!(),
    };

    // A *weak* handle, not a clone: the notify Watcher captured below (via
    // event_handler) owns the only remaining mpsc::Sender clone once this
    // function returns, so the mpsc channel this thread reads from can never
    // disconnect on its own — if this were a strong Sender clone, dropping
    // the Sender this function returns would do nothing, and every watcher
    // ever started would leak its thread and OS watch for the life of the
    // process. debounce_loop instead notices abandonment by finding no
    // strong Sender left to upgrade to.
    let weak_out = broadcast_tx.downgrade();
    std::thread::Builder::new()
        .name("sb-fs-watcher".into())
        .spawn(move || {
            // Keep the OS watcher alive for the lifetime of this thread
            let _watcher = watcher;
            debounce_loop(&root, &validator, raw_rx, weak_out);
        })
        .ok()?;

    Some(broadcast_tx)
}

fn debounce_loop(
    root: &Path,
    validator: &DiskSpacePrimitives,
    rx: mpsc::Receiver<PathBuf>,
    out: broadcast::WeakSender<FsEvent>,
) {
    // Pending space-relative paths, with the time they last fired
    let mut pending: HashMap<String, Instant> = HashMap::new();
    loop {
        // The mpsc channel above never disconnects on its own: the notify
        // Watcher that keeps this thread's OS watch alive holds the only
        // other clone of its Sender, and that Watcher lives on *this same
        // thread* (see start_watcher). So this upgrade is the only signal
        // this thread gets that the caller dropped the Sender it was
        // returned (e.g. its ServerState was rebuilt or torn down) and it's
        // time to exit, releasing the OS watch with it. The upgraded Sender
        // is only held for this one iteration — reobtained every loop so a
        // held clone here never itself props up the strong count.
        let Some(sender) = out.upgrade() else {
            return;
        };
        let timeout = if pending.is_empty() {
            ABANDONMENT_CHECK_INTERVAL
        } else {
            Duration::from_millis(25)
        };
        match rx.recv_timeout(timeout) {
            Ok(abs) => {
                if let Some(rel) = to_space_path(root, &abs) {
                    pending.insert(rel, Instant::now());
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        let now = Instant::now();
        let ready: Vec<String> = pending
            .iter()
            .filter(|(_, t)| now.duration_since(**t) >= DEBOUNCE)
            .map(|(k, _)| k.clone())
            .collect();
        if ready.is_empty() {
            continue;
        }
        // Built once per flush (not per path): cheap enough for a handful of
        // ready paths and keeps the watcher aligned with fetch_file_list.
        let gitignore = validator.gitignore_matcher();
        // Resolve every ready path into the event it would produce *before*
        // deciding whether this is a flood: otherwise the flood count
        // includes paths that were never visible over /.fs in the first
        // place (a whole configured-ignored directory churning, e.g. node_modules/,
        // shouldn't be able to trigger a Resync that makes every client
        // refetch its file list). get_file_meta_if_listable folds in the
        // same directory/no-extension rules fetch_file_list applies, in one
        // stat call, so this is exactly the set of events fetch_file_list
        // would agree exist.
        let mut events = Vec::new();
        for name in ready {
            pending.remove(&name);
            if gitignore.is_ignored(&name, false) {
                continue;
            }
            // Change vs. Delete is decided from current on-disk state, not
            // from which notify::EventKind fired: native backends can
            // reorder or replay events (e.g. macOS FSEvents re-delivering a
            // stale Modify after a genuine Remove for a path that existed
            // before the watch started), so the raw event kind alone is not
            // a reliable signal.
            match validator.get_file_meta_if_listable(&name) {
                Ok(Some(meta)) => events.push(FsEvent {
                    name,
                    action: FsAction::Change,
                    last_modified: meta.last_modified,
                }),
                Ok(None) => {} // directory, extensionless, or a stale casing: not a space file
                Err(SpaceError::NotFound) => events.push(FsEvent {
                    name,
                    action: FsAction::Delete,
                    last_modified: 0,
                }),
                Err(_) => {}
            }
        }
        if events.len() > FLOOD_THRESHOLD {
            // Flood: tell clients to re-list instead of replaying each event
            let _ = sender.send(FsEvent {
                name: String::new(),
                action: FsAction::Resync,
                last_modified: 0,
            });
            continue;
        }
        for ev in events {
            // Err just means no subscribers; fine
            let _ = sender.send(ev);
        }
    }
}

/// Absolute path -> space-relative path with forward slashes, or None for
/// paths outside the root or with hidden (dot-prefixed) components.
fn to_space_path(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for comp in rel.components() {
        let s = comp.as_os_str().to_str()?;
        if s.starts_with('.') {
            return None;
        }
        parts.push(s);
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn debounce_loop_exits_when_broadcast_sender_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let validator = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        let root = dir.path().to_path_buf();
        let (raw_tx, raw_rx) = mpsc::channel::<PathBuf>();
        let (broadcast_tx, _) = broadcast::channel::<FsEvent>(16);
        let weak_out = broadcast_tx.downgrade();

        // Mirrors start_watcher's real ownership shape: the thread also
        // holds its own clone of the mpsc sender (standing in for notify's
        // Watcher/event-handler closure), so the mpsc channel can never
        // disconnect on its own — termination has to come from noticing the
        // broadcast Sender is gone via the WeakSender, not from
        // mpsc::RecvTimeoutError::Disconnected.
        let thread_mpsc_tx = raw_tx.clone();
        let handle = std::thread::spawn(move || {
            let _keep_alive = thread_mpsc_tx;
            debounce_loop(&root, &validator, raw_rx, weak_out);
        });

        drop(broadcast_tx);

        let (done_tx, done_rx) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let _ = handle.join();
            let _ = done_tx.send(());
        });
        assert!(
            done_rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "debounce_loop thread did not exit after its broadcast Sender was dropped"
        );
    }

    #[tokio::test]
    async fn emits_change_event_for_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).expect("watcher should start");
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join("test.md"), b"hello").unwrap();
        let ev = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("timed out waiting for event")
            .unwrap();
        assert_eq!(ev.name, "test.md");
        assert_eq!(ev.action, FsAction::Change);
        assert!(ev.last_modified > 0);
    }

    #[tokio::test]
    async fn ignores_hidden_files() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join(".hidden"), b"x").unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for dotfile");
    }

    #[tokio::test]
    async fn ignores_gitignored_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("build")).unwrap();
        let tx = start_watcher(dir.path(), "build/", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join("build/output.js"), b"x").unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for gitignored path");
    }

    #[tokio::test]
    async fn ignores_new_directories() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for a new directory");
    }

    #[tokio::test]
    async fn ignores_extensionless_files() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join("Makefile"), b"x").unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for an extensionless file");
    }

    #[tokio::test]
    async fn emits_delete_event() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("gone.md");
        std::fs::write(&p, b"x").unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::remove_file(&p).unwrap();
        // Drain until we see the delete (creation may race in on some platforms)
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let ev = tokio::time::timeout(remaining, rx.recv())
                .await
                .expect("timed out waiting for delete")
                .unwrap();
            if ev.action == FsAction::Delete {
                assert_eq!(ev.name, "gone.md");
                break;
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn works_with_symlinked_root() {
        let real = tempfile::tempdir().unwrap();
        let linkdir = tempfile::tempdir().unwrap();
        let link = linkdir.path().join("space-link");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        // Watch via the symlink; write via the symlink; expect the event to
        // arrive with a correctly-relativized name (canonicalization at work)
        let tx = start_watcher(&link, "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(link.join("linked.md"), b"via symlink").unwrap();
        let ev = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("no event through symlinked root")
            .unwrap();
        assert_eq!(ev.name, "linked.md");
    }

    /// A case-only rename delivers OS events for both the old and new
    /// casing on a case-insensitive filesystem, and `fs::metadata` still
    /// resolves the old casing through the alias. The watcher must not
    /// report the stale casing, since `fetch_file_list` (which walks true
    /// directory entries) will never list it — that mismatch is what lets a
    /// client's snapshot grow a phantom file. Gated to macOS so the test is
    /// absent rather than vacuous where it can't exercise the aliasing.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn case_only_rename_never_emits_the_stale_casing() {
        let dir = tempfile::tempdir().unwrap();
        let probe = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        if !probe.is_case_insensitive() {
            return; // opted-out case-sensitive APFS volume
        }
        std::fs::write(dir.path().join("Foo.md"), b"x").unwrap();

        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        std::fs::rename(dir.path().join("Foo.md"), dir.path().join("foo.md")).unwrap();

        // The OS delivers events for both the old and new path on a
        // case-only rename; drain until we see the new casing, while
        // asserting the stale one never appears.
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            assert!(
                !remaining.is_zero(),
                "never saw an event for the renamed file under its new casing"
            );
            let ev = tokio::time::timeout(remaining, rx.recv())
                .await
                .expect("timed out waiting for rename events")
                .unwrap();
            assert_ne!(
                ev.name, "Foo.md",
                "watcher emitted the stale casing, which /.fs will never list"
            );
            if ev.name == "foo.md" {
                break;
            }
        }
    }

    #[tokio::test]
    async fn poll_mode_detects_changes() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Poll).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join("polled.md"), b"hello").unwrap();
        // Poll interval is ~2s; allow two cycles
        let ev = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("poll watcher did not report change")
            .unwrap();
        assert_eq!(ev.name, "polled.md");
        assert_eq!(ev.action, FsAction::Change);
    }

    #[tokio::test]
    async fn off_mode_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(start_watcher(dir.path(), "", WatchMode::Off).is_none());
    }

    #[tokio::test]
    async fn flood_collapses_into_resync() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        for i in 0..40 {
            std::fs::write(dir.path().join(format!("f{i}.md")), b"x").unwrap();
        }
        // A few individual events may precede the flood accumulating; require
        // that a Resync arrives and that we never see all 40 enumerated
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut individual = 0;
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let ev = tokio::time::timeout(remaining, rx.recv())
                .await
                .expect("timed out waiting for resync")
                .unwrap();
            if ev.action == FsAction::Resync {
                break;
            }
            individual += 1;
            assert!(individual < 40, "flood was fully enumerated, no resync");
        }
    }

    #[tokio::test]
    async fn coalesces_rapid_writes() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(dir.path(), "", WatchMode::Auto).unwrap();
        let mut rx = tx.subscribe();
        for i in 0..5 {
            std::fs::write(dir.path().join("burst.md"), format!("v{i}")).unwrap();
        }
        // First event arrives...
        tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap()
            .unwrap();
        // ...then silence within a coalescing window (few or no trailing events; must not be 5)
        let mut extra = 0;
        while tokio::time::timeout(Duration::from_millis(300), rx.recv())
            .await
            .is_ok()
        {
            extra += 1;
        }
        assert!(extra < 4, "expected coalescing, got {extra} extra events");
    }
}
