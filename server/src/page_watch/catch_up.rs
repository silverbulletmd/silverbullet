//! Whether a space's files changed since its runtime last caught up with
//! them, so `X-Await-Index` asks the runtime only when something changed.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::task::JoinHandle;

use crate::search::PageSource;

pub struct ChangeCounter {
    /// Events seen; starts at 1 because changes before the first use are unknown.
    seen: Arc<AtomicU64>,
    /// `seen` as of the last successful catch-up.
    settled: AtomicU64,
    follower: JoinHandle<()>,
}

impl Drop for ChangeCounter {
    fn drop(&mut self) {
        self.follower.abort();
    }
}

impl ChangeCounter {
    /// Counts `source`'s changes from now on, dirty until the first
    /// [`Self::settle`]. Must run inside tokio.
    pub fn start(source: &PageSource) -> Self {
        let seen = Arc::new(AtomicU64::new(1));
        let mut feed = source.feed();
        let counter = seen.clone();
        let follower = tokio::spawn(async move {
            while feed.recv().await.is_some() {
                counter.fetch_add(1, Ordering::SeqCst);
            }
        });
        Self {
            seen,
            settled: AtomicU64::new(0),
            follower,
        }
    }

    /// The change count to pass to [`Self::settle`] once caught up, when
    /// anything changed since the last catch-up.
    pub fn dirty(&self) -> Option<u64> {
        let seen = self.seen.load(Ordering::SeqCst);
        (seen > self.settled.load(Ordering::SeqCst)).then_some(seen)
    }

    /// The change count so far.
    pub fn seen(&self) -> u64 {
        self.seen.load(Ordering::SeqCst)
    }

    /// Records a catch-up that started at change count `seen`; later changes
    /// keep the counter dirty.
    pub fn settle(&self, seen: u64) {
        self.settled.fetch_max(seen, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use silverbullet_server_common::space::{GitignoreMatcher, MemorySpacePrimitives};
    use tokio::sync::broadcast;

    use super::*;
    use crate::search::SpaceSearchView;
    use crate::watcher::{FsAction, FsEvent};

    fn source() -> (PageSource, broadcast::Sender<FsEvent>) {
        let events = broadcast::channel(16).0;
        let view = SpaceSearchView::new(
            Arc::new(MemorySpacePrimitives::new()),
            GitignoreMatcher::default(),
        );
        (PageSource::new(Arc::new(view), events.clone()), events)
    }

    fn change(name: &str) -> FsEvent {
        FsEvent {
            name: name.into(),
            action: FsAction::Change,
            last_modified: 1,
            revision: None,
            origin: None,
        }
    }

    async fn until(mut done: impl FnMut() -> bool) {
        for _ in 0..200 {
            if done() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("condition not reached");
    }

    #[tokio::test]
    async fn starts_dirty() {
        let (source, _events) = source();
        let counter = ChangeCounter::start(&source);
        assert_eq!(counter.dirty(), Some(1));
    }

    #[tokio::test]
    async fn settle_clears_until_next_change() {
        let (source, events) = source();
        let counter = ChangeCounter::start(&source);
        let seen = counter.dirty().unwrap();
        counter.settle(seen);
        assert_eq!(counter.dirty(), None);

        events.send(change("Page.md")).unwrap();
        until(|| counter.seen() > seen).await;
        assert_eq!(counter.dirty(), Some(counter.seen()));
    }

    #[tokio::test]
    async fn new_page_source_starts_over() {
        let (first, _events) = source();
        let old = ChangeCounter::start(&first);
        old.settle(old.dirty().unwrap());
        assert_eq!(old.dirty(), None);

        let (second, _events) = source();
        let fresh = ChangeCounter::start(&second);
        assert_eq!(fresh.dirty(), Some(1));
    }
}
