//! Server-wide slot pool bounding concurrent index queries: a semaphore plus
//! how long a request may wait for a permit before it is `Busy`.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::SearchError;

pub(crate) struct Pool {
    sem: Arc<Semaphore>,
    wait: Duration,
}

impl Pool {
    pub(crate) fn new(slots: usize, wait: Duration) -> Self {
        Self {
            sem: Arc::new(Semaphore::new(slots)),
            wait,
        }
    }

    /// Waits up to the pool's `wait` for a permit; stops early when `cancel` fires.
    pub(crate) async fn acquire(
        &self,
        cancel: &CancellationToken,
    ) -> Result<OwnedSemaphorePermit, SearchError> {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(SearchError::Cancelled),
            permit = tokio::time::timeout(self.wait, self.sem.clone().acquire_owned()) => match permit {
                Ok(Ok(permit)) => Ok(permit),
                _ => Err(SearchError::Busy),
            },
        }
    }
}
