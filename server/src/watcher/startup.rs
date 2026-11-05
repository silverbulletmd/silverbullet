use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tokio::sync::broadcast;

use super::{FsEvent, WatchMode, ERROR_LOG_INTERVAL};
use crate::FsGuard;

pub(super) fn start(
    root: PathBuf,
    mode: WatchMode,
    raw: mpsc::Sender<PathBuf>,
    out: broadcast::WeakSender<FsEvent>,
    guard: Arc<FsGuard>,
    validator: Arc<silverbullet_server_common::space::disk::DiskSpacePrimitives>,
) -> std::io::Result<impl Send> {
    let resync_root = root.clone();
    let resync_guard = guard.clone();
    start_with_native(
        root,
        mode,
        raw,
        out,
        guard,
        |root, raw| {
            let mut watcher = notify::recommended_watcher(event_handler(raw))?;
            watcher.watch(root, RecursiveMode::Recursive)?;
            Ok(watcher)
        },
        move |sender| super::startup_resync(&resync_root, &validator, &resync_guard, sender),
    )
}

struct Watchers<W> {
    poll: Option<notify::PollWatcher>,
    native: Option<W>,
}

fn start_with_native<W: Send + 'static>(
    root: PathBuf,
    mode: WatchMode,
    raw: mpsc::Sender<PathBuf>,
    out: broadcast::WeakSender<FsEvent>,
    guard: Arc<FsGuard>,
    native: impl FnOnce(&Path, mpsc::Sender<PathBuf>) -> notify::Result<W> + Send + 'static,
    resync: impl Fn(&broadcast::Sender<FsEvent>) + Send + 'static,
) -> std::io::Result<impl Send> {
    if let WatchMode::Poll(interval) = mode {
        let config = notify::Config::default().with_poll_interval(interval);
        let mut poll =
            notify::PollWatcher::new(event_handler(raw), config).map_err(std::io::Error::other)?;
        poll.watch(&root, RecursiveMode::Recursive)
            .map_err(std::io::Error::other)?;
        guard.watched(mode);
        return Ok(Arc::new(Mutex::new(Watchers {
            poll: Some(poll),
            native: None,
        })));
    }
    let interval = match mode {
        WatchMode::Auto => Duration::from_secs(1),
        WatchMode::Poll(interval) => interval,
        WatchMode::Off => unreachable!(),
    };
    let watchers = Arc::new(Mutex::new(Watchers {
        poll: None,
        native: None,
    }));
    let registered = watchers.clone();
    // Until native registration completes, catch-up must not promise that
    // external changes have reached the event feed.
    guard.watched(WatchMode::Poll(interval));
    std::thread::Builder::new()
        .name("sb-fs-register".into())
        .spawn(move || {
            let config = notify::Config::default()
                .with_poll_interval(interval)
                .with_compare_contents(mode == WatchMode::Auto);
            let poll = notify::PollWatcher::new(event_handler(raw.clone()), config).and_then(
                |mut watcher| {
                    watcher.watch(&root, RecursiveMode::Recursive)?;
                    Ok(watcher)
                },
            );
            match poll {
                Ok(poll) => registered.lock().unwrap().poll = Some(poll),
                Err(error) => tracing::warn!("Could not start polling fs watcher: {error}"),
            }
            // The polling baseline can include changes made after callers first
            // read the space. Reconcile them before relying on subsequent events.
            let Some(sender) = out.upgrade() else {
                return;
            };
            resync(&sender);
            drop(sender);
            let mut native_failed = false;
            if mode == WatchMode::Auto {
                let started = std::time::Instant::now();
                match native(&root, raw) {
                    Ok(native) => {
                        if std::env::var_os("SB_TRACE_STARTUP").is_some() {
                            eprintln!(
                                "[startup] native fs watcher registered in {}ms",
                                started.elapsed().as_millis()
                            );
                        }
                        let Some(sender) = out.upgrade() else {
                            return;
                        };
                        let mut watchers = registered.lock().unwrap();
                        watchers.native = Some(native);
                        watchers.poll = None;
                        resync(&sender);
                        guard.forwarding().unwrap().native_ready();
                    }
                    Err(error) => {
                        tracing::warn!(
                            "Native fs watcher registration failed; continuing to poll: {error}"
                        );
                        native_failed = true;
                    }
                }
            }
            let failed = {
                let watchers = registered.lock().unwrap();
                native_failed || (watchers.poll.is_none() && watchers.native.is_none())
            };
            if failed {
                // Even if both backends fail, consumers must not keep trusting a
                // cached listing or index forever.
                while let Some(sender) = out.upgrade() {
                    resync(&sender);
                    drop(sender);
                    std::thread::sleep(super::DEFAULT_POLL_INTERVAL);
                }
            }
        })?;
    Ok(watchers)
}

