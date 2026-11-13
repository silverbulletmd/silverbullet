pub mod accounts;
pub mod auth;
pub mod bundle;
pub mod byte_range;
pub mod control;
pub mod events;
pub mod fs;
pub mod help;
pub mod mcp_oauth;
pub mod merge;
pub mod notice_page;
pub mod oauth;
pub mod proxy;
pub mod revisions;
pub mod runtime;
pub mod search;
pub mod shell;
pub mod tooling;

use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use chrono::{TimeZone, Utc};
use silverbullet_server_common::SpaceError;

/// RFC 9110 §13.1.2 `If-None-Match`: `*` or any listed tag equal to `etag`
/// after weak comparison. Proxies like Cloudflare hand strong tags back as
/// `W/` once they have re-compressed a response.
pub(crate) fn if_none_match_hits(if_none_match: &str, etag: &str) -> bool {
    if_none_match
        .split(',')
        .map(str::trim)
        .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == etag)
}

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
        SpaceError::ReadOnly(_) => (StatusCode::FORBIDDEN, e.to_string()),
        SpaceError::ReconcileIneligible => (StatusCode::CONFLICT, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    Response::builder()
        .status(status)
        .body(Body::from(body))
        .unwrap()
}

pub mod central_auth;

pub mod seo;
