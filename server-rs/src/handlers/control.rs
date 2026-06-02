use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::state::AppState;

pub async fn handle_ping(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [
            ("Cache-Control", "no-cache".to_string()),
            ("X-Space-Path", state.space_folder_path.clone()),
            ("X-Server-Version", state.version.clone()),
        ],
        "OK",
    )
}

pub async fn handle_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [("Cache-Control", "no-cache")],
        axum::Json(state.boot_config.clone()),
    )
}

#[cfg(test)]
mod tests {
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt; // for `oneshot`

    #[tokio::test]
    async fn ping_returns_version_header() {
        let app = crate::build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/.ping")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("X-Server-Version").unwrap(),
            "test-version"
        );
    }

    #[tokio::test]
    async fn config_returns_boot_config_json() {
        let app = crate::build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/.config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["spaceName"], "Test");
        assert_eq!(v["indexPage"], "index");
        assert_eq!(v["readOnly"], false);
    }
}
