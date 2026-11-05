//! Tracks writes made through the server until the space's watcher has sent
//! their events on, so a catch-up (`X-Await-Index`) can wait for an index
//! fed by the watcher to have received them. Exists only while a watcher
//! runs; [`crate::FsGuard`] reports each recorded write to it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use crate::watcher::{WatchMode, PIPELINE_WINDOW};

/// How long a write stays awaited by [`ForwardTracker::caught_up`] when the
/// watcher never reports its path (a casing the watcher spells differently,
/// an OS event lost to an overflow): far above the watcher's own latency.
const UNFORWARDED_TTL: Duration = Duration::from_secs(2);
/// Above this many tracked paths, `track` sweeps out expired ones, for when
/// no catch-up runs to do it.
const UNFORWARDED_SWEEP_THRESHOLD: usize = 10_000;
/// The hop after the watcher: the task that forwards its events to each
/// index's feed was woken when an event was sent, before the watcher noted
/// the write forwarded, and normally runs within microseconds.
const FEED_HOP: Duration = Duration::from_millis(10);

/// Recorded writes whose paths the watcher hasn't reported since: each path
/// with the sequence number of its first such write and the time of its
/// latest.
#[derive(Default)]
struct Unforwarded {
    next: u64,
    paths: HashMap<String, (u64, Instant)>,
}

pub struct ForwardTracker {
    polls: AtomicBool,
    unforwarded: Mutex<Unforwarded>,
    forwarded: Notify,
}

impl ForwardTracker {
    pub(crate) fn new(mode: WatchMode) -> Self {
        Self {
            polls: AtomicBool::new(matches!(mode, WatchMode::Poll(_))),
            unforwarded: Mutex::default(),
            forwarded: Notify::new(),
        }
    }

    /// Whether the watcher polls, so [`Self::caught_up`] can never confirm
    /// that changes made on disk were seen.
    pub fn polls(&self) -> bool {
        self.polls.load(Ordering::Acquire)
    }

    pub(crate) fn native_ready(&self) {
        self.polls.store(false, Ordering::Release);
    }

    /// Tracks a recorded write until the watcher reports its path. Dot paths
    /// never reach the watcher's events, so they aren't tracked.
    pub(crate) fn track(&self, path: &str, now: Instant) {
        if path.split('/').any(|part| part.starts_with('.')) {
            return;
        }
        let mut unforwarded = self.unforwarded.lock().unwrap();
        if unforwarded.paths.len() > UNFORWARDED_SWEEP_THRESHOLD {
            unforwarded
                .paths
                .retain(|_, (_, at)| now.saturating_duration_since(*at) < UNFORWARDED_TTL);
        }
        let seq = unforwarded.next;
        unforwarded.next += 1;
        // A rewrite keeps the first write's seq: a caller waiting for that
        // one still waits until the watcher reports the path.
        unforwarded
            .paths
            .entry(path.to_string())
            .and_modify(|(_, at)| *at = now)
            .or_insert((seq, now));
    }

    /// The watcher sent its event for `path` (or dropped it as not a space
    /// file): writes recorded for it so far are forwarded.
    pub(crate) fn forwarded(&self, path: &str) {
        if self
            .unforwarded
            .lock()
            .unwrap()
            .paths
            .remove(path)
            .is_some()
        {
            self.forwarded.notify_waiters();
        }
    }

    /// Whether every change made before the call has left the watcher, so
    /// an index fed by it can then catch up with them, by `deadline`:
    /// - writes recorded through the server are awaited until the watcher
    ///   reports their paths (or for [`UNFORWARDED_TTL`]), then [`FEED_HOP`];
    /// - a native watcher reports a change made on disk within
    ///   [`PIPELINE_WINDOW`], which is waited out from the call;
    /// - a polling watcher may report one only at its next poll, so this is
    ///   `false` once the recorded writes are forwarded.
    pub async fn caught_up(&self, deadline: Instant) -> bool {
        let started = Instant::now();
        if !self.writes_forwarded(deadline).await {
            return false;
        }
        if self.polls() {
            false
        } else {
            let window = (started + PIPELINE_WINDOW)
                .max(Instant::now() + FEED_HOP)
                .min(deadline);
            tokio::time::sleep_until(window.into()).await;
            true
        }
    }

