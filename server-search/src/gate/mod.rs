//! Admission for search requests: superseding and query slots,
//! decided in one `Gate::admit` call.

pub(crate) mod pool;
pub(crate) mod supersede;

use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::admission::Pools;
use crate::{limits, Admission, RequestCx, SearchError};
use pool::Pool;
use supersede::Supersede;

/// Past this many tracked keys, idle ones are dropped.
const MAX_TRACKED: usize = 4096;

/// One per server, shared by every space, so the query limit is server-wide.
pub struct Gate {
    supersede: Supersede,
    queries: Arc<Pool>,
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

impl Gate {
    pub fn new() -> Gate {
        Gate {
            supersede: Supersede::new(),
            queries: Arc::new(Pool::new(limits::MAX_QUERIES, limits::QUERY_QUEUE_WAIT)),
        }
    }

    /// Supersedes the tab's previous query when asked to, and hands out the
    /// right to wait for a query slot. Infallible today; stays a `Result` so
    /// M2's bounded semantic query queue can reject with `Busy` here.
    pub fn admit(&self, a: Admission) -> Result<RequestCx, SearchError> {
        let (cancel, registration) = if a.supersede {
            let (cancel, registration) = self.supersede.register(a.space, a.user, a.writer, a.tab);
            (cancel, Some(registration))
        } else {
            (CancellationToken::new(), None)
        };
        Ok(RequestCx::admitted(
            a.deadline,
            cancel,
            Pools {
                queries: self.queries.clone(),
            },
            registration,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{limits, Admission, SearchError};
    use std::time::Duration;

    const SPACE: &str = "/spaces/a";

    fn admission<'a>(
        user: Option<&'a str>,
        writer: bool,
        tab: &'a str,
        supersede: bool,
    ) -> Admission<'a> {
        Admission {
            space: SPACE,
            user,
            writer,
            tab,
            supersede,
            deadline: limits::DEADLINE,
        }
    }

    fn reader(user: &str) -> Admission<'_> {
        admission(Some(user), false, "", false)
    }

    fn query<'a>(user: &'a str, tab: &'a str) -> Admission<'a> {
        admission(Some(user), true, tab, true)
    }

    #[tokio::test]
    async fn a_newer_query_cancels_only_the_same_tabs_older_one() {
        let gate = Gate::new();
        let first = gate.admit(query("alice", "tab-1")).unwrap();
        let other_user = gate.admit(query("bob", "tab-1")).unwrap();
        let other_tab = gate.admit(query("alice", "tab-2")).unwrap();
        let other_space = gate
            .admit(Admission {
                space: "/spaces/b",
                ..query("alice", "tab-1")
            })
            .unwrap();
        assert!(!first.cancel.is_cancelled());
        let second = gate.admit(query("alice", "tab-1")).unwrap();
        assert!(first.cancel.is_cancelled());
        assert!(!second.cancel.is_cancelled());
        for untouched in [&other_user, &other_tab, &other_space] {
            assert!(!untouched.cancel.is_cancelled());
        }
        tokio::time::timeout(Duration::from_millis(100), first.cancel.cancelled())
            .await
            .expect("cancelled() resolves once superseded");
    }

    #[tokio::test]
    async fn admissions_without_supersede_never_cancel_or_get_cancelled() {
        let gate = Gate::new();
        let alice = |supersede| admission(Some("alice"), true, "tab-1", supersede);
        let first = gate.admit(alice(true)).unwrap();
        let raw = gate.admit(alice(false)).unwrap();
        let _ = gate.admit(alice(false)).unwrap();
        assert!(!first.cancel.is_cancelled());
        let _ = gate.admit(alice(true)).unwrap();
        assert!(first.cancel.is_cancelled());
        assert!(!raw.cancel.is_cancelled());
    }

    #[tokio::test]
    async fn signed_out_writers_and_anonymous_visitors_never_supersede_each_other() {
        let gate = Gate::new();
        let writer = gate.admit(admission(None, true, "tab-1", true)).unwrap();
        let visitor = gate.admit(admission(None, false, "tab-1", true)).unwrap();
        let _writer_again = gate.admit(admission(None, true, "tab-1", true)).unwrap();
        assert!(writer.cancel.is_cancelled());
        assert!(!visitor.cancel.is_cancelled());
        let reader = gate
            .admit(admission(Some("alice"), false, "tab-1", true))
            .unwrap();
        let _alice_writes = gate
            .admit(admission(Some("alice"), true, "tab-1", true))
            .unwrap();
        assert!(!reader.cancel.is_cancelled());
    }

    #[tokio::test(start_paused = true)]
    async fn query_slots_queue_briefly_then_report_busy() {
        let gate = Gate::new();
        let mut held = Vec::new();
        for i in 0..limits::MAX_QUERIES {
            let cx = gate.admit(reader(&format!("query-{i}"))).unwrap();
            held.push(cx.query_slot().await.unwrap());
        }
        let waiter = gate.admit(reader("b")).unwrap();
        let started = tokio::time::Instant::now();
        let waiting = waiter.query_slot();
        tokio::pin!(waiting);
        assert!(still_pending(&mut waiting).await);
        tokio::time::advance(limits::QUERY_QUEUE_WAIT - Duration::from_millis(1)).await;
        assert!(
            still_pending(&mut waiting).await,
            "waits the full queue wait"
        );
        tokio::time::advance(Duration::from_millis(2)).await;
        assert!(matches!(waiting.await, Err(SearchError::Busy)));
        assert!(started.elapsed() >= limits::QUERY_QUEUE_WAIT);
        held.pop();
        assert!(waiter.query_slot().await.is_ok());
    }

    /// Polls `fut` once without letting paused time advance; true when it is still pending.
    async fn still_pending<F: std::future::Future + Unpin>(fut: &mut F) -> bool {
        std::future::poll_fn(|cx| {
            std::task::Poll::Ready(std::pin::Pin::new(&mut *fut).poll(cx).is_pending())
        })
        .await
    }

    #[tokio::test]
    async fn a_superseded_request_stops_waiting_for_a_query_slot() {
        let gate = Gate::new();
        let mut held = Vec::new();
        for i in 0..limits::MAX_QUERIES {
            let cx = gate.admit(reader(&format!("query-{i}"))).unwrap();
            held.push(cx.query_slot().await.unwrap());
        }
        let older = gate.admit(query("alice", "tab-1")).unwrap();
        let wait = older.query_slot();
        tokio::pin!(wait);
        gate.admit(query("alice", "tab-1")).unwrap();
        assert!(matches!(wait.await, Err(SearchError::Cancelled)));
    }
}
