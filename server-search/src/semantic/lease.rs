//! Exclusive leases on semantic index files, process-wide: a file has one
//! sink at a time, from before the sink reads it until it closes. A space's
//! directory is removed only once no sink holds a file under it.

use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::Location;

/// The index files a sink holds, process-wide: a file has one sink at a time.
static OWNED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
static RELEASED: Condvar = Condvar::new();
/// How long an open waits for a file's owner before it warns (once).
const OWNER_WARN: Duration = Duration::from_secs(30);

/// `path` with its longest existing ancestor canonicalised, so a file has
/// one key whether or not it (or its directory) exists yet.
fn owner_key(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut base = path;
    loop {
        if let Ok(canonical) = base.canonicalize() {
            return rest.iter().rev().fold(canonical, |p, c| p.join(c));
        }
        match (base.parent(), base.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                base = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

fn owned() -> MutexGuard<'static, Vec<PathBuf>> {
    OWNED.lock().unwrap_or_else(|e| e.into_inner())
}

/// Blocks until no sink holds `key`, calling `on_wait` after every second
/// of waiting. Returns the registry, locked.
fn wait_free(key: &Path, mut on_wait: impl FnMut()) -> MutexGuard<'static, Vec<PathBuf>> {
    let mut held = owned();
    while held.iter().any(|p| p == key) {
        held = RELEASED
            .wait_timeout(held, Duration::from_secs(1))
            .unwrap_or_else(|e| e.into_inner())
            .0;
        on_wait();
    }
    held
}

/// Exclusive hold of one index file, from before the sink reads it until it
/// closes (or drops): no other sink opens or writes that file meanwhile.
pub(crate) struct Owner(PathBuf);

impl Owner {
    /// Blocks until no other sink holds `path`.
    pub(crate) fn acquire(path: &Path) -> Owner {
        let key = owner_key(path);
        let started = Instant::now();
        let mut warned = false;
        let mut held = wait_free(&key, || {
            if !warned && started.elapsed() >= OWNER_WARN {
                warned = true;
                tracing::warn!(
                    "Semantic index {}: still waiting for its previous sink to close",
                    path.display()
                );
            }
        });
        held.push(key.clone());
        Owner(key)
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        owned().retain(|p| p != &self.0);
        RELEASED.notify_all();
    }
}

/// Blocks until no sink holds an index file under `dir`, whichever model
/// it is for (a sink of a replaced service closing in the background, too).
fn wait_unowned_under(dir: &Path) {
    let key = owner_key(dir);
    let mut held = owned();
    while held.iter().any(|p| p.starts_with(&key)) {
        held = RELEASED
            .wait_timeout(held, Duration::from_secs(1))
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
}

/// Blocks until no sink holds a semantic index file of the space at
/// `location`, for any model: a space's directory can then be removed
/// without a late save recreating it, even after a model switch.
pub fn wait_closed_at(location: &Location) {
    if let Location::Disk(dir) = location {
        wait_unowned_under(&dir.join(super::store::SCHEMA_DIR));
    }
}

/// Tests: writers of each index file right now, the most at once, and saves.
#[cfg(test)]
pub(crate) mod writers {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    pub struct Count {
        pub now: usize,
        pub most: usize,
        pub saves: usize,
    }

    static COUNTS: Mutex<Option<HashMap<PathBuf, Count>>> = Mutex::new(None);

    fn with<R>(path: &Path, f: impl FnOnce(&mut Count) -> R) -> R {
        let mut counts = COUNTS.lock().unwrap_or_else(|e| e.into_inner());
        f(counts
            .get_or_insert_with(HashMap::new)
            .entry(super::owner_key(path))
            .or_default())
    }

    pub fn of(path: &Path) -> Count {
        with(path, |c| *c)
    }

    /// Counts a writer of `path` until dropped.
    pub struct Writing(PathBuf);

    pub fn enter(path: &Path) -> Writing {
        with(path, |c| {
            c.now += 1;
            c.most = c.most.max(c.now);
        });
        Writing(path.to_path_buf())
    }

    impl Drop for Writing {
        fn drop(&mut self) {
            with(&self.0, |c| {
                c.now -= 1;
                c.saves += 1;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// M4: a space's wait covers every model's file, not just one.
    #[test]
    fn waiting_for_a_space_covers_every_models_file() {
        let dir = tempfile::tempdir().unwrap();
        let old = Owner::acquire(&dir.path().join("semantic-v1/old-model.bin"));
        let other = tempfile::tempdir().unwrap();
        let _unrelated = Owner::acquire(&other.path().join("semantic-v1/old-model.bin"));
        let location = Location::Disk(dir.path().into());
        let done = std::sync::Arc::new(AtomicBool::new(false));
        let waiter = {
            let done = done.clone();
            std::thread::spawn(move || {
                wait_closed_at(&location);
                done.store(true, Ordering::SeqCst);
            })
        };
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !done.load(Ordering::SeqCst),
            "the old model's sink holds it"
        );
        drop(old);
        waiter.join().unwrap();
        assert!(done.load(Ordering::SeqCst));
    }
}
