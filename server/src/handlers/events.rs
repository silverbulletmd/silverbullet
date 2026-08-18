//! GET /.events -- Server-Sent Events stream of file-system change events.
//! Auth note: EventSource cannot set headers, so this endpoint must be
//! reachable with cookie auth alone (it sits behind the same protected-route
//! middleware as /.fs).

use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use crate::state::ServerState;

/// Ends `stream` the moment `shutdown` fires (or never, if it's `None`) so a
/// live `/.events` connection's response body completes on shutdown instead
/// of running until the client disconnects -- otherwise axum's graceful
/// shutdown, which waits for in-flight connections to finish, hangs on it
/// forever. Hand-rolled rather than `tokio_stream::StreamExt::take_until`
/// (`futures_util`, not a dependency here) or `StreamExt::merge` (which
/// would interleave a shutdown "item" into the SSE body instead of ending
/// it); both the stream and the shutdown future are boxed+pinned, which
/// makes the wrapper itself unconditionally `Unpin` and this `impl` safe
/// without unsafe pin-projection.
struct EndOnShutdown<Item> {
    stream: Pin<Box<dyn Stream<Item = Item> + Send>>,
    shutdown: Pin<Box<dyn Future<Output = ()> + Send>>,
    shutdown_fired: bool,
}

impl<Item> Stream for EndOnShutdown<Item> {
    type Item = Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Item>> {
        let this = self.get_mut();
        if !this.shutdown_fired && this.shutdown.as_mut().poll(cx).is_ready() {
            this.shutdown_fired = true;
        }
        if this.shutdown_fired {
            return Poll::Ready(None);
        }
        this.stream.as_mut().poll_next(cx)
    }
}

async fn wait_for_shutdown(mut shutdown: Option<tokio::sync::watch::Receiver<()>>) {
    match &mut shutdown {
        Some(rx) => {
            let _ = rx.changed().await;
        }
        None => std::future::pending::<()>().await,
    }
}

pub async fn handle_events(State(state): State<Arc<ServerState>>) -> Response {
    let Some(tx) = &state.fs_events else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let stream = BroadcastStream::new(tx.subscribe()).filter_map(
        |item: Result<crate::watcher::FsEvent, BroadcastStreamRecvError>| match item {
            Ok(ev) => Some(Ok::<Event, Infallible>(
                Event::default().data(serde_json::to_string(&ev).expect("FsEvent serializes")),
            )),
            // Lagged: this consumer overflowed the broadcast buffer and lost
            // events; hand it a resync instead of losing them silently
            Err(BroadcastStreamRecvError::Lagged(_)) => Some(Ok(
                Event::default().data(r#"{"name":"","action":"resync","lastModified":0}"#)
            )),
        },
    );
    // Gecko and WebKit leave EventSource at CONNECTING until the first body
    // byte arrives, so without this comment `onopen` waits for the first real
    // event (or the 30s keep-alive) -- and until it fires the client cannot
    // tell a dropped connection from an unsupported endpoint, and skips its
    // reconnect catch-up.
    let stream =
        tokio_stream::once(Ok::<Event, Infallible>(Event::default().comment("open"))).chain(stream);
    let stream = EndOnShutdown {
        stream: Box::pin(stream),
        shutdown: Box::pin(wait_for_shutdown(state.shutdown.clone())),
        shutdown_fired: false,
    };
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(30)))
        .into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tokio::sync::broadcast;
    use tower::util::ServiceExt;

    use crate::router::build_router;
    use crate::test_support::test_state;
    use crate::watcher::{FsAction, FsEvent};

    #[tokio::test]
    async fn events_endpoint_404s_without_watcher() {
        let state = test_state(); // fs_events: None
        let app = build_router(Arc::new(state));
        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn events_endpoint_streams_events() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel(16);
        state.fs_events = Some(tx.clone());
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            tx.send(FsEvent {
                name: "test.md".to_string(),
                action: FsAction::Change,
                last_modified: 42,
            })
            .unwrap();
            drop(tx); // ends the stream so the body can be collected
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("text/event-stream"));
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains(r#""name":"test.md""#), "body was: {text}");
        assert!(text.contains(r#""action":"change""#));
        assert!(text.contains(r#""lastModified":42"#));
    }

    #[tokio::test]
    async fn lagged_subscriber_gets_resync_instead_of_silent_loss() {
        let mut state = test_state();
        // Small capacity so a burst of sends overflows it before the
        // subscriber (created inside the handler) ever polls.
        let (tx, _keep) = broadcast::channel(2);
        state.fs_events = Some(tx.clone());
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            for i in 0..5 {
                tx.send(FsEvent {
                    name: format!("f{i}.md"),
                    action: FsAction::Change,
                    last_modified: i,
                })
                .unwrap();
            }
            drop(tx);
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(
            text.contains(r#"{"name":"","action":"resync","lastModified":0}"#),
            "body was: {text}"
        );
    }

    #[tokio::test]
    async fn stream_leads_with_a_comment_so_open_fires_right_away() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(':'), "body was: {text}");
    }

    /// The browser `EventSource` API cannot set an `Authorization` header, so
    /// this endpoint must be reachable via the session cookie alone (bearer
    /// tokens are not an option here) while still rejecting anonymous access.
    #[tokio::test]
    async fn events_endpoint_requires_cookie_auth() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;

        let auth = Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into());

        let mut state = test_state();
        state.authorizer = Some(Arc::new(authz));
        let (tx, _keep) = broadcast::channel(16);
        state.fs_events = Some(tx);
        let state = Arc::new(state);

        // No credentials at all: 401.
        let resp = build_router(state.clone())
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // Session cookie alone (no Authorization header, which EventSource
        // cannot set): 200.
        let resp = build_router(state)
            .oneshot(
                Request::get("/.events")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    /// The bug this guards against: before the shutdown signal was wired in,
    /// an open `/.events` connection was an HTTP response that never
    /// completed, so `axum::serve(...).with_graceful_shutdown` would hang
    /// forever waiting for it to finish. Here the broadcast sender is kept
    /// alive (so, absent a fix, the stream has no other reason to end) and no
    /// fs events are ever sent; only firing the shutdown watch channel should
    /// let the body collection complete. `tokio::time::timeout` makes a
    /// regression fail the test instead of hanging it.
    #[tokio::test]
    async fn shutdown_signal_ends_an_open_stream() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx.clone());
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(());
        state.shutdown = Some(shutdown_rx);
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            shutdown_tx.send(()).unwrap();
            // Keep `tx` and `shutdown_tx`'s sender-ness alive until after the
            // signal fires; dropping `tx` here would end the stream for an
            // unrelated reason (the broadcast channel closing) and the test
            // would no longer be exercising the shutdown path.
            drop(tx);
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = tokio::time::timeout(
            Duration::from_secs(5),
            axum::body::to_bytes(resp.into_body(), 1024 * 1024),
        )
        .await
        .expect("stream did not end after shutdown fired -- graceful shutdown would hang")
        .unwrap();
        // No fs events were sent, so the body is just keep-alive comments (or
        // empty) -- the point is that collection completed at all.
        let _ = body;
    }
}
