//! A space's file listing, kept in memory and current from the filesystem
//! watcher, so listing requests stop re-walking (and `stat`ing) the whole
//! space each time. Every client polls the listing, so without this the disk
//! work grows with the number of open tabs and devices.
//!
//! The watcher's validated events are applied as they arrive. Anything it
//! cannot describe -- an overflow, a vanished directory, a lagging feed --
//! drops the cache, and a real walk still happens at least every
//! `REVALIDATE_AFTER` to catch what a watcher never sees (changes made by
//! another host on a network filesystem, a folder moved in from outside).
//! Without an attached watcher every listing walks, as before.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use silverbullet_server_common::space::disk::DiskSpacePrimitives;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};
use tokio::sync::broadcast;

use crate::watcher::{FsAction, FsEvent};

const REVALIDATE_AFTER: Duration = Duration::from_secs(60);

pub struct ListingCachedSpace {
    disk: Arc<DiskSpacePrimitives>,
    cache: Arc<ListingCache>,
}

impl ListingCachedSpace {
    pub fn new(disk: DiskSpacePrimitives) -> Self {
        let case_insensitive = disk.is_case_insensitive();
        Self {
            disk: Arc::new(disk),
            cache: Arc::new(ListingCache::new(case_insensitive, REVALIDATE_AFTER)),
        }
    }

    /// Starts serving listings from memory, kept current by `events`. Only
    /// for a sender fed by `start_watcher` over this same folder: a sender
    /// nothing feeds would leave the cache trusted and never updated.
    pub fn attach(&self, events: &broadcast::Sender<FsEvent>) {
        let mut receiver = events.subscribe();
        self.cache.lock().live = true;
        let cache = self.cache.clone();
        let disk = self.disk.clone();
        let spawned = std::thread::Builder::new()
            .name("sb-listing-cache".into())
            .spawn(move || loop {
                match receiver.blocking_recv() {
                    Ok(event) => cache.apply(&event, &*disk),
                    Err(broadcast::error::RecvError::Lagged(_)) => cache.invalidate(),
                    Err(broadcast::error::RecvError::Closed) => {
                        let mut state = cache.lock();
                        state.live = false;
                        state.clear();
                        return;
                    }
                }
            });
        if let Err(e) = spawned {
            tracing::warn!("Not caching the file listing: {e}");
            self.cache.lock().live = false;
        }
    }
}

impl SpacePrimitives for ListingCachedSpace {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        self.cache
            .fetch(|| self.disk.fetch_file_list(), &*self.disk)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.disk.get_file_meta(path)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.disk.read_file(path)
    }

    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.disk.read_file_range(path, start, length)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let written = self.disk.write_file(path, data, meta);
        // Even a failed write may have re-cased or created the file.
        self.cache.refresh(path, &*self.disk);
        written
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        let deleted = self.disk.delete_file(path);
        self.cache.refresh(path, &*self.disk);
        deleted
    }
}

/// What the cache needs from the disk to re-check one path.
trait ListableMeta {
    fn listable_meta(&self, path: &str) -> Result<Option<FileMeta>, SpaceError>;
}

impl ListableMeta for DiskSpacePrimitives {
    fn listable_meta(&self, path: &str) -> Result<Option<FileMeta>, SpaceError> {
        self.get_file_meta_if_listable(path)
    }
}

struct ListingCache {
    state: Mutex<State>,
    /// Held for a whole walk, so concurrent listings share one.
    walk: Mutex<()>,
    case_insensitive: bool,
    revalidate_after: Duration,
}

#[derive(Default)]
struct State {
    live: bool,
    files: Option<Files>,
    walked_at: Option<Instant>,
    /// While a walk runs: the paths that changed meanwhile, to re-check once
    /// it lands, or `Invalidated` when the walk's result can't be trusted.
    during_walk: Option<Touched>,
}

impl State {
    fn clear(&mut self) {
        self.files = None;
        self.walked_at = None;
        if self.during_walk.is_some() {
            self.during_walk = Some(Touched::Invalidated);
        }
    }

    fn touch(&mut self, path: &str) {
        if let Some(Touched::Paths(paths)) = &mut self.during_walk {
            paths.insert(path.to_string());
        }
    }
}

