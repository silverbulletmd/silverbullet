use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use silverbullet_server_common::page::is_tool_page;
use silverbullet_server_common::revision::{etag_for_hash, sha256_hex};
use silverbullet_server_common::SpaceError;

use crate::handlers::space_error_response;
use crate::router::run_blocking;
use crate::state::ServerState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolingFile {
    path: String,
    last_modified: i64,
    text: String,
}

/// `GET /.tooling`: the raw text of every Tool Page in one response, so the
/// client can load scripts and styles at boot without waiting for the index.
pub async fn handle_tooling(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let result = run_blocking(move || -> Result<Response, SpaceError> {
        let mut metas: Vec<_> = state
            .space
            .fetch_file_list()?
            .into_iter()
            .filter(|m| m.name.strip_suffix(".md").is_some_and(is_tool_page))
            .collect();
        metas.sort_by(|a, b| a.name.cmp(&b.name));

        // The version too: a new server may build the payload differently
        // from the same files, and a 304 would keep the old shape alive.
        let mut fingerprint = format!("{}\n", state.version.get());
        for m in &metas {
            fingerprint.push_str(&format!("{}\0{}\0{}\n", m.name, m.last_modified, m.size));
        }
        let etag = etag_for_hash(&sha256_hex(fingerprint.as_bytes()));
        if if_none_match
            .as_deref()
            .is_some_and(|v| crate::handlers::if_none_match_hits(v, &etag))
        {
            return Ok(Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, &etag)
                .header(header::CACHE_CONTROL, "private, no-cache")
                .body(Body::empty())
                .unwrap());
        }

        let mut files = Vec::with_capacity(metas.len());
        for m in metas {
            match state.space.read_file(&m.name) {
                Ok((data, meta)) => files.push(ToolingFile {
                    path: m.name,
                    last_modified: meta.last_modified,
                    text: String::from_utf8_lossy(&data).into_owned(),
                }),
                // Deleted between listing and reading.
                Err(SpaceError::NotFound) => {}
                Err(e) => return Err(e),
            }
        }
        let json =
            serde_json::to_string(&files).map_err(|e| SpaceError::Io(std::io::Error::other(e)))?;
        Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ETAG, &etag)
            .header(header::CACHE_CONTROL, "private, no-cache")
            .body(Body::from(json))
            .unwrap())
    })
    .await;
    match result {
        Ok(resp) => resp,
        Err(e) => space_error_response(e),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Arc;

    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use silverbullet_server_common::SpacePrimitives;
    use tower::ServiceExt;

    async fn get(
        state: &Arc<crate::state::ServerState>,
        if_none_match: Option<&str>,
    ) -> axum::response::Response {
        let mut req = Request::builder().uri("/.tooling");
        if let Some(v) = if_none_match {
            req = req.header(header::IF_NONE_MATCH, v);
        }
        crate::build_router(state.clone())
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    async fn body_json(resp: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn returns_only_tool_pages() {
        let state = Arc::new(test_state());
        for (p, t) in [
            ("Library/A.md", "a"),
            ("Library/Config.md", "c"),
            ("CONFIG.md", "legacy"),
            ("Notes.md", "n"),
            ("Library/img.png", "i"),
        ] {
            state.space.write_file(p, t.as_bytes(), None).unwrap();
        }
        let resp = get(&state, None).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = body_json(resp).await;
        let got: Vec<_> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (f["path"].as_str().unwrap(), f["text"].as_str().unwrap()))
            .collect();
        assert_eq!(got, vec![("Library/A.md", "a"), ("Library/Config.md", "c")]);
    }

    fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect_files(root, &path, out);
            } else {
                let rel = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, std::fs::read(&path).unwrap()));
            }
        }
    }

    /// The space stamps its own modification times on write, so
    /// `lastModified` is normalised to 0 on both sides (expected.json holds 0).
    #[tokio::test]
    async fn matches_shared_fixture() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/tooling");
        let space_dir = dir.join("space");
        let state = Arc::new(test_state());
        let mut files = Vec::new();
        collect_files(&space_dir, &space_dir, &mut files);
        assert!(files.len() >= 5);
        for (p, data) in files {
            state.space.write_file(&p, &data, None).unwrap();
        }
        let mut actual = body_json(get(&state, None).await).await;
        for f in actual.as_array_mut().unwrap() {
            f["lastModified"] = 0.into();
        }
        let expected: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("expected.json")).unwrap()).unwrap();
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn etag_roundtrip() {
        let state = Arc::new(test_state());
        state.space.write_file("Library/A.md", b"a", None).unwrap();
        let resp = get(&state, None).await;
        let etag = resp
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(
            get(&state, Some(&etag)).await.status(),
            StatusCode::NOT_MODIFIED
        );
        assert_eq!(
            get(&state, Some(&format!("W/{etag}"))).await.status(),
            StatusCode::NOT_MODIFIED
        );
        state.space.write_file("Library/B.md", b"b", None).unwrap();
        assert_eq!(get(&state, Some(&etag)).await.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn etag_changes_with_the_server_version() {
        let state = Arc::new(test_state());
        state.space.write_file("Library/A.md", b"a", None).unwrap();
        let etag = get(&state, None).await.headers()[header::ETAG].clone();

        let mut upgraded = test_state();
        upgraded.space = state.space.clone();
        upgraded.version = "next-version".to_string().into();
        let resp = get(&Arc::new(upgraded), Some(etag.to_str().unwrap())).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn etag_changes_with_size_at_same_mtime() {
        let state = Arc::new(test_state());
        let meta = state.space.write_file("Library/A.md", b"a", None).unwrap();
        let etag = get(&state, None).await.headers()[header::ETAG].clone();
        let rewritten = state
            .space
            .write_file("Library/A.md", b"abc", Some(&meta))
            .unwrap();
        assert_eq!(rewritten.last_modified, meta.last_modified);
        let resp = get(&state, Some(etag.to_str().unwrap())).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_ne!(resp.headers()[header::ETAG], etag);
    }
}
