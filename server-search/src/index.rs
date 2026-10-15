//! What every index backend shares: where an index lives, the stamps it
//! compares, the changes it applies, the feed that announces them, and the
//! one rule for what text an index may hold and a query may show.

use std::collections::HashMap;
use std::path::PathBuf;

use tokio::sync::{mpsc, Semaphore};

use crate::backend::SpaceView;
use crate::limits::MAX_FILE_BYTES;
use crate::report::IndexKind;

/// Where a space's indexes live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Location {
    /// The space's search directory (`.../<space-id>`); each index adds its
    /// own schema directory (`fulltext-v3`, `semantic-v1`).
    Disk(PathBuf),
    Memory,
}

/// What an index backend compares to decide whether a file changed since it
/// was indexed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    /// Last-modified time in milliseconds since the epoch, as storage reports it.
    pub modified: i64,
    pub size: u64,
}

/// How an index was found when it was opened, for the startup and ready lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opened {
    /// A valid index on disk from an earlier run.
    Reused,
    /// An index on disk saved during a first build that didn't finish: its
    /// pages are kept, and the worker finishes the build as a first build.
    Resumed,
    /// An index on disk created empty (none yet, or the old one was unusable).
    Fresh,
    /// An index in RAM (asked for, or the disk fallback).
    Memory,
}

/// One change a sink applies: an upsert replaces whatever the index holds
/// for `path`.
#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    Upsert {
        path: String,
        text: String,
        stamp: FileStamp,
    },
    Delete {
        path: String,
    },
}

/// What the change feed reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedEvent {
    /// This path (space-relative, as storage names it) may have changed.
    Changed(String),
    /// Changes may have been missed (a lagged watcher, a resync): compare
    /// everything.
    Rescan,
}

pub type ChangeFeed = mpsc::UnboundedReceiver<FeedEvent>;

#[derive(Debug, thiserror::Error)]
pub enum SinkError {
    /// Another writer (usually another instance of the same space) holds the
    /// index lock.
    #[error("the index is locked by another writer")]
    LockBusy,
    /// Details for the server log only; they can name files.
    #[error("index write failed: {0}")]
    Failed(String),
}

/// What a sink's index is while a reconcile changes more than
/// `batch_pages` pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhileReconciling {
    /// An index built once ([`IndexSink::built_once`]) stays usable: the
    /// state stays as it is, the progress is reported as `catch_up`, and
    /// only a first build waits for a build slot.
    StayReady,
    /// Every such reconcile reports `Building` and waits for a build slot.
    ReportBuilding,
}

/// How a sink wants its changes: at most `batch_pages` pages and about
/// `batch_bytes` of text per [`IndexSink::apply`], and one of `builds` held
/// while a reconcile changes more than `batch_pages` pages (with
/// [`WhileReconciling::StayReady`], only while a build does).
#[derive(Clone, Copy)]
pub struct SinkLimits {
    pub batch_pages: usize,
    pub batch_bytes: u64,
    pub builds: &'static Semaphore,
    pub while_reconciling: WhileReconciling,
}

/// What a [`crate::sync::SyncWorker`] keeps in step with storage. Every
/// method may block; the worker calls them in `spawn_blocking`.
pub trait IndexSink: Send + Sync + 'static {
    fn kind(&self) -> IndexKind;
    /// The index held the whole space once: reused from disk, or a first
    /// build finished (by any worker of this sink).
    fn built_once(&self) -> bool;
    /// Path → stamp of every page in the index.
    fn stamps(&self) -> HashMap<String, FileStamp>;
    /// Applies `changes` at once; they are searchable on return.
    fn apply(&self, changes: &[Change]) -> Result<(), SinkError>;
    /// [`IndexSink::apply`], calling `progress(n)` from time to time while
    /// it runs: `n` of the changes' pages are done (not searchable before it
    /// returns). Default: no progress until `apply` returns.
    fn apply_with_progress(
        &self,
        changes: &[Change],
        progress: &dyn Fn(usize),
    ) -> Result<(), SinkError> {
        let _ = progress;
        self.apply(changes)
    }
    /// Pages in the index, and its size in bytes (on disk, or in memory).
    fn measure(&self) -> (u64, u64);
    fn is_memory(&self) -> bool;
    /// Called once each time the worker runs out of work after applying
    /// changes. Default: nothing.
    fn settle(&self) {}
    /// Called once, when the worker's first reconcile finished: the index
    /// holds the whole space. Default: nothing.
    fn built(&self) {}
    /// Called by a rebuild before its reconcile: drops what the rebuild must
    /// recompute. Default: nothing, so queries keep answering from the old
    /// entries until each page is re-applied (the full-text index).
    fn reset(&self) -> Result<(), SinkError> {
        Ok(())
    }
    fn limits(&self) -> SinkLimits;
}

/// Why a path has no text the index may hold or a query may show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unindexable {
    /// Hidden, gone, or not a page.
    Absent,
    /// Over `MAX_FILE_BYTES` or not UTF-8.
    Skipped,
}

/// Only Markdown pages are indexed.
pub(crate) fn is_page(path: &str) -> bool {
    path.ends_with(".md")
}

/// The text of page `path` as storage serves it now, by the one rule for
/// what an index may hold and a query may show: a page ([`is_page`]) that
/// storage reads, at most [`MAX_FILE_BYTES`] by its `listed_size` (when
/// storage listed one; then it isn't read when too large) and by what was
/// read, and valid UTF-8.
pub(crate) fn page_text(
    view: &dyn SpaceView,
    path: &str,
    listed_size: Option<u64>,
) -> Result<String, Unindexable> {
    if !is_page(path) {
        return Err(Unindexable::Absent);
    }
    if listed_size.is_some_and(|size| size > MAX_FILE_BYTES) {
        return Err(Unindexable::Skipped);
    }
    let data = view.read(path).ok_or(Unindexable::Absent)?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(Unindexable::Skipped);
    }
    String::from_utf8(data).map_err(|_| Unindexable::Skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestView;

    // Moved verbatim from fulltext/schema.rs.
    #[test]
    fn page_text_is_the_one_rule_for_what_the_index_holds() {
        let view = TestView::default();
        view.write("Fern.md", "fern");
        view.write("Fern.txt", "fern");
        view.write_bytes("Bad.md", vec![0xff, 0xfe]);
        view.write_bytes("Huge.md", vec![b'a'; MAX_FILE_BYTES as usize + 1]);
        view.write("Hidden.md", "secret");
        view.hide("Hidden.md");
        assert_eq!(page_text(&view, "Fern.md", None), Ok("fern".to_string()));
        assert_eq!(page_text(&view, "Fern.txt", None), Err(Unindexable::Absent));
        assert_eq!(page_text(&view, "Gone.md", None), Err(Unindexable::Absent));
        assert_eq!(
            page_text(&view, "Hidden.md", None),
            Err(Unindexable::Absent)
        );
        assert_eq!(page_text(&view, "Bad.md", None), Err(Unindexable::Skipped));
        assert_eq!(page_text(&view, "Huge.md", None), Err(Unindexable::Skipped));
        // Too large by its listed size: refused without reading it.
        let listed = Some(MAX_FILE_BYTES + 1);
        assert_eq!(
            page_text(&view, "Fern.md", listed),
            Err(Unindexable::Skipped)
        );
        assert_eq!(view.reads("Fern.md"), 1);
        assert_eq!(view.reads("Fern.txt"), 0, "not a page: never read");
    }
}