fn event_handler(raw: mpsc::Sender<PathBuf>) -> impl notify::EventHandler {
    let mut last_error = None;
    move |result: notify::Result<Event>| match result {
        Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
            for path in event.paths {
                let _ = raw.send(path);
            }
        }
        Ok(_) => {}
        Err(error) => {
            let now = std::time::Instant::now();
            if last_error.is_none_or(|at| now.duration_since(at) >= ERROR_LOG_INTERVAL) {
                tracing::warn!("fs watcher error: {error}");
                last_error = Some(now);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watcher::{debounce_loop, FsAction};
    use silverbullet_server_common::space::disk::DiskSpacePrimitives;
    use std::time::{Duration, Instant};

    fn start_with_native<W: Send + 'static>(
        root: PathBuf,
        mode: WatchMode,
        raw: mpsc::Sender<PathBuf>,
        out: broadcast::WeakSender<FsEvent>,
        guard: Arc<FsGuard>,
        native: impl FnOnce(&Path, mpsc::Sender<PathBuf>) -> notify::Result<W> + Send + 'static,
    ) -> std::io::Result<impl Send> {
        super::start_with_native(root, mode, raw, out, guard, native, |sender| {
            let _ = sender.send(FsEvent::resync());
        })
    }

    #[test]
    fn pending_native_registration_returns_and_covers_disk_changes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("Existing.md"), b"before").unwrap();
        std::fs::write(root.join("Vanishing.md"), b"before").unwrap();
        std::fs::write(root.join("Old.md"), b"before").unwrap();
        let validator = DiskSpacePrimitives::new(&root, "").unwrap();
        let guard = Arc::new(FsGuard::default());
        let (out, mut events) = broadcast::channel(256);
        let weak = out.downgrade();
        let (raw, paths) = mpsc::channel();
        let (entered_tx, entered) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let (returned_tx, returned) = mpsc::channel();
        let worker_guard = guard.clone();
        let worker_root = root.clone();
        let worker = std::thread::spawn(move || {
            let watcher = start_with_native(
                worker_root.clone(),
                WatchMode::Auto,
                raw,
                weak.clone(),
                worker_guard.clone(),
                move |root, raw| {
                    entered_tx.send(()).unwrap();
                    released.recv().unwrap();
                    std::fs::write(root.join("Handoff.md"), b"during handoff").unwrap();
                    Ok(raw)
                },
            )
            .unwrap();
            returned_tx.send(()).unwrap();
            let _watcher = watcher;
            debounce_loop(
                &worker_root,
                &validator,
                paths,
                weak,
                &worker_guard,
                Duration::from_millis(20),
            );
        });
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        let result = returned.recv_timeout(Duration::from_millis(250));
        if result.is_err() {
            release.send(()).unwrap();
            drop(out);
            worker.join().unwrap();
            panic!("watcher startup blocked on native registration");
        }
        assert!(guard.forwarding().unwrap().polls());
        let listing = crate::ListingCachedSpace::new(DiskSpacePrimitives::new(&root, "").unwrap());
        listing.attach(&out);
        use silverbullet_server_common::SpacePrimitives;
        listing.fetch_file_list().unwrap();
        std::fs::write(root.join("Existing.md"), b"after editing").unwrap();
        std::fs::write(root.join("New.md"), b"new").unwrap();
        std::fs::remove_file(root.join("Vanishing.md")).unwrap();
        std::fs::rename(root.join("Old.md"), root.join("Renamed.md")).unwrap();
        let mut expected = vec![
            ("Existing.md", FsAction::Change),
            ("New.md", FsAction::Change),
            ("Vanishing.md", FsAction::Delete),
            ("Old.md", FsAction::Delete),
            ("Renamed.md", FsAction::Change),
        ];
        let deadline = Instant::now() + Duration::from_secs(5);
        while !expected.is_empty() && Instant::now() < deadline {
            if let Ok(event) = events.try_recv() {
                expected.retain(|(name, action)| event.name != *name || event.action != *action);
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        // Always release the native start so a failed assertion leaves no blocked thread.
        release.send(()).unwrap();
        assert!(
            expected.is_empty(),
            "missed disk changes while registering: {expected:?}"
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut resync = false;
        while Instant::now() < deadline {
            if let Ok(event) = events.try_recv() {
                resync |= event.action == FsAction::Resync;
            }
            if resync && !guard.forwarding().unwrap().polls() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(resync, "handoff must reconcile the registration gap");
        assert!(!guard.forwarding().unwrap().polls());
        let deadline = Instant::now() + Duration::from_secs(5);
        while !listing
            .fetch_file_list()
            .unwrap()
            .iter()
            .any(|file| file.name == "Handoff.md")
        {
            assert!(Instant::now() < deadline, "handoff left the listing stale");
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(out);
        worker.join().unwrap();
    }
    #[test]
    fn failed_native_registration_keeps_polling() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let guard = Arc::new(FsGuard::default());
        let (out, _) = broadcast::channel(16);
        let (raw, paths) = mpsc::channel();
        let (failed_tx, failed) = mpsc::channel();
        let watcher = start_with_native(
            root.clone(),
            WatchMode::Auto,
            raw,
            out.downgrade(),
            guard.clone(),
            move |_, _| {
                failed_tx.send(()).unwrap();
                Err::<(), _>(notify::Error::generic("registration refused"))
            },
        )
        .unwrap();
        failed.recv_timeout(Duration::from_secs(5)).unwrap();
        std::fs::write(root.join("New.md"), b"after failed registration").unwrap();
        assert_eq!(
            paths.recv_timeout(Duration::from_secs(5)).unwrap(),
            root.join("New.md")
        );
        assert!(guard.forwarding().unwrap().polls());
        drop(out);
        drop(watcher);
    }

    #[test]
    fn closing_during_registration_drops_the_late_watcher() {
        struct Native(mpsc::Sender<()>);
        impl Drop for Native {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let (out, _) = broadcast::channel(16);
        let (raw, _paths) = mpsc::channel();
        let (entered_tx, entered) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let (dropped_tx, dropped) = mpsc::channel();
        let watcher = start_with_native(
            dir.path().to_path_buf(),
            WatchMode::Auto,
            raw,
            out.downgrade(),
            Arc::new(FsGuard::default()),
            move |_, _| {
                entered_tx.send(()).unwrap();
                released.recv().unwrap();
                Ok(Native(dropped_tx))
            },
        )
        .unwrap();
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        drop(out);
        drop(watcher);
        release.send(()).unwrap();
        dropped
            .recv_timeout(Duration::from_secs(5))
            .expect("late watcher was retained after close");
    }
    #[tokio::test]
    async fn failed_polling_baseline_and_native_registration_resync_after_root_recovers() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("space");
        let (out, mut events) = broadcast::channel(16);
        let (raw, _paths) = mpsc::channel();
        let (entered_tx, entered) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let watcher = start_with_native(
            root.clone(),
            WatchMode::Auto,
            raw,
            out.downgrade(),
            Arc::new(FsGuard::default()),
            move |_, _| {
                entered_tx.send(()).unwrap();
                released.recv().unwrap();
                Err::<(), _>(notify::Error::generic("registration refused"))
            },
        )
        .unwrap();
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(events.recv().await.unwrap().action, FsAction::Resync);
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("Recovered.md"), b"after root recovered").unwrap();
        release.send(()).unwrap();
        let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("failed watcher backends left a silent event feed")
            .unwrap();
        assert_eq!(event.action, FsAction::Resync);
        drop(out);
        drop(watcher);
    }
}
