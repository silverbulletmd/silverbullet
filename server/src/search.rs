//! Which search engine serves a space, and the storage view it searches through.
//! The HTTP layer (`handlers::search`) only ever sees `Arc<dyn SearchBackend>`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use silverbullet_server_common::space::GitignoreMatcher;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};
use silverbullet_server_search::fulltext::ChangeFeed;
use silverbullet_server_search::{FileStamp, FullTextBackend, SearchBackend, SpaceView};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::mpsc;

use crate::watcher::{FsAction, FsEvent};

/// Where a space's full-text index lives: `Disk(<index root>/<space id>)` or RAM.
pub use silverbullet_server_search::fulltext::Location;

/// Re-exported so embedders can build a gate without depending on the search crate.
pub use silverbullet_server_search::Gate;

/// Exposes what storage exposes: listing and reads go through `SpacePrimitives`.
/// Storage lists no dot paths, control files or `SB_SPACE_IGNORE` matches but
/// would read the first and last, so reads check them here.
pub struct SpaceSearchView {
    space: Arc<dyn SpacePrimitives>,
    /// The space's `SB_SPACE_IGNORE` rules, fixed for the instance's lifetime.
    ignore: GitignoreMatcher,
}

impl SpaceSearchView {
    pub fn new(space: Arc<dyn SpacePrimitives>, ignore: GitignoreMatcher) -> Self {
        Self { space, ignore }
    }

    /// Dot paths and ignore matches; control files are refused by the
    /// storage stack's own filter. Anything that isn't a plain relative path
    /// (empty, rooted, backslashes, empty components) counts as hidden too,
    /// and is refused before the ignore matcher, which panics on paths
    /// outside its root.
    fn hidden(&self, path: &str) -> bool {
        let malformed = path.is_empty() || path.starts_with('/') || path.contains('\\');
        malformed
            || path
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.'))
            || self.ignore.is_ignored(path, false)
    }

    /// Fails closed: when the listing fails, nothing counts as visible.
    fn files(&self) -> Vec<silverbullet_server_common::FileMeta> {
        self.space.fetch_file_list().unwrap_or_else(|error| {
            tracing::warn!("search: listing the space failed, hiding all files: {error}");
            Vec::new()
        })
    }
}

impl SpaceView for SpaceSearchView {
    fn list(&self) -> HashSet<String> {
        self.files().into_iter().map(|f| f.name).collect()
    }

    /// A size storage reports as negative becomes 0; compare `modified` as well.
    /// `None` when listing fails.
    fn list_meta(&self) -> Option<HashMap<String, FileStamp>> {
        let files = match self.space.fetch_file_list() {
            Ok(files) => files,
            Err(error) => {
                tracing::warn!("search: listing the space failed: {error}");
                return None;
            }
        };
        let meta = files
            .into_iter()
            .map(|f| {
                let stamp = FileStamp {
                    modified: f.last_modified,
                    size: u64::try_from(f.size).unwrap_or(0),
                };
                (f.name, stamp)
            })
            .collect();
        Some(meta)
    }

    /// `None` for a hidden path, so a change event for one reads as a delete.
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if self.hidden(path) {
            return None;
        }
        self.space.read_file(path).ok().map(|(data, _)| data)
    }

    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
        if self.hidden(path) {
            return None;
        }
        self.space
            .read_file_range(path, 0, len)
            .or_else(|_| {
                self.space
                    .read_file(path)
                    .map(|(d, m)| (d[..len.min(d.len())].to_vec(), m))
            })
            .ok()
            .map(|(data, _)| data)
    }
}

/// The one place that decides which engine serves a space (M2 adds semantic
/// here): every space gets the full-text index at `location`. `name` names
/// the space in log lines (its id, or its folder's name). `space` is what
/// the index reads: only the space's own files (the primary layer, not the
/// bundled fallback such as `Library/Std`). `ignore` is the space's
/// `SB_SPACE_IGNORE` matcher (`DiskSpacePrimitives::gitignore_matcher`); reads
/// refuse what it matches. `events` keeps the index current: the space
/// watcher's, or a [`WriteEvents`] sender when there is no watcher; without
/// any, the index catches up on its periodic reconcile only.
///
/// Production callers must be inside a tokio runtime: the index's tasks are
/// spawned on it and stop with it. Called outside one (sync tests), they run
/// on a small process-wide runtime that is never shut down.
pub fn backend_for(
    name: &str,
    space: Arc<dyn SpacePrimitives>,
    ignore: GitignoreMatcher,
    location: Location,
    events: Option<broadcast::Receiver<FsEvent>>,
) -> Arc<dyn SearchBackend> {
    let _runtime = tokio::runtime::Handle::try_current()
        .is_err()
        .then(|| fallback_runtime().enter());
    #[cfg(test)]
    let dir = match &location {
        Location::Disk(dir) => Some(dir.clone()),
        Location::Memory => None,
    };
    let view = Arc::new(SpaceSearchView::new(space, ignore));
    let backend = Arc::new(FullTextBackend::new(
        name,
        location,
        view,
        change_feed(events),
    ));
    #[cfg(test)]
    if let Some(dir) = dir {
        test_support::register(dir, &backend);
    }
    backend
}

