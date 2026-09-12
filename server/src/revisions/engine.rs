use super::store::RevisionStore;
use super::sync::{self, SyncError, TickOutcome};
use crate::watcher::{EventOrigin, EventOriginKind, FsAction, FsEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_secs(30);
const MAX_INTERVAL: Duration = Duration::from_secs(300);
/// Safety net: how often to reconcile the working tree against HEAD even
/// though nothing was ever marked dirty.
const SWEEP_INTERVAL: Duration = Duration::from_secs(3600);
/// How often a conflicted repo re-ticks, whatever `pull_interval` says. Only
/// a tick can close a resolved merge, and while `MERGE_HEAD` exists every
/// commit is refused -- so the post-commit trigger, the sole other caller,
/// can never fire.
const CONFLICT_RETRY: Duration = Duration::from_secs(60);
const SWEEP_MESSAGE: &str = "Periodic sweep";
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
    /// When the reconciling sweep last ran, successfully or not.
    last_sweep: Instant,
    stopping: bool,
}

#[derive(Clone, Copy)]
pub struct Timing {
    quiet: Duration,
    max_interval: Duration,
    sweep_interval: Duration,
    conflict_retry: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            quiet: QUIET,
            max_interval: MAX_INTERVAL,
            sweep_interval: SWEEP_INTERVAL,
            conflict_retry: CONFLICT_RETRY,
        }
    }
}

