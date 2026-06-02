use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, put};
use axum::Router;
use silverbullet_common::SpaceError;

use crate::handlers::{bundle, control, fs};
use crate::state::AppState;

/// Run a synchronous `SpacePrimitives` operation on the blocking thread pool so
/// it never stalls an async worker. This is the single async↔sync seam; handler
/// bodies otherwise read as straight-line synchronous code. A panic in the
/// blocking closure is surfaced as `SpaceError::Io` rather than unwound.
pub(crate) async fn run_blocking<F, T>(f: F) -> Result<T, SpaceError>
where
    F: FnOnce() -> Result<T, SpaceError> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result,
        Err(join_err) => {
            tracing::error!("blocking task failed: {join_err}");
            Err(SpaceError::Io(std::io::Error::other(format!(
                "blocking task join error: {join_err}"
            ))))
        }
    }
}

/// Build the HTTP router for the file/config/bundle endpoints. These routes are
/// unauthenticated; an authentication layer can be added by the caller or a
/// later revision.
pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/.ping", get(control::handle_ping))
        .route("/.config", get(control::handle_config))
        .route("/.fs", get(fs::handle_fs_list))
        .route("/.fs/", get(fs::handle_fs_list))
        .route("/.fs/{*path}", get(fs::handle_fs_get))
        .route("/.fs/{*path}", put(fs::handle_fs_put))
        .route("/.fs/{*path}", delete(fs::handle_fs_delete))
        .fallback(get(bundle::handle_client_bundle))
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}