    /// Waits until the writes recorded before the call are forwarded or
    /// expired; `false` at `deadline`.
    async fn writes_forwarded(&self, deadline: Instant) -> bool {
        let upto = self.unforwarded.lock().unwrap().next;
        loop {
            let forwarded = self.forwarded.notified();
            tokio::pin!(forwarded);
            forwarded.as_mut().enable();
            let now = Instant::now();
            let expires = {
                let mut unforwarded = self.unforwarded.lock().unwrap();
                unforwarded
                    .paths
                    .retain(|_, (_, at)| now.duration_since(*at) < UNFORWARDED_TTL);
                unforwarded
                    .paths
                    .values()
                    .filter(|(seq, _)| *seq < upto)
                    .map(|(_, at)| *at + UNFORWARDED_TTL)
                    .min()
            };
            let Some(expires) = expires else {
                return true;
            };
            if now >= deadline {
                return false;
            }
            tokio::select! {
                _ = forwarded => {}
                _ = tokio::time::sleep_until(expires.min(deadline).into()) => {}
            }
        }
    }
}

/// Whether the space's watcher, if it has one, forwarded every change made
/// before the call by `deadline` ([`ForwardTracker::caught_up`]). Without a
/// watcher there is nothing to wait for: the index is fed by the space's own
/// writes (see `search::WriteEvents`).
pub async fn caught_up(tracker: Option<&ForwardTracker>, deadline: Instant) -> bool {
    match tracker {
        Some(tracker) => tracker.caught_up(deadline).await,
        None => true,
    }
}

/// Whether the space has a watcher and it polls.
pub fn polls(tracker: Option<&ForwardTracker>) -> bool {
    tracker.is_some_and(ForwardTracker::polls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_unforwarded_paths_are_swept_past_the_threshold() {
        let tracker = ForwardTracker::new(WatchMode::Auto);
        let old = Instant::now() - (UNFORWARDED_TTL + Duration::from_secs(1));
        for i in 0..=UNFORWARDED_SWEEP_THRESHOLD {
            tracker.track(&format!("p{i}.md"), old);
        }
        tracker.track("fresh.md", Instant::now());
        let unforwarded = tracker.unforwarded.lock().unwrap();
        assert_eq!(unforwarded.paths.len(), 1);
        assert!(unforwarded.paths.contains_key("fresh.md"));
    }

    #[test]
    fn polls_only_with_a_polling_watcher() {
        assert!(ForwardTracker::new(WatchMode::Poll(Duration::from_secs(1))).polls());
        assert!(!ForwardTracker::new(WatchMode::Auto).polls());
    }

    #[test]
    fn a_rewrite_keeps_the_first_writes_seq() {
        let tracker = ForwardTracker::new(WatchMode::Auto);
        let first = Instant::now() - Duration::from_millis(500);
        tracker.track("a.md", first);
        tracker.track("b.md", first);
        let later = Instant::now();
        tracker.track("a.md", later);
        let unforwarded = tracker.unforwarded.lock().unwrap();
        assert_eq!(unforwarded.paths["a.md"], (0, later));
        assert_eq!(unforwarded.paths["b.md"].0, 1);
    }

    #[test]
    fn dot_paths_are_not_tracked() {
        let tracker = ForwardTracker::new(WatchMode::Auto);
        tracker.track(".git/index", Instant::now());
        tracker.track("Garden/.hidden.md", Instant::now());
        assert!(tracker.unforwarded.lock().unwrap().paths.is_empty());
    }
}
