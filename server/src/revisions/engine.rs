use super::store::RevisionStore;
use crate::watcher::{EventOrigin, EventOriginKind, FsAction, FsEvent};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_secs(30);
const MAX_INTERVAL: Duration = Duration::from_secs(300);
const TICK: Duration = Duration::from_secs(2);
const DEFAULT_DOMAIN: &str = "silverbullet.local";
const EXTERNAL_AUTHOR: &str = "External";
const SYSTEM_AUTHOR: &str = "SilverBullet";

/// Who a pending change gets committed as. The commit grouping key: two
/// attributions in one debounce window produce two commits.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Attribution {
    Account { name: String, email: Option<String> },
    LocalUser,
    External,
    System,
}

struct EngineState {
    dirty: HashMap<String, Attribution>,
    first_mark: Option<Instant>,
    last_mark: Option<Instant>,
    stopping: bool,
}

#[derive(Clone, Copy)]
struct Timing {
    quiet: Duration,
    max_interval: Duration,
    tick: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            quiet: QUIET,
            max_interval: MAX_INTERVAL,
            tick: TICK,
        }
    }
}

struct EngineInner {
    store: Arc<RevisionStore>,
    state: (Mutex<EngineState>, Condvar),
    warned: AtomicBool,
    commit_lock: Mutex<()>,
    snapshot_done: AtomicBool,
    initial_snapshot_paths: Option<Vec<String>>,
}

impl EngineInner {
    fn request_stop(&self) {
        let (lock, cv) = &self.state;
        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        guard.stopping = true;
        cv.notify_all();
    }

    /// The `name <email>` to commit an attribution under.
    fn identity_for(&self, attribution: &Attribution) -> (String, String) {
        let (name, email) = match attribution {
            Attribution::Account { name, email } => (name.clone(), email.clone()),
            Attribution::LocalUser | Attribution::System => (SYSTEM_AUTHOR.to_string(), None),
            Attribution::External => (EXTERNAL_AUTHOR.to_string(), None),
        };
        let email = email.unwrap_or_else(|| {
            format!(
                "{}@{}",
                name.to_lowercase().replace(char::is_whitespace, "-"),
                DEFAULT_DOMAIN
            )
        });
        (name, email)
    }

    fn on_event(&self, ev: FsEvent) {
        match ev.action {
            FsAction::Change | FsAction::Delete => {
                self.mark(&ev.name, attribution_for(ev.origin.as_ref()));
            }
            FsAction::Resync => self.rescan_as_external(),
        }
    }

    fn mark(&self, space_path: &str, attribution: Attribution) {
        self.record(space_path, attribution, true);
    }

    /// `overwrite: false` keeps an already-pending per-user attribution, so a
    /// blanket rescan can't relabel a user's own edit as external.
    fn record(&self, space_path: &str, attribution: Attribution, overwrite: bool) {
        if !self.store.auto_commit_allowed() {
            return;
        }
        let (lock, _) = &self.state;
        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        guard.first_mark.get_or_insert(now);
        guard.last_mark = Some(now);
        if overwrite {
            guard.dirty.insert(space_path.to_string(), attribution);
        } else {
            guard
                .dirty
                .entry(space_path.to_string())
                .or_insert(attribution);
        }
    }

    /// Whether it produced at least one commit.
    fn commit_now(&self) -> bool {
        if !self.store.auto_commit_allowed() {
            return false;
        }
        let _commit_guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut committed = self.ensure_initial_snapshot_locked();
        let (lock, _) = &self.state;
        let batch = {
            let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            guard.first_mark = None;
            guard.last_mark = None;
            std::mem::take(&mut guard.dirty)
        };
        if batch.is_empty() {
            return committed;
        }
        let mut by_attribution: HashMap<Attribution, Vec<String>> = HashMap::new();
        for (path, attribution) in batch {
            by_attribution.entry(attribution).or_default().push(path);
        }
        for (attribution, mut paths) in by_attribution {
            paths.sort();
            let message = commit_message(&paths);
            let (name, email) = self.identity_for(&attribution);
            match self.store.commit_batch(&name, &email, &message, &paths) {
                Ok(id) => {
                    committed |= id.is_some();
                    self.warned.store(false, Ordering::Relaxed);
                }
                Err(e) => {
                    if !self.warned.swap(true, Ordering::Relaxed) {
                        tracing::warn!("History auto-commit skipped: {e}");
                    }
                    let (lock, _) = &self.state;
                    let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                    let now = Instant::now();
                    guard.first_mark.get_or_insert(now);
                    guard.last_mark = Some(now);
                    for p in paths {
                        guard.dirty.entry(p).or_insert_with(|| attribution.clone());
                    }
                }
            }
        }
        committed
    }