enum Touched {
    Paths(HashSet<String>),
    Invalidated,
}

#[derive(Default)]
struct Files {
    by_name: HashMap<String, FileMeta>,
    /// Lowercased name -> stored name, kept on case-insensitive disks only.
    by_folded: HashMap<String, String>,
    /// The listing as last served, rebuilt after any change.
    sorted: Option<Vec<FileMeta>>,
}

impl Files {
    fn from_list(list: &[FileMeta], case_insensitive: bool) -> Self {
        let mut files = Files::default();
        for meta in list {
            files.upsert(meta.clone(), case_insensitive);
        }
        files
    }

    fn upsert(&mut self, meta: FileMeta, case_insensitive: bool) {
        if case_insensitive {
            let folded = meta.name.to_lowercase();
            if let Some(previous) = self.by_folded.insert(folded, meta.name.clone()) {
                if previous != meta.name {
                    self.by_name.remove(&previous);
                }
            }
        }
        self.by_name.insert(meta.name.clone(), meta);
        self.sorted = None;
    }

    /// Whether `name` was a listed file.
    fn remove(&mut self, name: &str, case_insensitive: bool) -> bool {
        let Some(removed) = self.by_name.remove(name) else {
            return false;
        };
        if case_insensitive {
            self.by_folded.remove(&removed.name.to_lowercase());
        }
        self.sorted = None;
        true
    }

    fn listing(&mut self) -> Vec<FileMeta> {
        self.sorted
            .get_or_insert_with(|| {
                let mut list: Vec<FileMeta> = self.by_name.values().cloned().collect();
                list.sort_by(|a, b| a.name.cmp(&b.name));
                list
            })
            .clone()
    }
}