/// `<indexes>/<id>` for a space id that is one safe path component: 1 to 128
/// ASCII letters, digits, `-`, `_` or `.`, not starting with `.` (so no `..`,
/// no separators, no drive prefix like `C:`). Any other id gets no directory
/// (the caller keeps that space's index in RAM), with a warning.
pub fn index_dir(indexes: &Path, id: &str) -> Option<PathBuf> {
    let safe = (1..=128).contains(&id.len())
        && !id.starts_with('.')
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    if !safe {
        tracing::warn!(
            "search: space id {id:?} can't name an index directory; keeping it in memory"
        );
        return None;
    }
    Some(indexes.join(id))
}

/// Deletes the index directory `dir` (from [`index_dir`]), only when its
/// canonical path is strictly inside the canonical `indexes`. `Ok(false)` when
/// there was nothing to delete or it refused.
pub fn remove_index_dir(indexes: &Path, dir: &Path) -> std::io::Result<bool> {
    let (Ok(base), Ok(target)) = (indexes.canonicalize(), dir.canonicalize()) else {
        return Ok(false);
    };
    if target == base || !target.starts_with(&base) {
        tracing::warn!(
            "search: refusing to delete {}, which isn't inside {}",
            target.display(),
            base.display()
        );
        return Ok(false);
    }
    std::fs::remove_dir_all(&target).map(|()| true)
}

fn fallback_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tracing::debug!(
            "search: backend_for called outside a tokio runtime; \
             running search indexes on a process-wide runtime"
        );
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("sb-search")
            .enable_all()
            .build()
            .expect("search runtime")
    })
}

/// Test-only access to the disk-located backends `backend_for` built, so a
/// test can check which store an instance ended up with.
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, Weak};

    use silverbullet_server_search::FullTextBackend;

    type Built = Vec<(PathBuf, Weak<FullTextBackend>)>;
    static BUILT: Mutex<Built> = Mutex::new(Vec::new());

    pub(super) fn register(dir: PathBuf, backend: &Arc<FullTextBackend>) {
        let mut built = BUILT.lock().unwrap();
        built.retain(|(_, weak)| weak.strong_count() > 0);
        built.push((dir, Arc::downgrade(backend)));
    }

    /// The live backends indexing into `dir`, oldest first.
    pub(crate) fn backends_at(dir: &Path) -> Vec<Arc<FullTextBackend>> {
        BUILT
            .lock()
            .unwrap()
            .iter()
            .filter(|(d, _)| d == dir)
            .filter_map(|(_, weak)| weak.upgrade())
            .collect()
    }
}

/// Storage that reports its own successful writes and deletes as change
/// events, for an instance without a file watcher (`SB_FS_WATCH=off`): edits
/// made through the server (editor, API, runtime) reach the index at once.
/// Changes made on disk behind the server's back still wait for the index's
/// periodic reconcile.
pub struct WriteEvents {
    inner: Arc<dyn SpacePrimitives>,
    events: broadcast::Sender<FsEvent>,
}

impl WriteEvents {
    /// The wrapped storage and the sender to subscribe the index to.
    pub fn wrap(inner: Arc<dyn SpacePrimitives>) -> (Self, broadcast::Sender<FsEvent>) {
        let (events, _) = broadcast::channel(1024);
        (
            Self {
                inner,
                events: events.clone(),
            },
            events,
        )
    }

    fn report(&self, name: &str, action: FsAction, last_modified: i64) {
        let _ = self.events.send(FsEvent {
            name: name.to_string(),
            action,
            last_modified,
            revision: None,
            origin: None,
        });
    }
}

impl SpacePrimitives for WriteEvents {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        self.inner.fetch_file_list()
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.inner.get_file_meta(path)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.inner.read_file(path)
    }

    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.inner.read_file_range(path, start, length)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let written = self.inner.write_file(path, data, meta)?;
        self.report(path, FsAction::Change, written.last_modified);
        Ok(written)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        self.inner.delete_file(path)?;
        self.report(path, FsAction::Delete, 0);
        Ok(())
    }
}

