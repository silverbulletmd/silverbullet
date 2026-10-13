//! Which search engine serves a space, and the storage view it searches through.
//! The HTTP layer (`handlers::search`) only ever sees `Arc<dyn SearchBackend>`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use silverbullet_server_common::SpacePrimitives;
use silverbullet_server_search::ripgrep::{discover, Engine, RipgrepBackend};
use silverbullet_server_search::{SearchBackend, SpaceView};

/// Re-exported so embedders can build a gate without depending on the search crate.
pub use silverbullet_server_search::Gate;

/// Exposes what storage exposes: listing and prefix reads go through `SpacePrimitives`.
pub struct SpaceSearchView(pub Arc<dyn SpacePrimitives>);

impl SpaceView for SpaceSearchView {
    /// Fails closed: when the listing fails, nothing counts as visible.
    fn list(&self) -> HashSet<String> {
        match self.0.fetch_file_list() {
            Ok(files) => files.into_iter().map(|f| f.name).collect(),
            Err(error) => {
                tracing::warn!("search: listing the space failed, hiding all files: {error}");
                Default::default()
            }
        }
    }

    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
        self.0
            .read_file_range(path, 0, len)
            .or_else(|_| {
                self.0
                    .read_file(path)
                    .map(|(d, m)| (d[..len.min(d.len())].to_vec(), m))
            })
            .ok()
            .map(|(data, _)| data)
    }
}

/// The one place that decides which engine serves a space (M2 adds semantic here).
pub fn backend_for(folder: &Path, space: Arc<dyn SpacePrimitives>) -> Arc<dyn SearchBackend> {
    let engine = Engine::detect(folder, discover::binary().map(PathBuf::from));
    Arc::new(RipgrepBackend::new(
        folder.to_path_buf(),
        engine,
        Arc::new(SpaceSearchView(space)),
    ))
}

/// Says at startup whether search works: without ripgrep every search
/// endpoint answers "unavailable", which is otherwise easy to miss.
pub fn log_availability() {
    match discover::binary() {
        Some(path) => tracing::info!("Search: using ripgrep at {}", path.display()),
        None => tracing::warn!(
            "ripgrep (rg) not found on PATH or at SB_RIPGREP_PATH: search is disabled. \
             Install ripgrep to enable it, see https://docs.silverbullet.md/Search"
        ),
    }
}