impl Timing {
    pub fn from_parts(quiet: Duration, max_interval: Duration) -> Timing {
        Timing {
            quiet,
            max_interval,
            sweep_interval: SWEEP_INTERVAL,
            conflict_retry: CONFLICT_RETRY,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SyncSettings {
    pub server_root: PathBuf,
    pub space_id: String,
    pub mode: crate::multi::config::GitSyncMode,
    pub pull_interval: Option<Duration>,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SyncState {
    Idle,
    Syncing,
    Conflicted {
        paths: Vec<String>,
    },
    Paused {
        reason: String,
    },
    Error {
        kind: String,
        #[serde(skip_serializing_if = "String::is_empty")]
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSnapshot {
    pub sync: SyncState,
    pub last_attempt: Option<u64>,
    pub last_success: Option<u64>,
    pub version: u64,
    pub enabled: bool,
    pub paused: bool,
    pub pending: Option<usize>,
    pub incoming: Option<usize>,
    pub dirty: bool,
}

#[derive(Default)]
struct SyncTelemetry {
    version: u64,
    last_attempt: Option<u64>,
    last_success: Option<u64>,
    pending: Option<usize>,
    incoming: Option<usize>,
    dirty: bool,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

struct Flight<'a>(&'a AtomicBool);
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl SyncState {
    /// Raw Git diagnostics belong in the admin projection.
    pub fn without_message(&self) -> SyncState {
        match self {
            SyncState::Error { kind, .. } => SyncState::Error {
                kind: kind.clone(),
                message: String::new(),
            },
            other => other.clone(),
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
    sync: Option<SyncSettings>,
    sync_state: Mutex<SyncState>,
    /// The last state actually broadcast, which `sync_state` is not:
    /// `Syncing` is written there silently every tick, and comparing against
    /// it would make an unresolved conflict look like a fresh transition.
    last_broadcast_sync_state: Mutex<SyncState>,
    /// Fires only on an actual `SyncState` transition (see `set_sync_state`),
    /// never on every tick -- a conflict persists across many ticks, and
    /// resending it each time would train users to dismiss the notification.
    sync_events: tokio::sync::broadcast::Sender<SyncState>,
    last_sync: Mutex<Option<Instant>>,
    sync_failures: AtomicU32,
    sync_paused: AtomicBool,
    sync_running: AtomicBool,
    sync_requested: AtomicBool,
    telemetry: Mutex<SyncTelemetry>,
    fs_guard: Arc<crate::fs_guard::FsGuard>,
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
        self.notify_file_saved();
    }

    fn notify_file_saved(&self) {
        if self
            .store
            .repo_root()
            .is_some_and(|repo| super::store::merge_in_progress(&repo))
        {
            self.sync_requested.store(true, Ordering::Release);
            self.state.1.notify_all();
        }
        let mut telemetry = self.telemetry.lock().unwrap_or_else(|e| e.into_inner());
        telemetry.version += 1;
        telemetry.pending = None;
    }

    /// `overwrite: false` keeps an already-pending per-user attribution, so a
    /// blanket rescan can't relabel a user's own edit as external.
    fn record(&self, space_path: &str, attribution: Attribution, overwrite: bool) {
        if !self.store.auto_commit_allowed() {
            return;
        }
        let (lock, cv) = &self.state;
        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        // Only the idle -> dirty transition moves the commit thread's deadline
        // earlier; while marks are already pending, a further mark can only
        // push the quiet deadline out, so the sleep it is already in remains
        // valid (it wakes early, recomputes, and waits again). Notifying per
        // mark would wake the thread thousands of times during a rescan for
        // no gain.
        let was_idle = guard.first_mark.is_none();
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
        drop(guard);
        if was_idle {
            cv.notify_all();
        }
    }

    /// Whether it produced at least one commit.
    fn commit_now(&self) -> bool {
        if !self.store.auto_commit_allowed() {
            return false;
        }
        let _commit_guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        self.commit_locked()
    }

    /// `commit_lock` is not reentrant, so the flush every caller needs lives
    /// here and each of them takes the lock exactly once.
    fn commit_locked(&self) -> bool {
        let _mutation = self
            .fs_guard
            .mutation
            .write()
            .unwrap_or_else(|e| e.into_inner());
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
            let (name, email) = self.identity_for(&attribution);
            match self.store.commit_batch_auto(&name, &email, &paths) {
                Ok(id) => {
                    committed |= id.is_some();
                    self.warned.store(false, Ordering::Relaxed);
                }
                Err(e) => {
                    if !self.warned.swap(true, Ordering::Relaxed) {
                        tracing::warn!("History auto-commit skipped: {e}");
                    }
                    let (lock, cv) = &self.state;
                    let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                    let now = Instant::now();
                    guard.first_mark.get_or_insert(now);
                    guard.last_mark = Some(now);
                    for p in paths {
                        guard.dirty.entry(p).or_insert_with(|| attribution.clone());
                    }
                    // The batch was taken, so this is an idle -> dirty
                    // transition: the waiting thread needs a new deadline to
                    // retry against, and `snapshot_now` can land here off-thread.
                    drop(guard);
                    cv.notify_all();
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

    /// Reconcile the working tree against HEAD, committing whatever the
    /// watcher never reported. The engine only ever commits what it was told
    /// changed, so a lost event is otherwise invisible and permanent.
    /// Returns whether it produced a commit.
    fn sweep(&self) -> bool {
        if !self.store.auto_commit_allowed() {
            return false;
        }
        let _commit_guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        // Read-only probe first. `git.rs` sets GIT_OPTIONAL_LOCKS=0, so this
        // `git status` will not write the index: an idle space costs one stat
        // walk per sweep and no writes at all.
        let paths: Vec<String> = match super::read::uncommitted_files(&self.store) {
            Ok(files) => files.into_iter().map(|f| f.path).collect(),
            Err(e) => {
                tracing::warn!("History sweep could not inspect the space: {e}");
                return false;
            }
        };
        if paths.is_empty() {
            return false;
        }
        // Anything marked between the loop's check and here is about to be
        // committed by the debounce path with its real author; a sweep would
        // flatten that to External, so leave it alone.
        {
            let (lock, _) = &self.state;
            let guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            if !guard.dirty.is_empty() {
                return false;
            }
        }
        // Reaching here means the event path dropped something: every
        // watcher-reported change is committed on the debounce, long before a
        // sweep interval elapses. This warning is the only signal of that.
        tracing::warn!(
            "History sweep found {} uncommitted change(s) the watcher never reported ({}); committing",
            paths.len(),
            sample(&paths)
        );
        let (name, email) = self.identity_for(&Attribution::External);
        match self.store.commit_all(&name, &email, SWEEP_MESSAGE) {
            Ok(id) => id.is_some(),
            Err(e) => {
                tracing::warn!("History sweep commit failed: {e}");
                false
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

    /// Exponential backoff on repeated failure, capped near an hour, so a
    /// revoked key does not retry every interval forever.
    fn sync_backoff(&self) -> Duration {
        let n = self.sync_failures.load(Ordering::Acquire).min(6);
        Duration::from_secs(60u64 << n).min(Duration::from_secs(3600))
    }

    /// Acquires `commit_lock` itself; never call this from a path that
    /// already holds it (`commit_now`, `sweep` and `snapshot_now` all do).
    fn sync_now(&self, allow_unrelated: bool) -> Result<TickOutcome, SyncError> {
        if !self.store.auto_commit_allowed() {
            return Ok(TickOutcome::Idle);
        }
        let Some(settings) = self.sync.as_ref() else {
            return Ok(TickOutcome::Idle);
        };
        let Some(repo) = self.store.repo_root() else {
            return Ok(TickOutcome::Idle);
        };
        if self
            .sync_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(TickOutcome::Idle);
        }
        let _flight = Flight(&self.sync_running);
        let _guard = self.commit_lock.lock().unwrap_or_else(|e| e.into_inner());
        if self.sync_paused.load(Ordering::Acquire) {
            return Ok(TickOutcome::Idle);
        }
        self.sync_requested.store(false, Ordering::Release);
        {
            let mut telemetry = self.telemetry.lock().unwrap_or_else(|e| e.into_inner());
            telemetry.last_attempt = Some(now_millis());
            telemetry.version += 1;
        }
        *self.last_sync.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        let envs = match super::keys::checked_envs_for_mode(
            settings.mode,
            &settings.server_root,
            &settings.space_id,
            &repo,
        ) {
            Ok(envs) => envs,
            Err(error) => {
                self.sync_failures.fetch_add(1, Ordering::AcqRel);
                let (kind, message) = describe_sync_error(&error);
                self.set_sync_state(SyncState::Error { kind, message });
                return Err(error);
            }
        };
        self.commit_locked();
        *self.last_sync.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        self.set_sync_state_silent(SyncState::Syncing);

        let completion = {
            let _mutation = self
                .fs_guard
                .mutation
                .write()
                .unwrap_or_else(|e| e.into_inner());
            sync::try_complete_merge(&repo)
        };
        match completion {
            Ok(sync::MergeCompletion::Completed) => {
                tracing::info!("Completed a resolved merge in {repo:?}");
            }
            Ok(sync::MergeCompletion::Unresolvable { .. }) => {
                let paths = sync::unmerged_paths(&repo);
                self.set_sync_state(SyncState::Conflicted {
                    paths: paths.clone(),
                });
                return Ok(TickOutcome::Conflicted(paths));
            }
            Ok(sync::MergeCompletion::Pending) => {}
            Err(e) => tracing::warn!("Could not complete the merge in {repo:?}: {e:?}"),
        }
        if super::store::merge_in_progress(&repo) {
            let paths = sync::unmerged_paths(&repo);
            self.set_sync_state(SyncState::Conflicted {
                paths: paths.clone(),
            });
            return Ok(TickOutcome::Conflicted(paths));
        }

        let result = sync::tick_guarded(
            &repo,
            &envs,
            allow_unrelated,
            Some(&self.fs_guard),
            Some(settings),
        );
        match &result {
            Ok(TickOutcome::Conflicted(paths)) => {
                self.sync_failures.store(0, Ordering::Release);
                self.set_sync_state(SyncState::Conflicted {
                    paths: paths.clone(),
                });
            }
            Ok(_) => {
                {
                    let mut telemetry = self.telemetry.lock().unwrap_or_else(|e| e.into_inner());
                    telemetry.last_success = Some(now_millis());
                    telemetry.pending = Some(0);
                    telemetry.incoming = Some(0);
                }
                self.sync_failures.store(0, Ordering::Release);
                let was_idle = matches!(
                    *self
                        .last_broadcast_sync_state
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()),
                    SyncState::Idle
                );
                self.set_sync_state(SyncState::Idle);
                if was_idle {
                    let _ = self.sync_events.send(SyncState::Idle);
                }
            }
            Err(e) => {
                self.sync_failures.fetch_add(1, Ordering::AcqRel);
                tracing::warn!("Git sync failed for {repo:?}: {e:?}");
                let (kind, message) = describe_sync_error(e);
                self.set_sync_state(SyncState::Error { kind, message });
            }
        }
        result
    }

    /// Whether an outstanding merge is what the space is sitting on.
    fn merge_pending(&self) -> bool {
        if matches!(
            *self
                .last_broadcast_sync_state
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
            SyncState::Conflicted { .. } | SyncState::Paused { .. }
        ) {
            return true;
        }
        match self.store.repo_root() {
            Some(repo) => super::store::merge_in_progress(&repo),
            None => false,
        }
    }

    /// How often a tick is due, or `None` when nothing schedules one. A
    /// conflicted repo is a scheduling reason of its own: `pull_interval` may
    /// be `None` (the "only when I change something" preset), and while the
    /// merge is outstanding no commit can land to drive the other trigger.
    fn sync_interval(&self, conflict_retry: Duration) -> Option<Duration> {
        if self.sync_paused.load(Ordering::Acquire) {
            return None;
        }
        let settings = self.sync.as_ref()?;
        let interval = match (settings.pull_interval, self.merge_pending()) {
            (Some(i), true) => i.min(conflict_retry),
            (Some(i), false) => i,
            (None, true) => conflict_retry,
            (None, false) => return None,
        };
        if self.sync_failures.load(Ordering::Acquire) == 0 {
            return Some(interval);
        }
        Some(interval.max(self.sync_backoff()))
    }

    fn sync_should_wait_out_backoff(&self) -> bool {
        if self.sync_failures.load(Ordering::Acquire) == 0 {
            return false;
        }
        match *self.last_sync.lock().unwrap_or_else(|e| e.into_inner()) {
            Some(last) => last.elapsed() < self.sync_backoff(),
            None => false,
        }
    }

    fn set_sync_state(&self, state: SyncState) {
        *self.sync_state.lock().unwrap_or_else(|e| e.into_inner()) = state.clone();
        self.telemetry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .version += 1;
        {
            let mut last = self
                .last_broadcast_sync_state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if *last == state {
                return;
            }
            *last = state.clone();
        }
        let _ = self.sync_events.send(state);
        // Entering or leaving a conflict changes when the next tick is due,
        // and a tick driven from off-thread (`POST /git/sync`) leaves the loop
        // parked on the deadline it chose before that was true.
        let (lock, cv) = &self.state;
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        cv.notify_all();
    }

    /// Like `set_sync_state`, but never broadcasts and never updates
    /// `last_broadcast_sync_state` -- `Syncing` is transient internal
    /// telemetry that `/.revisions/` polling may observe, but a `/.events`
    /// subscriber must not be told about, and it must not count as the
    /// "previous state" the next terminal outcome is compared against.
    fn set_sync_state_silent(&self, state: SyncState) {
        *self.sync_state.lock().unwrap_or_else(|e| e.into_inner()) = state;
        self.telemetry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .version += 1;
    }
}

/// A restart mid-conflict must not report `Idle`: `MERGE_HEAD` survives the
/// process, and with it the paused auto-commit the state is meant to explain.
fn initial_sync_state(store: &RevisionStore) -> SyncState {
    match store.repo_root() {
        Some(repo) if super::store::merge_in_progress(&repo) => SyncState::Conflicted {
            paths: sync::unmerged_paths(&repo),
        },
        _ => SyncState::Idle,
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

/// `kind` is a machine token the UI branches on; `message` only carries what
/// `kind` does not already say, so a classified variant (its Debug form *is*
/// the token) gets none, and only the catch-all keeps the stderr -- redacted,
/// because git echoes the whole remote URL, credentials included.
pub(crate) fn describe_sync_error(e: &SyncError) -> (String, String) {
    match e {
        SyncError::Other(stderr) => ("Other".to_string(), redact_credentials(stderr)),
        other => (format!("{other:?}"), String::new()),
    }
}

pub(crate) fn redact_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(scheme_at) = rest.find("://") {
        let after_scheme = scheme_at + 3;
        out.push_str(&rest[..after_scheme]);
        let tail = &rest[after_scheme..];
        let authority_end = tail
            .find(|c: char| c == '/' || c == '?' || c == '#' || c.is_whitespace())
            .unwrap_or(tail.len());
        let authority = &tail[..authority_end];
        match authority.rfind('@') {
            Some(at) => {
                out.push_str("[redacted]");
                out.push_str(&authority[at..]);
            }
            None => out.push_str(authority),
        }
        rest = &tail[authority_end..];
    }
    out.push_str(rest);
    out
}

/// A few paths for a log line, so a sweep over a large space stays readable.
fn sample(paths: &[String]) -> String {
    const SHOWN: usize = 3;
    let head = paths
        .iter()
        .take(SHOWN)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    match paths.len().checked_sub(SHOWN) {
        Some(rest) if rest > 0 => format!("{head}, +{rest} more"),
        _ => head,
    }
}

/// Time until the next commit, sweep, or sync deadline. Marks that move the
/// deadline earlier wake the waiting thread.
fn next_deadline(
    state: &EngineState,
    quiet: Duration,
    max_interval: Duration,
    sweep_interval: Duration,
    sync_wait: Option<Duration>,
) -> Duration {
    let mut wait = sweep_interval.saturating_sub(state.last_sweep.elapsed());
    if let (Some(first), Some(last)) = (state.first_mark, state.last_mark) {
        wait = wait
            .min(quiet.saturating_sub(last.elapsed()))
            .min(max_interval.saturating_sub(first.elapsed()));
    }
    if let Some(sync_wait) = sync_wait {
        wait = wait.min(sync_wait);
    }
    // Never sleep zero: a deadline that has saturated but is not yet "due"
    // by the caller's own comparison would spin this loop.
    wait.max(Duration::from_millis(1))
}

pub struct RevisionEngine {
    inner: Arc<EngineInner>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl RevisionEngine {
    pub fn start(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        timing: Timing,
        sync: Option<SyncSettings>,
    ) -> Arc<RevisionEngine> {
        Self::start_internal(
            store,
            events,
            timing,
            sync,
            Arc::new(crate::fs_guard::FsGuard::default()),
        )
    }

    #[cfg(test)]
    pub(crate) fn start_with_timing(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        timing: Timing,
        sync: Option<SyncSettings>,
    ) -> Arc<RevisionEngine> {
        Self::start_internal(
            store,
            events,
            timing,
            sync,
            Arc::new(crate::fs_guard::FsGuard::default()),
        )
    }

    pub fn start_with_fs_guard(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        timing: Timing,
        sync: Option<SyncSettings>,
        fs_guard: Arc<crate::fs_guard::FsGuard>,
    ) -> Arc<RevisionEngine> {
        Self::start_internal(store, events, timing, sync, fs_guard)
    }

    fn start_internal(
        store: RevisionStore,
        events: Option<tokio::sync::broadcast::Receiver<FsEvent>>,
        timing: Timing,
        sync: Option<SyncSettings>,
        fs_guard: Arc<crate::fs_guard::FsGuard>,
    ) -> Arc<RevisionEngine> {
        if let Some(repo) = store.repo_root() {
            if super::store::merge_in_progress(&repo) {
                let _ = super::conflicts::capture(&repo);
            }
        }
        let store = Arc::new(store);
        let initial_snapshot_paths = if store.auto_commit_allowed() && !store.head_exists() {
            list_all_paths(store.root())
        } else {
            None
        };
        let (sync_events, _) = tokio::sync::broadcast::channel(16);
        let initial_sync_state = if sync.as_ref().is_some_and(|s| s.paused) {
            SyncState::Paused {
                reason: "Sync is paused".into(),
            }
        } else if sync.is_some() {
            initial_sync_state(&store)
        } else {
            SyncState::Idle
        };
        let inner = Arc::new(EngineInner {
            store: store.clone(),
            state: (
                Mutex::new(EngineState {
                    dirty: HashMap::new(),
                    first_mark: None,
                    last_mark: None,
                    last_sweep: Instant::now(),
                    stopping: false,
                }),
                Condvar::new(),
            ),
            warned: AtomicBool::new(false),
            commit_lock: Mutex::new(()),
            snapshot_done: AtomicBool::new(false),
            initial_snapshot_paths,
            sync_paused: AtomicBool::new(sync.as_ref().is_some_and(|s| s.paused)),
            sync,
            sync_state: Mutex::new(initial_sync_state.clone()),
            last_broadcast_sync_state: Mutex::new(initial_sync_state),
            sync_events,
            last_sync: Mutex::new(None),
            sync_failures: AtomicU32::new(0),
            sync_running: AtomicBool::new(false),
            sync_requested: AtomicBool::new(false),
            telemetry: Mutex::new(SyncTelemetry::default()),
            fs_guard,
        });

        let thread = if inner.store.auto_commit_allowed() {
            let tick_inner = inner.clone();
            let quiet = timing.quiet;
            let max_interval = timing.max_interval;
            let sweep_interval = timing.sweep_interval;
            let conflict_retry = timing.conflict_retry;
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
                        let commit_due = match (guard.first_mark, guard.last_mark) {
                            (Some(first), Some(last)) => {
                                last.elapsed() >= quiet || first.elapsed() >= max_interval
                            }
                            _ => false,
                        };
                        let sweep_due = guard.last_sweep.elapsed() >= sweep_interval;
                        let last_sync = *tick_inner
                            .last_sync
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        let sync_interval = tick_inner.sync_interval(conflict_retry);
                        let sync_due = (!tick_inner.sync_paused.load(Ordering::Acquire)
                            && tick_inner.sync_requested.load(Ordering::Acquire))
                            || match (sync_interval, last_sync) {
                                (Some(i), Some(last)) => last.elapsed() >= i,
                                (Some(_), None) => true,
                                (None, _) => false,
                            };
                        if !commit_due && !sweep_due && !sync_due {
                            let sync_wait = sync_interval.map(|i| match last_sync {
                                Some(last) => i.saturating_sub(last.elapsed()),
                                None => Duration::from_millis(1),
                            });
                            let wait = next_deadline(
                                &guard,
                                quiet,
                                max_interval,
                                sweep_interval,
                                sync_wait,
                            );
                            let (g, _) = cv
                                .wait_timeout(guard, wait)
                                .unwrap_or_else(|e| e.into_inner());
                            drop(g);
                            continue;
                        }
                        if sweep_due {
                            // Reset up front, including when the sweep below
                            // bails: a sweep deferred because the debounce path
                            // owns the change has nothing to find anyway.
                            guard.last_sweep = Instant::now();
                        }
                        drop(guard);
                        if commit_due {
                            let committed = tick_inner.commit_now();
                            if committed
                                && tick_inner.sync.is_some()
                                && !tick_inner.sync_should_wait_out_backoff()
                            {
                                let _ = tick_inner.sync_now(false);
                            }
                        }
                        if sweep_due
                            && tick_inner.sweep()
                            && !tick_inner.sync_should_wait_out_backoff()
                        {
                            let _ = tick_inner.sync_now(false);
                        }
                        if sync_due {
                            let _ = tick_inner.sync_now(false);
                        }
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

    pub fn notify_file_saved(&self) {
        self.inner.notify_file_saved();
    }

    pub fn request_sync(&self) {
        if self.inner.sync.is_some()
            && !self.inner.sync_paused.load(Ordering::Acquire)
            && !self.inner.sync_running.load(Ordering::Acquire)
        {
            self.inner.sync_requested.store(true, Ordering::Release);
            self.inner.state.1.notify_all();
        }
    }

    pub fn sync_snapshot(&self) -> SyncSnapshot {
        let sync = self.sync_state();
        let dirty = super::read::uncommitted_files(self.store())
            .map(|files| !files.is_empty())
            .unwrap_or(false);
        let counts = self
            .store()
            .repo_root()
            .and_then(|repo| sync::ahead_behind(&repo, "HEAD").ok());
        let mut telemetry = self
            .inner
            .telemetry
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (pending, incoming) = match counts {
            Some((ahead, behind)) => (Some(ahead), Some(behind)),
            None => (None, None),
        };
        if telemetry.dirty != dirty
            || telemetry.pending != pending
            || telemetry.incoming != incoming
        {
            telemetry.version += 1;
            telemetry.dirty = dirty;
            telemetry.pending = pending;
            telemetry.incoming = incoming;
        }
        SyncSnapshot {
            sync,
            last_attempt: telemetry.last_attempt,
            last_success: telemetry.last_success,
            version: telemetry.version,
            enabled: self.inner.sync.is_some(),
            paused: self.inner.sync_paused.load(Ordering::Acquire),
            pending: telemetry.pending,
            incoming: telemetry.incoming,
            dirty,
        }
    }

    pub fn conflicts(&self) -> Result<super::conflicts::ConflictList, SyncError> {
        let _guard = self
            .inner
            .commit_lock
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _mutation = self
            .inner
            .fs_guard
            .mutation
            .write()
            .unwrap_or_else(|e| e.into_inner());
        let repo = self.store().repo_root().ok_or(SyncError::NoRemote)?;
        super::conflicts::list(&repo)
    }

    pub fn resolve_conflict(
        &self,
        id: &str,
        request: &super::conflicts::ResolveRequest,
        actor: &crate::auth::Actor,
    ) -> Result<super::conflicts::ConflictList, super::conflicts::ResolveError> {
        let result = {
            let _guard = self
                .inner
                .commit_lock
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let _mutation = self
                .inner
                .fs_guard
                .mutation
                .write()
                .unwrap_or_else(|e| e.into_inner());
            let repo = self.store().repo_root().ok_or(SyncError::NoRemote)?;
            let before = super::conflicts::list(&repo)?;
            let path = before
                .conflicts
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.path.clone());
            let attribution = attribution_for(Some(&EventOrigin {
                kind: EventOriginKind::User,
                display_name: actor.full_name.clone().or_else(|| actor.username.clone()),
                email: actor.email.clone(),
                client_id: None,
                source: Some("git-conflict-resolution".into()),
            }));
            let (name, email) = self.inner.identity_for(&attribution);
            let result = super::conflicts::resolve_as(
                &repo,
                id,
                request,
                Some(super::conflicts::Resolver { name, email }),
            )?;
            if let Some(path) = path {
                self.inner.fs_guard.forget(&path);
                let hash = std::fs::read(repo.join(&path))
                    .ok()
                    .map(|bytes| silverbullet_server_common::revision::sha256_hex(&bytes))
                    .or_else(|| request.content_revision.clone());
                if let Some(hash) = hash {
                    self.inner.fs_guard.record_expected_write(
                        &path,
                        &hash,
                        actor.clone(),
                        None,
                        Some("git-conflict-resolution".into()),
                    );
                }
            }
            result
        };
        self.request_sync();
        Ok(result)
    }

    pub fn inherit_sync_history(&self, previous: &RevisionEngine) {
        let previous = previous
            .inner
            .telemetry
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut current = self
            .inner
            .telemetry
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        current.last_attempt = previous.last_attempt;
        current.last_success = previous.last_success;
        current.pending = previous.pending;
        current.incoming = previous.incoming;
        current.dirty = previous.dirty;
        current.version = current.version.max(previous.version) + 1;
    }

    pub fn conflict_side(
        &self,
        id: &str,
        generation: &str,
        side: &str,
    ) -> Result<Vec<u8>, super::conflicts::ResolveError> {
        let _guard = self
            .inner
            .commit_lock
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let repo = self.store().repo_root().ok_or(SyncError::NoRemote)?;
        super::conflicts::download(&repo, id, generation, side)
    }

    pub fn quiesce_sync(&self) {
        self.inner.sync_paused.store(true, Ordering::Release);
        let _guard = self
            .inner
            .commit_lock
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        self.inner.set_sync_state(SyncState::Paused {
            reason: "Sync is paused".into(),
        });
    }

    pub fn set_sync_paused(&self, paused: bool) {
        if paused {
            self.quiesce_sync();
        } else {
            self.inner.sync_paused.store(false, Ordering::Release);
            self.inner.set_sync_state(SyncState::Idle);
            self.request_sync();
        }
    }

    pub fn sync_state(&self) -> SyncState {
        self.inner
            .sync_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The last *terminal* `SyncState` -- what `sync_state()` holds minus
    /// any transient `Syncing` a tick may currently have it set to (see
    /// `set_sync_state_silent`). This is what an SSE subscriber must be
    /// shown as "current state": `Syncing` is internal telemetry for
    /// `/.revisions/` pollers, not something a client should ever be told
    /// to react to.
    pub fn last_broadcast_sync_state(&self) -> SyncState {
        self.inner
            .last_broadcast_sync_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// `allow_unrelated` is never persisted: a one-time confirmation in the
    /// admin UI passes it for a single tick. Persisting it would silently
    /// permit unrelated-history merges forever.
    pub fn sync_now(&self, allow_unrelated: bool) -> Result<TickOutcome, SyncError> {
        self.inner.sync_now(allow_unrelated)
    }

    /// A `SyncState` transition as it happens -- see `set_sync_state`. Backs
    /// the `/.events` `sync` SSE event.
    pub fn subscribe_sync(&self) -> tokio::sync::broadcast::Receiver<SyncState> {
        self.inner.sync_events.subscribe()
    }

    #[cfg(test)]
    pub fn set_sync_state_for_test(&self, state: SyncState) {
        self.inner.set_sync_state(state);
    }

    /// Sets `sync_state` (what `/.revisions/` and a naive SSE reader would
    /// see) without touching `last_broadcast_sync_state` -- simulates a tick
    /// currently in flight, mid-`Syncing`, for tests exercising that race.
    #[cfg(test)]
    pub fn set_sync_state_silent_for_test(&self, state: SyncState) {
        self.inner.set_sync_state_silent(state);
    }
}

#[cfg(test)]
pub(crate) fn engine_with_sync_for_test() -> (Arc<RevisionEngine>, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = RevisionStore::open(
        dir.path(),
        silverbullet_server_common::RevisionsMode::Managed,
    )
    .expect("open revision store");
    let engine = RevisionEngine::start(store, None, Timing::default(), None);
    (engine, dir)
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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

    #[test]
    fn a_vanished_untracked_path_does_not_block_later_commits_for_its_author() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("seed.md"), b"seed").unwrap();
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
        handle.commit_now();

        std::fs::write(dir.path().join("gone.md"), b"ephemeral").unwrap();
        handle.mark("gone.md", Attribution::LocalUser);
        std::fs::remove_file(dir.path().join("gone.md")).unwrap();
        handle.mark("gone.md", Attribution::LocalUser);
        handle.commit_now();

        std::fs::write(dir.path().join("later.md"), b"persisted").unwrap();
        handle.mark("later.md", Attribution::LocalUser);
        handle.commit_now();

        assert_eq!(git_out(dir.path(), &["show", "HEAD:later.md"]), "persisted");
        assert_eq!(git_out(dir.path(), &["status", "--porcelain"]), "");
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
        handle.commit_now();

        assert_eq!(
            commit_as(&dir, &handle, "alice"),
            format!("alice <alice@{DEFAULT_DOMAIN}>")
        );
    }

    #[test]
    fn attribution_resolves_to_the_expected_identity() {
        let dir = tempfile::tempdir().unwrap();
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);

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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(store, None, Timing::default(), None);
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
            let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), Some(rx), Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), Some(rx), Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
        handle.commit_now();

        assert!(!handle.snapshot_now().unwrap());
    }

    #[test]
    fn snapshot_now_refuses_on_an_unmanaged_repo() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        let handle = RevisionEngine::start(store, None, Timing::default(), None);

        let err = handle.snapshot_now().unwrap_err();

        assert!(err.contains("not managed"), "{err}");
        assert!(!handle.store().head_exists(), "nothing may be committed");
    }

    #[tokio::test]
    async fn resync_event_triggers_full_rescan_marked_external() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = tokio::sync::broadcast::channel(16);
        let handle = RevisionEngine::start(managed(&dir), Some(rx), Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), Some(rx), Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
        let handle = RevisionEngine::start(managed(&dir), None, Timing::default(), None);
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
                Timing {
                    quiet: Duration::from_millis(1),
                    max_interval: Duration::from_secs(300),
                    // Long sweep interval: this test is about the debounce/drop
                    // race, not the safety net.
                    sweep_interval: Duration::from_secs(3600),
                    conflict_retry: CONFLICT_RETRY,
                },
                None,
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

    /// `git log` before the first commit exits non-zero, which `git_out`
    /// treats as fatal. The sweep tests poll the log from the moment the
    /// engine starts, so they need the empty-repo answer instead.
    fn git_log(dir: &Path, args: &[&str]) -> String {
        let mut full = vec!["log"];
        full.extend_from_slice(args);
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(&full)
            .output()
            .unwrap();
        if out.status.success() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            String::new()
        }
    }

    /// Poll for a condition instead of sleeping a fixed slack period, so the
    /// deadline-driven tests stay fast without getting flaky on a loaded box.
    fn wait_until(deadline: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        cond()
    }

    /// The safety net: a change the engine was never told about still lands.
    #[test]
    fn sweep_commits_a_change_the_watcher_never_reported() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), b"hello").unwrap();
        let handle = RevisionEngine::start_with_timing(
            managed(&dir),
            None,
            Timing {
                quiet: Duration::from_secs(30),
                max_interval: Duration::from_secs(300),
                sweep_interval: Duration::from_millis(50),
                conflict_retry: CONFLICT_RETRY,
            },
            None,
        );

        // Written behind the engine's back: no event, no mark. Before the
        // sweep existed this sat uncommitted forever.
        std::fs::write(dir.path().join("lost.md"), b"never announced").unwrap();

        assert!(
            wait_until(Duration::from_secs(10), || {
                git_log(dir.path(), &["--format=%s"]).contains(SWEEP_MESSAGE)
            }),
            "sweep never committed: {}",
            git_out(dir.path(), &["status", "--porcelain"])
        );
        drop(handle);

        let log = git_out(dir.path(), &["log", "-1", "--format=%an", "--", "lost.md"]);
        assert_eq!(log, EXTERNAL_AUTHOR, "a swept change has no known author");
        assert_eq!(
            git_out(dir.path(), &["status", "--porcelain"]),
            "",
            "clean tree after the sweep"
        );
    }

    #[test]
    fn sweep_creates_no_commit_when_nothing_slipped_through() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), b"hello").unwrap();
        let handle = RevisionEngine::start_with_timing(
            managed(&dir),
            None,
            Timing {
                quiet: Duration::from_secs(30),
                max_interval: Duration::from_secs(300),
                sweep_interval: Duration::from_millis(20),
                conflict_retry: CONFLICT_RETRY,
            },
            None,
        );
        // Long enough for many sweeps to fire over an unchanged tree.
        assert!(!wait_until(Duration::from_millis(500), || {
            git_log(dir.path(), &["--format=%s"]).contains(SWEEP_MESSAGE)
        }));
        drop(handle);
        assert_eq!(
            git_log(dir.path(), &["--format=%s"]),
            "Initial space snapshot",
            "an idle space accrues no empty sweep commits"
        );
    }

    /// A sweep must not steal a pending change from the debounce path and
    /// flatten its author to External.
    #[test]
    fn sweep_defers_to_a_pending_attributed_change() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), b"hello").unwrap();
        let handle = RevisionEngine::start_with_timing(
            managed(&dir),
            None,
            Timing {
                // Long quiet window: the mark stays pending while sweeps fire.
                quiet: Duration::from_secs(30),
                max_interval: Duration::from_secs(300),
                sweep_interval: Duration::from_millis(20),
                conflict_retry: CONFLICT_RETRY,
            },
            None,
        );
        std::fs::write(dir.path().join("mine.md"), b"alice wrote this").unwrap();
        handle.mark(
            "mine.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );
        assert!(!wait_until(Duration::from_millis(500), || {
            git_log(dir.path(), &["--format=%s"]).contains(SWEEP_MESSAGE)
        }));

        // The drop flush is what finally commits it, with alice intact.
        drop(handle);
        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an", "--", "mine.md"]),
            "alice",
            "the sweep clobbered a pending attribution"
        );
    }

