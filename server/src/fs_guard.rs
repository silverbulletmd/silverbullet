use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use silverbullet_server_common::revision::sha256_hex;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};

use crate::auth::Actor;

/// Above this many distinct paths, `path_lock` sweeps out entries nobody else
/// holds a reference to, so a space that churns through many paths over its
/// lifetime doesn't grow the map without bound.
const LOCK_SWEEP_THRESHOLD: usize = 10_000;

/// How long an expected-write entry stays attributable. Best-effort: a
/// watcher event arriving later than this is simply reported as external.
const EXPECTED_WRITE_TTL: Duration = Duration::from_secs(30);
/// Above this many entries, `record_expected_write` opportunistically sweeps
/// out expired ones -- same spirit as `LOCK_SWEEP_THRESHOLD`.
const EXPECTED_WRITE_SWEEP_THRESHOLD: usize = 10_000;
/// Above this many cached content hashes, `record` evicts in insertion order.
/// Plain FIFO rather than LRU: an entry evicted while still hot is re-recorded
/// by its next write, costing one hash, and a space large enough to churn
/// through this many paths is past the point where an exact policy pays for
/// the bookkeeping.
const HASH_CACHE_CAPACITY: usize = 10_000;

/// The resolved identity of a write this process just made, keyed by
/// `(path, content hash)` so the watcher can match it up against the
/// filesystem event it later produces. Best-effort only (constraint 3): never
/// consulted on any error path.
///
/// `size`/`last_modified` are `Some` only when the recording call site had
/// the written (or, for a delete, the about-to-vanish) file's meta in hand;
/// a delete event's `revision` is only ever populated from a `Some` pair here
/// (see `enrich_event`) so it never reports a fabricated size/timestamp.
#[derive(Debug, Clone)]
pub struct ExpectedWrite {
    pub actor: Actor,
    pub client_id: Option<String>,
    pub source: Option<String>,
    pub size: Option<i64>,
    pub last_modified: Option<i64>,
    recorded_at: Instant,
}

/// Content hashes keyed by path, each valid only while the file still reports
/// the `(last_modified, size)` it was recorded against. `order` bounds the map:
/// see [`HASH_CACHE_CAPACITY`].
#[derive(Default)]
struct HashCache {
    entries: HashMap<String, (i64, i64, String)>,
    order: VecDeque<String>,
}

/// Per-space content-hash cache and per-path mutation locks for conditional
/// `/.fs` writes.
#[derive(Default)]
pub struct FsGuard {
    cache: RwLock<HashCache>,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    expected_writes: Mutex<HashMap<(String, String), ExpectedWrite>>,
    #[cfg(test)]
    hash_for_calls: std::sync::atomic::AtomicUsize,
}

impl FsGuard {
    /// Cached hash for the path, validated against (mtime, size); on miss,
    /// reads the file through `space` and hashes it.
    pub fn hash_for(&self, space: &dyn SpacePrimitives, path: &str) -> Result<String, SpaceError> {
        #[cfg(test)]
        self.hash_for_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let meta = space.get_file_meta(path)?;
        if let Some(hash) = self.cached_hash(path, &meta) {
            return Ok(hash);
        }
        let (data, meta) = space.read_file(path)?;
        let hash = sha256_hex(&data);
        self.record(path, &meta, hash.clone());
        Ok(hash)
    }

    /// The recorded hash for `path`, if one was recorded against exactly the
    /// `(last_modified, size)` `meta` reports. Callers that already hold both
    /// the file's bytes and its meta use this to skip re-hashing content this
    /// process has hashed before.
    pub fn cached_hash(&self, path: &str, meta: &FileMeta) -> Option<String> {
        let cache = self.cache.read().unwrap();
        let (mtime, size, hash) = cache.entries.get(path)?;
        (*mtime == meta.last_modified && *size == meta.size).then(|| hash.clone())
    }

    /// Total number of `hash_for` calls made so far. Test-only: lets a test
    /// pin that a code path (e.g. the watcher's flood-control path) never
    /// hashes file contents.
    #[cfg(test)]
    pub(crate) fn hash_for_call_count(&self) -> usize {
        self.hash_for_calls
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Record the hash of content just written, keyed by the write's result meta.
    pub fn record(&self, path: &str, meta: &FileMeta, hash: String) {
        let mut cache = self.cache.write().unwrap();
        if cache
            .entries
            .insert(path.to_string(), (meta.last_modified, meta.size, hash))
            .is_none()
        {
            cache.order.push_back(path.to_string());
        }
        while cache.order.len() > HASH_CACHE_CAPACITY {
            // A key `forget` already dropped is popped here too; removing it
            // again is a no-op, and bounding `order` bounds `entries` with it.
            let Some(oldest) = cache.order.pop_front() else {
                break;
            };
            cache.entries.remove(&oldest);
        }
    }

    /// Forget a path (after delete).
    pub fn forget(&self, path: &str) {
        self.cache.write().unwrap().entries.remove(path);
    }

    /// Per-path mutation lock (handlers wrap validate-then-write in it).
    pub fn path_lock(&self, path: &str) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().unwrap();
        if locks.len() > LOCK_SWEEP_THRESHOLD {
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        }
        locks.entry(path.to_string()).or_default().clone()
    }

