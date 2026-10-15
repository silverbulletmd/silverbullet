//! The in-memory space every full-text test indexes and queries.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use crate::{FileStamp, SpaceView};

/// Runs before the n-th read (counting every path, from 1).
pub(crate) type Hook = Box<dyn FnMut(&TestView, usize) + Send>;

/// A space in memory that hides like storage does: hidden paths (dot paths
/// and anything marked with `hide`, e.g. control files) are neither listed
/// nor read. Every write gets a fresh `modified`. Reads are counted per path,
/// can run a hook before the n-th read, and can be blocked: all of them while
/// `block` is in force, or those of `Pages/` from the `block_from`-th read on.
/// Listing can be made to fail.
#[derive(Default)]
pub(crate) struct TestView {
    pub(crate) files: Mutex<HashMap<String, (Vec<u8>, i64)>>,
    pub(crate) hidden: Mutex<HashSet<String>>,
    pub(crate) clock: AtomicI64,
    pub(crate) reads: Mutex<HashMap<String, usize>>,
    pub(crate) hook: Mutex<Option<Hook>>,
    /// List every size as 0, as storage does when it doesn't know it.
    pub(crate) sizes_unknown: bool,
    /// Every listing reports a fresh `modified` for every file.
    pub(crate) restamp: bool,
    /// Listing fails while set.
    pub(crate) unlistable: AtomicBool,
    pub(crate) blocked: Mutex<bool>,
    pub(crate) unblocked: Condvar,
    /// Reads of `Pages/` block from this read on (counting from 1); 0 = never.
    pub(crate) block_from: AtomicUsize,
}

impl TestView {
    pub(crate) fn with(files: &[(&str, &str)]) -> Arc<TestView> {
        let view = Arc::new(TestView::default());
        for (path, body) in files {
            view.write(path, body);
        }
        view
    }

    pub(crate) fn write(&self, path: &str, body: &str) {
        self.write_bytes(path, body.as_bytes().to_vec());
    }

    pub(crate) fn write_bytes(&self, path: &str, data: Vec<u8>) {
        let modified = self.clock.fetch_add(1, Ordering::Relaxed) + 1;
        self.files
            .lock()
            .unwrap()
            .insert(path.into(), (data, modified));
    }

    pub(crate) fn remove(&self, path: &str) {
        self.files.lock().unwrap().remove(path);
    }

    pub(crate) fn hide(&self, path: &str) {
        self.hidden.lock().unwrap().insert(path.into());
    }

    fn is_hidden(&self, path: &str) -> bool {
        path.split('/').any(|part| part.starts_with('.'))
            || self.hidden.lock().unwrap().contains(path)
    }

    pub(crate) fn reads(&self, path: &str) -> usize {
        self.reads.lock().unwrap().get(path).copied().unwrap_or(0)
    }

    pub(crate) fn total_reads(&self) -> usize {
        self.reads.lock().unwrap().values().sum()
    }

    pub(crate) fn reset_reads(&self) {
        self.reads.lock().unwrap().clear();
    }

    pub(crate) fn block(&self) {
        *self.blocked.lock().unwrap() = true;
    }

    pub(crate) fn release(&self) {
        self.block_from.store(0, Ordering::SeqCst);
        *self.blocked.lock().unwrap() = false;
        self.unblocked.notify_all();
    }

    /// Blocks reads until the guard is dropped, also when a test fails
    /// (a read left blocked would hang the runtime's shutdown).
    pub(crate) fn blocked(self: &Arc<Self>) -> Unblock {
        self.block();
        Unblock(self.clone())
    }

    /// Waits while the read `n` (of `path`) is held by `block` or `block_from`.
    fn wait_while_blocked(&self, path: &str, n: usize) {
        let from = self.block_from.load(Ordering::SeqCst);
        let held = from > 0 && n >= from && path.starts_with("Pages/");
        let mut blocked = self.blocked.lock().unwrap();
        while held && self.block_from.load(Ordering::SeqCst) > 0 {
            blocked = self.unblocked.wait(blocked).unwrap();
        }
        while *blocked {
            blocked = self.unblocked.wait(blocked).unwrap();
        }
    }
}

pub(crate) struct Unblock(pub(crate) Arc<TestView>);

impl Drop for Unblock {
    fn drop(&mut self) {
        self.0.release();
    }
}

impl SpaceView for TestView {
    fn list_meta(&self) -> Option<HashMap<String, FileStamp>> {
        if self.unlistable.load(Ordering::Relaxed) {
            return None;
        }
        let bump = self
            .restamp
            .then(|| self.clock.fetch_add(1, Ordering::Relaxed));
        let files = self.files.lock().unwrap().clone();
        let meta = files
            .into_iter()
            .filter(|(path, _)| !self.is_hidden(path))
            .map(|(path, (data, modified))| {
                let size = if self.sizes_unknown {
                    0
                } else {
                    data.len() as u64
                };
                let modified = modified + bump.unwrap_or(0) * 1_000_000;
                (path, FileStamp { modified, size })
            })
            .collect();
        Some(meta)
    }

    fn read(&self, path: &str) -> Option<Vec<u8>> {
        let n = {
            let mut reads = self.reads.lock().unwrap();
            *reads.entry(path.into()).or_default() += 1;
            reads.values().sum::<usize>()
        };
        let hook = self.hook.lock().unwrap().take();
        if let Some(mut hook) = hook {
            hook(self, n);
            *self.hook.lock().unwrap() = Some(hook);
        }
        self.wait_while_blocked(path, n);
        if self.is_hidden(path) {
            return None;
        }
        self.files
            .lock()
            .unwrap()
            .get(path)
            .map(|(data, _)| data.clone())
    }
}