    fn snapshot_now(&self) -> Result<bool, String> {
        if !self.store.auto_commit_allowed() {
            return Err("revisions are not managed for this space".to_string());
        }
        let committed = self.commit_now();
        let _commit_guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        let (name, email) = self.identity_for(&Attribution::System);
        let swept = self.store.commit_all(&name, &email, "Manual snapshot")?;
        Ok(committed || swept.is_some())
    }

    fn rescan_as_external(&self) {
        if let Some(paths) = list_all_paths(self.store.root()) {
            for path in paths {
                self.record(&path, Attribution::External, false);
            }
        }
    }

    fn ensure_initial_snapshot_locked(&self) -> bool {
        if self.snapshot_done.load(Ordering::Acquire) {
            return false;
        }
        let Some(paths) = &self.initial_snapshot_paths else {
            self.snapshot_done.store(true, Ordering::Release);
            return false;
        };
        let root = self.store.root();
        let existing: Vec<String> = paths
            .iter()
            .filter(|p| root.join(p).exists())
            .cloned()
            .collect();
        if existing.is_empty() {
            self.snapshot_done.store(true, Ordering::Release);
            return false;
        }
        let (name, email) = self.identity_for(&Attribution::System);
        match self
            .store
            .commit_batch(&name, &email, "Initial space snapshot", &existing)
        {
            Ok(id) => {
                self.snapshot_done.store(true, Ordering::Release);
                id.is_some()
            }
            Err(e) => {
                tracing::warn!("History initial snapshot failed, will retry: {e}");
                false
            }
        }
    }

    fn ensure_initial_snapshot(&self) {
        if !self.store.auto_commit_allowed() {
            return;
        }
        let _commit_guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_initial_snapshot_locked();
    }
}

fn list_all_paths(root: &Path) -> Option<Vec<String>> {
    let disk = match silverbullet_server_common::space::disk::DiskSpacePrimitives::new(root, "") {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("History space listing failed: {e}");
            return None;
        }
    };
    use silverbullet_server_common::SpacePrimitives;
    match disk.fetch_file_list() {
        Ok(list) => Some(list.into_iter().map(|m| m.name).collect()),
        Err(e) => {
            tracing::warn!("History space listing failed: {e}");
            None
        }
    }
}

fn attribution_for(origin: Option<&EventOrigin>) -> Attribution {
    let Some(origin) = origin else {
        return Attribution::External;
    };
    if origin.kind != EventOriginKind::User {
        return Attribution::External;
    }
    match (&origin.display_name, &origin.email) {
        (None, None) => Attribution::LocalUser,
        (Some(name), email) => Attribution::Account {
            name: name.clone(),
            email: email.clone(),
        },
        (None, Some(email)) => match name_from_email(email) {
            Some(name) => Attribution::Account {
                name,
                email: Some(email.clone()),
            },
            None => Attribution::LocalUser,
        },
    }
}

fn name_from_email(email: &str) -> Option<String> {
    let local = email.split('@').next().unwrap_or_default().trim();
    (!local.is_empty()).then(|| local.to_string())
}

fn commit_message(paths: &[String]) -> String {
    match paths.len() {
        1 => format!("Update {}", paths[0]),
        2 => format!("Update {}, {}", paths[0], paths[1]),
        n => format!("Update {}, {} (+{} more)", paths[0], paths[1], n - 2),
    }
}

