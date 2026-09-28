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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigResponse<'a> {
    #[serde(flatten)]
    boot_config: &'a silverbullet_server_common::BootConfig,
    space_prefixes: Vec<String>,
    share_owner_id: String,
}

pub(crate) async fn handle_config(
    State(state): State<Arc<ServerState>>,
    axum::Extension(actor): axum::Extension<crate::auth::Actor>,
    revision_access: Option<axum::Extension<crate::router::RevisionAccess>>,
) -> impl IntoResponse {
    let writable = actor.level >= crate::auth::AccessLevel::Write;
    let mut boot_config = state.boot_config.clone();
    if revision_access.is_some_and(|access| !access.0 .0) {
        boot_config.revisions = silverbullet_server_common::RevisionsMode::Disabled;
    }
    if !writable {
        boot_config.read_only = true;
        boot_config.shell_backend = "noop".into();
    }
    (
        StatusCode::OK,
        [("Cache-Control", "no-cache")],
        axum::Json(ConfigResponse {
            boot_config: &boot_config,
            space_prefixes: state.space_prefixes.current(),
            share_owner_id: silverbullet_server_common::revision::sha256_hex(
                format!(
                    "{}\0{}",
                    state.space_folder_path,
                    actor.username.as_deref().unwrap_or("single-user")
                )
                .as_bytes(),
            ),
        })
        .into_response(),
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

#[derive(serde::Serialize)]
struct ManifestShareFile {
    name: &'static str,
    accept: Vec<&'static str>,
}

#[derive(serde::Serialize)]
struct ManifestShareParams {
    title: &'static str,
    text: &'static str,
    url: &'static str,
    files: Vec<ManifestShareFile>,
}

#[derive(serde::Serialize)]
struct ManifestShareTarget {
    action: String,
    method: &'static str,
    enctype: &'static str,
    params: ManifestShareParams,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    share_target: Option<ManifestShareTarget>,
}

/// Render the PWA manifest from space configuration, prefixing icon, start,
/// and scope URLs so installations work under a sub-path mount.
pub async fn handle_manifest(
    State(state): State<Arc<ServerState>>,
    axum::Extension(actor): axum::Extension<crate::auth::Actor>,
) -> impl IntoResponse {
    let prefix = &state.host_url_prefix;
    let eligible = actor.level >= crate::auth::AccessLevel::Write
        && !state.boot_config.read_only
        && !state.boot_config.enable_client_encryption
        && !state.boot_config.disable_service_worker;
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
        share_target: eligible.then(|| ManifestShareTarget {
            action: format!("{prefix}/.client/share-target"),
            method: "POST",
            enctype: "multipart/form-data",
            params: ManifestShareParams {
                title: "title",
                text: "text",
                url: "url",
                files: vec![ManifestShareFile {
                    name: "files",
                    accept: vec!["*/*"],
                }],
            },
        }),
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
    use axum::response::IntoResponse;
    use tower::ServiceExt;

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
    async fn public_boot_hides_revisions_but_read_members_keep_git_views() {
        for (is_member, expected) in [(false, "disabled"), (true, "managed")] {
            let mut state = test_state();
            state.boot_config.account_managed = true;
            state.boot_config.revisions = silverbullet_server_common::RevisionsMode::Managed;
            let actor = crate::auth::Actor {
                level: crate::auth::AccessLevel::Read,
                ..Default::default()
            };
            let response = super::handle_config(
                axum::extract::State(Arc::new(state)),
                axum::Extension(actor),
                Some(axum::Extension(crate::router::RevisionAccess(is_member))),
            )
            .await
            .into_response();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["revisions"], expected);
        }
    }

    async fn config_for(level: crate::auth::AccessLevel) -> serde_json::Value {
        let state = Arc::new(test_state());
        let actor = crate::auth::Actor {
            level,
            ..Default::default()
        };
        let resp = super::handle_config(axum::extract::State(state), axum::Extension(actor), None)
            .await
            .into_response();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn a_read_level_caller_is_told_the_space_is_read_only() {
        let body = config_for(crate::auth::AccessLevel::Read).await;
        assert_eq!(body["readOnly"], serde_json::json!(true));
        assert_eq!(body["shellBackend"], serde_json::json!("noop"));
    }

    #[tokio::test]
    async fn a_write_level_caller_sees_the_space_as_configured() {
        let body = config_for(crate::auth::AccessLevel::Write).await;
        assert_eq!(body["readOnly"], serde_json::json!(false));
        assert_eq!(body["shellBackend"], serde_json::json!("local"));
    }

    #[tokio::test]
    async fn a_write_level_caller_still_sees_a_genuinely_read_only_space() {
        let mut state = test_state();
        state.boot_config.read_only = true;
        let actor = crate::auth::Actor {
            level: crate::auth::AccessLevel::Write,
            ..Default::default()
        };
        let resp = super::handle_config(
            axum::extract::State(Arc::new(state)),
            axum::Extension(actor),
            None,
        )
        .await
        .into_response();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["readOnly"], serde_json::json!(true));
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
        assert!(v.get("share_target").is_none());
    }

    #[tokio::test]
    async fn writable_space_manifest_advertises_multipart_share_target() {
        let mut state = test_state();
        state.boot_config.disable_service_worker = false;
        let app = crate::build_router(Arc::new(state));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/.client/manifest.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(manifest["share_target"]["action"], "/.client/share-target");
        assert_eq!(manifest["share_target"]["method"], "POST");
        assert_eq!(manifest["share_target"]["enctype"], "multipart/form-data");
        assert_eq!(manifest["share_target"]["params"]["title"], "title");
        assert_eq!(manifest["share_target"]["params"]["text"], "text");
        assert_eq!(manifest["share_target"]["params"]["url"], "url");
        assert_eq!(
            manifest["share_target"]["params"]["files"][0]["name"],
            "files"
        );
        assert_eq!(
            manifest["share_target"]["params"]["files"][0]["accept"][0],
            "*/*"
        );
    }

    #[tokio::test]
    async fn ineligible_spaces_do_not_advertise_a_share_target() {
        for (read_only, encrypted, level) in [
            (true, false, crate::auth::AccessLevel::Write),
            (false, true, crate::auth::AccessLevel::Write),
            (false, false, crate::auth::AccessLevel::Read),
        ] {
            let mut state = test_state();
            state.boot_config.disable_service_worker = false;
            state.boot_config.read_only = read_only;
            state.boot_config.enable_client_encryption = encrypted;
            let actor = crate::auth::Actor {
                level,
                ..Default::default()
            };
            let response = super::handle_manifest(
                axum::extract::State(Arc::new(state)),
                axum::Extension(actor),
            )
            .await
            .into_response();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert!(manifest.get("share_target").is_none());
        }
    }

    #[tokio::test]
    async fn config_has_a_stable_share_owner_marker() {
        let app = crate::build_router(Arc::new(test_state()));
        let request = || {
            Request::builder()
                .uri("/.config")
                .body(Body::empty())
                .unwrap()
        };
        let first = app.clone().oneshot(request()).await.unwrap();
        let second = app.oneshot(request()).await.unwrap();
        let json = async |response: axum::response::Response| {
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()
        };
        let first = json(first).await;
        let second = json(second).await;
        assert!(first["shareOwnerId"].as_str().is_some());
        assert_eq!(first["shareOwnerId"], second["shareOwnerId"]);
    }
}
