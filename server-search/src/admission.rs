//! What the HTTP layer tells the gate about a request, and the context a
//! backend gets back: its deadline, cancellation, and the right to wait for a
//! process slot.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::OwnedSemaphorePermit;
use tokio_util::sync::CancellationToken;

use crate::gate::pool::ProcessPool;
use crate::gate::supersede::Registration;
use crate::SearchError;

pub struct Admission<'a> {
    /// Space identity: its folder path.
    pub space: &'a str,
    /// The signed-in user, if any.
    pub user: Option<&'a str>,
    /// Whether the caller has write access. With `user`, it keeps a signed-out
    /// writer and an anonymous visitor on the same tab id apart.
    pub writer: bool,
    /// The tab's client id; empty when the client sent none.
    pub tab: &'a str,
    /// Only an interactive query with a tab id supersedes that tab's previous one.
    pub supersede: bool,
    pub deadline: Duration,
}

/// Per-request context: when to give up, and whether a newer request from the
/// same tab has superseded this one.
pub struct RequestCx {
    pub deadline: tokio::time::Instant,
    pub cancel: CancellationToken,
    pool: Option<Arc<ProcessPool>>,
    _registration: Option<Registration>,
}

impl RequestCx {
    pub(crate) fn admitted(
        deadline: Duration,
        cancel: CancellationToken,
        pool: Arc<ProcessPool>,
        registration: Option<Registration>,
    ) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + deadline,
            cancel,
            pool: Some(pool),
            _registration: registration,
        }
    }

    /// For tests and internal callers: no limits beyond `deadline`, never cancelled by others.
    pub fn unlimited(deadline: Duration) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + deadline,
            cancel: CancellationToken::new(),
            pool: None,
            _registration: None,
        }
    }

    /// Waits up to `limits::QUEUE_WAIT` for one of the server's rg process slots.
    pub async fn process_slot(&self) -> Result<ProcessSlot, SearchError> {
        match &self.pool {
            Some(pool) => pool.acquire(&self.cancel).await,
            None => Ok(ProcessSlot { _permit: None }),
        }
    }
}

/// Held while an rg process runs; dropping it frees the slot.
pub struct ProcessSlot {
    pub(crate) _permit: Option<OwnedSemaphorePermit>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn unlimited_requests_get_a_slot_at_once_and_are_never_cancelled() {
        let cx = RequestCx::unlimited(Duration::from_secs(3));
        let _slots: Vec<ProcessSlot> = vec![
            cx.process_slot().await.unwrap(),
            cx.process_slot().await.unwrap(),
        ];
        assert!(!cx.cancel.is_cancelled());
        assert!(cx.deadline > tokio::time::Instant::now());
    }
}