    /// Regression net for deadline-driven waiting: with the sweep an hour out
    /// the loop is parked in a long `wait_timeout`, so a mark must notify it
    /// rather than wait for a tick that no longer exists.
    #[test]
    fn a_mark_wakes_the_parked_loop_and_commits_on_the_quiet_deadline() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), b"hello").unwrap();
        let handle = RevisionEngine::start_with_timing(
            managed(&dir),
            None,
            Timing {
                quiet: Duration::from_millis(100),
                max_interval: Duration::from_secs(300),
                sweep_interval: Duration::from_secs(3600),
                conflict_retry: CONFLICT_RETRY,
            },
            None,
        );
        // Let the loop reach its idle park before marking.
        assert!(wait_until(Duration::from_secs(5), || {
            git_log(dir.path(), &["--format=%s"]).contains("Initial space snapshot")
        }));
        std::thread::sleep(Duration::from_millis(50));

        std::fs::write(dir.path().join("late.md"), b"x").unwrap();
        handle.mark(
            "late.md",
            Attribution::Account {
                name: "alice".into(),
                email: None,
            },
        );

        assert!(
            wait_until(Duration::from_secs(5), || {
                git_log(dir.path(), &["--format=%s"]).contains("Create late.md")
            }),
            "a parked loop never woke for a new mark"
        );
    }

    #[test]
    fn sample_lists_a_few_paths_then_summarizes() {
        assert_eq!(sample(&["a.md".into()]), "a.md");
        assert_eq!(
            sample(&["a.md".into(), "b.md".into(), "c.md".into()]),
            "a.md, b.md, c.md"
        );
        assert_eq!(
            sample(&["a.md".into(), "b.md".into(), "c.md".into(), "d.md".into()]),
            "a.md, b.md, c.md, +1 more"
        );
    }

    #[test]
    fn next_deadline_picks_the_earliest_and_never_returns_zero() {
        let quiet = Duration::from_secs(30);
        let max_interval = Duration::from_secs(300);
        let sweep = Duration::from_secs(3600);
        let now = Instant::now();

        let idle = EngineState {
            dirty: HashMap::new(),
            first_mark: None,
            last_mark: None,
            last_sweep: now,
            stopping: false,
        };
        let wait = next_deadline(&idle, quiet, max_interval, sweep, None);
        assert!(
            wait > Duration::from_secs(3000),
            "an idle space must park until the sweep, got {wait:?}"
        );

        let dirty = EngineState {
            first_mark: Some(now),
            last_mark: Some(now),
            ..idle
        };
        let wait = next_deadline(&dirty, quiet, max_interval, sweep, None);
        assert!(wait <= quiet && wait > Duration::from_secs(25), "{wait:?}");

        let stale = EngineState {
            first_mark: Some(now - Duration::from_secs(9999)),
            last_mark: Some(now - Duration::from_secs(9999)),
            last_sweep: now - Duration::from_secs(9999),
            dirty: HashMap::new(),
            stopping: false,
        };
        assert!(
            next_deadline(&stale, quiet, max_interval, sweep, None) > Duration::ZERO,
            "a saturated deadline must not spin the loop"
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

    #[test]
    fn sync_state_broadcasts_only_on_change() {
        let (engine, _dir) = engine_with_sync_for_test();
        let mut rx = engine.subscribe_sync();

        engine.set_sync_state_for_test(SyncState::Conflicted {
            paths: vec!["a.md".into()],
        });
        engine.set_sync_state_for_test(SyncState::Conflicted {
            paths: vec!["a.md".into()],
        });
        engine.set_sync_state_for_test(SyncState::Idle);

        assert!(matches!(
            rx.try_recv().unwrap(),
            SyncState::Conflicted { .. }
        ));
        assert!(matches!(rx.try_recv().unwrap(), SyncState::Idle));
        assert!(
            rx.try_recv().is_err(),
            "the repeated Conflicted must not be resent"
        );
    }

    #[test]
    fn a_commit_triggers_a_push_without_waiting_for_the_pull_interval() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let work = crate::revisions::sync::tests::seeded_clone(remote.path());
        let server_root = tempfile::tempdir().unwrap();

        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing {
                quiet: Duration::from_millis(50),
                max_interval: Duration::from_millis(100),
                sweep_interval: Duration::from_secs(3600),
                conflict_retry: CONFLICT_RETRY,
            },
            Some(SyncSettings {
                server_root: server_root.path().to_path_buf(),
                space_id: "test-space".to_string(),
                mode: crate::multi::config::GitSyncMode::Manual,
                pull_interval: None,
                paused: false,
            }),
        );

        std::fs::write(work.path().join("note.md"), "pushed by the engine\n").unwrap();
        engine.mark("note.md", Attribution::System);

        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let landed = loop {
            let other = crate::revisions::sync::tests::plain_clone(remote.path());
            let body = std::fs::read_to_string(other.path().join("note.md")).unwrap_or_default();
            if body.contains("pushed by the engine") {
                break true;
            }
            if std::time::Instant::now() > deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(landed, "the commit never reached the remote");
        assert!(wait_until(Duration::from_secs(10), || {
            matches!(engine.sync_state(), SyncState::Idle)
        }));
    }

    #[test]
    fn a_conflicted_sync_still_advances_last_sync_so_the_loop_does_not_spin() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let seed = crate::revisions::sync::tests::seeded_clone(remote.path());
        let work = crate::revisions::sync::tests::plain_clone(remote.path());

        std::fs::write(seed.path().join("note.md"), "theirs\n").unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "theirs"]);
        git_out(seed.path(), &["push", "-q"]);
        std::fs::write(work.path().join("note.md"), "mine\n").unwrap();
        git_out(work.path(), &["add", "-A"]);
        git_out(work.path(), &["commit", "-qm", "mine"]);
        let server_root = tempfile::tempdir().unwrap();

        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(SyncSettings {
                server_root: server_root.path().to_path_buf(),
                space_id: "test-space".to_string(),
                mode: crate::multi::config::GitSyncMode::Manual,
                pull_interval: None,
                paused: false,
            }),
        );

        let first = engine.inner.sync_now(false).unwrap();
        assert!(matches!(first, TickOutcome::Conflicted(_)), "{first:?}");
        let after_first = engine
            .inner
            .last_sync
            .lock()
            .unwrap()
            .expect("last_sync set after a conflicted tick");

        std::thread::sleep(Duration::from_millis(5));
        let second = engine.inner.sync_now(false).unwrap();
        assert!(matches!(second, TickOutcome::Conflicted(_)), "{second:?}");
        let after_second = engine
            .inner
            .last_sync
            .lock()
            .unwrap()
            .expect("last_sync set after the second conflicted tick");

        assert!(
            after_second > after_first,
            "a conflicted sync must still advance last_sync, or the loop spins"
        );
    }

    /// Pins the transition-only requirement end to end, through the real
    /// `sync_now` path (not the `set_sync_state_for_test` shim) -- this is
    /// what `set_sync_state_silent` exists for: without it, the unconditional
    /// `Syncing` broadcast at the top of every tick makes `Conflicted ->
    /// Syncing -> Conflicted` read as two genuine transitions each time a
    /// still-unresolved conflict is re-ticked.
    #[test]
    fn a_persisting_conflict_broadcasts_exactly_once_across_repeated_ticks() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let seed = crate::revisions::sync::tests::seeded_clone(remote.path());
        let work = crate::revisions::sync::tests::plain_clone(remote.path());

        std::fs::write(seed.path().join("note.md"), "theirs\n").unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "theirs"]);
        git_out(seed.path(), &["push", "-q"]);
        std::fs::write(work.path().join("note.md"), "mine\n").unwrap();
        git_out(work.path(), &["add", "-A"]);
        git_out(work.path(), &["commit", "-qm", "mine"]);
        let server_root = tempfile::tempdir().unwrap();

        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(SyncSettings {
                server_root: server_root.path().to_path_buf(),
                space_id: "test-space".to_string(),
                mode: crate::multi::config::GitSyncMode::Manual,
                pull_interval: None,
                paused: false,
            }),
        );
        let mut rx = engine.subscribe_sync();

        let first = engine.inner.sync_now(false).unwrap();
        assert!(matches!(first, TickOutcome::Conflicted(_)), "{first:?}");
        std::thread::sleep(Duration::from_millis(5));
        let second = engine.inner.sync_now(false).unwrap();
        assert!(matches!(second, TickOutcome::Conflicted(_)), "{second:?}");

        let mut received = Vec::new();
        while let Ok(state) = rx.try_recv() {
            received.push(state);
        }
        assert_eq!(
            received.len(),
            1,
            "a still-unresolved conflict must broadcast exactly once, not once per tick: {received:?}"
        );
        assert!(matches!(received[0], SyncState::Conflicted { .. }));
    }

    fn conflicted_clone(remote: &Path) -> (tempfile::TempDir, tempfile::TempDir) {
        let seed = crate::revisions::sync::tests::seeded_clone(remote);
        let work = crate::revisions::sync::tests::plain_clone(remote);
        std::fs::write(seed.path().join("note.md"), "theirs\n").unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "theirs"]);
        git_out(seed.path(), &["push", "-q"]);
        std::fs::write(work.path().join("note.md"), "mine\n").unwrap();
        git_out(work.path(), &["add", "-A"]);
        git_out(work.path(), &["commit", "-qm", "mine"]);
        (seed, work)
    }

    fn sync_settings(server_root: &Path, pull_interval: Option<Duration>) -> SyncSettings {
        SyncSettings {
            server_root: server_root.to_path_buf(),
            space_id: "test-space".to_string(),
            mode: crate::multi::config::GitSyncMode::Manual,
            pull_interval,
            paused: false,
        }
    }

    /// `pullIntervalSecs: 0` is a shipped preset, so a conflict must not be
    /// able to wedge the space: while `MERGE_HEAD` exists no commit lands, so
    /// the post-commit trigger -- the only other caller of `sync_now` -- can
    /// never fire, and `try_complete_merge` would be unreachable forever.
    #[test]
    fn a_conflict_completes_even_with_polling_switched_off() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let (_seed, work) = conflicted_clone(remote.path());
        let server_root = tempfile::tempdir().unwrap();

        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing {
                conflict_retry: Duration::from_millis(20),
                ..Timing::default()
            },
            Some(sync_settings(server_root.path(), None)),
        );

        assert!(matches!(
            engine.sync_now(false).unwrap(),
            TickOutcome::Conflicted(_)
        ));
        std::fs::write(work.path().join("note.md"), "mine and theirs\n").unwrap();

        assert!(
            wait_until(Duration::from_secs(10), || {
                !crate::revisions::store::merge_in_progress(work.path())
            }),
            "a later tick must complete the resolved merge"
        );
        assert!(wait_until(Duration::from_secs(10), || {
            matches!(engine.sync_state(), SyncState::Idle)
        }));
    }

    #[test]
    fn a_restart_mid_conflict_reports_conflicted_not_idle() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let (_seed, work) = conflicted_clone(remote.path());
        let server_root = tempfile::tempdir().unwrap();

        crate::revisions::sync::tick(work.path(), &[], false).unwrap();
        assert!(crate::revisions::store::merge_in_progress(work.path()));

        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(server_root.path(), None)),
        );

        assert_eq!(
            engine.sync_state(),
            SyncState::Conflicted {
                paths: vec!["note.md".to_string()]
            }
        );
        assert_eq!(engine.last_broadcast_sync_state(), engine.sync_state());
    }

    #[test]
    fn a_binary_conflict_pauses_the_space_and_names_the_file() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let seed = crate::revisions::sync::tests::seeded_clone(remote.path());
        std::fs::write(seed.path().join("logo.png"), [0xff, 0xd8, 0x00]).unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "base"]);
        git_out(seed.path(), &["push", "-q"]);
        let work = crate::revisions::sync::tests::plain_clone(remote.path());

        std::fs::write(seed.path().join("logo.png"), [0xff, 0xd8, 0x01]).unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "theirs"]);
        git_out(seed.path(), &["push", "-q"]);
        std::fs::write(work.path().join("logo.png"), [0xff, 0xd8, 0x02]).unwrap();
        git_out(work.path(), &["add", "-A"]);
        git_out(work.path(), &["commit", "-qm", "mine"]);

        let server_root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(server_root.path(), None)),
        );

        assert!(matches!(
            engine.sync_now(false).unwrap(),
            TickOutcome::Conflicted(_)
        ));
        engine.sync_now(false).unwrap();

        match engine.sync_state() {
            SyncState::Conflicted { paths } => assert_eq!(paths, vec!["logo.png"]),
            other => panic!("expected Conflicted, got {other:?}"),
        }
    }

    /// Design tick step 1: flush first, so the merge below is never refused
    /// with "your local changes would be overwritten" over an edit still
    /// sitting inside the debounce window.
    #[test]
    fn a_tick_against_a_dirty_tree_commits_before_it_merges() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let seed = crate::revisions::sync::tests::seeded_clone(remote.path());
        let base: String = (0..20).map(|i| format!("line {i}\n")).collect();
        std::fs::write(seed.path().join("note.md"), &base).unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "base"]);
        git_out(seed.path(), &["push", "-q"]);
        let work = crate::revisions::sync::tests::plain_clone(remote.path());

        std::fs::write(
            seed.path().join("note.md"),
            base.replace("line 0\n", "theirs\n"),
        )
        .unwrap();
        git_out(seed.path(), &["add", "-A"]);
        git_out(seed.path(), &["commit", "-qm", "theirs"]);
        git_out(seed.path(), &["push", "-q"]);

        let server_root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(server_root.path(), None)),
        );

        // Uncommitted, still inside the debounce window.
        std::fs::write(
            work.path().join("note.md"),
            base.replace("line 19\n", "mine\n"),
        )
        .unwrap();
        engine.mark("note.md", Attribution::System);

        assert_eq!(
            engine.sync_now(false).unwrap(),
            TickOutcome::MergedAndPushed
        );
        assert!(matches!(engine.sync_state(), SyncState::Idle));
        let merged = std::fs::read_to_string(work.path().join("note.md")).unwrap();
        assert!(
            merged.contains("theirs") && merged.contains("mine"),
            "{merged}"
        );
    }

    #[test]
    fn a_brand_new_empty_remote_syncs_instead_of_erroring() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let work = tempfile::tempdir().unwrap();
        git_out(work.path(), &["init", "-q", "-b", "main"]);
        git_out(work.path(), &["config", "user.email", "t@x.test"]);
        git_out(work.path(), &["config", "user.name", "T"]);
        std::fs::write(work.path().join("index.md"), b"hello").unwrap();
        git_out(work.path(), &["add", "-A"]);
        git_out(work.path(), &["commit", "-qm", "init"]);
        git_out(
            work.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );

        let server_root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(server_root.path(), None)),
        );

        assert_eq!(engine.sync_now(false).unwrap(), TickOutcome::Pushed);
        assert_eq!(engine.sync_state(), SyncState::Idle);
        assert_eq!(engine.inner.sync_failures.load(Ordering::Acquire), 0);
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_runs_coalesce_and_pause_waits_for_the_active_push() {
        use std::os::unix::fs::PermissionsExt;
        let remote = crate::revisions::sync::tests::bare_remote();
        let work = crate::revisions::sync::tests::seeded_clone(remote.path());
        let root = tempfile::tempdir().unwrap();
        let hook = remote.path().join("hooks/update");
        std::fs::write(
            &hook,
            "#!/bin/sh\ntouch sync-started\nwhile [ ! -f sync-release ]; do sleep 0.02; done\n",
        )
        .unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(root.path(), None)),
        );
        std::fs::write(work.path().join("note.md"), b"updated\n").unwrap();
        engine.mark("note.md", Attribution::System);
        let running = engine.clone();
        let first = std::thread::spawn(move || running.sync_now(false));
        assert!(wait_until(Duration::from_secs(5), || remote
            .path()
            .join("sync-started")
            .exists()));
        let started = Instant::now();
        assert_eq!(engine.sync_now(false).unwrap(), TickOutcome::Idle);
        assert!(started.elapsed() < Duration::from_secs(1));
        let (tx, rx) = std::sync::mpsc::channel();
        let pausing = engine.clone();
        let pause = std::thread::spawn(move || {
            pausing.quiesce_sync();
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
        std::fs::write(remote.path().join("sync-release"), b"").unwrap();
        first.join().unwrap().unwrap();
        pause.join().unwrap();
        assert!(engine.sync_snapshot().paused);
        assert_eq!(engine.sync_now(false).unwrap(), TickOutcome::Idle);
    }

    #[test]
    fn external_git_completion_is_not_overwritten_by_the_next_tick() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let (_seed, work) = conflicted_clone(remote.path());
        let root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(root.path(), None)),
        );
        engine.sync_now(false).unwrap();
        std::fs::write(work.path().join("note.md"), b"resolved externally\n").unwrap();
        git_out(work.path(), &["add", "note.md"]);
        git_out(work.path(), &["commit", "-qm", "external resolution"]);
        let head = git_out(work.path(), &["rev-parse", "HEAD"]);
        engine.sync_now(false).unwrap();
        assert_eq!(git_out(work.path(), &["rev-parse", "HEAD"]), head);
        assert_eq!(engine.sync_state(), SyncState::Idle);
    }

    #[test]
    fn saving_resolved_markers_resumes_without_the_minute_retry() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let (_seed, work) = conflicted_clone(remote.path());
        let root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(root.path(), None)),
        );
        engine.sync_now(false).unwrap();
        std::fs::write(work.path().join("note.md"), b"combined\n").unwrap();
        engine.notify_file_saved();
        assert!(wait_until(Duration::from_secs(3), || {
            !crate::revisions::store::merge_in_progress(work.path())
        }));
        assert!(wait_until(Duration::from_secs(3), || engine
            .sync_snapshot()
            .last_success
            .is_some()));
    }

    #[test]
    fn a_paused_engine_does_not_fetch_and_keeps_success_unknown() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let work = crate::revisions::sync::tests::seeded_clone(remote.path());
        let root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let mut settings = sync_settings(root.path(), None);
        settings.paused = true;
        let engine =
            RevisionEngine::start_with_timing(store, None, Timing::default(), Some(settings));
        let snapshot = engine.sync_snapshot();
        assert!(snapshot.enabled && snapshot.paused);
        assert_eq!(snapshot.last_success, None);
        let before = std::fs::read(work.path().join(".git/FETCH_HEAD")).ok();
        engine.sync_now(false).unwrap();
        assert_eq!(
            std::fs::read(work.path().join(".git/FETCH_HEAD")).ok(),
            before
        );
        assert_eq!(engine.sync_snapshot().last_attempt, None);
    }

    #[test]
    fn a_successful_push_has_zero_pending_and_a_real_success_time() {
        let remote = crate::revisions::sync::tests::bare_remote();
        let work = crate::revisions::sync::tests::seeded_clone(remote.path());
        let root = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(work.path(), RevisionsMode::Managed).unwrap();
        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(sync_settings(root.path(), None)),
        );
        std::fs::write(work.path().join("note.md"), b"updated\n").unwrap();
        engine.mark("note.md", Attribution::System);
        let before = engine.sync_snapshot();
        assert!(before.dirty);
        engine.sync_now(false).unwrap();
        let after = engine.sync_snapshot();
        assert!(after.version > before.version);
        assert!(after
            .last_success
            .is_some_and(|success| success >= after.last_attempt.unwrap()));
        assert_eq!(after.pending, Some(0));
        assert_eq!(
            crate::revisions::sync::ahead_behind(work.path(), "main").unwrap(),
            (0, 0)
        );
    }

    #[test]
    fn a_sync_error_message_never_carries_credentials() {
        let (kind, message) = describe_sync_error(&SyncError::Other(
            "fatal: repository 'https://user:token@host/repo.git/' not found".to_string(),
        ));
        assert_eq!(kind, "Other");
        assert!(!message.contains("user:token@"), "{message}");
        assert!(message.contains("[redacted]@host"), "{message}");

        let (kind, message) = describe_sync_error(&SyncError::AuthFailed);
        assert_eq!(kind, "AuthFailed");
        assert!(message.is_empty());
    }

    #[test]
    fn an_error_state_serializes_without_its_message_for_members() {
        let state = SyncState::Error {
            kind: "Other".to_string(),
            message: "fatal: could not read from internal.host".to_string(),
        };
        let full = serde_json::to_string(&state).unwrap();
        assert!(full.contains("internal.host"), "{full}");
        let stripped = serde_json::to_string(&state.without_message()).unwrap();
        assert_eq!(stripped, r#"{"state":"error","kind":"Other"}"#);
    }

    #[test]
    fn sync_now_refuses_a_space_nested_in_a_larger_repo() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let sub = dir.path().join("docs");
        std::fs::create_dir_all(&sub).unwrap();
        let store = RevisionStore::open(&sub, RevisionsMode::Managed).unwrap();
        assert!(!store.auto_commit_allowed());
        let server_root = tempfile::tempdir().unwrap();

        let engine = RevisionEngine::start_with_timing(
            store,
            None,
            Timing::default(),
            Some(SyncSettings {
                server_root: server_root.path().to_path_buf(),
                space_id: "test-space".to_string(),
                mode: crate::multi::config::GitSyncMode::Manual,
                pull_interval: None,
                paused: false,
            }),
        );

        assert_eq!(engine.sync_now(false).unwrap(), TickOutcome::Idle);
        assert!(!dir.path().join(".git").join("FETCH_HEAD").exists());
    }

    #[test]
    fn next_deadline_never_exceeds_a_pending_sync_wait() {
        let quiet = Duration::from_secs(30);
        let max_interval = Duration::from_secs(300);
        let sweep = Duration::from_secs(3600);
        let idle = EngineState {
            dirty: HashMap::new(),
            first_mark: None,
            last_mark: None,
            last_sweep: Instant::now(),
            stopping: false,
        };
        let wait = next_deadline(
            &idle,
            quiet,
            max_interval,
            sweep,
            Some(Duration::from_secs(10)),
        );
        assert!(wait <= Duration::from_secs(10), "{wait:?}");
    }

    #[test]
    fn redact_credentials_strips_a_userinfo_prefix_but_leaves_the_rest() {
        assert_eq!(
            redact_credentials("fatal: unable to access 'https://user:token@host/repo.git/'"),
            "fatal: unable to access 'https://[redacted]@host/repo.git/'"
        );
        assert_eq!(
            redact_credentials("fatal: unable to access 'https://ghp_xxxxx@github.com/o/r.git/'"),
            "fatal: unable to access 'https://[redacted]@github.com/o/r.git/'"
        );
        assert_eq!(
            redact_credentials("https://host:443/a/b@c"),
            "https://host:443/a/b@c"
        );
        assert_eq!(
            redact_credentials("git@host:path/repo.git"),
            "git@host:path/repo.git"
        );
        assert_eq!(
            redact_credentials("ssh://git@host/path"),
            "ssh://[redacted]@host/path"
        );
        assert_eq!(
            redact_credentials("ssh: connect to host git.example.test port 22"),
            "ssh: connect to host git.example.test port 22"
        );
        assert_eq!(
            redact_credentials("see https://a:b@x.test and https://c:d@y.test for details"),
            "see https://[redacted]@x.test and https://[redacted]@y.test for details"
        );
    }
}
