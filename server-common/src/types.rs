use serde::{Deserialize, Serialize};

/// File metadata for a file in a space — the `/.fs` wire contract shared with
/// the client's `FileMeta` interface.
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub name: String,
    pub created: i64,
    pub last_modified: i64,
    pub content_type: String,
    pub size: i64,
    pub perm: String,
}

/// Boot configuration sent to the client via `/.config`.
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub space_folder_path: String,
    pub space_name: String,
    pub index_page: String,
    pub read_only: bool,
    pub log_push: bool,
    pub enable_client_encryption: bool,
    /// True when one account/session and encryption salt span every prefix on
    /// this server. Clients may then transfer in-memory encryption keys across
    /// same-origin service-worker scopes.
    #[serde(default)]
    pub account_managed: bool,
    pub shell_backend: String,
    pub disable_service_worker: bool,
    /// Highest sync wire protocol version this server understands. A running
    /// v2 server always advertises 2; the serde default of 1 exists only for
    /// deserializing configs produced by older servers.
    #[serde(default = "default_sync_protocol_version")]
    pub sync_protocol_version: u32,
    #[serde(default)]
    pub revisions: RevisionsMode,
}

fn default_sync_protocol_version() -> u32 {
    1
}

#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RevisionsMode {
    Managed,
    Unmanaged,
    #[default]
    Disabled,
}

impl RevisionsMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RevisionsMode::Managed => "managed",
            RevisionsMode::Unmanaged => "unmanaged",
            RevisionsMode::Disabled => "disabled",
        }
    }
}

/// Errors returned by SpacePrimitives operations.
#[derive(Debug, thiserror::Error)]
pub enum SpaceError {
    #[error("Not found")]
    NotFound,
    #[error("Path not in space")]
    PathOutsideRoot,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Could not write file: {0}")]
    WriteError(String),
    #[error("Read-only: {0}")]
    ReadOnly(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Precondition failed")]
    PreconditionFailed,
    #[error("Reconcile ineligible")]
    ReconcileIneligible,
}

/// The core storage abstraction for a space's files.
pub trait SpacePrimitives: Send + Sync {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError>;
    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError>;
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError>;
    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError>;
    fn delete_file(&self, path: &str) -> Result<(), SpaceError>;
}

impl<T: SpacePrimitives + ?Sized> SpacePrimitives for std::sync::Arc<T> {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        (**self).fetch_file_list()
    }
    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        (**self).get_file_meta(path)
    }
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        (**self).read_file(path)
    }
    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        (**self).write_file(path, data, meta)
    }
    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        (**self).delete_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_meta_serializes_camel_case() {
        let m = FileMeta {
            name: "index.md".into(),
            created: 1,
            last_modified: 2,
            content_type: "text/markdown".into(),
            size: 3,
            perm: "rw".into(),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"lastModified\":2"), "got: {json}");
        assert!(
            json.contains("\"contentType\":\"text/markdown\""),
            "got: {json}"
        );
    }

    #[test]
    fn space_error_messages() {
        assert_eq!(SpaceError::NotFound.to_string(), "Not found");
        assert_eq!(SpaceError::PathOutsideRoot.to_string(), "Path not in space");
    }
}

/// Only compiled when the `openapi` feature is on. Exercises the `#[cfg_attr]`
/// `ToSchema` derives so a build with `--features openapi` actually generates
/// schemas for the wire types — this is what proves the annotations stand
/// alone, independent of any OIDC payload work.
#[cfg(all(test, feature = "openapi"))]
mod openapi_tests {
    use super::*;
    use utoipa::OpenApi;

    #[derive(OpenApi)]
    #[openapi(components(schemas(FileMeta, BootConfig, RevisionsMode)))]
    struct WireContract;

    #[test]
    fn schemas_generate_for_wire_types() {
        let doc = WireContract::openapi();
        let json = doc.to_pretty_json().expect("schema must serialize");
        // The `rename_all = "camelCase"` serde hints must carry into the schema.
        assert!(
            json.contains("lastModified"),
            "schema missing camelCase field: {json}"
        );
        assert!(
            json.contains("FileMeta"),
            "FileMeta component missing: {json}"
        );
        assert!(
            json.contains("BootConfig"),
            "BootConfig component missing: {json}"
        );
        assert!(
            json.contains("RevisionsMode"),
            "RevisionsMode component missing: {json}"
        );
    }
}
