use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use crate::{
    FileStamp, IndexReport, QueryMode, QueryRequest, QueryResult, RelatedRequest, RequestCx,
    SearchError, StatusResponse,
};

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Read access to the files a space actually exposes (no dot paths, ignored
/// files or control files), which index backends read what they index from.
pub trait SpaceView: Send + Sync {
    /// Every file path storage exposes, with its stamp; `None` when listing
    /// failed, so an index never mistakes a failed listing for an empty space.
    fn list_meta(&self) -> Option<HashMap<String, FileStamp>>;
    /// The whole of `path`, or `None` when it is missing or storage hides it.
    fn read(&self, path: &str) -> Option<Vec<u8>>;
}

pub trait SearchBackend: Send + Sync {
    /// Modes public visitors (no account, no write access) may query in; empty
    /// means no search for them. Related pages are never public.
    /// The HTTP layer refuses everything else before admission.
    fn public_modes(&self) -> &[QueryMode];
    /// The mode a query without one runs in: the first of
    /// `status().capabilities.modes`. Cheap: called before every mode-less query.
    fn default_mode(&self) -> QueryMode;
    fn status(&self) -> StatusResponse;
    /// The pages the space's full-text index counts (regular and meta
    /// pages), for the space-size policy of semantic search; while it
    /// builds, at least the total the build reports. `None` when there is no
    /// count (not opened yet, or failing).
    fn pages(&self) -> Option<u64> {
        None
    }
    fn query<'a>(
        &'a self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>>;
    /// Pages related to `req.page`, leaving out the pages named in
    /// `req.exclude` (exact names, no `.md`).
    fn related<'a>(
        &'a self,
        _req: RelatedRequest,
        _cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(async { Err(SearchError::Unsupported("related pages")) })
    }
    /// Each index this backend keeps, for the dashboard. Default: none.
    fn indexes(&self) -> Vec<IndexReport> {
        Vec::new()
    }
    /// Rebuilds every index while queries keep being answered (see each
    /// backend). Idempotent while one runs.
    fn rebuild(&self) -> Result<(), SearchError> {
        Err(SearchError::Unsupported("rebuilding the search index"))
    }
}
