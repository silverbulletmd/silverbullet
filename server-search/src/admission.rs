//! What the HTTP layer tells the gate about a request, and the context a
//! backend gets back: its deadline, cancellation, and the right to wait for a
//! query slot.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::OwnedSemaphorePermit;
use tokio_util::sync::CancellationToken;

use crate::gate::pool::Pool;
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

/// The server-wide pools an admitted request draws from.
#[derive(Clone)]
pub(crate) struct Pools {
    pub(crate) queries: Arc<Pool>,
}

/// Per-request context: when to give up, and whether a newer request from the
/// same tab has superseded this one.
pub struct RequestCx {
    pub deadline: tokio::time::Instant,
    pub cancel: CancellationToken,
    pools: Option<Pools>,
    _registration: Option<Registration>,
}

impl RequestCx {
    pub(crate) fn admitted(
        deadline: Duration,
        cancel: CancellationToken,
        pools: Pools,
        registration: Option<Registration>,
    ) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + deadline,
            cancel,
            pools: Some(pools),
            _registration: registration,
        }
    }

    /// For tests and internal callers: no limits beyond `deadline`, never cancelled by others.
    pub fn unlimited(deadline: Duration) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + deadline,
            cancel: CancellationToken::new(),
            pools: None,
            _registration: None,
        }
    }

    /// Waits up to `limits::QUERY_QUEUE_WAIT` for one of the server's index
    /// query slots.
    pub async fn query_slot(&self) -> Result<QuerySlot, SearchError> {
        let permit = match &self.pools {
            Some(pools) => Some(pools.queries.acquire(&self.cancel).await?),
            None => None,
        };
        Ok(QuerySlot { _permit: permit })
    }
}

/// Held while an index backend runs a query; dropping it frees the slot.
pub struct QuerySlot {
    _permit: Option<OwnedSemaphorePermit>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn unlimited_requests_get_a_slot_at_once_and_are_never_cancelled() {
        let cx = RequestCx::unlimited(Duration::from_secs(3));
        let mut queries: Vec<QuerySlot> = Vec::new();
        for _ in 0..=crate::limits::MAX_QUERIES {
            queries.push(cx.query_slot().await.unwrap());
        }
        assert!(!cx.cancel.is_cancelled());
        assert!(cx.deadline > tokio::time::Instant::now());
    }
}
