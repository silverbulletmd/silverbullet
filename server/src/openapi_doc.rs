//! OpenAPI component-schema generation, gated behind the `openapi` feature.
//!
//! Aggregates every *public* annotated wire DTO into a single `utoipa::OpenApi`
//! document. The public contract is what an external consumer needs; the private
//! request/response structs (`ShellRequest`, `LoginBody`, `Manifest`, etc.) are
//! still `ToSchema`-derived where they live but are intentionally not bundled
//! here. No YAML dependency is pulled in — the spec is served as JSON via the
//! already-present `serde_json`.

#![cfg(feature = "openapi")]

use axum::response::IntoResponse;
use utoipa::OpenApi;

use crate::handlers::auth::LoginForm;
use crate::handlers::revisions::HistoryQuery;
use crate::handlers::runtime::LogsQuery;
use crate::multi::config::{Binding, MultiConfig, ShellSettings, SpaceConfig};
use crate::multi::instance::{InstanceStatus, SpaceInstance};
use crate::multi::manager::{ApiError, SpaceState, VisibleSpace};
use crate::multi::registry::RoutingTable;
use crate::multi::setup::{FirstSpace, SetupRequest};
use crate::multi::users::{Profile, TokenEntry, UserEntry};
use crate::multi::validate::FieldError;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "SilverBullet Server API",
        description = "HTTP API for the SilverBullet server: authentication, \
space management, account administration, and per-space file (note) CRUD. \
Generated from the server crate's `utoipa` annotations; enabled with the \
`openapi` cargo feature.",
        version = "0.0.0"
    ),
    paths(
        crate::multi::space_index::handle_login,
        crate::multi::space_index::handle_logout,
        crate::multi::space_index::handle_session,
        crate::multi::space_index::handle_list,
        crate::multi::space_index::handle_get_profile,
        crate::multi::space_index::handle_put_profile,
        crate::multi::admin_api::handle_list,
        crate::multi::admin_api::handle_create,
        crate::multi::admin_api::handle_update,
        crate::multi::admin_api::handle_get,
        crate::multi::admin_api::handle_patch,
        crate::multi::admin_api::handle_delete,
        crate::multi::admin_api::handle_list_users,
        crate::multi::admin_api::handle_get_user,
        crate::multi::admin_api::handle_create_user,
        crate::multi::admin_api::handle_set_user_profile,
        crate::multi::admin_api::handle_delete_user,
        crate::multi::admin_api::handle_set_user_password,
        crate::multi::admin_api::handle_set_admin,
        crate::multi::admin_api::handle_create_token,
        crate::multi::admin_api::handle_delete_token,
        crate::multi::admin_api::handle_fs_dirs,
        crate::multi::admin_api::handle_server_info,
        crate::handlers::fs::handle_fs_list,
        crate::handlers::fs::handle_fs_get,
        crate::handlers::fs::handle_fs_put,
        crate::handlers::fs::handle_fs_delete,
        crate::handlers::fs::handle_fs_reconcile,
        crate::handlers::control::handle_ping,
        crate::handlers::control::handle_config,
        crate::handlers::control::handle_manifest,
        crate::handlers::accounts::handle_accounts,
        crate::handlers::events::handle_events,
        crate::handlers::auth::handle_auth_get,
        crate::handlers::auth::handle_auth_post,
        crate::handlers::auth::handle_logout,
        crate::handlers::shell::handle_shell,
        crate::handlers::proxy::handle_proxy,
        crate::handlers::revisions::handle_space_log,
        crate::handlers::revisions::handle_snapshot,
        crate::handlers::revisions::handle_file_revisions,
        crate::handlers::runtime::handle_runtime_lua,
        crate::handlers::runtime::handle_runtime_lua_script,
        crate::handlers::runtime::handle_runtime_logs,
        crate::multi::setup_api::handle_status,
        crate::multi::setup_api::handle_complete,
        crate::multi::setup_api::handle_fs_dirs,
    ),
    components(schemas(
        LoginForm,
        HistoryQuery,
        LogsQuery,
        Profile,
        TokenEntry,
        UserEntry,
        FieldError,
        FirstSpace,
        SetupRequest,
        ApiError,
        SpaceState,
        VisibleSpace,
        Binding,
        ShellSettings,
        SpaceConfig,
        MultiConfig,
        InstanceStatus,
        SpaceInstance,
        RoutingTable
    ))
)]
struct WireContract;

/// Serialize the wire-contract OpenAPI document to pretty-printed JSON.
///
/// Compiled only with `--features openapi`; callers outside that feature never
/// pay for `utoipa`. Returned as `String` so the router can set
/// `content-type: application/json` without an extra dependency.
pub fn openapi_json() -> String {
    WireContract::openapi()
        .to_pretty_json()
        .expect("wire-contract schema must serialize")
}

/// Serve the OpenAPI wire-contract document as pretty-printed JSON.
///
/// Gated behind the `openapi` feature: without it, this handler (and the
/// `utoipa` dependency) does not exist, so the default binary stays lean.
pub async fn handle_openapi_json() -> axum::response::Response {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        openapi_json(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_generate_for_server_wire_types() {
        let json = openapi_json();
        // The camelCase serde hints must carry into the generated schema names.
        assert!(json.contains("LoginForm"), "missing LoginForm: {json}");
        assert!(json.contains("UserEntry"), "missing UserEntry: {json}");
        assert!(json.contains("SpaceConfig"), "missing SpaceConfig: {json}");
        assert!(
            json.contains("RoutingTable"),
            "missing RoutingTable: {json}"
        );

        // Paths from the multi-space API must be present, not just components.
        let value: serde_json::Value =
            serde_json::from_str(&json).expect("spec must be valid JSON");
        let paths = value["paths"]
            .as_object()
            .expect("spec must contain a paths object");
        assert!(
            paths.contains_key("/.spaces/api/login"),
            "missing login path: {paths:?}"
        );
        assert!(
            paths.contains_key("/.spaces/api/spaces"),
            "missing spaces path: {paths:?}"
        );
        assert!(
            paths.contains_key("/.spaces/api/admin/users"),
            "missing admin users path: {paths:?}"
        );
        assert!(
            paths.contains_key("/.spaces/api/admin/spaces/{id}"),
            "missing admin spaces path: {paths:?}"
        );
        assert!(
            paths.contains_key("/.fs/{path}"),
            "missing fs path: {paths:?}"
        );
    }
}
