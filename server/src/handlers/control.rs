use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::state::ServerState;

pub async fn handle_ping(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [
            ("Cache-Control", "no-cache".to_string()),
            ("X-Space-Path", state.space_folder_path.clone()),
            ("X-Server-Version", state.version.get()),
        ],
        "OK",
    )
}

pub async fn handle_config(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [("Cache-Control", "no-cache")],
        axum::Json(state.boot_config.clone()),
    )
}

/// An icon entry in the PWA manifest.
#[derive(serde::Serialize)]
struct ManifestIcon {
    src: String,
    #[serde(rename = "type")]
    icon_type: String,
    sizes: String,
}

/// The PWA `manifest.json` document. Field names match the web app manifest
/// spec (snake_case), so they are serialized verbatim.
#[derive(serde::Serialize)]
struct Manifest {
    short_name: String,
    name: String,
    icons: Vec<ManifestIcon>,
    capture_links: String,
    start_url: String,
    display: String,
    display_override: Vec<String>,
    scope: String,
    theme_color: String,
    description: String,
}

/// Serve the dynamically generated PWA `manifest.json` (referenced from
/// `index.html`). Reconstructed from the former Go `manifestHandler`: space
/// name/description and theme color come from config, and `host_url_prefix` is
/// prepended to the icon, start URL, and scope so the PWA installs correctly
/// under a sub-path mount.
pub async fn handle_manifest(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    let prefix = &state.host_url_prefix;
    let manifest = Manifest {
        short_name: state.boot_config.space_name.clone(),
        name: state.boot_config.space_name.clone(),
        icons: vec![ManifestIcon {
            src: format!("{prefix}/.client/logo-dock.png"),
            icon_type: "image/png".to_string(),
            sizes: "512x512".to_string(),
        }],
        capture_links: "new-client".to_string(),
        start_url: format!("{prefix}/#boot"),
        display: "standalone".to_string(),
        display_override: vec!["window-controls-overlay".to_string()],
        scope: format!("{prefix}/"),
        theme_color: state.theme_color.clone(),
        description: state.space_description.clone(),
    };
    (
        StatusCode::OK,
        [("Cache-Control", "no-cache")],
        axum::Json(manifest),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt; // for `oneshot`

    #[tokio::test]
    async fn ping_returns_version_header() {
        let app = crate::build_router(Arc::new(test_state()));
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
        let app = crate::build_router(Arc::new(test_state()));
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

    #[tokio::test]
    async fn manifest_returns_pwa_manifest_json() {
        let app = crate::build_router(Arc::new(test_state()));
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/.client/manifest.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/json"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["short_name"], "Test");
        assert_eq!(v["name"], "Test");
        assert_eq!(v["start_url"], "/#boot");
        assert_eq!(v["scope"], "/");
        assert_eq!(v["display"], "standalone");
        assert_eq!(v["icons"][0]["src"], "/.client/logo-dock.png");
        assert_eq!(v["icons"][0]["type"], "image/png");
        assert_eq!(v["theme_color"], "#e1e1e1");
    }
}
