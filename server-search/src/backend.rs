use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;

use crate::{QueryMode, QueryRequest, QueryResult, RequestCx, SearchError, StatusResponse};

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What an index backend compares to decide whether a file changed since it
/// was indexed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    /// Last-modified time in milliseconds since the epoch, as storage reports it.
    pub modified: i64,
    pub size: u64,
}

/// Read access to the files a space actually exposes. Backends that search
/// the folder on disk use it to drop anything storage hides (dot paths,
/// ignore rules, control files) and to compute positions; index backends use
/// it to read what they index.
pub trait SpaceView: Send + Sync {
    /// Every file path storage exposes. Implementations fail closed (empty set) when listing fails.
    fn list(&self) -> HashSet<String>;
    /// Every file path storage exposes, with its stamp; `None` when listing
    /// failed, so an index never mistakes a failed listing for an empty space.
    fn list_meta(&self) -> Option<HashMap<String, FileStamp>>;
    /// The first `len` bytes of `path`, or `None` when storage does not expose it.
    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>>;
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
    fn query<'a>(
        &'a self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>>;
    fn related<'a>(
        &'a self,
        _page: String,
        _limit: usize,
        _cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(async { Err(SearchError::Unsupported("related pages")) })
    }
}