/// Forwards the watcher's events to the index: each event's path, and `None`
/// (rescan) for the watcher's `Resync` and when the receiver lagged and
/// events were lost. Ends when the
/// watcher's sender closes or the index stops listening.
fn change_feed(events: Option<broadcast::Receiver<FsEvent>>) -> ChangeFeed {
    let (tx, feed) = mpsc::unbounded_channel();
    let Some(mut events) = events else {
        return feed;
    };
    tokio::spawn(async move {
        loop {
            let msg = tokio::select! {
                _ = tx.closed() => return,
                event = events.recv() => match event {
                    Ok(event) if event.action == FsAction::Resync => None,
                    Ok(event) => Some(event.name),
                    Err(RecvError::Lagged(_)) => None,
                    Err(RecvError::Closed) => return,
                },
            };
            if tx.send(msg).is_err() {
                return;
            }
        }
    });
    feed
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server_common::space::DiskSpacePrimitives;

    fn disk_view(files: &[(&str, &str)], ignore: &str) -> (tempfile::TempDir, SpaceSearchView) {
        let dir = tempfile::tempdir().unwrap();
        for (name, body) in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        let disk = DiskSpacePrimitives::new(dir.path(), ignore).unwrap();
        let matcher = disk.gitignore_matcher();
        (dir, SpaceSearchView::new(Arc::new(disk), matcher))
    }

    fn event(name: &str, action: FsAction) -> FsEvent {
        FsEvent {
            name: name.into(),
            action,
            last_modified: 1,
            revision: None,
            origin: None,
        }
    }

    #[tokio::test]
    async fn the_feed_forwards_paths_and_turns_lag_and_resync_into_rescans() {
        let (tx, rx) = broadcast::channel(2);
        let mut feed = change_feed(Some(rx));
        // The forwarder hasn't run yet: the third event overflows the channel.
        for name in ["Fern.md", "Moss.md", "Lichen.md"] {
            tx.send(event(name, FsAction::Change)).unwrap();
        }
        assert_eq!(feed.recv().await, Some(None), "lagged");
        assert_eq!(feed.recv().await, Some(Some("Moss.md".into())));
        assert_eq!(feed.recv().await, Some(Some("Lichen.md".into())));
        tx.send(event("Moss.md", FsAction::Delete)).unwrap();
        assert_eq!(feed.recv().await, Some(Some("Moss.md".into())));
        tx.send(event("", FsAction::Resync)).unwrap();
        assert_eq!(feed.recv().await, Some(None), "resync");
        drop(tx);
        assert_eq!(feed.recv().await, None, "ends with the watcher");
    }

    #[test]
    fn index_dirs_take_only_one_safe_component() {
        let indexes = Path::new("/data/search/indexes");
        for id in [
            "0f6c2b9e-1d4a-4c1b-9a8e-2b6f1e9d0c3a",
            "notes",
            "work_2",
            "a.b",
        ] {
            assert_eq!(index_dir(indexes, id), Some(indexes.join(id)), "{id}");
        }
        let long = "x".repeat(129);
        for id in [
            "",
            ".",
            "..",
            ".hidden",
            "a/b",
            "a\\b",
            "C:",
            "C:x",
            "/abs",
            "../x",
            "a b",
            "é",
            long.as_str(),
        ] {
            assert_eq!(index_dir(indexes, id), None, "{id:?}");
        }
    }

    #[test]
    fn index_dirs_are_removed_only_inside_the_indexes_directory() {
        let root = tempfile::tempdir().unwrap();
        let indexes = root.path().join("search/indexes");
        std::fs::create_dir_all(indexes.join("gone/fulltext-v1")).unwrap();
        std::fs::create_dir_all(root.path().join("outside")).unwrap();
        assert!(remove_index_dir(&indexes, &indexes.join("gone")).unwrap());
        assert!(!indexes.join("gone").exists());
        assert!(!remove_index_dir(&indexes, &indexes.join("missing")).unwrap());
        for dir in [
            indexes.clone(),
            indexes.join(".."),
            indexes.join("../../outside"),
            root.path().join("outside"),
        ] {
            assert!(
                !remove_index_dir(&indexes, &dir).unwrap(),
                "{}",
                dir.display()
            );
        }
        assert!(indexes.is_dir() && root.path().join("outside").is_dir());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("outside"), indexes.join("link")).unwrap();
            assert!(!remove_index_dir(&indexes, &indexes.join("link")).unwrap());
            assert!(root.path().join("outside").is_dir());
        }
    }

    #[tokio::test]
    async fn write_events_report_only_successful_writes_and_deletes() {
        use silverbullet_server_common::space::{MemorySpacePrimitives, ReadOnlySpacePrimitives};
        let (space, tx) = WriteEvents::wrap(Arc::new(MemorySpacePrimitives::new()));
        let mut events = tx.subscribe();
        space.write_file("Fern.md", b"fern", None).unwrap();
        space.delete_file("Fern.md").unwrap();
        assert!(space.delete_file("Fern.md").is_err());
        let seen: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
            .map(|e| (e.name, e.action))
            .collect();
        assert_eq!(
            seen,
            [
                ("Fern.md".to_string(), FsAction::Change),
                ("Fern.md".to_string(), FsAction::Delete)
            ]
        );
        let read_only = Arc::new(ReadOnlySpacePrimitives::new(Box::new(
            MemorySpacePrimitives::new(),
        )));
        let (space, tx) = WriteEvents::wrap(read_only);
        let mut events = tx.subscribe();
        assert!(space.write_file("Fern.md", b"fern", None).is_err());
        assert!(
            events.try_recv().is_err(),
            "a refused write reports nothing"
        );
    }

    #[tokio::test]
    async fn the_forwarder_stops_when_the_index_does() {
        let (tx, rx) = broadcast::channel::<FsEvent>(4);
        drop(change_feed(Some(rx)));
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while tx.receiver_count() > 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the forwarder let go of the watcher");
        let mut closed = change_feed(None);
        assert_eq!(closed.recv().await, None, "no watcher, no events");
    }

    #[test]
    fn list_meta_stamps_only_visible_files_with_storage_metadata() {
        let (_dir, view) = disk_view(
            &[
                ("Fern.md", "fern fronds\n"),
                ("notes/Moss.md", "moss"),
                (".hidden.md", "dot"),
                (".trash/Old.md", "old"),
                ("private/Payroll.md", "salary"),
            ],
            "private/",
        );
        let meta = view.list_meta().unwrap();
        let mut names: Vec<_> = meta.keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["Fern.md", "notes/Moss.md"]);
        let storage = view.space.get_file_meta("Fern.md").unwrap();
        assert_eq!(
            meta["Fern.md"],
            FileStamp {
                modified: storage.last_modified,
                size: 12,
            }
        );
        assert!(meta["Fern.md"].modified > 0);
        assert_eq!(meta["notes/Moss.md"].size, 4);
    }

    #[test]
    fn reads_return_whole_files_and_refuse_dot_paths_and_ignored_files() {
        let (_dir, view) = disk_view(
            &[
                ("Fern.md", "fern fronds\n"),
                (".hidden.md", "dot"),
                (".trash/Old.md", "old"),
                ("notes/.draft.md", "draft"),
                ("private/Payroll.md", "salary"),
                ("private/deep/Bonus.md", "bonus"),
                ("Secret.md", "secret"),
            ],
            "private/\nSecret.md",
        );
        assert_eq!(view.read("Fern.md").as_deref(), Some(&b"fern fronds\n"[..]));
        assert_eq!(
            view.read_prefix("Fern.md", 4).as_deref(),
            Some(&b"fern"[..])
        );
        for hidden in [
            ".hidden.md",
            ".trash/Old.md",
            "notes/.draft.md",
            "private/Payroll.md",
            "private/deep/Bonus.md",
            "Secret.md",
            "",
            "/Fern.md",
            "../Fern.md",
            "notes/../Fern.md",
            "./Fern.md",
            "notes//Fern.md",
            "notes\\..\\Fern.md",
            ".trash\\Old.md",
        ] {
            assert_eq!(view.read(hidden), None, "{hidden}");
            assert_eq!(view.read_prefix(hidden, 3), None, "{hidden}");
        }
        assert_eq!(view.read("Missing.md"), None);
    }

    #[test]
    fn read_and_list_meta_refuse_server_control_files() {
        let (dir, _) = disk_view(&[("Fern.md", "fern"), ("server.json", "{}")], "");
        let disk = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        let filtered = crate::multi::instance::ServerControlFileFilter::new(Box::new(disk));
        let view = SpaceSearchView::new(Arc::new(filtered), GitignoreMatcher::default());
        assert_eq!(view.read("server.json"), None);
        assert_eq!(view.read_prefix("server.json", 1), None);
        assert_eq!(view.read("Fern.md").as_deref(), Some(&b"fern"[..]));
        let meta = view.list_meta().unwrap();
        assert!(!meta.contains_key("server.json"), "{meta:?}");
        assert!(meta.contains_key("Fern.md"));
    }
}