pub struct RevisionEngine {
    inner: Arc<EngineInner>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl RevisionEngine {
    pub fn start(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
    ) -> Arc<RevisionEngine> {
        Self::start_internal(store, events, Timing::default())
    }

    #[cfg(test)]
    pub(crate) fn start_with_timing(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        quiet: Duration,
        max_interval: Duration,
        tick: Duration,
    ) -> Arc<RevisionEngine> {
        Self::start_internal(
            store,
            events,
            Timing {
                quiet,
                max_interval,
                tick,
            },
        )
    }

    fn start_internal(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        timing: Timing,
    ) -> Arc<RevisionEngine> {
        let store = Arc::new(store);
        let initial_snapshot_paths = if store.auto_commit_allowed() && !store.head_exists() {
            list_all_paths(store.root())
        } else {
            None
        };
        let inner = Arc::new(EngineInner {
            store: store.clone(),
            state: (
                Mutex::new(EngineState {
                    dirty: HashMap::new(),
                    first_mark: None,
                    last_mark: None,
                    stopping: false,
                }),
                Condvar::new(),
            ),
            warned: AtomicBool::new(false),
            commit_lock: Mutex::new(()),
            snapshot_done: AtomicBool::new(false),
            initial_snapshot_paths,
        });

        let thread = if inner.store.auto_commit_allowed() {
            let tick_inner = inner.clone();
            let quiet = timing.quiet;
            let max_interval = timing.max_interval;
            let tick = timing.tick;
            let thread = std::thread::Builder::new()
                .name("sb-history".to_string())
                .spawn(move || {
                    let mut first_pass = true;
                    loop {
                        let (lock, cv) = &tick_inner.state;
                        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                        if guard.stopping {
                            return;
                        }
                        if first_pass {
                            first_pass = false;
                            drop(guard);
                            tick_inner.ensure_initial_snapshot();
                            continue;
                        }
                        let (g, _) = cv
                            .wait_timeout(guard, tick)
                            .unwrap_or_else(|e| e.into_inner());
                        guard = g;
                        if guard.stopping {
                            return;
                        }
                        let due = match (guard.first_mark, guard.last_mark) {
                            (Some(first), Some(last)) => {
                                last.elapsed() >= quiet || first.elapsed() >= max_interval
                            }
                            _ => false,
                        };
                        if !due {
                            continue;
                        }
                        drop(guard);
                        tick_inner.commit_now();
                    }
                })
                .expect("failed to spawn history thread");

            if let Some(rx) = events {
                let event_inner = inner.clone();
                std::thread::Builder::new()
                    .name("sb-history-events".to_string())
                    .spawn(move || {
                        let mut rx = rx;
                        loop {
                            match rx.blocking_recv() {
                                Ok(ev) => event_inner.on_event(ev),
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                    tracing::warn!(
                                        "History watcher lagged by {n} events; rescanning space"
                                    );
                                    event_inner.rescan_as_external();
                                }
                                Err(_) => return,
                            }
                        }
                    })
                    .expect("failed to spawn history event thread");
            } else {
                tracing::warn!(
                    "Managed revisions active but the file watcher is off; auto-commit disabled"
                );
            }
            Some(thread)
        } else {
            None
        };

        Arc::new(RevisionEngine { inner, thread })
    }

    pub fn store(&self) -> &RevisionStore {
        &self.inner.store
    }

    pub fn mark(&self, space_path: &str, attribution: Attribution) {
        self.inner.mark(space_path, attribution);
    }

    #[cfg(test)]
    pub fn identity_for_test(&self, attribution: &Attribution) -> (String, String) {
        self.inner.identity_for(attribution)
    }

    pub fn commit_now(&self) {
        self.inner.commit_now();
    }

    /// Commit everything outstanding right now, instead of waiting for the
    /// debounce. `Ok(false)` means there was nothing to commit.
    pub fn snapshot_now(&self) -> Result<bool, String> {
        self.inner.snapshot_now()
    }
}

