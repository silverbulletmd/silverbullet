use serde::{Deserialize, Serialize};

/// File metadata for a file in a space — the `/.fs` wire contract shared with
/// the client's `FileMeta` interface.
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
    /// same-origin service-worker scopes. False on a server without accounts,
    /// so the client offers no account UI there.
    #[serde(default)]
    pub account_managed: bool,
    pub shell_backend: String,
    pub disable_service_worker: bool,
    /// Keep the client's datastore in memory instead of IndexedDB, so nothing
    /// is left on the device. Set per request for "Shared computer" sessions.
    #[serde(default)]
    pub ephemeral_storage: bool,
    /// Highest sync wire protocol version this server understands. A running
    /// v2 server always advertises 2; the serde default of 1 exists only for
    /// deserializing configs produced by older servers.
    #[serde(default = "default_sync_protocol_version")]
    pub sync_protocol_version: u32,
    #[serde(default)]
    pub revisions: RevisionsMode,
    /// Whether this server has real folders: `/.fs?folders=1` listings and
    /// `PUT`/`DELETE` on `/.fs/{folder}/`. Older servers omit it.
    #[serde(default)]
    pub folders: bool,
    /// Where others reach this space, for shareable links. `None` (omitted on
    /// the wire) means the URL the client is served from; `Some(None)` (sent
    /// as `null`) means nowhere. Desktop serves every space on localhost, so
    /// it sends its sync remote, or `null` for a space that doesn't sync.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_nullable"
    )]
    pub public_url: Option<Option<String>>,
}

/// Plain `Option` deserializing reads `null` as absent; keep them apart.
fn present_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

fn default_sync_protocol_version() -> u32 {
    1
}

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
    #[error("Folder not empty")]
    FolderNotEmpty,
    #[error("Not supported: {0}")]
    Unsupported(String),
}

pub(crate) fn range_read_error(path: &str) -> SpaceError {
    SpaceError::Io(std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        format!("could not read requested range from {path}"),
    ))
}

/// Every file and every folder in a space: the `/.fs?folders=1` wire shape.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Listing {
    pub files: Vec<FileMeta>,
    /// Every folder, empty or not, as a relative path without a trailing
    /// slash ("Projects/Archive"). `None` when the backend has no folders of
    /// its own (an older server, or a backend without folder support): then
    /// folders are only what file paths imply, and sync leaves them alone.
    pub folders: Option<Vec<String>>,
}

/// The folders a file path implies: "a/b/c.md" -> ["a", "a/b"].
pub fn parent_folders(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/').map(move |(i, _)| &path[..i])
}

/// Whether `path` lies somewhere below `folder` (given without slashes at
/// either end): "a/b/c.md" is in "a" and in "a/b", but not in "a/b/c.md".
pub fn is_in_folder(path: &str, folder: &str) -> bool {
    path.strip_prefix(folder)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// The core storage abstraction for a space's files.
///
/// Folders behave like a normal file system's: a folder exists until it is
/// deleted, whether or not anything is in it. A backend without real folders
/// keeps the defaults: its listing has no folders (`None`), and folder
/// operations are `Unsupported`.
pub trait SpacePrimitives: Send + Sync {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError>;
    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError>;
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError>;
    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        let (data, meta) = self.read_file(path)?;
        let start = usize::try_from(start).map_err(|_| range_read_error(path))?;
        let end = start
            .checked_add(length)
            .ok_or_else(|| range_read_error(path))?;
        let slice = data.get(start..end).ok_or_else(|| range_read_error(path))?;
        Ok((slice.to_vec(), meta))
    }
    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError>;
    fn delete_file(&self, path: &str) -> Result<(), SpaceError>;

    /// Every file and folder, in one go where the backend can.
    fn fetch_listing(&self) -> Result<Listing, SpaceError> {
        Ok(Listing {
            files: self.fetch_file_list()?,
            folders: None,
        })
    }
    /// Creates the folder and any missing parents; a no-op if it exists.
    fn create_folder(&self, _path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::Unsupported("folders".into()))
    }
    /// Deletes a folder: `NotFound` if it doesn't exist. Unless `recursive`,
    /// only an empty one (`FolderNotEmpty` otherwise); with it, the folder
    /// and everything in it, files and subfolders, in one operation.
    fn delete_folder(&self, _path: &str, _recursive: bool) -> Result<(), SpaceError> {
        Err(SpaceError::Unsupported("folders".into()))
    }
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
    fn read_file_range(
        &self,
        path: &str,
        start: u64,
        length: usize,
    ) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        (**self).read_file_range(path, start, length)
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
    fn fetch_listing(&self) -> Result<Listing, SpaceError> {
        (**self).fetch_listing()
    }
    fn create_folder(&self, path: &str) -> Result<(), SpaceError> {
        (**self).create_folder(path)
    }
    fn delete_folder(&self, path: &str, recursive: bool) -> Result<(), SpaceError> {
        (**self).delete_folder(path, recursive)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_config_from_an_older_server_has_no_folders() {
        let json = serde_json::json!({
            "spaceFolderPath": "/space",
            "spaceName": "Notes",
            "indexPage": "index",
            "readOnly": false,
            "logPush": false,
            "enableClientEncryption": false,
            "shellBackend": "noop",
            "disableServiceWorker": false,
        });
        let config: BootConfig = serde_json::from_value(json).unwrap();
        assert!(!config.folders);
    }

    #[test]
    fn parent_folders_of_a_path() {
        assert_eq!(parent_folders("a/b/c.md").collect::<Vec<_>>(), ["a", "a/b"]);
        assert_eq!(parent_folders("c.md").count(), 0);
    }

    #[test]
    fn a_path_is_in_the_folders_above_it_only() {
        assert!(is_in_folder("a/b/c.md", "a"));
        assert!(is_in_folder("a/b/c.md", "a/b"));
        assert!(is_in_folder("a/b", "a"));
        assert!(!is_in_folder("a/b/c.md", "a/b/c.md"));
        assert!(!is_in_folder("ab/c.md", "a"));
        assert!(!is_in_folder("a", "a"));
    }

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
    fn public_url_keeps_absent_null_and_url_apart() {
        let mut config = BootConfig {
            space_folder_path: "/space".into(),
            space_name: "Notes".into(),
            index_page: "index".into(),
            read_only: false,
            log_push: false,
            enable_client_encryption: false,
            account_managed: false,
            shell_backend: "noop".into(),
            disable_service_worker: false,
            ephemeral_storage: false,
            sync_protocol_version: 2,
            folders: true,
            revisions: RevisionsMode::Disabled,
            public_url: None,
        };
        for (public_url, wire) in [
            (None, None),
            (Some(None), Some(serde_json::Value::Null)),
            (
                Some(Some("https://notes.example.com/".to_string())),
                Some(serde_json::json!("https://notes.example.com/")),
            ),
        ] {
            config.public_url = public_url.clone();
            let json = serde_json::to_value(&config).unwrap();
            assert_eq!(json.get("publicUrl").cloned(), wire);
            let back: BootConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back.public_url, public_url);
        }
    }

    #[test]
    fn space_error_messages() {
        assert_eq!(SpaceError::NotFound.to_string(), "Not found");
        assert_eq!(SpaceError::PathOutsideRoot.to_string(), "Path not in space");
    }
}