impl ListingCache {
    fn new(case_insensitive: bool, revalidate_after: Duration) -> Self {
        Self {
            state: Mutex::new(State::default()),
            walk: Mutex::new(()),
            case_insensitive,
            revalidate_after,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn fresh(&self) -> Option<Vec<FileMeta>> {
        let mut state = self.lock();
        if !state.live || state.walked_at?.elapsed() >= self.revalidate_after {
            return None;
        }
        Some(state.files.as_mut()?.listing())
    }

    fn fetch(
        &self,
        walk: impl FnOnce() -> Result<Vec<FileMeta>, SpaceError>,
        disk: &dyn ListableMeta,
    ) -> Result<Vec<FileMeta>, SpaceError> {
        if let Some(list) = self.fresh() {
            return Ok(list);
        }
        if !self.lock().live {
            return walk();
        }
        let _walking = self.walk.lock().unwrap_or_else(|e| e.into_inner());
        // Another request may have finished the walk this one waited on.
        if let Some(list) = self.fresh() {
            return Ok(list);
        }
        self.lock().during_walk = Some(Touched::Paths(HashSet::new()));
        let listed = walk();
        let touched = self.lock().during_walk.take();
        let list = listed?;
        let Some(Touched::Paths(touched)) = touched else {
            return Ok(list);
        };
        {
            let mut state = self.lock();
            if !state.live {
                return Ok(list);
            }
            state.files = Some(Files::from_list(&list, self.case_insensitive));
            state.walked_at = Some(Instant::now());
        }
        // The walk may have passed these before or after they changed.
        for path in touched {
            self.refresh(&path, disk);
        }
        Ok(self.fresh().unwrap_or(list))
    }

    fn invalidate(&self) {
        self.lock().clear();
    }

    /// Re-checks one path against the disk.
    fn refresh(&self, path: &str, disk: &dyn ListableMeta) {
        let current = disk.listable_meta(path);
        let mut state = self.lock();
        state.touch(path);
        let case_insensitive = self.case_insensitive;
        let Some(files) = state.files.as_mut() else {
            return;
        };
        match current {
            Ok(Some(meta)) => files.upsert(meta, case_insensitive),
            Ok(None) | Err(SpaceError::NotFound) => {
                files.remove(path, case_insensitive);
            }
            Err(_) => state.clear(),
        }
    }

    fn apply(&self, event: &FsEvent, disk: &dyn ListableMeta) {
        match event.action {
            FsAction::Change => self.refresh(&event.name, disk),
            FsAction::Delete => {
                let mut state = self.lock();
                state.touch(&event.name);
                let case_insensitive = self.case_insensitive;
                let was_file = state
                    .files
                    .as_mut()
                    .is_some_and(|files| files.remove(&event.name, case_insensitive));
                // Not a file we listed, so most likely a directory: whatever it
                // held is gone (or renamed somewhere no event will name).
                if !was_file {
                    state.clear();
                }
            }
            FsAction::Resync => self.invalidate(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn meta(name: &str, last_modified: i64) -> FileMeta {
        FileMeta {
            name: name.to_string(),
            created: 1,
            last_modified,
            content_type: "text/markdown".to_string(),
            size: 1,
            perm: "rw".to_string(),
        }
    }

    /// A disk the tests rewrite between calls.
    #[derive(Default)]
    struct FakeDisk {
        files: Mutex<HashMap<String, FileMeta>>,
        walks: AtomicUsize,
    }

    impl FakeDisk {
        fn put(&self, name: &str, last_modified: i64) {
            self.files
                .lock()
                .unwrap()
                .insert(name.to_string(), meta(name, last_modified));
        }

        fn drop_file(&self, name: &str) {
            self.files.lock().unwrap().remove(name);
        }

        fn walk(&self) -> Result<Vec<FileMeta>, SpaceError> {
            self.walks.fetch_add(1, Ordering::SeqCst);
            Ok(self.files.lock().unwrap().values().cloned().collect())
        }
    }

    impl ListableMeta for FakeDisk {
        fn listable_meta(&self, path: &str) -> Result<Option<FileMeta>, SpaceError> {
            match self.files.lock().unwrap().get(path) {
                Some(m) => Ok(Some(m.clone())),
                None => Err(SpaceError::NotFound),
            }
        }
    }

    fn live_cache(case_insensitive: bool) -> ListingCache {
        let cache = ListingCache::new(case_insensitive, Duration::from_secs(60));
        cache.lock().live = true;
        cache
    }

    fn names(list: &[FileMeta]) -> Vec<&str> {
        list.iter().map(|m| m.name.as_str()).collect()
    }

    fn event(name: &str, action: FsAction) -> FsEvent {
        FsEvent {
            name: name.to_string(),
            action,
            last_modified: 0,
            revision: None,
            origin: None,
        }
    }

    #[test]
    fn without_a_watcher_every_listing_walks() {
        let disk = FakeDisk::default();
        disk.put("a.md", 1);
        let cache = ListingCache::new(false, Duration::from_secs(60));
        cache.fetch(|| disk.walk(), &disk).unwrap();
        cache.fetch(|| disk.walk(), &disk).unwrap();
        assert_eq!(disk.walks.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_live_cache_walks_once_and_follows_events() {
        let disk = FakeDisk::default();
        disk.put("b.md", 1);
        disk.put("a.md", 1);
        let cache = live_cache(false);
        assert_eq!(
            names(&cache.fetch(|| disk.walk(), &disk).unwrap()),
            ["a.md", "b.md"]
        );

        disk.put("c.md", 2);
        cache.apply(&event("c.md", FsAction::Change), &disk);
        disk.put("a.md", 5);
        cache.apply(&event("a.md", FsAction::Change), &disk);
        disk.drop_file("b.md");
        cache.apply(&event("b.md", FsAction::Delete), &disk);

        let list = cache.fetch(|| disk.walk(), &disk).unwrap();
        assert_eq!(names(&list), ["a.md", "c.md"]);
        assert_eq!(list[0].last_modified, 5);
        assert_eq!(disk.walks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_vanished_directory_or_a_resync_forces_a_walk() {
        let disk = FakeDisk::default();
        disk.put("Folder/a.md", 1);
        let cache = live_cache(false);
        cache.fetch(|| disk.walk(), &disk).unwrap();

        disk.drop_file("Folder/a.md");
        disk.put("Renamed/a.md", 1);
        cache.apply(&event("Folder", FsAction::Delete), &disk);
        assert_eq!(
            names(&cache.fetch(|| disk.walk(), &disk).unwrap()),
            ["Renamed/a.md"]
        );

        cache.apply(&event("", FsAction::Resync), &disk);
        cache.fetch(|| disk.walk(), &disk).unwrap();
        assert_eq!(disk.walks.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn listings_revalidate_after_the_interval() {
        let disk = FakeDisk::default();
        disk.put("a.md", 1);
        let cache = ListingCache::new(false, Duration::from_millis(5));
        cache.lock().live = true;
        cache.fetch(|| disk.walk(), &disk).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        disk.put("from-another-host.md", 1);
        let list = cache.fetch(|| disk.walk(), &disk).unwrap();
        assert_eq!(names(&list), ["a.md", "from-another-host.md"]);
    }

    #[test]
    fn a_change_during_a_walk_is_rechecked_after_it() {
        let disk = FakeDisk::default();
        disk.put("a.md", 1);
        let cache = live_cache(false);
        let list = cache
            .fetch(
                || {
                    let walked = disk.walk();
                    // Lands after the walk passed it, before it finished.
                    disk.put("a.md", 9);
                    disk.put("new.md", 9);
                    cache.apply(&event("a.md", FsAction::Change), &disk);
                    cache.apply(&event("new.md", FsAction::Change), &disk);
                    walked
                },
                &disk,
            )
            .unwrap();
        assert_eq!(names(&list), ["a.md", "new.md"]);
        assert_eq!(list[0].last_modified, 9);
    }

    #[test]
    fn a_resync_during_a_walk_keeps_its_result_out_of_the_cache() {
        let disk = FakeDisk::default();
        disk.put("a.md", 1);
        let cache = live_cache(false);
        cache
            .fetch(
                || {
                    let walked = disk.walk();
                    cache.apply(&event("", FsAction::Resync), &disk);
                    walked
                },
                &disk,
            )
            .unwrap();
        cache.fetch(|| disk.walk(), &disk).unwrap();
        assert_eq!(disk.walks.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_case_only_rename_replaces_the_old_casing() {
        let disk = FakeDisk::default();
        disk.put("page.md", 1);
        let cache = live_cache(true);
        cache.fetch(|| disk.walk(), &disk).unwrap();
        disk.drop_file("page.md");
        disk.put("Page.md", 2);
        cache.apply(&event("Page.md", FsAction::Change), &disk);
        assert_eq!(
            names(&cache.fetch(|| disk.walk(), &disk).unwrap()),
            ["Page.md"]
        );
    }

    #[test]
    fn concurrent_listings_share_one_walk() {
        let disk = Arc::new(FakeDisk::default());
        disk.put("a.md", 1);
        let cache = Arc::new(live_cache(false));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let (disk, cache) = (disk.clone(), cache.clone());
                std::thread::spawn(move || {
                    cache
                        .fetch(
                            || {
                                std::thread::sleep(Duration::from_millis(30));
                                disk.walk()
                            },
                            &*disk,
                        )
                        .unwrap()
                })
            })
            .collect();
        for t in threads {
            assert_eq!(names(&t.join().unwrap()), ["a.md"]);
        }
        assert_eq!(disk.walks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_real_watcher_keeps_the_listing_current() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.md"), "a").unwrap();
        let disk = DiskSpacePrimitives::new(dir.path(), "").unwrap();
        let space = ListingCachedSpace::new(disk);
        let events = crate::start_watcher(
            dir.path(),
            "",
            crate::WatchMode::Auto,
            Arc::new(crate::FsGuard::default()),
        )
        .unwrap();
        space.attach(&events);
        assert_eq!(names(&space.fetch_file_list().unwrap()), ["a.md"]);

        space.write_file("b.md", b"b", None).unwrap();
        assert_eq!(names(&space.fetch_file_list().unwrap()), ["a.md", "b.md"]);

        std::fs::write(dir.path().join("external.md"), "x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let list = space.fetch_file_list().unwrap();
            if names(&list).contains(&"external.md") {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "watcher never reported the change"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        space.delete_file("a.md").unwrap();
        assert_eq!(
            names(&space.fetch_file_list().unwrap()),
            ["b.md", "external.md"]
        );
    }
}
