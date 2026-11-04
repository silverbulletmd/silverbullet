//! The worker's change feed, counting how far the worker got through it.

use std::future::{poll_fn, Future};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::index::{ChangeFeed, FeedEvent};

/// The feed and how far the worker got through it, for
/// [`super::SyncWorker::caught_up`].
pub(super) struct Feed {
    /// The receiver and how many events the worker took from it, under one
    /// lock: an event is always either queued or counted.
    queue: Mutex<(ChangeFeed, u64)>,
    /// The events taken when the worker was last idle: all of them applied.
    applied: AtomicU64,
    applied_changed: Notify,
}

impl Feed {
    pub(super) fn new(feed: ChangeFeed) -> Self {
        Self {
            queue: Mutex::new((feed, 0)),
            applied: AtomicU64::new(0),
            applied_changed: Notify::new(),
        }
    }

    /// The next event, counted as taken when it leaves the queue.
    pub(super) async fn recv(&self) -> Option<FeedEvent> {
        poll_fn(|cx| {
            let mut queue = self.queue.lock().unwrap();
            let polled = queue.0.poll_recv(cx);
            if let Poll::Ready(Some(_)) = polled {
                queue.1 += 1;
            }
            polled
        })
        .await
    }

    /// Every event received so far: taken or still queued.
    pub(super) fn received(&self) -> u64 {
        let queue = self.queue.lock().unwrap();
        queue.1 + queue.0.len() as u64
    }

    pub(super) fn taken(&self) -> u64 {
        self.queue.lock().unwrap().1
    }

    pub(super) fn set_applied(&self, n: u64) {
        if self.applied.swap(n, Ordering::SeqCst) != n {
            self.applied_changed.notify_waiters();
        }
    }

    /// See [`super::SyncWorker::caught_up`].
    pub(super) fn caught_up(
        self: Arc<Self>,
        deadline: std::time::Instant,
        stopped: CancellationToken,
    ) -> impl Future<Output = bool> + 'static {
        let target = self.received();
        async move {
            let wait = async {
                loop {
                    let changed = self.applied_changed.notified();
                    tokio::pin!(changed);
                    changed.as_mut().enable();
                    if self.applied.load(Ordering::SeqCst) >= target {
                        return;
                    }
                    changed.await;
                }
            };
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            tokio::select! {
                waited = tokio::time::timeout(left, wait) => waited.is_ok(),
                _ = stopped.cancelled() => false,
            }
        }
    }
}
