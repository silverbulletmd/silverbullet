pub mod auth;
pub mod bundle;
pub mod control;
pub mod fs;
pub mod proxy;
pub mod runtime;
pub mod runtime_objects;
pub mod shell;

use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use silverbullet_server_common::SpaceError;

/// Map a `SpaceError` to an HTTP response, matching the client's expectations
/// (missing files are a plain 404).
pub(crate) fn space_error_response(e: SpaceError) -> Response {
    match e {
        SpaceError::NotFound => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("404 page not found\n"))
            .unwrap(),
        other => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(other.to_string()))
            .unwrap(),
    }
}