    /// Record that a write to `(path, hash)` was made by `actor`/`client_id`/
    /// `source` (see constraint 6), without a known size/last-modified (see
    /// `record_expected_write_with_meta` when the caller has them). Best-effort:
    /// the watcher looks this up to attribute the filesystem event the write
    /// produces; a miss just means the event is reported as external.
    pub fn record_expected_write(
        &self,
        path: &str,
        hash: &str,
        actor: Actor,
        client_id: Option<String>,
        source: Option<String>,
    ) {
        self.record_expected_write_at(
            path,
            hash,
            actor,
            client_id,
            source,
            None,
            None,
            Instant::now(),
        );
    }

    /// Like [`Self::record_expected_write`], but also records the written (or
    /// about-to-be-deleted) revision's size and last-modified, so a delete
    /// event can carry a truthful `revision` (constraint 5's revision fields
    /// are all-or-nothing; deletes can't rehash their vanished content, so
    /// this is the only source for them).
    #[allow(clippy::too_many_arguments)]
    pub fn record_expected_write_with_meta(
        &self,
        path: &str,
        hash: &str,
        actor: Actor,
        client_id: Option<String>,
        source: Option<String>,
        size: i64,
        last_modified: i64,
    ) {
        self.record_expected_write_at(
            path,
            hash,
            actor,
            client_id,
            source,
            Some(size),
            Some(last_modified),
            Instant::now(),
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn record_expected_write_at(
        &self,
        path: &str,
        hash: &str,
        actor: Actor,
        client_id: Option<String>,
        source: Option<String>,
        size: Option<i64>,
        last_modified: Option<i64>,
        now: Instant,
    ) {
        let mut map = self.expected_writes.lock().unwrap();
        if map.len() > EXPECTED_WRITE_SWEEP_THRESHOLD {
            map.retain(|_, v| now.duration_since(v.recorded_at) < EXPECTED_WRITE_TTL);
        }
        map.insert(
            (path.to_string(), hash.to_string()),
            ExpectedWrite {
                actor,
                client_id,
                source,
                size,
                last_modified,
                recorded_at: now,
            },
        );
    }

    /// The expected-write entry for an exact `(path, hash)`, if any and not
    /// yet expired.
    pub fn lookup_expected_write(&self, path: &str, hash: &str) -> Option<ExpectedWrite> {
        let now = Instant::now();
        self.expected_writes
            .lock()
            .unwrap()
            .get(&(path.to_string(), hash.to_string()))
            .filter(|v| now.duration_since(v.recorded_at) < EXPECTED_WRITE_TTL)
            .cloned()
    }

    /// The most recently recorded, unexpired entry for `path`, regardless of
    /// hash. A deleted file can't be rehashed to look up an exact key, so a
    /// delete event's attribution falls back to "whatever this path's freshest
    /// expected write was". Returns the hash it was recorded under alongside
    /// the entry.
    pub fn latest_expected_write_for_path(&self, path: &str) -> Option<(String, ExpectedWrite)> {
        let now = Instant::now();
        self.expected_writes
            .lock()
            .unwrap()
            .iter()
            .filter(|((p, _), v)| {
                p == path && now.duration_since(v.recorded_at) < EXPECTED_WRITE_TTL
            })
            .max_by_key(|(_, v)| v.recorded_at)
            .map(|((_, hash), v)| (hash.clone(), v.clone()))
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn record_expected_write_with_time(
        &self,
        path: &str,
        hash: &str,
        actor: Actor,
        client_id: Option<String>,
        source: Option<String>,
        recorded_at: Instant,
    ) {
        self.record_expected_write_at(
            path,
            hash,
            actor,
            client_id,
            source,
            None,
            None,
            recorded_at,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_meta(last_modified: i64) -> FileMeta {
        FileMeta {
            name: "a.md".into(),
            created: 0,
            last_modified,
            content_type: "text/markdown".into(),
            size: 1,
            perm: "rw".into(),
        }
    }

    #[test]
    fn records_and_looks_up_an_exact_path_hash_match() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            Some("client-1".into()),
            Some("editor".into()),
        );
        let ew = guard
            .lookup_expected_write("a.md", "hash1")
            .expect("expected write recorded");
        assert_eq!(ew.actor.username.as_deref(), Some("alice"));
        assert_eq!(ew.client_id.as_deref(), Some("client-1"));
        assert_eq!(ew.source.as_deref(), Some("editor"));
    }

    #[test]
    fn record_with_meta_carries_size_and_last_modified() {
        let guard = FsGuard::default();
        guard.record_expected_write_with_meta(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
            5,
            999,
        );
        let ew = guard.lookup_expected_write("a.md", "hash1").unwrap();
        assert_eq!(ew.size, Some(5));
        assert_eq!(ew.last_modified, Some(999));
    }

    #[test]
    fn record_without_meta_leaves_size_and_last_modified_unknown() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
        );
        let ew = guard.lookup_expected_write("a.md", "hash1").unwrap();
        assert_eq!(ew.size, None);
        assert_eq!(ew.last_modified, None);
    }

    #[test]
    fn lookup_misses_on_wrong_path_or_wrong_hash() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
        );
        assert!(guard.lookup_expected_write("a.md", "hash2").is_none());
        assert!(guard.lookup_expected_write("b.md", "hash1").is_none());
    }

    #[test]
    fn entry_expires_after_the_ttl() {
        let guard = FsGuard::default();
        let old = Instant::now() - (EXPECTED_WRITE_TTL + Duration::from_secs(1));
        guard.record_expected_write_with_time(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
            old,
        );
        assert!(guard.lookup_expected_write("a.md", "hash1").is_none());
    }

    #[test]
    fn entry_just_under_the_ttl_still_hits() {
        let guard = FsGuard::default();
        let recent = Instant::now() - Duration::from_secs(1);
        guard.record_expected_write_with_time(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
            recent,
        );
        assert!(guard.lookup_expected_write("a.md", "hash1").is_some());
    }

    #[test]
    fn latest_expected_write_for_path_ignores_hash_and_picks_the_freshest() {
        let guard = FsGuard::default();
        let older = Instant::now() - Duration::from_secs(10);
        guard.record_expected_write_with_time(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
            older,
        );
        guard.record_expected_write(
            "a.md",
            "hash2",
            Actor {
                username: Some("bob".into()),
                ..Default::default()
            },
            None,
            None,
        );

        let (hash, ew) = guard
            .latest_expected_write_for_path("a.md")
            .expect("an entry for a.md");
        assert_eq!(hash, "hash2");
        assert_eq!(ew.actor.username.as_deref(), Some("bob"));
    }

    #[test]
    fn latest_expected_write_for_path_ignores_expired_entries() {
        let guard = FsGuard::default();
        let old = Instant::now() - (EXPECTED_WRITE_TTL + Duration::from_secs(1));
        guard.record_expected_write_with_time(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
            old,
        );
        assert!(guard.latest_expected_write_for_path("a.md").is_none());
    }

    #[test]
    fn latest_expected_write_for_path_misses_an_unknown_path() {
        let guard = FsGuard::default();
        guard.record_expected_write(
            "a.md",
            "hash1",
            Actor {
                username: Some("alice".into()),
                ..Default::default()
            },
            None,
            None,
        );
        assert!(guard.latest_expected_write_for_path("b.md").is_none());
    }

    #[test]
    fn hash_for_call_count_tracks_calls() {
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        space.write_file("a.md", b"hello", None).unwrap();
        let guard = FsGuard::default();
        assert_eq!(guard.hash_for_call_count(), 0);
        guard.hash_for(&space, "a.md").unwrap();
        guard.hash_for(&space, "a.md").unwrap();
        assert_eq!(guard.hash_for_call_count(), 2);
    }

    #[test]
    fn cached_hash_hits_on_matching_meta_and_misses_once_it_changes() {
        let space = silverbullet_server_common::space::MemorySpacePrimitives::new();
        let meta = space.write_file("a.md", b"hello", None).unwrap();
        let guard = FsGuard::default();
        assert_eq!(guard.cached_hash("a.md", &meta), None);

        let hash = guard.hash_for(&space, "a.md").unwrap();
        assert_eq!(guard.cached_hash("a.md", &meta).as_ref(), Some(&hash));

        let stale = FileMeta {
            size: meta.size + 1,
            ..meta.clone()
        };
        assert_eq!(guard.cached_hash("a.md", &stale), None);
    }

    #[test]
    fn record_evicts_in_insertion_order_past_capacity() {
        let guard = FsGuard::default();
        let meta = test_meta(1);
        for i in 0..HASH_CACHE_CAPACITY + 10 {
            guard.record(&format!("p{i}.md"), &meta, format!("h{i}"));
        }
        let cache = guard.cache.read().unwrap();
        assert_eq!(cache.entries.len(), HASH_CACHE_CAPACITY);
        assert_eq!(cache.order.len(), HASH_CACHE_CAPACITY);
        assert!(!cache.entries.contains_key("p0.md"));
        assert!(cache
            .entries
            .contains_key(&format!("p{}.md", HASH_CACHE_CAPACITY + 9)));
    }

    #[test]
    fn re_recording_the_same_path_does_not_grow_the_eviction_queue() {
        let guard = FsGuard::default();
        for i in 0..100 {
            guard.record("a.md", &test_meta(i), format!("h{i}"));
        }
        let cache = guard.cache.read().unwrap();
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.order.len(), 1);
    }
}
