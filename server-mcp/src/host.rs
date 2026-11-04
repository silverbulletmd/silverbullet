use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, HeaderValue, Request};
use axum::Router;
use tower::ServiceExt;

pub use space_tools::ops::{SpaceRequest, SpaceResponse};

use crate::Caller;

const RESPONSE_LIMIT: usize = 32 * 1024 * 1024;
/// Only headers the `/.fs`, `/.runtime` and `/.search` handlers read.
/// Anything else (Cookie, Authorization, X-Forwarded-*) could replace the
/// bearer's identity or origin.
pub const FORWARDED_HEADERS: &[&str] = &[
    "content-type",
    "accept",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "if-range",
    "range",
    "x-timeout",
    "x-client-id",
    "x-source",
    "x-get-meta",
    "x-await-index",
];

pub struct SpaceInfo {
    pub id: String,
    pub name: String,
    pub runtime: bool,
}

#[derive(Debug)]
pub enum HostError {
    /// Unknown, unwritable or reserved space.
    NotAvailable(String),
    /// The space exists but its instance is errored.
    Unavailable(String),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostError::NotAvailable(m) | HostError::Unavailable(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for HostError {}

/// Where a local file is: see [`PathLocator::locate`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// The space's id.
    pub space: String,
    /// The page a Markdown file holds.
    pub page: Option<String>,
}

/// Finds the space a local file belongs to.
pub trait PathLocator {
    /// The space and page holding the local file `path`, or why there is
    /// none.
    fn locate(&self, caller: &Caller, path: &str) -> Result<Located, String>;
}

#[async_trait]
pub trait McpHost: Send + Sync {
    /// Spaces the caller can write to, sorted by name.
    fn spaces(&self, caller: &Caller) -> Vec<SpaceInfo>;
    /// Sends `req` to `space`, starting the space first if the host has to.
    async fn request(
        &self,
        caller: &Caller,
        space: &str,
        req: SpaceRequest,
    ) -> Result<SpaceResponse, HostError>;

    /// Present when the spaces are folders on the caller's machine: `help`
    /// then takes a local file `path` and answers with what the locator
    /// finds.
    fn locator(&self) -> Option<&dyn PathLocator> {
        None
    }

    /// Text `help` appends to its overview, or to a path lookup: about
    /// `space`, or about all spaces when `help` was given none.
    fn help_note(&self, _caller: &Caller, _space: Option<&str>) -> Option<String> {
        None
    }
}

/// Sends `req` in-process to a space's `router` as `authority`, authenticated
/// by `bearer` alone: of the caller's headers only [`FORWARDED_HEADERS`] pass.
pub async fn forward(
    router: Router,
    authority: &str,
    bearer: &str,
    req: SpaceRequest,
) -> Result<SpaceResponse, HostError> {
    // Origin-form only: an absolute URI would carry its own authority.
    debug_assert!(
        req.path_and_query.starts_with('/'),
        "{}",
        req.path_and_query
    );
    let mut builder = Request::builder()
        .method(req.method)
        .uri(&req.path_and_query)
        .header(header::HOST, authority)
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    for (name, value) in req.headers {
        if !FORWARDED_HEADERS.contains(&name.as_str()) {
            continue;
        }
        let value = HeaderValue::from_str(&value)
            .map_err(|_| HostError::Unavailable("invalid request: bad header value".into()))?;
        builder = builder.header(name, value);
    }
    let request = builder
        .body(Body::from(req.body))
        .map_err(|e| HostError::Unavailable(format!("invalid request: {e}")))?;
    let response = match router.oneshot(request).await {
        Ok(response) => response,
        Err(never) => match never {},
    };
    let (parts, body) = response.into_parts();
    let body = axum::body::to_bytes(body, RESPONSE_LIMIT)
        .await
        .map_err(|_| HostError::Unavailable("response too large".into()))?;
    Ok(SpaceResponse {
        status: parts.status,
        headers: parts.headers,
        body: body.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::http::{HeaderMap, HeaderName, Method, StatusCode};
    use axum::routing::get;

    use super::*;

    /// The allowlist is a security boundary: widening it is a deliberate act.
    #[test]
    fn forwarded_headers_are_pinned() {
        assert_eq!(
            FORWARDED_HEADERS,
            [
                "content-type",
                "accept",
                "if-match",
                "if-none-match",
                "if-modified-since",
                "if-range",
                "range",
                "x-timeout",
                "x-client-id",
                "x-source",
                "x-get-meta",
                "x-await-index",
            ]
        );
    }

    #[tokio::test]
    async fn forward_passes_only_allowlisted_headers_and_its_own_bearer() {
        let seen = Arc::new(Mutex::new(HeaderMap::new()));
        let record = seen.clone();
        let router = Router::new().route(
            "/.fs/Garden.md",
            get(move |headers: HeaderMap| {
                *record.lock().unwrap() = headers;
                async { "# Garden" }
            }),
        );
        let header =
            |name: &'static str, value: &str| (HeaderName::from_static(name), value.into());
        let req = SpaceRequest {
            method: Method::GET,
            path_and_query: "/.fs/Garden.md".into(),
            body: Vec::new(),
            headers: vec![
                header("x-await-index", "1"),
                header("if-none-match", "\"abc\""),
                header("cookie", "session=elsewhere"),
                header("authorization", "Bearer someone-else"),
                header("host", "evil.test"),
                header("origin", "http://evil.test"),
                header("x-forwarded-host", "evil.test"),
                header("x-forwarded-for", "203.0.113.9"),
            ],
        };
        let response = forward(router, "orchard.test", "space-token", req)
            .await
            .unwrap();
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(response.body, b"# Garden");
        let seen = seen.lock().unwrap();
        assert_eq!(seen["x-await-index"], "1");
        assert_eq!(seen["if-none-match"], "\"abc\"");
        assert_eq!(seen["authorization"], "Bearer space-token");
        assert_eq!(seen.get_all("authorization").iter().count(), 1);
        assert_eq!(seen["host"], "orchard.test");
        assert_eq!(seen.get_all("host").iter().count(), 1);
        for name in ["cookie", "origin", "x-forwarded-host", "x-forwarded-for"] {
            assert!(seen.get(name).is_none(), "{name}");
        }
    }
}
