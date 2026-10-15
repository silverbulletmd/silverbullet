//! Where every space's indexes live on disk and how they are deleted safely:
//! the safe-id check, the boot sweep of what no space uses, the removal of
//! one space's directory with its retries, superseded model revisions, and
//! the per-space removal fence ([`Removals`]) that keeps a space from
//! opening while its directory goes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};

use silverbullet_server_search::semantic::catalog;
use silverbullet_server_search::{is_schema_dir, Location, SearchRoot, CURRENT_SCHEMA_DIRS};

/// How often, and how far apart, a deleted space's index removal is tried:
/// a commit the old worker had started can still be writing files.
const REMOVE_TRIES: u32 = 20;
const REMOVE_RETRY: std::time::Duration = std::time::Duration::from_millis(250);

/// The directory holding every space's full-text index, one subdirectory
/// per space id: `<data root>/search/indexes` on a multi-user server,
/// `<app data>/search/indexes` on Desktop. Every path into it goes through
/// [`IndexRoot::location`]'s safe-id check, and every delete through a
/// strictly-inside check on canonical paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexRoot(PathBuf);

impl IndexRoot {
    /// `<data root>/search/indexes`.
    #[cfg(test)]
    pub(crate) fn in_data_root(root: &Path) -> IndexRoot {
        IndexRoot::of(&super::search_root(root))
    }

    /// `<search root>/indexes`.
    pub(crate) fn of(root: &SearchRoot) -> IndexRoot {
        IndexRoot(root.indexes())
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    /// `Disk(<root>/<id>)`, or RAM (with a warning) for an id that isn't one
    /// safe path component.
    pub(crate) fn location(&self, id: &str) -> Location {
        match index_dir(&self.0, id) {
            Some(dir) => Location::Disk(dir),
            None => Location::Memory,
        }
    }

    /// Removes space `id`'s index directory, trying [`REMOVE_TRIES`] times
    /// [`REMOVE_RETRY`] apart while it can't be removed yet (an old worker
    /// may still be committing); a failure after that only warns. An id
    /// without a directory, or one that isn't a safe path component, removes
    /// nothing.
    pub(crate) fn remove_space_now(&self, id: &str) {
        let Some(dir) = index_dir(&self.0, id) else {
            return;
        };
        if !dir.exists() {
            return;
        }
        let mut last = None;
        for _ in 0..REMOVE_TRIES {
            match remove_index_dir(&self.0, &dir) {
                Ok(_) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(error) => last = Some(error),
            }
            std::thread::sleep(REMOVE_RETRY);
        }
        if let Some(error) = last {
            tracing::warn!(
                "Couldn't remove the search index of a deleted space ({}): {error}",
                dir.display()
            );
        }
    }

    /// Deletes what no space uses: the directory of every id `live` rejects
    /// that looks like an index directory (see [`looks_like_index`]), and
    /// every schema directory (`fulltext-v*`, `semantic-v*`) other than the
    /// current ones inside the directories it keeps. Only real directories
    /// with a name [`index_dir`] could have made are touched (no symlinks, no
    /// odd names), through [`remove_index_dir`]. Each removal is logged;
    /// anything else is left alone, and failures only warn.
    pub(crate) fn sweep(&self, live: &dyn Fn(&str) -> bool) {
        let indexes = &self.0;
        let remove = |dir: &Path, what: &str| match remove_index_dir(indexes, dir) {
            Ok(true) => tracing::info!("search: removed {what} {}", dir.display()),
            Ok(false) => {}
            Err(error) => {
                tracing::warn!("search: couldn't remove {what} {}: {error}", dir.display())
            }
        };
        for (id, dir) in plain_subdirs(indexes) {
            if !safe_index_id(&id) {
                continue;
            }
            if !live(&id) {
                if looks_like_index(&dir) {
                    remove(&dir, "the search index of a space that no longer exists,");
                } else {
                    tracing::info!(
                        "search: leaving {}, which matches no space but doesn't look like a search index",
                        dir.display()
                    );
                }
                continue;
            }
            for (schema, stale) in plain_subdirs(&dir) {
                if is_schema_dir(&schema) && !CURRENT_SCHEMA_DIRS.contains(&schema.as_str()) {
                    remove(&stale, "an old search index format,");
                }
            }
        }
    }
}

/// `<indexes>/<id>` for a space id that is one safe path component: 1 to 128
/// ASCII letters, digits, `-`, `_` or `.`, not starting with `.` (so no `..`,
/// no separators, no drive prefix like `C:`). Any other id gets no directory
/// (the caller keeps that space's index in RAM), with a warning.
fn index_dir(indexes: &Path, id: &str) -> Option<PathBuf> {
    if !safe_index_id(id) {
        tracing::warn!(
            "search: space id {id:?} can't name an index directory; keeping it in memory"
        );
        return None;
    }
    Some(indexes.join(id))
}

fn safe_index_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && !id.starts_with('.')
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Whether `dir` holds what the index stores create in a space's directory
/// and nothing else: one or more real `fulltext-v*` or `semantic-v*`
/// directories, no other entry (no file, symlink or other directory, hidden
/// ones included). The stores write nothing else at that level, so anything
/// more means someone else's data shares the directory.
fn looks_like_index(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut schemas = 0;
    for entry in entries {
        let Ok(entry) = entry else {
            return false;
        };
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        let name = entry.file_name();
        if !is_dir || !name.to_str().is_some_and(is_schema_dir) {
            return false;
        }
        schemas += 1;
    }
    schemas > 0
}

/// Deletes model directories (`<id>@<revision>`) under `models` whose
/// catalog entry now pins another revision ([`catalog::superseded`]). Other
/// catalog models at their pin stay (the dashboard lists them and removes
/// one not in use). Names the catalog doesn't know stay too, and aren't
/// listed or removable from the dashboard: only a release that drops a
/// model leaves one, and its directory is removed by hand. Failures only
/// warn.
pub(super) fn sweep_models(models: &Path) {
    for (name, dir) in plain_subdirs(models) {
        if !catalog::superseded(&name) {
            continue;
        }
        match remove_index_dir(models, &dir) {
            Ok(true) => tracing::info!("search: removed a superseded model, {}", dir.display()),
            Ok(false) => {}
            Err(error) => tracing::warn!(
                "search: couldn't remove the superseded model {}: {error}",
                dir.display()
            ),
        }
    }
}

/// The real (not symlinked) subdirectories of `dir` with UTF-8 names.
fn plain_subdirs(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| Some((entry.file_name().into_string().ok()?, entry.path())))
        .collect()
}

