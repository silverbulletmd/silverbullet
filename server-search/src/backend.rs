use std::future::Future;
use std::pin::Pin;

use crate::{
    QueryRequest, QueryResult, RawRequest, RawResult, RequestCx, SearchError, StatusResponse,
};

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Read access to the files a space actually exposes. Backends that search
/// the folder on disk use it to drop anything storage hides (dot paths,
/// ignore rules, control files) and to compute positions.
pub trait SpaceView: Send + Sync {
    /// Every file path storage exposes. Implementations fail closed (empty set) when listing fails.
    fn list(&self) -> std::collections::HashSet<String>;
    /// The first `len` bytes of `path`, or `None` when storage does not expose it.
    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>>;
}

pub trait SearchBackend: Send + Sync {
    /// Whether visitors without an account or write access may search. The
    /// HTTP layer refuses them before admission when this is `false`.
    fn allows_anonymous(&self) -> bool;
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
    /// The backend's native tool, when it has one (ripgrep: rg argv).
    fn raw<'a>(
        &'a self,
        _req: RawRequest,
        _cx: RequestCx,
    ) -> BoxFut<'a, Result<RawResult, SearchError>> {
        Box::pin(async { Err(SearchError::Unsupported("raw search")) })
    }
}