impl Drop for RevisionEngine {
    fn drop(&mut self) {
        self.inner.request_stop();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.inner.commit_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::revisions::RevisionStore;
    use silverbullet_server_common::RevisionsMode;
    use std::path::Path;
    use std::time::Duration;

    fn git_out(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn managed(dir: &tempfile::TempDir) -> RevisionStore {
        RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap()
    }

    #[test]
    fn initial_commit_snapshots_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), b"hello").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();
        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an"]),
            "SilverBullet"
        );
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains("index.md"), "{files}");
    }

    #[test]
    fn start_returns_before_the_initial_snapshot_runs() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            std::fs::write(dir.path().join(format!("f{i}.md")), b"x").unwrap();
        }
        let handle = RevisionEngine::start(managed(&dir), None);
        assert!(
            !handle.store().head_exists(),
            "start() must return before the initial snapshot commit has run"
        );
        handle.commit_now();
        assert!(handle.store().head_exists());
        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an"]),
            "SilverBullet"
        );
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains("f0.md"), "{files}");
    }

    #[test]
    fn initial_snapshot_skips_paths_deleted_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("keep.md"), b"k").unwrap();
        std::fs::write(dir.path().join("gone.md"), b"g").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        std::fs::remove_file(dir.path().join("gone.md")).unwrap();
        handle.commit_now();
        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an"]),
            "SilverBullet"
        );
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains("keep.md"), "{files}");
        assert!(!files.contains("gone.md"), "{files}");
    }

    #[test]
    fn marks_batch_into_per_author_commits() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"s").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();
        std::fs::write(dir.path().join("a.md"), b"a").unwrap();
        std::fs::write(dir.path().join("b.md"), b"b").unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );
        handle.mark("b.md", Attribution::External);
        handle.commit_now();
        let mut authors: Vec<String> = git_out(dir.path(), &["log", "--format=%an"])
            .lines()
            .map(|l| l.to_string())
            .collect();
        authors.sort();
        assert_eq!(authors, vec!["External", "SilverBullet", "alice"]);
    }

    /// Commits `a.md` marked as an account named `author` and returns the
    /// resulting `name <email>`.
    fn commit_as(dir: &tempfile::TempDir, handle: &RevisionEngine, author: &str) -> String {
        std::fs::write(dir.path().join("a.md"), author).unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: author.into(),
                email: None,
            },
        );
        handle.commit_now();
        git_out(dir.path(), &["log", "-1", "--format=%an <%ae>"])
    }

    #[test]
    fn a_missing_email_synthesizes_one_from_the_default_domain() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"s").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();

        assert_eq!(
            commit_as(&dir, &handle, "alice"),
            format!("alice <alice@{DEFAULT_DOMAIN}>")
        );
    }

    #[test]
    fn attribution_resolves_to_the_expected_identity() {
        let dir = tempfile::tempdir().unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);

        let cases = [
            (
                Attribution::Account {
                    name: "Ada Lovelace".into(),
                    email: Some("ada@example.org".into()),
                },
                ("Ada Lovelace", "ada@example.org"),
            ),
            (
                Attribution::Account {
                    name: "Ada Lovelace".into(),
                    email: None,
                },
                ("Ada Lovelace", "ada-lovelace@silverbullet.local"),
            ),
            (
                Attribution::LocalUser,
                ("SilverBullet", "silverbullet@silverbullet.local"),
            ),
            (
                Attribution::External,
                ("External", "external@silverbullet.local"),
            ),
            (
                Attribution::System,
                ("SilverBullet", "silverbullet@silverbullet.local"),
            ),
        ];
        for (attribution, (name, email)) in cases {
            assert_eq!(
                handle.identity_for_test(&attribution),
                (name.to_string(), email.to_string()),
                "{attribution:?}"
            );
        }
    }

    fn user_origin(display_name: Option<&str>, email: Option<&str>) -> EventOrigin {
        EventOrigin {
            kind: EventOriginKind::User,
            display_name: display_name.map(str::to_string),
            email: email.map(str::to_string),
            client_id: None,
            source: None,
        }
    }

    #[test]
    fn a_write_silverbullet_never_made_is_external() {
        assert_eq!(attribution_for(None), Attribution::External);

        let mut origin = user_origin(Some("Ada Lovelace"), Some("ada@example.org"));
        origin.kind = EventOriginKind::External;
        assert_eq!(attribution_for(Some(&origin)), Attribution::External);
    }

    #[test]
    fn attribution_for_maps_an_origin_to_its_author() {
        let account = |name: &str, email: Option<&str>| Attribution::Account {
            name: name.to_string(),
            email: email.map(str::to_string),
        };
        let cases = [
            (user_origin(None, None), Attribution::LocalUser),
            (
                user_origin(Some("Ada Lovelace"), Some("ada@example.org")),
                account("Ada Lovelace", Some("ada@example.org")),
            ),
            (
                user_origin(Some("Ada Lovelace"), None),
                account("Ada Lovelace", None),
            ),
            (
                user_origin(None, Some("ada@example.org")),
                account("ada", Some("ada@example.org")),
            ),
            (
                user_origin(None, Some("@example.org")),
                Attribution::LocalUser,
            ),
        ];
        for (origin, expected) in cases {
            assert_eq!(attribution_for(Some(&origin)), expected, "{origin:?}");
        }
    }

    #[test]
    fn two_accounts_in_one_window_still_split_into_two_commits() {
        let dir = tempfile::tempdir().unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        std::fs::write(dir.path().join("a.md"), "a").unwrap();
        std::fs::write(dir.path().join("b.md"), "b").unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: "Alice".into(),
                email: Some("alice@x.test".into()),
            },
        );
        handle.mark(
            "b.md",
            Attribution::Account {
                name: "Bob".into(),
                email: Some("bob@x.test".into()),
            },
        );
        handle.commit_now();
        let idents = git_out(dir.path(), &["log", "--format=%an <%ae>"]);
        assert!(idents.contains("Alice <alice@x.test>"), "{idents}");
        assert!(idents.contains("Bob <bob@x.test>"), "{idents}");
    }

    #[test]
    fn unmanaged_store_never_commits() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        let handle = RevisionEngine::start(store, None);
        std::fs::write(dir.path().join("a.md"), b"a").unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );
        handle.commit_now();
        assert!(
            !git_out(dir.path(), &["status", "--porcelain"]).is_empty(),
            "file stays uncommitted"
        );
    }

    #[test]
    fn drop_flushes_pending_marks() {
        let dir = tempfile::tempdir().unwrap();
        {
            let handle = RevisionEngine::start(managed(&dir), None);
            std::fs::write(dir.path().join("late.md"), b"x").unwrap();
            handle.mark(
                "late.md",
                Attribution::Account {
                    name: "ada".into(),
                    email: None,
                },
            );
        }
        let authors = git_out(dir.path(), &["log", "--format=%an"]);
        assert!(authors.contains("ada"), "{authors}");
    }

    #[tokio::test]
    async fn watcher_events_feed_marks() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = tokio::sync::broadcast::channel(16);
        let handle = RevisionEngine::start(managed(&dir), Some(rx));
        std::fs::write(dir.path().join("w.md"), b"w").unwrap();
        tx.send(crate::watcher::FsEvent::resync()).unwrap();
        tx.send(test_change_event("w.md", Some("carol"))).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        handle.commit_now();
        let authors = git_out(dir.path(), &["log", "--format=%an"]);
        assert!(authors.contains("carol"), "{authors}");
    }

    #[tokio::test]
    async fn anonymous_user_writes_commit_as_silverbullet_not_external() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = tokio::sync::broadcast::channel(16);
        let handle = RevisionEngine::start(managed(&dir), Some(rx));
        handle.commit_now();
        std::fs::write(dir.path().join("w.md"), b"w").unwrap();
        tx.send(test_change_event("w.md", None)).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        handle.commit_now();
        let authors = git_out(dir.path(), &["log", "-1", "--format=%an"]);
        assert_eq!(authors, "SilverBullet");
    }

    #[test]
    fn snapshot_now_commits_the_pending_batch_immediately() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"s").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();
        std::fs::write(dir.path().join("a.md"), b"a").unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );

        assert!(handle.snapshot_now().unwrap());

        assert_eq!(git_out(dir.path(), &["log", "-1", "--format=%an"]), "alice");
    }

    #[test]
    fn snapshot_now_also_sweeps_up_changes_no_event_ever_marked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"s").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();
        // Never marked: the engine has no idea this file changed.
        std::fs::write(dir.path().join("unseen.md"), b"u").unwrap();

        assert!(handle.snapshot_now().unwrap());

        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains("unseen.md"), "{files}");
        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an %s"]),
            "SilverBullet Manual snapshot"
        );
    }

    #[test]
    fn snapshot_now_reports_when_there_was_nothing_to_commit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"s").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();

        assert!(!handle.snapshot_now().unwrap());
    }

    #[test]
    fn snapshot_now_refuses_on_an_unmanaged_repo() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        let handle = RevisionEngine::start(store, None);

        let err = handle.snapshot_now().unwrap_err();

        assert!(err.contains("not managed"), "{err}");
        assert!(!handle.store().head_exists(), "nothing may be committed");
    }

    #[tokio::test]
    async fn resync_event_triggers_full_rescan_marked_external() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = tokio::sync::broadcast::channel(16);
        let handle = RevisionEngine::start(managed(&dir), Some(rx));
        handle.commit_now();

        std::fs::write(dir.path().join("newly-created.md"), b"z").unwrap();
        tx.send(crate::watcher::FsEvent::resync()).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        handle.commit_now();

        let authors = git_out(dir.path(), &["log", "--format=%an"]);
        assert!(authors.contains("External"), "{authors}");
        let files = git_out(dir.path(), &["log", "--name-only"]);
        assert!(files.contains("newly-created.md"), "{files}");
    }

    #[tokio::test]
    async fn lagged_broadcast_triggers_rescan_marked_external() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = tokio::sync::broadcast::channel(1);
        let handle = RevisionEngine::start(managed(&dir), Some(rx));
        handle.commit_now();

        std::fs::write(dir.path().join("later.md"), b"z").unwrap();
        for _ in 0..30 {
            let _ = tx.send(crate::watcher::FsEvent::resync());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        handle.commit_now();

        let authors = git_out(dir.path(), &["log", "--format=%an"]);
        assert!(authors.contains("External"), "{authors}");
        let files = git_out(dir.path(), &["log", "--name-only"]);
        assert!(files.contains("later.md"), "{files}");
    }

    #[test]
    fn concurrent_commit_now_calls_do_not_misattribute_across_authors() {
        let dir = tempfile::tempdir().unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();

        let stop = Arc::new(AtomicBool::new(false));
        let h_bg = handle.clone();
        let stop_bg = stop.clone();
        let dir_bg = dir.path().to_path_buf();
        let bg = std::thread::spawn(move || {
            let mut i = 0;
            while !stop_bg.load(Ordering::Relaxed) {
                let name = format!("bg-{i}.md");
                std::fs::write(dir_bg.join(&name), b"x").unwrap();
                h_bg.mark(
                    &name,
                    Attribution::Account {
                        name: "bob".into(),
                        email: None,
                    },
                );
                h_bg.commit_now();
                i += 1;
            }
        });

        for i in 0..30 {
            let name = format!("fg-{i}.md");
            std::fs::write(dir.path().join(&name), b"y").unwrap();
            handle.mark(
                &name,
                Attribution::Account {
                    name: "alice".into(),
                    email: None,
                },
            );
            handle.commit_now();
        }
        stop.store(true, Ordering::Relaxed);
        bg.join().unwrap();
        handle.commit_now();

        let log = git_out(dir.path(), &["log", "--name-only", "--format=--author:%an"]);
        let mut author = "";
        for line in log.lines() {
            if let Some(a) = line.strip_prefix("--author:") {
                author = if a == "bob" {
                    "bob"
                } else if a == "alice" {
                    "alice"
                } else {
                    ""
                };
                continue;
            }
            if line.is_empty() {
                continue;
            }
            if let Some(stripped) = line.strip_prefix("bg-") {
                assert_eq!(author, "bob", "misattributed bg-{stripped} to {author}");
            } else if let Some(stripped) = line.strip_prefix("fg-") {
                assert_eq!(author, "alice", "misattributed fg-{stripped} to {author}");
            }
        }
        assert_eq!(
            git_out(dir.path(), &["status", "--porcelain"]),
            "",
            "clean tree: no batch was silently discarded"
        );
    }

    #[test]
    fn rescan_does_not_relabel_a_pending_user_edit_as_external() {
        let dir = tempfile::tempdir().unwrap();
        let handle = RevisionEngine::start(managed(&dir), None);
        handle.commit_now();

        std::fs::write(dir.path().join("a.md"), b"a").unwrap();
        std::fs::write(dir.path().join("b.md"), b"b").unwrap();
        handle.mark(
            "a.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );
        handle.inner.rescan_as_external();
        handle.commit_now();

        let log = git_out(dir.path(), &["log", "--name-only", "--format=--author:%an"]);
        let mut author = "";
        for line in log.lines() {
            if let Some(a) = line.strip_prefix("--author:") {
                author = a;
            } else if line == "a.md" {
                assert_eq!(author, "alice", "rescan clobbered alice's attribution");
            }
        }
        assert!(log.contains("b.md"), "{log}");
    }

    #[test]
    fn dropping_a_handle_racing_its_own_tick_thread_flushes_and_returns() {
        let dir = tempfile::tempdir().unwrap();

        for i in 0..50 {
            let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
            let handle = RevisionEngine::start_with_timing(
                store,
                None,
                Duration::from_millis(1),
                Duration::from_secs(300),
                Duration::from_millis(1),
            );
            let name = format!("race-{i}.md");
            std::fs::write(dir.path().join(&name), b"x").unwrap();
            handle.mark(
                &name,
                Attribution::Account {
                    name: "alice".into(),
                    email: None,
                },
            );
            std::thread::sleep(Duration::from_millis(3));
            drop(handle);
        }

        assert_eq!(
            git_out(dir.path(), &["status", "--porcelain"]),
            "",
            "every dropped handle flushed its pending marks"
        );
    }

    fn test_change_event(name: &str, display_name: Option<&str>) -> FsEvent {
        FsEvent {
            name: name.to_string(),
            action: FsAction::Change,
            last_modified: 1,
            revision: None,
            origin: Some(user_origin(display_name, None)),
        }
    }
}
