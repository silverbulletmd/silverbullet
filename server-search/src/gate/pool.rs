//! Process slots: a server-wide limit on concurrent rg processes.

use std::sync::Arc;

use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use crate::ripgrep::limits;
use crate::{ProcessSlot, SearchError};

pub(crate) struct ProcessPool {
    processes: Arc<Semaphore>,
}

impl ProcessPool {
    pub(crate) fn new() -> Self {
        Self {
            processes: Arc::new(Semaphore::new(limits::MAX_PROCESSES)),
        }
    }

    /// Waits up to `limits::QUEUE_WAIT` for a slot.
    pub(crate) async fn acquire(
        &self,
        cancel: &CancellationToken,
    ) -> Result<ProcessSlot, SearchError> {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(SearchError::Cancelled),
            permit = tokio::time::timeout(limits::QUEUE_WAIT, self.processes.clone().acquire_owned()) => match permit {
                Ok(Ok(permit)) => Ok(ProcessSlot { _permit: Some(permit) }),
                _ => Err(SearchError::Busy),
            },
        }
    }
}
