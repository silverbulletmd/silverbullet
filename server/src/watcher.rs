//! File-system watcher backing the `/.events` SSE endpoint.
//!
//! notify (OS watcher) -> mpsc -> debounce/coalesce thread -> validation via
//! DiskSpacePrimitives (same visibility rules as the /.fs API) -> tokio
//! broadcast channel consumed by SSE subscribers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tokio::sync::broadcast;

use silverbullet_server_common::space::disk::DiskSpacePrimitives;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};

use crate::fs_guard::{ExpectedWrite, FsGuard};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FsEvent {
    pub name: String,
    pub action: FsAction,
    #[serde(rename = "lastModified")]
    pub last_modified: i64,
    /// Content revision, when known. Absent for a change event the guard
    /// couldn't hash, and for most deletes (see [`enrich_event`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<EventRevision>,
    /// Best-effort attribution, when known. Never load-bearing (constraint 3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<EventOrigin>,
}

impl FsEvent {
    fn change(name: String, last_modified: i64) -> Self {
        Self {
            name,
            action: FsAction::Change,
            last_modified,
            revision: None,
            origin: None,
        }
    }

    fn delete(name: String) -> Self {
        Self {
            name,
            action: FsAction::Delete,
            last_modified: 0,
            revision: None,
            origin: None,
        }
    }

