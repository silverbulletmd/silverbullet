use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use silverbullet_common::FileMeta;

use crate::handlers::space_error_response;
use crate::router::run_blocking;
use crate::state::AppState;

pub async fn handle_fs_list(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let state_inner = state.clone();
    match run_blocking(move || state_inner.space.fetch_file_list()).await {
        Ok(files) => {
            let json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string());
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("X-Space-Path", &state.space_folder_path)
                .header("Cache-Control", "no-cache")
                .body(Body::from(json))
                .unwrap()
        }
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(e.to_string()))
            .unwrap(),
    }
}

pub async fn handle_fs_get(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Metadata-only probe.
    if headers.get("X-Get-Meta").is_some() {
        let state_inner = state.clone();
        let path_inner = path.clone();
        return match run_blocking(move || state_inner.space.get_file_meta(&path_inner)).await {
            Ok(meta) => set_file_meta_headers(Response::builder().status(StatusCode::OK), &meta)
                .body(Body::empty())
                .unwrap(),
            Err(e) => space_error_response(e),
        };
    }

    let force_octet_stream = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("application/octet-stream"))
        .unwrap_or(false);

    let state_inner = state.clone();
    let path_inner = path.clone();
    match run_blocking(move || state_inner.space.read_file(&path_inner)).await {
        Ok((data, mut meta)) => {
            let real_content_type = meta.content_type.clone();
            if force_octet_stream {
                meta.content_type = "application/octet-stream".to_string();
            }
            set_file_meta_headers(Response::builder().status(StatusCode::OK), &meta)
                .header("X-Content-Type", &real_content_type)
                .body(Body::from(data))
                .unwrap()
        }
        Err(e) => space_error_response(e),
    }
}

/// Set the `X-*` file-metadata headers the client reads off `/.fs` responses.
pub(crate) fn set_file_meta_headers(
    builder: axum::http::response::Builder,
    meta: &FileMeta,
) -> axum::http::response::Builder {
    builder
        .header("Content-Type", &meta.content_type)
        .header("X-Created", meta.created.to_string())
        .header("X-Last-Modified", meta.last_modified.to_string())
        .header("X-Content-Length", meta.size.to_string())
        .header("X-Permission", &meta.perm)
        .header("Cache-Control", "no-cache")
}

pub async fn handle_fs_put(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let meta = file_meta_from_headers(&headers, &path);
    let state_inner = state.clone();
    let path_inner = path.clone();
    match run_blocking(move || {
        state_inner
            .space
            .write_file(&path_inner, &body, Some(&meta))
    })
    .await
    {
        Ok(result_meta) => {
            set_file_meta_headers(Response::builder().status(StatusCode::OK), &result_meta)
                .body(Body::from("OK"))
                .unwrap()
        }
        Err(e) => {
            tracing::error!("write failed: {e}");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("Write failed"))
                .unwrap()
        }
    }
}

pub async fn handle_fs_delete(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
) -> impl IntoResponse {
    let state_inner = state.clone();
    let path_inner = path.clone();
    match run_blocking(move || state_inner.space.delete_file(&path_inner)).await {
        Ok(()) => Response::builder()
            .status(StatusCode::OK)
            .body(Body::from("OK"))
            .unwrap(),
        Err(e) => space_error_response(e),
    }
}

/// Parse the client's `X-*` write headers into a `FileMeta`.
fn file_meta_from_headers(headers: &HeaderMap, path: &str) -> FileMeta {
    let header_str = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let header_i64 = |name: &str| {
        header_str(name)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64)
    };
    FileMeta {
        name: path.to_string(),
        created: header_i64("X-Created"),
        last_modified: header_i64("X-Last-Modified"),
        content_type: header_str("Content-Type").unwrap_or("").to_string(),
        size: header_str("X-Content-Length")
            .or_else(|| header_str("Content-Length"))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64),
        perm: header_str("X-Permission").unwrap_or("ro").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn list_returns_written_files() {
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri("/.fs").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let files: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(files
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["name"] == "a.md"));
    }

    #[tokio::test]
    async fn get_returns_bytes_and_headers() {
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        // Full metadata-header contract the client reads off a GET.
        assert!(resp.headers().get("X-Created").is_some());
        assert!(resp.headers().get("X-Last-Modified").is_some());
        assert_eq!(resp.headers().get("X-Content-Length").unwrap(), "5");
        assert_eq!(resp.headers().get("X-Permission").unwrap(), "rw");
        let content_type = resp
            .headers()
            .get("Content-Type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let x_content_type = resp
            .headers()
            .get("X-Content-Type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(!content_type.is_empty());
        // On a normal GET the served Content-Type equals the real one.
        assert_eq!(content_type, x_content_type);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"hello");
    }

    #[tokio::test]
    async fn get_with_octet_stream_accept_overrides_content_type() {
        // The subtlest part of the /.fs contract: an `accept: application/octet-stream`
        // request forces the body Content-Type to octet-stream while the real type
        // is preserved in X-Content-Type.
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .header("accept", "application/octet-stream")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("Content-Type").unwrap(),
            "application/octet-stream"
        );
        let real = resp
            .headers()
            .get("X-Content-Type")
            .unwrap()
            .to_str()
            .unwrap();
        assert_ne!(real, "application/octet-stream");
        assert!(real.contains("markdown") || real.starts_with("text/"));
    }

    #[tokio::test]
    async fn get_missing_is_404() {
        let resp = crate::build_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/.fs/nope.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn put_then_get_roundtrips() {
        let state = test_state();
        let app = crate::build_router(state);
        let put = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        let get = app
            .oneshot(
                Request::builder()
                    .uri("/.fs/note.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(get.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"content");
    }

    #[tokio::test]
    async fn delete_then_get_is_404() {
        let state = test_state();
        state.space.write_file("gone.md", b"x", None).unwrap();
        let app = crate::build_router(state);
        let del = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/.fs/gone.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del.status(), StatusCode::OK);
        let get = app
            .oneshot(
                Request::builder()
                    .uri("/.fs/gone.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::NOT_FOUND);
    }
}
