//! Admission for search requests: superseding and process slots, decided in
//! one `Gate::admit` call.

pub(crate) mod pool;
pub(crate) mod supersede;

use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::{Admission, RequestCx, SearchError};
use pool::ProcessPool;
use supersede::Supersede;

/// Past this many tracked keys, idle ones are dropped.
const MAX_TRACKED: usize = 4096;

/// One per server, shared by every space, so the process limit is server-wide.
pub struct Gate {
    supersede: Supersede,
    pool: Arc<ProcessPool>,
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
            pool: Arc::new(ProcessPool::new()),
        }
    }

    /// Supersedes the tab's previous query when asked to, and hands out the
    /// right to wait for a process slot.
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
            self.pool.clone(),
            registration,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ripgrep::limits;
    use crate::{Admission, SearchError};
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
    async fn process_slots_queue_briefly_then_report_busy() {
        let gate = Gate::new();
        let holders: Vec<_> = (0..limits::MAX_PROCESSES)
            .map(|i| gate.admit(reader(&format!("holder-{i}"))).unwrap())
            .collect();
        let mut held = Vec::new();
        for holder in &holders {
            held.push(holder.process_slot().await.unwrap());
        }
        let waiter = gate.admit(reader("b")).unwrap();
        let waiting = waiter.process_slot();
        tokio::pin!(waiting);
        tokio::time::advance(limits::QUEUE_WAIT + Duration::from_millis(1)).await;
        assert!(matches!(waiting.await, Err(SearchError::Busy)));
        held.pop();
        assert!(waiter.process_slot().await.is_ok());
    }

    #[tokio::test]
    async fn a_superseded_request_stops_waiting_for_a_slot() {
        let gate = Gate::new();
        let holders: Vec<_> = (0..limits::MAX_PROCESSES)
            .map(|i| gate.admit(reader(&format!("holder-{i}"))).unwrap())
            .collect();
        let mut held = Vec::new();
        for holder in &holders {
            held.push(holder.process_slot().await.unwrap());
        }
        let older = gate.admit(query("alice", "tab-1")).unwrap();
        let wait = older.process_slot();
        tokio::pin!(wait);
        gate.admit(query("alice", "tab-1")).unwrap();
        assert!(matches!(wait.await, Err(SearchError::Cancelled)));
    }
}
