//! OpenAPI component-schema smoke test. Compiled only with `--features openapi`.
//!
//! Aggregates every *public* annotated wire DTO and asserts the document
//! serializes. Private request/response structs (`ShellRequest`, `LoginBody`,
//! `Manifest`, etc.) are still `ToSchema`-derived where they live; this harness
//!only proves the public contract, which is what an external consumer needs.
//! The green build under `--features openapi` is what proves the openapi branch
//! stands alone, independent of any OIDC payload work.

#![cfg(all(test, feature = "openapi"))]

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
#[openapi(components(schemas(
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
)))]
struct WireContract;

#[test]
fn schemas_generate_for_server_wire_types() {
    let doc = WireContract::openapi();
    let json = doc
        .to_pretty_json()
        .expect("wire-contract schema must serialize");
    // The camelCase serde hints must carry into the generated schema names.
    assert!(json.contains("LoginForm"), "missing LoginForm: {json}");
    assert!(json.contains("UserEntry"), "missing UserEntry: {json}");
    assert!(json.contains("SpaceConfig"), "missing SpaceConfig: {json}");
    assert!(
        json.contains("RoutingTable"),
        "missing RoutingTable: {json}"
    );
}
