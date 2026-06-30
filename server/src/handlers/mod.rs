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
use chrono::{TimeZone, Utc};
use silverbullet_server_common::SpaceError;

/// Format a millisecond Unix timestamp as an HTTP-date (IMF-fixdate, GMT) for
/// `Last-Modified`. Returns an empty string for an out-of-range timestamp.
pub(crate) fn http_date(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%a, %d %b %Y %H:%M:%S GMT").to_string())
        .unwrap_or_default()
}

/// Map a `SpaceError` to an HTTP response, matching the client's expectations
/// (missing files are a plain 404). Client-side faults (paths escaping the
/// space root, unauthorized) map to 4xx so callers can tell them apart from
/// server failures; the error message is preserved in the body.
pub(crate) fn space_error_response(e: SpaceError) -> Response {
    let (status, body) = match &e {
        SpaceError::NotFound => (StatusCode::NOT_FOUND, "404 page not found\n".to_string()),
        SpaceError::PathOutsideRoot => (StatusCode::FORBIDDEN, e.to_string()),
        SpaceError::Unauthorized => (StatusCode::UNAUTHORIZED, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    Response::builder()
        .status(status)
        .body(Body::from(body))
        .unwrap()
}