/// Deletes `dir`, only when its canonical path is strictly inside the
/// canonical `indexes` (the indexes or the models directory). `Ok(false)` when
/// there was nothing to delete or it refused.
pub(super) fn remove_index_dir(indexes: &Path, dir: &Path) -> std::io::Result<bool> {
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

/// The spaces whose index directory is being removed, each with the number
/// of fences held on it. While one is held, opening that space waits
/// ([`Removals::wait`]): a new sink or index writer must not start in a
/// directory that is going away.
#[derive(Clone, Default)]
pub(crate) struct Removals(Arc<(Mutex<HashMap<String, usize>>, Condvar)>);

impl Removals {
    pub(crate) fn start(&self, id: &str) -> RemovalGuard {
        let (held, _) = &*self.0;
        *held.lock().unwrap().entry(id.to_string()).or_default() += 1;
        RemovalGuard {
            removals: self.clone(),
            id: id.to_string(),
        }
    }

    pub(crate) fn contains(&self, id: &str) -> bool {
        self.0 .0.lock().unwrap().contains_key(id)
    }

    /// Returns once no fence is held on `id`.
    pub(crate) fn wait(&self, id: &str) {
        let (held, lifted) = &*self.0;
        let mut held = held.lock().unwrap();
        while held.contains_key(id) {
            held = lifted.wait(held).unwrap();
        }
    }
}

/// A fence on one space's index directory ([`super::SpaceSearch::fence_removal`]);
/// dropping it lifts the fence.
pub struct RemovalGuard {
    removals: Removals,
    id: String,
}

impl Drop for RemovalGuard {
    fn drop(&mut self) {
        let (held, lifted) = &*self.removals.0;
        let mut held = held.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = held.get_mut(&self.id) {
            *count -= 1;
            if *count == 0 {
                held.remove(&self.id);
            }
        }
        lifted.notify_all();
    }
}

#[cfg(test)]
mod tests;
