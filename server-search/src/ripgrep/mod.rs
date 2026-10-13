//! The ripgrep backend: searches the space folder on disk with `rg`, both for
//! structured queries (`query`) and raw passthrough (`raw`). Every rg process
//! goes through `RipgrepBackend::rg`, which applies the enforced arguments.

pub mod args;
pub mod discover;
pub mod exec;
pub mod limits;
mod query;
pub mod rank;
mod raw;
#[cfg(test)]
pub(super) mod test_support;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::backend::{BoxFut, SearchBackend, SpaceView};
use crate::{
    Capabilities, QueryMode, QueryRequest, QueryResult, RawRequest, RawResult, RequestCx,
    SearchError, StatusResponse,
};

const ID: &str = "ripgrep";

/// The modes structured queries support; the first is the default.
const MODES: [QueryMode; 3] = [QueryMode::Words, QueryMode::Phrase, QueryMode::Regex];

/// Whether searching can work at all: a ripgrep binary and a space on disk.
pub enum Engine {
    Ready(PathBuf),
    Unavailable(String),
}

impl Engine {
    pub fn detect(root: &Path, binary: Option<PathBuf>) -> Engine {
        if !root.is_dir() {
            return Engine::Unavailable("Search needs a space stored on disk".into());
        }
        match binary {
            Some(binary) => Engine::Ready(binary),
            None => Engine::Unavailable("ripgrep (rg) is not installed on the server".into()),
        }
    }
}

pub struct RipgrepBackend {
    root: PathBuf,
    engine: Engine,
    view: Arc<dyn SpaceView>,
}

impl RipgrepBackend {
    pub fn new(root: PathBuf, engine: Engine, view: Arc<dyn SpaceView>) -> Self {
        Self { root, engine, view }
    }

    fn check_available(&self) -> Result<&Path, SearchError> {
        match &self.engine {
            Engine::Ready(binary) => Ok(binary),
            Engine::Unavailable(reason) => Err(SearchError::Unavailable(reason.clone())),
        }
    }

    async fn rg(
        &self,
        args: &[String],
        stdin: Option<Vec<u8>>,
        cx: &RequestCx,
    ) -> Result<exec::ExecOutput, SearchError> {
        let binary = self.check_available()?;
        exec::run(binary, &self.root, args, stdin, cx).await
    }
}

impl SearchBackend for RipgrepBackend {
    /// Every query costs an rg process, too much to offer to anyone on the internet.
    fn allows_anonymous(&self) -> bool {
        false
    }

    fn status(&self) -> StatusResponse {
        let reason = match &self.engine {
            Engine::Ready(_) => None,
            Engine::Unavailable(reason) => Some(reason.clone()),
        };
        let available = reason.is_none();
        StatusResponse {
            backend: available.then(|| ID.to_string()),
            model: None,
            capabilities: Capabilities {
                modes: MODES.to_vec(),
                related: false,
            },
            ready: available,
            progress: None,
            reason,
        }
    }

    fn query<'a>(
        &'a self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(self.run_query(req, cx))
    }

    fn raw<'a>(
        &'a self,
        req: RawRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<RawResult, SearchError>> {
        Box::pin(self.run_raw(req, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_detect_reports_why_search_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let reason = |e: Engine| match e {
            Engine::Unavailable(r) => r,
            Engine::Ready(_) => panic!("expected unavailable"),
        };
        assert_eq!(
            reason(Engine::detect(
                &dir.path().join("missing"),
                Some("rg".into())
            )),
            "Search needs a space stored on disk"
        );
        assert_eq!(
            reason(Engine::detect(dir.path(), None)),
            "ripgrep (rg) is not installed on the server"
        );
        assert!(matches!(
            Engine::detect(dir.path(), Some("rg".into())),
            Engine::Ready(_)
        ));
    }
}
