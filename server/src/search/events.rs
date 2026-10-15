//! The change events that keep a space's indexes current: the watcher's,
//! or, without one, the space's own writes ([`WriteEvents`]), forwarded to
//! each index as a [`ChangeFeed`].

use std::sync::Arc;

use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};
use silverbullet_server_search::{ChangeFeed, FeedEvent};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::mpsc;

use crate::watcher::{FsAction, FsEvent};

/// The storage an instance serves and the events that keep its index
/// current: with a watcher, `space` itself and the watcher's events; without
/// one (`SB_FS_WATCH=off`, an ephemeral Desktop space), `space` wrapped in
/// [`WriteEvents`], whose own successful writes and deletes are the events.
pub fn change_events(
    space: Arc<dyn SpacePrimitives>,
    watcher: Option<&broadcast::Sender<FsEvent>>,
) -> (Arc<dyn SpacePrimitives>, broadcast::Receiver<FsEvent>) {
    match watcher {
        Some(tx) => (space, tx.subscribe()),
        None => {
            let (space, tx) = WriteEvents::wrap(space);
            (Arc::new(space), tx.subscribe())
        }
    }
}

/// Storage that reports its own successful writes and deletes as change
/// events, for an instance without a file watcher (`SB_FS_WATCH=off`): edits
/// made through the server (editor, API, runtime) reach the index at once.
/// Changes made on disk behind the server's back still wait for the index's
/// periodic reconcile.
pub struct WriteEvents {
    inner: Arc<dyn SpacePrimitives>,
    events: broadcast::Sender<FsEvent>,
}

impl WriteEvents {
    /// The wrapped storage and the sender to subscribe the index to.
    pub fn wrap(inner: Arc<dyn SpacePrimitives>) -> (Self, broadcast::Sender<FsEvent>) {
        let (events, _) = broadcast::channel(1024);
        (
            Self {
                inner,
                events: events.clone(),
            },
            events,
        )
    }

    fn report(&self, name: &str, action: FsAction, last_modified: i64) {
        let _ = self.events.send(FsEvent {
            name: name.to_string(),
            action,
            last_modified,
            revision: None,
            origin: None,
        });
    }
}

impl SpacePrimitives for WriteEvents {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        self.inner.fetch_file_list()
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.inner.get_file_meta(path)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.inner.read_file(path)
    }

    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.inner.read_file_range(path, start, length)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let written = self.inner.write_file(path, data, meta)?;
        self.report(path, FsAction::Change, written.last_modified);
        Ok(written)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        self.inner.delete_file(path)?;
        self.report(path, FsAction::Delete, 0);
        Ok(())
    }
}

/// Forwards the watcher's events to the index: each event's path, and a
/// rescan for the watcher's `Resync` and when the receiver lagged and
/// events were lost. Ends when the watcher's sender closes or the index
/// stops listening.
pub(super) fn change_feed(mut events: broadcast::Receiver<FsEvent>) -> ChangeFeed {
    let (tx, feed) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let msg = tokio::select! {
                _ = tx.closed() => return,
                event = events.recv() => match event {
                    Ok(event) if event.action == FsAction::Resync => FeedEvent::Rescan,
                    Ok(event) => FeedEvent::Changed(event.name),
                    Err(RecvError::Lagged(_)) => FeedEvent::Rescan,
                    Err(RecvError::Closed) => return,
                },
            };
            if tx.send(msg).is_err() {
                return;
            }
        }
    });
    feed
}

#[cfg(test)]
mod tests;
