//! Compile-time-embedded client bundle + `base_fs`, exposed as read-only
//! `SpacePrimitives` so the whole UI ships inside the single static binary.

use std::marker::PhantomData;

use rust_embed::RustEmbed;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};

// Source maps outweigh the code they describe, so release binaries leave them
// out. Debug builds read these folders from disk, maps included, so DevTools
// keeps them in development.

/// The built client web UI (`client_bundle/client`), served at the SPA fallback.
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../client_bundle/client"]
#[cfg_attr(not(debug_assertions), exclude = "*.map")]
pub struct ClientAssets;

/// The bundled default space content (`client_bundle/base_fs`) — a read-only
/// underlay beneath the user's disk files.
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../client_bundle/base_fs"]
#[cfg_attr(not(debug_assertions), exclude = "*.map")]
pub struct BaseFsAssets;

/// A read-only `SpacePrimitives` over a `rust-embed` asset set.
///
/// `PhantomData<fn() -> E>` keeps the marker unconditionally `Send + Sync`
/// (required by `SpacePrimitives`) without imposing those bounds on `E`.
pub struct EmbeddedSpace<E: RustEmbed> {
    _marker: PhantomData<fn() -> E>,
}

impl<E: RustEmbed> EmbeddedSpace<E> {
    pub fn new() -> Self {
        Self {
            _marker: PhantomData,
        }
    }
}

impl<E: RustEmbed> Default for EmbeddedSpace<E> {
    fn default() -> Self {
        Self::new()
    }
}

fn meta_for(path: &str, data_len: usize, last_modified: Option<u64>) -> FileMeta {
    // rust-embed reports seconds; FileMeta and the client sync hash use milliseconds.
    let ts = last_modified.unwrap_or(0) as i64 * 1000;
    FileMeta {
        name: path.to_string(),
        created: ts,
        last_modified: ts,
        content_type: mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string(),
        size: data_len as i64,
        perm: "ro".to_string(),
    }
}

impl<E: RustEmbed> SpacePrimitives for EmbeddedSpace<E> {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        Ok(E::iter()
            .filter_map(|p| self.get_file_meta(&p).ok())
            .collect())
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        let f = E::get(path).ok_or(SpaceError::NotFound)?;
        Ok(meta_for(path, f.data.len(), f.metadata.last_modified()))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        let f = E::get(path).ok_or(SpaceError::NotFound)?;
        let meta = meta_for(path, f.data.len(), f.metadata.last_modified());
        Ok((f.data.into_owned(), meta))
    }

    fn write_file(
        &self,
        path: &str,
        _data: &[u8],
        _meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot write {path}: embedded bundle is read-only"
        )))
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot delete {path}: embedded bundle is read-only"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_bundle_contains_index_html() {
        let space = EmbeddedSpace::<ClientAssets>::new();
        let (data, meta) = space.read_file(".client/index.html").unwrap();
        assert!(!data.is_empty());
        assert!(meta.content_type.contains("html"), "{}", meta.content_type);
    }

    #[test]
    fn missing_file_is_not_found() {
        let space = EmbeddedSpace::<ClientAssets>::new();
        assert!(matches!(
            space.read_file("does/not/exist.xyz"),
            Err(SpaceError::NotFound)
        ));
    }

    #[test]
    fn writes_are_rejected() {
        let space = EmbeddedSpace::<ClientAssets>::new();
        assert!(space.write_file("x", b"y", None).is_err());
    }

    #[test]
    fn file_list_is_nonempty() {
        let space = EmbeddedSpace::<ClientAssets>::new();
        assert!(!space.fetch_file_list().unwrap().is_empty());
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "debug builds read the bundle from disk")]
    fn release_bundles_leave_out_source_maps() {
        assert!(ClientAssets::iter().all(|p| !p.ends_with(".map")));
        assert!(BaseFsAssets::iter().all(|p| !p.ends_with(".map")));
        assert!(ClientAssets::get(".client/client.js").is_some());
    }
}