    /// The single construction path for a resync event, shared by the
    /// watcher's flood-control path and the SSE handler's lagged-subscriber
    /// path so the two can never emit different JSON for the same thing.
    pub fn resync() -> Self {
        Self {
            name: String::new(),
            action: FsAction::Resync,
            last_modified: 0,
            revision: None,
            origin: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EventRevision {
    pub algorithm: String,
    pub hash: String,
    pub size: i64,
    #[serde(rename = "lastModified")]
    pub last_modified: i64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EventOriginKind {
    User,
    External,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventOrigin {
    pub kind: EventOriginKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Never serialized: the revision engine needs it in-process, and a space
    /// member has no business receiving every other member's email address.
    #[serde(skip)]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

fn enrich_event(
    mut event: FsEvent,
    meta: Option<&FileMeta>,
    guard: &FsGuard,
    space: &dyn SpacePrimitives,
) -> FsEvent {
    match event.action {
        FsAction::Change => {
            let Ok(hash) = guard.hash_for(space, &event.name) else {
                return event;
            };
            let size = meta.map(|m| m.size).unwrap_or(0);
            let last_modified = event.last_modified;
            event.revision = Some(EventRevision {
                algorithm: "sha256".to_string(),
                hash: hash.clone(),
                size,
                last_modified,
            });
            event.origin = Some(origin_for(guard.lookup_expected_write(&event.name, &hash)));
        }
        FsAction::Delete => {
            if let Some((hash, expected)) = guard.latest_expected_write_for_path(&event.name) {
                if let (Some(size), Some(last_modified)) = (expected.size, expected.last_modified) {
                    event.revision = Some(EventRevision {
                        algorithm: "sha256".to_string(),
                        hash,
                        size,
                        last_modified,
                    });
                }
                event.origin = Some(origin_for(Some(expected)));
            }
        }
        FsAction::Resync => {}
    }
    event
}

fn origin_for(hit: Option<ExpectedWrite>) -> EventOrigin {
    match hit {
        Some(expected) => EventOrigin {
            kind: EventOriginKind::User,
            display_name: expected.actor.full_name.or(expected.actor.username),
            email: expected.actor.email,
            client_id: expected.client_id,
            source: expected.source,
        },
        None => EventOrigin {
            kind: EventOriginKind::External,
            display_name: None,
            email: None,
            client_id: None,
            source: None,
        },
    }
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WatchMode {
    Auto,
    /// Poll every `Duration`. Carried in the variant rather than read from a
    /// constant so tests can drive a fast poll without waiting out the real
    /// interval.
    Poll(Duration),
    Off,
}

impl WatchMode {
    pub fn from_env() -> Self {
        match std::env::var("SB_FS_WATCH").as_deref() {
            Ok("poll") => WatchMode::Poll(poll_interval_from_env()),
            Ok("off") => WatchMode::Off,
            Ok("auto") | Err(_) => WatchMode::Auto,
            Ok(other) => {
                tracing::warn!("Unknown SB_FS_WATCH value {other:?}, using auto");
                WatchMode::Auto
            }
        }
    }
}

/// `SB_FS_POLL_INTERVAL`, in whole seconds. Split from the env lookup so the
/// parsing is testable without mutating process-wide state.
fn poll_interval_from_env() -> Duration {
    parse_poll_interval(std::env::var("SB_FS_POLL_INTERVAL").ok().as_deref())
}

fn parse_poll_interval(raw: Option<&str>) -> Duration {
    let Some(raw) = raw else {
        return DEFAULT_POLL_INTERVAL;
    };
    match raw.trim().parse::<u64>() {
        // Zero would spin the poll thread, so it is rejected rather than
        // honored: an operator asking for "as fast as possible" gets the
        // default instead of a busy loop over their whole space.
        Ok(secs) if secs > 0 => Duration::from_secs(secs),
        _ => {
            tracing::warn!(
                "Invalid SB_FS_POLL_INTERVAL {raw:?}, using {}s",
                DEFAULT_POLL_INTERVAL.as_secs()
            );
            DEFAULT_POLL_INTERVAL
        }
    }
}

const DEBOUNCE: Duration = Duration::from_millis(75);
const FLOOD_THRESHOLD: usize = 20;
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(30);
const CHANNEL_CAPACITY: usize = 256;
const ERROR_LOG_INTERVAL: Duration = Duration::from_secs(30);
const ABANDONMENT_CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// Start watching `root`. Returns the broadcast sender (subscribe for events),
/// or None if the watcher is off or could not be started (callers degrade to
/// polling). `gitignore` must match what the space's DiskSpacePrimitives was
/// built with, so watcher visibility agrees with the /.fs API.
pub fn start_watcher(
    root: &Path,
    gitignore: &str,
    mode: WatchMode,
    fs_guard: Arc<FsGuard>,
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
        WatchMode::Poll(interval) => {
            let config = notify::Config::default().with_poll_interval(interval);
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

    let weak_out = broadcast_tx.downgrade();
    std::thread::Builder::new()
        .name("sb-fs-watcher".into())
        .spawn(move || {
            // Keep the OS watcher alive for the lifetime of this thread
            let _watcher = watcher;
            debounce_loop(
                &root,
                &validator,
                raw_rx,
                weak_out,
                &fs_guard,
                ABANDONMENT_CHECK_INTERVAL,
            );
        })
        .ok()?;

    Some(broadcast_tx)
}

fn debounce_loop(
    root: &Path,
    validator: &DiskSpacePrimitives,
    rx: mpsc::Receiver<PathBuf>,
    out: broadcast::WeakSender<FsEvent>,
    guard: &FsGuard,
    abandonment_check: Duration,
) {
    // Pending space-relative paths, with the time they last fired
    let mut pending: HashMap<String, Instant> = HashMap::new();
    loop {
        let Some(sender) = out.upgrade() else {
            return;
        };
        let timeout = if pending.is_empty() {
            abandonment_check
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
        let gitignore = validator.gitignore_matcher();

        let mut resolved: Vec<(FsEvent, Option<FileMeta>)> = Vec::new();
        for name in ready {
            pending.remove(&name);
            if gitignore.is_ignored(&name, false) {
                continue;
            }
            match validator.get_file_meta_if_listable(&name) {
                Ok(Some(meta)) => {
                    let event = FsEvent::change(name, meta.last_modified);
                    resolved.push((event, Some(meta)));
                }
                Ok(None) => {} // directory, extensionless, or a stale casing: not a space file
                Err(SpaceError::NotFound) => {
                    resolved.push((FsEvent::delete(name), None));
                }
                Err(_) => {}
            }
        }
        if resolved.len() > FLOOD_THRESHOLD {
            let _ = sender.send(FsEvent::resync());
            continue;
        }
        for (event, meta) in resolved {
            let event = enrich_event(event, meta.as_ref(), guard, validator);
            // Err just means no subscribers; fine
            let _ = sender.send(event);
        }
    }
}

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
    use crate::auth::Actor;
    use std::time::Duration;

    #[test]
    fn poll_interval_defaults_when_unset_or_unusable() {
        assert_eq!(parse_poll_interval(None), DEFAULT_POLL_INTERVAL);
        assert_eq!(parse_poll_interval(Some("")), DEFAULT_POLL_INTERVAL);
        assert_eq!(parse_poll_interval(Some("nonsense")), DEFAULT_POLL_INTERVAL);
        assert_eq!(parse_poll_interval(Some("-5")), DEFAULT_POLL_INTERVAL);
        assert_eq!(
            parse_poll_interval(Some("0")),
            DEFAULT_POLL_INTERVAL,
            "zero would spin the poll thread"
        );
    }

    #[test]
    fn poll_interval_honors_whole_seconds() {
        assert_eq!(parse_poll_interval(Some("1")), Duration::from_secs(1));
        assert_eq!(parse_poll_interval(Some("120")), Duration::from_secs(120));
        assert_eq!(
            parse_poll_interval(Some("  45  ")),
            Duration::from_secs(45),
            "surrounding whitespace is tolerated"
        );
    }

    #[test]
    fn debounce_loop_exits_when_broadcast_sender_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let validator = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        let root = dir.path().to_path_buf();
        let (raw_tx, raw_rx) = mpsc::channel::<PathBuf>();
        let (broadcast_tx, _) = broadcast::channel::<FsEvent>(16);
        let weak_out = broadcast_tx.downgrade();

        let thread_mpsc_tx = raw_tx.clone();
        let guard = FsGuard::default();
        let handle = std::thread::spawn(move || {
            let _keep_alive = thread_mpsc_tx;
            debounce_loop(
                &root,
                &validator,
                raw_rx,
                weak_out,
                &guard,
                Duration::from_millis(50),
            );
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
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .expect("watcher should start");
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
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join(".hidden"), b"x").unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for dotfile");
    }

    #[tokio::test]
    async fn ignores_gitignored_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("build")).unwrap();
        let tx = start_watcher(
            dir.path(),
            "build/",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(dir.path().join("build/output.js"), b"x").unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for gitignored path");
    }

    #[tokio::test]
    async fn ignores_new_directories() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
        let mut rx = tx.subscribe();
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        let res = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(res.is_err(), "expected no event for a new directory");
    }

    #[tokio::test]
    async fn ignores_extensionless_files() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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
        let tx = start_watcher(&link, "", WatchMode::Auto, Arc::new(FsGuard::default())).unwrap();
        let mut rx = tx.subscribe();
        std::fs::write(link.join("linked.md"), b"via symlink").unwrap();
        let ev = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("no event through symlinked root")
            .unwrap();
        assert_eq!(ev.name, "linked.md");
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn case_only_rename_never_emits_the_stale_casing() {
        let dir = tempfile::tempdir().unwrap();
        let probe = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        if !probe.is_case_insensitive() {
            return; // opted-out case-sensitive APFS volume
        }
        std::fs::write(dir.path().join("Foo.md"), b"x").unwrap();

        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Poll(Duration::from_millis(100)),
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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
        assert!(
            start_watcher(dir.path(), "", WatchMode::Off, Arc::new(FsGuard::default())).is_none()
        );
    }

    #[tokio::test]
    async fn flood_collapses_into_resync() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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

    /// Pins the ordering fix: enrichment (which hashes file contents via
    /// `FsGuard::hash_for`) must run only on flushes that survive the flood
    /// check, never on the flushed-away paths of a flood -- otherwise a bulk
    /// import would read and hash every file only to discard it all for one
    /// Resync. A handful of individual (non-flood) events may legitimately
    /// precede the flood settling, and each of those does call `hash_for`
    /// once; the call count must never approach the full 40 files.
    #[tokio::test]
    async fn flood_does_not_hash_files_before_collapsing_into_resync() {
        let dir = tempfile::tempdir().unwrap();
        let guard = Arc::new(FsGuard::default());
        let tx = start_watcher(dir.path(), "", WatchMode::Auto, guard.clone()).unwrap();
        let mut rx = tx.subscribe();
        for i in 0..40 {
            std::fs::write(dir.path().join(format!("flood{i}.md")), b"x").unwrap();
        }
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
        assert!(
            guard.hash_for_call_count() <= individual,
            "flood must not hash files before collapsing into Resync: {} hash_for calls for {} individual events",
            guard.hash_for_call_count(),
            individual
        );
    }

    #[tokio::test]
    async fn coalesces_rapid_writes() {
        let dir = tempfile::tempdir().unwrap();
        let tx = start_watcher(
            dir.path(),
            "",
            WatchMode::Auto,
            Arc::new(FsGuard::default()),
        )
        .unwrap();
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

    fn memory_space_with(
        path: &str,
        content: &[u8],
    ) -> silverbullet_server_common::space::MemorySpacePrimitives {
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        space.write_file(path, content, None).unwrap();
        space
    }

    #[test]
    fn enrich_event_attributes_an_expected_write_as_user_origin() {
        let space = memory_space_with("a.md", b"hello");
        let guard = FsGuard::default();
        let hash = silverbullet_server_common::revision::sha256_hex(b"hello");
        guard.record_expected_write(
            "a.md",
            &hash,
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            Some("client-1".into()),
            Some("editor".into()),
        );

        let ev = enrich_event(FsEvent::change("a.md".into(), 123), None, &guard, &space);

        let revision = ev.revision.expect("revision present");
        assert_eq!(revision.hash, hash);
        assert_eq!(revision.algorithm, "sha256");
        let origin = ev.origin.expect("origin present");
        assert_eq!(origin.kind, EventOriginKind::User);
        assert_eq!(origin.display_name.as_deref(), Some("alice"));
        assert_eq!(origin.client_id.as_deref(), Some("client-1"));
        assert_eq!(origin.source.as_deref(), Some("editor"));
    }

    #[test]
    fn enrich_event_change_revision_size_and_last_modified_come_from_the_live_meta() {
        let space = memory_space_with("a.md", b"hello world");
        let guard = FsGuard::default();
        let meta = FileMeta {
            name: "a.md".into(),
            created: 100,
            last_modified: 456,
            content_type: "text/markdown".into(),
            size: 11,
            perm: "rw".into(),
        };

        let ev = enrich_event(
            FsEvent::change("a.md".into(), meta.last_modified),
            Some(&meta),
            &guard,
            &space,
        );

        let revision = ev.revision.expect("revision present");
        assert_eq!(revision.size, meta.size);
        assert_eq!(revision.last_modified, meta.last_modified);
    }

    #[test]
    fn enrich_event_unexpected_change_is_external_but_still_carries_a_revision() {
        let space = memory_space_with("a.md", b"hello");
        let guard = FsGuard::default();

        let ev = enrich_event(FsEvent::change("a.md".into(), 123), None, &guard, &space);

        assert!(ev.revision.is_some(), "revision should still be computed");
        assert_eq!(ev.origin.unwrap().kind, EventOriginKind::External);
    }

    #[test]
    fn enrich_event_anonymous_expected_write_is_user_origin_without_a_display_name() {
        // constraint 3: anonymous auth (bearer token) degrades to an origin
        // with no displayName, not to kind="external" -- the write WAS
        // recognized, it just carries no verified identity.
        let space = memory_space_with("a.md", b"hello");
        let guard = FsGuard::default();
        let hash = silverbullet_server_common::revision::sha256_hex(b"hello");
        guard.record_expected_write(
            "a.md",
            &hash,
            Actor::default(),
            Some("client-1".into()),
            Some("sync".into()),
        );

        let ev = enrich_event(FsEvent::change("a.md".into(), 123), None, &guard, &space);

        let origin = ev.origin.expect("origin present");
        assert_eq!(origin.kind, EventOriginKind::User);
        assert_eq!(origin.display_name, None);
        assert_eq!(origin.client_id.as_deref(), Some("client-1"));
    }

    #[test]
    fn enrich_event_hash_error_emits_without_revision_or_origin() {
        // Never load-bearing (constraint 3): a hashing failure (file absent
        // from `space`) must not block the event, just leave it unenriched.
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        let guard = FsGuard::default();

        let ev = enrich_event(
            FsEvent::change("missing.md".into(), 0),
            None,
            &guard,
            &space,
        );

        assert!(ev.revision.is_none());
        assert!(ev.origin.is_none());
    }

    #[test]
    fn enrich_event_delete_attributes_via_the_last_expected_write_for_the_path() {
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        let guard = FsGuard::default();
        guard.record_expected_write_with_meta(
            "gone.md",
            "deadbeef",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            Some("editor".into()),
            5,
            999,
        );

        let ev = enrich_event(FsEvent::delete("gone.md".into()), None, &guard, &space);

        let revision = ev.revision.expect("revision present for a known delete");
        assert_eq!(revision.hash, "deadbeef");
        assert_eq!(revision.size, 5);
        assert_eq!(revision.last_modified, 999);
        let origin = ev.origin.expect("origin present");
        assert_eq!(origin.kind, EventOriginKind::User);
        assert_eq!(origin.display_name.as_deref(), Some("alice"));
    }

    #[test]
    fn enrich_event_delete_without_a_known_size_omits_revision_but_keeps_origin() {
        // The matched expected write was recorded without meta (e.g. via the
        // plain `record_expected_write`, not `..._with_meta`): the map can
        // still attribute WHO, but not a truthful size/lastModified, so
        // `revision` must stay absent rather than fabricate one.
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        let guard = FsGuard::default();
        guard.record_expected_write(
            "gone.md",
            "deadbeef",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            Some("editor".into()),
        );

        let ev = enrich_event(FsEvent::delete("gone.md".into()), None, &guard, &space);

        assert!(ev.revision.is_none());
        let origin = ev.origin.expect("origin present");
        assert_eq!(origin.kind, EventOriginKind::User);
        assert_eq!(origin.display_name.as_deref(), Some("alice"));
    }

    #[test]
    fn enrich_event_delete_with_no_known_hash_carries_no_revision() {
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        let guard = FsGuard::default();

        let ev = enrich_event(FsEvent::delete("gone.md".into()), None, &guard, &space);

        assert!(ev.revision.is_none());
        assert!(ev.origin.is_none());
    }

    #[test]
    fn resync_construction_is_byte_compatible_with_the_legacy_literal() {
        let json = serde_json::to_string(&FsEvent::resync()).unwrap();
        assert_eq!(json, r#"{"name":"","action":"resync","lastModified":0}"#);
    }

    #[test]
    fn fs_event_without_attribution_is_byte_compatible_with_the_legacy_shape() {
        let ev = FsEvent {
            name: "a.md".into(),
            action: FsAction::Change,
            last_modified: 42,
            revision: None,
            origin: None,
        };
        assert_eq!(
            serde_json::to_string(&ev).unwrap(),
            r#"{"name":"a.md","action":"change","lastModified":42}"#
        );
    }

    #[test]
    fn fs_event_with_attribution_serializes_the_new_optional_fields() {
        let ev = FsEvent {
            name: "a.md".into(),
            action: FsAction::Change,
            last_modified: 42,
            revision: Some(EventRevision {
                algorithm: "sha256".into(),
                hash: "deadbeef".into(),
                size: 5,
                last_modified: 42,
            }),
            origin: Some(EventOrigin {
                kind: EventOriginKind::User,
                display_name: Some("alice".into()),
                email: None,
                client_id: Some("client-1".into()),
                source: Some("editor".into()),
            }),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert_eq!(
            json,
            r#"{"name":"a.md","action":"change","lastModified":42,"revision":{"algorithm":"sha256","hash":"deadbeef","size":5,"lastModified":42},"origin":{"kind":"user","displayName":"alice","clientId":"client-1","source":"editor"}}"#
        );
    }

    #[test]
    fn origin_display_name_prefers_the_full_name_and_never_serializes_the_email() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("ada".into()),
                full_name: Some("Ada Lovelace".into()),
                email: Some("ada@example.org".into()),
            },
            None,
            None,
        );
        let origin = origin_for(guard.lookup_expected_write("a.md", "hash1"));
        assert_eq!(origin.display_name.as_deref(), Some("Ada Lovelace"));
        assert_eq!(origin.email.as_deref(), Some("ada@example.org"));

        let json = serde_json::to_string(&origin).unwrap();
        assert!(
            !json.contains("ada@example.org"),
            "email must not reach clients: {json}"
        );
        assert!(json.contains("Ada Lovelace"), "{json}");
    }

    #[test]
    fn origin_display_name_falls_back_to_the_username() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("ada".into()),
                ..Default::default()
            },
            None,
            None,
        );
        let origin = origin_for(guard.lookup_expected_write("a.md", "hash1"));
        assert_eq!(origin.display_name.as_deref(), Some("ada"));
    }
}
