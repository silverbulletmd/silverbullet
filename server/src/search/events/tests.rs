use super::*;

fn event(name: &str, action: FsAction) -> FsEvent {
    FsEvent {
        name: name.into(),
        action,
        last_modified: 1,
        revision: None,
        origin: None,
    }
}

#[tokio::test]
async fn the_feed_forwards_paths_and_turns_lag_and_resync_into_rescans() {
    let (tx, rx) = broadcast::channel(2);
    let mut feed = change_feed(rx);
    // The forwarder hasn't run yet: the third event overflows the channel.
    for name in ["Fern.md", "Moss.md", "Lichen.md"] {
        tx.send(event(name, FsAction::Change)).unwrap();
    }
    assert_eq!(feed.recv().await, Some(FeedEvent::Rescan), "lagged");
    assert_eq!(
        feed.recv().await,
        Some(FeedEvent::Changed("Moss.md".into()))
    );
    assert_eq!(
        feed.recv().await,
        Some(FeedEvent::Changed("Lichen.md".into()))
    );
    tx.send(event("Moss.md", FsAction::Delete)).unwrap();
    assert_eq!(
        feed.recv().await,
        Some(FeedEvent::Changed("Moss.md".into()))
    );
    tx.send(event("", FsAction::Resync)).unwrap();
    assert_eq!(feed.recv().await, Some(FeedEvent::Rescan), "resync");
    drop(tx);
    assert_eq!(feed.recv().await, None, "ends with the watcher");
}

#[tokio::test]
async fn write_events_report_only_successful_writes_and_deletes() {
    use silverbullet_server_common::space::{MemorySpacePrimitives, ReadOnlySpacePrimitives};
    let (space, tx) = WriteEvents::wrap(Arc::new(MemorySpacePrimitives::new()));
    let mut events = tx.subscribe();
    space.write_file("Fern.md", b"fern", None).unwrap();
    space.delete_file("Fern.md").unwrap();
    assert!(space.delete_file("Fern.md").is_err());
    let seen: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
        .map(|e| (e.name, e.action))
        .collect();
    assert_eq!(
        seen,
        [
            ("Fern.md".to_string(), FsAction::Change),
            ("Fern.md".to_string(), FsAction::Delete)
        ]
    );
    let read_only = Arc::new(ReadOnlySpacePrimitives::new(Box::new(
        MemorySpacePrimitives::new(),
    )));
    let (space, tx) = WriteEvents::wrap(read_only);
    let mut events = tx.subscribe();
    assert!(space.write_file("Fern.md", b"fern", None).is_err());
    assert!(
        events.try_recv().is_err(),
        "a refused write reports nothing"
    );
}

#[tokio::test]
async fn change_events_come_from_the_watcher_or_from_the_spaces_own_writes() {
    use silverbullet_server_common::space::MemorySpacePrimitives;
    let (watcher, _) = broadcast::channel(4);
    let space: Arc<dyn SpacePrimitives> = Arc::new(MemorySpacePrimitives::new());
    let (served, mut rx) = change_events(space, Some(&watcher));
    served.write_file("Notes/Plan.md", b"# Plan", None).unwrap();
    assert!(
        rx.try_recv().is_err(),
        "with a watcher, changes come from the watcher only"
    );
    watcher
        .send(event("Notes/Plan.md", FsAction::Change))
        .unwrap();
    assert_eq!(rx.try_recv().unwrap().name, "Notes/Plan.md");

    let (served, mut rx) = change_events(Arc::new(MemorySpacePrimitives::new()), None);
    served.write_file("Notes/Plan.md", b"# Plan", None).unwrap();
    served.delete_file("Notes/Plan.md").unwrap();
    let change = rx.try_recv().unwrap();
    assert_eq!(
        (change.name.as_str(), change.action),
        ("Notes/Plan.md", FsAction::Change)
    );
    assert_eq!(rx.try_recv().unwrap().action, FsAction::Delete);
}

#[tokio::test]
async fn the_forwarder_stops_when_the_index_does() {
    let (tx, rx) = broadcast::channel::<FsEvent>(4);
    drop(change_feed(rx));
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while tx.receiver_count() > 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the forwarder let go of the watcher");
    let (gone, rx) = broadcast::channel::<FsEvent>(1);
    drop(gone);
    let mut closed = change_feed(rx);
    assert_eq!(
        closed.recv().await,
        None,
        "a sender that is gone ends the feed"
    );
}
