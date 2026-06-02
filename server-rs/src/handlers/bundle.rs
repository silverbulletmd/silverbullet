use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::router::run_blocking;
use crate::state::AppState;

/// SPA fallback: serve a bundle asset by request path, or `index.html` for any
/// unknown path (client-side routing). HTML is run through `process_index_html`.
pub async fn handle_client_bundle(
    State(state): State<Arc<AppState>>,
    req: axum::http::Request<Body>,
) -> impl IntoResponse {
    if state.client_bundle.is_none() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("No client bundle configured"))
            .unwrap();
    }

    let path = req.uri().path().trim_start_matches('/').to_string();

    // Try the requested asset first.
    let s = state.clone();
    let p = path.clone();
    let direct = run_blocking(move || s.client_bundle.as_ref().unwrap().read_file(&p)).await;
    if let Ok((data, meta)) = direct {
        let data = if meta.content_type.contains("html") {
            process_index_html(&data)
        } else {
            data
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", &meta.content_type)
            .body(Body::from(data))
            .unwrap();
    }

    // Fallback: serve the SPA shell.
    let s = state.clone();
    let shell = run_blocking(move || {
        s.client_bundle
            .as_ref()
            .unwrap()
            .read_file(".client/index.html")
    })
    .await;
    match shell {
        Ok((data, meta)) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", &meta.content_type)
            .body(Body::from(process_index_html(&data)))
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap(),
    }
}

/// Replace the `index.html` template placeholders with default values. Richer
/// templating (configurable title/description, server-side rendering) can be
/// added later.
fn process_index_html(data: &[u8]) -> Vec<u8> {
    let html = String::from_utf8_lossy(data);
    html.replace("{{.HostPrefix}}", "")
        .replace("{{.Title}}", "SilverBullet")
        .replace("{{.Description}}", "")
        .replace("{{.AdditionalHeadHTML}}", "")
        .replace("{{.Content | markdown}}", "Loading...")
        .into_bytes()
}

#[cfg(test)]
mod tests {
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn seed_bundle(state: &crate::state::AppState, path: &str, body: &[u8]) {
        state
            .client_bundle
            .as_ref()
            .unwrap()
            .write_file(path, body, None)
            .unwrap();
    }

    #[tokio::test]
    async fn serves_a_bundle_asset() {
        let state = test_state();
        seed_bundle(&state, ".client/app.js", b"console.log(1)");
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.client/app.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"console.log(1)");
    }

    #[tokio::test]
    async fn templates_and_falls_back_to_index_html() {
        let state = test_state();
        seed_bundle(&state, ".client/index.html", b"<title>{{.Title}}</title>");
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/some/spa/route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"<title>SilverBullet</title>");
    }
}
