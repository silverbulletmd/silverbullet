//! `/.search/*`: the space's search backend over HTTP. Errors are 4xx JSON
//! because the client treats any 5xx as being offline.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Extension, FromRequest, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use silverbullet_server_search::{
    limits, Admission, Capabilities, QueryMode, QueryRequest, QueryResult, RequestCx, SearchError,
    StatusResponse,
};

use crate::auth::{AccessLevel, Actor};
use crate::state::ServerState;

/// The search endpoints, with their body limit and rejection counting.
/// `state` feeds the counting layer; the router supplies it to handlers.
pub fn routes(state: &Arc<ServerState>) -> Router<Arc<ServerState>> {
    Router::new()
        .route("/.search/status", get(handle_status))
        .route("/.search/query", post(handle_query))
        .route("/.search/related", post(handle_related))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::map_response_with_state(
            state.clone(),
            count_rejections,
        ))
}

async fn count_rejections(State(state): State<Arc<ServerState>>, response: Response) -> Response {
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        if let Some(m) = state.metrics.as_ref() {
            m.search_rejections.inc();
        }
    }
    response
}

/// Search POSTs only read the space.
pub(crate) fn is_read_post(path: &str) -> bool {
    matches!(path, "/.search/query" | "/.search/related")
}

/// Every search endpoint refuses cross-origin cookie requests, reads included.
pub(crate) fn needs_same_origin(path: &str) -> bool {
    path.starts_with("/.search/")
}

/// A JSON body that, when it doesn't parse (a mode the backend doesn't have,
/// an unknown field), is refused as `400 invalid` like any other bad query,
/// not with axum's plain-text 422.
pub struct SearchJson<T>(pub T);

impl<T, S> FromRequest<S> for SearchJson<T>
where
    T: serde::de::DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = SearchFailure;

    async fn from_request(req: Request, state: &S) -> Result<Self, SearchFailure> {
        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(|_| SearchError::Invalid("Search request body is too large".into()))?;
        serde_json::from_slice(&bytes)
            .map(SearchJson)
            .map_err(|e| SearchError::Invalid(format!("Invalid search request: {e}")).into())
    }
}

pub struct SearchFailure(pub SearchError);

impl From<SearchError> for SearchFailure {
    fn from(error: SearchError) -> Self {
        Self(error)
    }
}

impl IntoResponse for SearchFailure {
    fn into_response(self) -> Response {
        let error = self.0;
        let status = match &error {
            SearchError::Invalid(_)
            | SearchError::QueryTooShort(_)
            | SearchError::Unsupported(_) => StatusCode::BAD_REQUEST,
            SearchError::Unavailable(_) => StatusCode::NOT_FOUND,
            SearchError::Cancelled => StatusCode::CONFLICT,
            SearchError::Busy => StatusCode::TOO_MANY_REQUESTS,
            SearchError::Failed(_) => StatusCode::UNPROCESSABLE_ENTITY,
        };
        let body = Json(serde_json::json!({"error": error.code(), "message": error.to_string()}));
        match error {
            SearchError::Busy => (status, [("retry-after", "1")], body).into_response(),
            _ => (status, body).into_response(),
        }
    }
}

fn search_client(headers: &HeaderMap) -> String {
    headers
        .get("x-search-client")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(64)
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Route {
    Query,
    Related,
}

fn admission<'a>(
    state: &'a ServerState,
    actor: &'a Actor,
    tab: &'a str,
    route: Route,
) -> Admission<'a> {
    Admission {
        space: &state.space_folder_path,
        user: actor.username.as_deref(),
        writer: actor.level == AccessLevel::Write,
        tab,
        // Only a tab's interactive search supersedes its previous one; scripts and
        // widgets running related searches in parallel must not cancel each other.
        supersede: route == Route::Query && !tab.is_empty(),
        deadline: limits::DEADLINE,
    }
}

const PUBLIC_VISITORS: &str = "Search isn't available to public visitors";

/// A caller with no identity (no username) and no real write access. Write
/// without a username comes either from a bearer token (an authenticated
/// client, not a visitor) or from an open server's default grant (or a
/// headless/runtime cookie on it). On a space that is open to anonymous readers
/// but not to anonymous writers (a single-user server without auth that is
/// read-only), such Write is treated as a visitor's. `state.authorizer` cannot
/// tell these apart, because every instance wraps its authorizer, even an
/// absent one, so it is never `None`.
fn is_public_visitor(state: &ServerState, actor: &Actor) -> bool {
    let open_read_only = state.anonymous_readable && !state.anonymous_writable;
    actor.username.is_none() && (actor.level < AccessLevel::Write || open_read_only)
}

/// Refuses public visitors before admission. A query passes only in one of the backend's `public_modes()`: its
/// `mode` is the one it will run in (`handle_query` resolves a missing one to
/// the backend's default first). Related pages never pass.
fn refuse_public_visitors(
    state: &ServerState,
    actor: &Actor,
    route: Route,
    mode: Option<QueryMode>,
) -> Result<(), SearchError> {
    if !is_public_visitor(state, actor) {
        return Ok(());
    }
    let allowed = route == Route::Query
        && mode.is_some_and(|mode| state.search.public_modes().contains(&mode));
    if allowed {
        Ok(())
    } else {
        Err(SearchError::Unavailable(PUBLIC_VISITORS.into()))
    }
}

fn admit(
    state: &ServerState,
    actor: &Actor,
    headers: &HeaderMap,
    route: Route,
) -> Result<RequestCx, SearchError> {
    let tab = search_client(headers);
    state
        .search_gate
        .admit(admission(state, actor, &tab, route))
}

/// Public visitors see only the modes they may use, and no related pages;
/// with none, search reads as unavailable to them.
pub async fn handle_status(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
) -> Json<StatusResponse> {
    if !is_public_visitor(&state, &actor) {
        return Json(state.search.status());
    }
    let public = state.search.public_modes();
    if public.is_empty() {
        return Json(StatusResponse {
            backend: None,
            model: None,
            capabilities: Capabilities {
                modes: vec![],
                related: false,
            },
            ready: false,
            progress: None,
            reason: Some(PUBLIC_VISITORS.into()),
        });
    }
    let mut status = state.search.status();
    status
        .capabilities
        .modes
        .retain(|mode| public.contains(mode));
    status.capabilities.related = false;
    Json(status)
}

pub async fn handle_query(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    SearchJson(mut req): SearchJson<QueryRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    // Resolved once, so the mode checked here is the mode the backend runs.
    let mode = req.mode.unwrap_or_else(|| state.search.default_mode());
    req.mode = Some(mode);
    refuse_public_visitors(&state, &actor, Route::Query, Some(mode))?;
    let cx = admit(&state, &actor, &headers, Route::Query)?;
    if let Some(m) = state.metrics.as_ref() {
        m.search_queries.inc();
    }
    let result = state.search.query(req, cx).await?;
    if let Some(m) = state.metrics.as_ref() {
        if result.partial {
            m.search_partial.inc();
        }
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelatedRequest {
    page: String,
    #[serde(default)]
    limit: Option<usize>,
}

pub async fn handle_related(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    SearchJson(req): SearchJson<RelatedRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    refuse_public_visitors(&state, &actor, Route::Related, None)?;
    let cx = admit(&state, &actor, &headers, Route::Related)?;
    let result = state
        .search
        .related(req.page, req.limit.unwrap_or(10), cx)
        .await?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use crate::auth::{AccessLevel, AuthContext, AuthOutcome, RequestAuthorizer};
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use silverbullet_server_common::space::DiskSpacePrimitives;
    use silverbullet_server_search::{
        BoxFut, Capabilities, Match, QueryMode, QueryRequest, QueryResult, RequestCx,
        SearchBackend, SearchError, StatusResponse,
    };
    use std::sync::Arc;
    use tower::ServiceExt;

    struct Grant(Option<AccessLevel>, Option<&'static str>);
    impl RequestAuthorizer for Grant {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            let mut outcome = AuthOutcome::anonymous();
            outcome.grant = self.0;
            outcome.username = self.1.map(String::from);
            Some(outcome)
        }
    }

    async fn disk_state(dir: &std::path::Path, grant: Grant) -> Arc<crate::ServerState> {
        Arc::new(ignoring_state(dir, "", grant).await)
    }

    /// A space on disk searched through the real full-text backend (in RAM),
    /// returned once its first build finished.
    async fn ignoring_state(
        dir: &std::path::Path,
        ignore: &str,
        grant: Grant,
    ) -> crate::ServerState {
        let mut state = test_state();
        let folder = dir.to_string_lossy().to_string();
        let disk = DiskSpacePrimitives::new(&folder, ignore).unwrap();
        let matcher = disk.gitignore_matcher();
        state.space = Arc::new(disk);
        state.search = crate::search::backend_for(
            "test",
            state.space.clone(),
            matcher,
            crate::search::Location::Memory,
            None,
        );
        state.space_folder_path = folder.clone();
        state.boot_config.space_folder_path = folder;
        state.authorizer = Some(Arc::new(grant));
        wait_ready(&state).await;
        state
    }

    async fn wait_ready(state: &crate::ServerState) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !state.search.status().ready {
            assert!(
                std::time::Instant::now() < deadline,
                "the index never became ready: {:?}",
                state.search.status()
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    /// Answers every request with fixed results, so dispatch is observable.
    struct Stub {
        query: fn() -> Result<QueryResult, SearchError>,
        /// What `status` lists; the first is the default mode.
        modes: &'static [QueryMode],
        public: &'static [QueryMode],
        related: bool,
    }

    impl Stub {
        fn new(query: fn() -> Result<QueryResult, SearchError>) -> Self {
            Self {
                query,
                modes: &[QueryMode::Words],
                public: &[],
                related: false,
            }
        }

        /// Words and Phrase, with related pages; public visitors get `public`.
        fn indexed(public: &'static [QueryMode]) -> Self {
            Self {
                query: one_match,
                modes: &[QueryMode::Words, QueryMode::Phrase],
                public,
                related: true,
            }
        }
    }

    impl SearchBackend for Stub {
        fn public_modes(&self) -> &[QueryMode] {
            self.public
        }

        fn default_mode(&self) -> QueryMode {
            self.modes[0]
        }

        fn status(&self) -> StatusResponse {
            StatusResponse {
                backend: Some("stub".into()),
                model: None,
                capabilities: Capabilities {
                    modes: self.modes.to_vec(),
                    related: self.related,
                },
                ready: true,
                progress: None,
                reason: None,
            }
        }

        fn query<'a>(
            &'a self,
            _req: QueryRequest,
            _cx: RequestCx,
        ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
            let result = (self.query)();
            Box::pin(async move { result })
        }

        fn related<'a>(
            &'a self,
            _page: String,
            _limit: usize,
            _cx: RequestCx,
        ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
            let result = one_match();
            Box::pin(async move { result })
        }
    }

    fn stub_state(
        user: &'static str,
        query: fn() -> Result<QueryResult, SearchError>,
    ) -> Arc<crate::ServerState> {
        let mut state = test_state();
        state.search = Arc::new(Stub::new(query));
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Write), Some(user))));
        state.metrics = Some(Arc::new(crate::metrics::Metrics::new()));
        Arc::new(state)
    }

    fn one_match() -> Result<QueryResult, SearchError> {
        Ok(QueryResult {
            items: vec![Match {
                page: "Stub Page".into(),
                pos: 0,
                line: 1,
                heading: None,
                excerpt: "stub".into(),
                highlights: vec![],
            }],
            total: 1,
            partial: false,
            notice: None,
        })
    }

    async fn call(
        state: Arc<crate::ServerState>,
        method: Method,
        path: &str,
        body: &str,
    ) -> (StatusCode, serde_json::Value) {
        let (status, _, body) = call_with_headers(state, method, path, body).await;
        (status, body)
    }

    async fn call_with_headers(
        state: Arc<crate::ServerState>,
        method: Method,
        path: &str,
        body: &str,
    ) -> (StatusCode, axum::http::HeaderMap, serde_json::Value) {
        let req = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .header("x-search-client", "tab-1")
            .body(Body::from(body.to_string()))
            .unwrap();
        let res = crate::build_router(state).oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            headers,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn queries_dispatch_through_the_states_backend() {
        let state = stub_state("stub-query-writer", one_match);
        let (status, body) = call(state, Method::POST, "/.search/query", r#"{"query":"x"}"#).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Stub Page");
    }

    #[tokio::test]
    async fn busy_backends_answer_429_and_count_the_rejection() {
        let state = stub_state("stub-busy-writer", || Err(SearchError::Busy));
        let (status, headers, body) = call_with_headers(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"x"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
        assert_eq!(headers["retry-after"], "1");
        assert_eq!(body["error"], "busy");
        assert_eq!(state.metrics.as_ref().unwrap().search_rejections.get(), 1);
    }

    /// Storage that panics on reads once `armed`, with a path in the message.
    struct PanickingReads {
        inner: silverbullet_server_common::space::MemorySpacePrimitives,
        armed: std::sync::atomic::AtomicBool,
    }

    impl silverbullet_server_common::SpacePrimitives for PanickingReads {
        fn fetch_file_list(
            &self,
        ) -> Result<Vec<silverbullet_server_common::FileMeta>, silverbullet_server_common::SpaceError>
        {
            self.inner.fetch_file_list()
        }
        fn get_file_meta(
            &self,
            path: &str,
        ) -> Result<silverbullet_server_common::FileMeta, silverbullet_server_common::SpaceError>
        {
            self.inner.get_file_meta(path)
        }
        fn read_file(
            &self,
            path: &str,
        ) -> Result<
            (Vec<u8>, silverbullet_server_common::FileMeta),
            silverbullet_server_common::SpaceError,
        > {
            if self.armed.load(std::sync::atomic::Ordering::SeqCst) {
                panic!("can't read /srv/private-data/spaces/{path}");
            }
            self.inner.read_file(path)
        }
        fn write_file(
            &self,
            path: &str,
            data: &[u8],
            meta: Option<&silverbullet_server_common::FileMeta>,
        ) -> Result<silverbullet_server_common::FileMeta, silverbullet_server_common::SpaceError>
        {
            self.inner.write_file(path, data, meta)
        }
        fn delete_file(&self, path: &str) -> Result<(), silverbullet_server_common::SpaceError> {
            self.inner.delete_file(path)
        }
    }

    #[tokio::test]
    async fn a_failed_search_names_no_file_or_folder() {
        use silverbullet_server_common::SpacePrimitives;
        let inner = silverbullet_server_common::space::MemorySpacePrimitives::new();
        inner.write_file("Fern.md", b"fern fronds\n", None).unwrap();
        let space = Arc::new(PanickingReads {
            inner,
            armed: Default::default(),
        });
        let mut state = test_state();
        state.space = space.clone();
        state.search = crate::search::backend_for(
            "test",
            space.clone(),
            Default::default(),
            crate::search::Location::Memory,
            None,
        );
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Write), Some("writer"))));
        wait_ready(&state).await;
        space.armed.store(true, std::sync::atomic::Ordering::SeqCst);
        let (status, body) = call(
            Arc::new(state),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["error"], "failed", "{body}");
        let text = body.to_string();
        for leak in ["/srv", "private-data", "Fern.md", "panic"] {
            assert!(!text.contains(leak), "{leak} in {text}");
        }
    }

    #[tokio::test]
    async fn status_is_readable_and_reports_the_full_text_index() {
        let dir = tempfile::tempdir().unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader"))).await;
        let (status, body) = call(state, Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["capabilities"],
            serde_json::json!({"modes": ["words", "phrase"], "related": false})
        );
        assert_eq!(body["backend"], "fulltext");
        assert_eq!(body["ready"], true);
    }

    #[tokio::test]
    async fn readers_can_query() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader"))).await;
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Fern");
    }

    #[tokio::test]
    async fn queries_accept_a_scope() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        std::fs::write(
            dir.path().join("Fern template.md"),
            "---\ntags: template\n---\nfern log\n",
        )
        .unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader"))).await;
        for (scope, page) in [("pages", "Fern"), ("meta", "Fern template")] {
            let (status, body) = call(
                state.clone(),
                Method::POST,
                "/.search/query",
                &format!(r#"{{"query":"fern","scope":"{scope}"}}"#),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["total"], 1, "{scope}: {body}");
            assert_eq!(body["items"][0]["page"], page, "{scope}: {body}");
        }
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/query",
            r#"{"query":"fern","scope":"all"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["total"], 2, "{body}");
    }

    #[tokio::test]
    async fn the_rg_route_is_gone_and_regex_is_an_invalid_mode() {
        let dir = fern_space();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Write), Some("writer"))).await;
        let (status, _) = call(
            state.clone(),
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        // No handler any more: a POST to an unrouted path hits the GET-only client-bundle fallback.
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/query",
            r#"{"query":"fern","mode":"regex"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"], "invalid", "{body}");
    }

    #[tokio::test]
    async fn errors_are_typed_and_never_5xx() {
        let dir = tempfile::tempdir().unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Write), Some("writer"))).await;
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"x"}"#,
        )
        .await;
        assert!(status.is_client_error(), "{status}");
        assert!(body["error"].is_string());
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/related",
            r#"{"page":"A"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "unsupported");
        let (status, _) = call(
            state,
            Method::POST,
            "/.search/query",
            r#"{"query":"fern","scope":"x"}"#,
        )
        .await;
        assert!(status.is_client_error());
    }

    #[tokio::test]
    async fn client_encrypted_spaces_still_search_server_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut state =
            ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Write), Some("w"))).await;
        state.boot_config.enable_client_encryption = true;
        let (status, body) = call(Arc::new(state), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backend"], "fulltext");
    }

    #[tokio::test]
    async fn space_ignored_pages_never_appear() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("private")).unwrap();
        std::fs::write(dir.path().join("private/Payroll.md"), "quartz salary\n").unwrap();
        std::fs::write(dir.path().join("Notes.md"), "quartz notes\n").unwrap();
        let state = ignoring_state(
            dir.path(),
            "private/",
            Grant(Some(AccessLevel::Read), Some("reader")),
        )
        .await;
        let (status, body) = call(
            Arc::new(state),
            Method::POST,
            "/.search/query",
            r#"{"query":"quartz"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["total"], 1, "{body}");
        assert_eq!(body["items"][0]["page"], "Notes");
    }

    const PUBLIC: &str = "Search isn't available to public visitors";

    /// A public visitor of a space with `Fern.md`, searched by the real
    /// backend: Words and Phrase find it, everything else is refused, and the
    /// status lists only Words and Phrase.
    async fn assert_public_search(state: Arc<crate::ServerState>) {
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backend"], "fulltext", "{body}");
        assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
        assert_eq!(
            body["capabilities"],
            serde_json::json!({"modes": ["words", "phrase"], "related": false})
        );
        for req in [
            r#"{"query":"fern"}"#,
            r#"{"query":"fern","mode":"words"}"#,
            r#"{"query":"fern fronds","mode":"phrase"}"#,
        ] {
            let (status, body) = call(state.clone(), Method::POST, "/.search/query", req).await;
            assert_eq!(status, StatusCode::OK, "{req}: {body}");
            assert_eq!(body["items"][0]["page"], "Fern", "{req}: {body}");
        }
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern","mode":"regex"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"], "invalid", "{body}");
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/related",
            r#"{"page":"Fern"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
        assert_eq!(
            body,
            serde_json::json!({"error": "unavailable", "message": PUBLIC})
        );
    }

    fn fern_space() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        dir
    }

    #[tokio::test]
    async fn public_visitors_of_a_published_space_search_words_and_phrases() {
        let dir = fern_space();
        let mut state = ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Read), None)).await;
        state.anonymous_readable = true;
        assert_public_search(Arc::new(state)).await;
    }

    #[tokio::test]
    async fn a_forged_client_id_or_bare_cookie_is_still_a_public_visitor() {
        let dir = fern_space();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), None)).await;
        for (client, cookie) in [
            ("tab-1", None),
            ("writer-tab-0000", None),
            ("", Some("auth_localhost=forged")),
        ] {
            let mut req = Request::builder()
                .method(Method::POST)
                .uri("/.search/related")
                .header("content-type", "application/json")
                .header("x-search-client", client)
                .header("sec-fetch-site", "same-origin");
            if let Some(cookie) = cookie {
                req = req.header("cookie", cookie);
            }
            let res = crate::build_router(state.clone())
                .oneshot(req.body(Body::from(r#"{"page":"Fern"}"#)).unwrap())
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::NOT_FOUND, "{client} {cookie:?}");
            let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["message"], PUBLIC);
        }
    }

    #[tokio::test]
    async fn signed_in_readers_of_a_published_space_still_search() {
        let dir = fern_space();
        let mut state = ignoring_state(
            dir.path(),
            "",
            Grant(Some(AccessLevel::Read), Some("reader")),
        )
        .await;
        state.anonymous_readable = true;
        let state = Arc::new(state);
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
        let (status, body) =
            call(state, Method::POST, "/.search/query", r#"{"query":"fern"}"#).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Fern");
    }

    /// A single-user server without auth, flagged the way `multi::instance` flags it.
    async fn open_single_user(dir: &std::path::Path, read_only: bool) -> crate::ServerState {
        let mut state = ignoring_state(dir, "", Grant(None, None)).await;
        state.authorizer = None;
        state.anonymous_readable = true;
        state.anonymous_writable = !read_only;
        state.boot_config.read_only = read_only;
        state
    }

    #[tokio::test]
    async fn a_single_user_server_without_auth_searches_and_read_only_ones_publicly() {
        let dir = fern_space();
        let state = Arc::new(open_single_user(dir.path(), false).await);
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Fern");
        // `SB_READ_ONLY` without auth (the docs site): visitors search publicly.
        let state = Arc::new(open_single_user(dir.path(), true).await);
        assert_public_search(state).await;
    }

    #[tokio::test]
    async fn a_token_caller_on_a_read_only_server_with_auth_still_searches() {
        // An `SB_AUTH_TOKEN` bearer: trusted, so Write without a username.
        let dir = fern_space();
        let mut state = ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Write), None)).await;
        state.boot_config.read_only = true;
        let state = Arc::new(state);
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Fern");
    }

    fn public_stub_state(stub: Stub) -> Arc<crate::ServerState> {
        let mut state = test_state();
        state.search = Arc::new(stub);
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Read), None)));
        Arc::new(state)
    }

    #[tokio::test]
    async fn public_visitors_see_only_the_backends_public_modes() {
        let state = public_stub_state(Stub::indexed(&[QueryMode::Words, QueryMode::Phrase]));
        let (status, body) = call(state, Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backend"], "stub");
        assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
        assert_eq!(
            body["capabilities"],
            serde_json::json!({"modes": ["words", "phrase"], "related": false})
        );
    }

    #[tokio::test]
    async fn signed_in_readers_see_every_mode() {
        let mut state = test_state();
        state.search = Arc::new(Stub::indexed(&[QueryMode::Words, QueryMode::Phrase]));
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Read), Some("reader"))));
        let (status, body) = call(Arc::new(state), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["capabilities"],
            serde_json::json!({"modes": ["words", "phrase"], "related": true})
        );
    }

    #[tokio::test]
    async fn public_visitors_query_only_in_public_modes() {
        let state = public_stub_state(Stub::indexed(&[QueryMode::Words, QueryMode::Phrase]));
        for req in [
            r#"{"query":"x"}"#,
            r#"{"query":"x","mode":"words"}"#,
            r#"{"query":"x","mode":"phrase"}"#,
        ] {
            let (status, body) = call(state.clone(), Method::POST, "/.search/query", req).await;
            assert_eq!(status, StatusCode::OK, "{req}: {body}");
            assert_eq!(body["items"][0]["page"], "Stub Page");
        }
        for (path, req) in [
            ("/.search/query", r#"{"query":"x","mode":"natural"}"#),
            ("/.search/related", r#"{"page":"Fern"}"#),
        ] {
            let (status, body) = call(state.clone(), Method::POST, path, req).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{path} {req}: {body}");
            assert_eq!(
                body,
                serde_json::json!({"error": "unavailable", "message": PUBLIC}),
                "{path} {req}"
            );
        }
    }

    #[tokio::test]
    async fn a_mode_less_public_query_is_checked_in_the_backends_default_mode() {
        let state = public_stub_state(Stub {
            modes: &[QueryMode::Phrase, QueryMode::Words],
            ..Stub::indexed(&[QueryMode::Words])
        });
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"x"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
        assert_eq!(body["error"], "unavailable");
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/query",
            r#"{"query":"x","mode":"words"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    fn actor(level: AccessLevel, username: Option<&str>) -> crate::auth::Actor {
        crate::auth::Actor {
            username: username.map(String::from),
            credential_version: None,
            full_name: None,
            email: None,
            level,
        }
    }

    #[test]
    fn admission_maps_the_actor_route_and_tab() {
        use super::{admission, Route};
        use silverbullet_server_search::limits;
        let state = test_state();
        let writer = actor(AccessLevel::Write, Some("w"));
        let a = admission(&state, &writer, "tab-1", Route::Query);
        assert_eq!(a.space, state.space_folder_path);
        assert_eq!((a.user, a.writer), (Some("w"), true));
        assert!(a.supersede);
        let signed_out = actor(AccessLevel::Write, None);
        let a = admission(&state, &signed_out, "", Route::Query);
        assert_eq!((a.user, a.writer), (None, true));
        assert!(!a.supersede);
        let reader = actor(AccessLevel::Read, Some("r"));
        let a = admission(&state, &reader, "", Route::Query);
        assert_eq!((a.user, a.writer), (Some("r"), false));
        let deadline = |route| admission(&state, &writer, "tab-1", route).deadline;
        assert_eq!(deadline(Route::Query), limits::DEADLINE);
        assert_eq!(deadline(Route::Related), limits::DEADLINE);
    }

    #[test]
    fn only_a_tabs_queries_supersede_each_other() {
        use super::{admission, Route};
        let state = test_state();
        let actor = actor(AccessLevel::Write, Some("supersede-writer"));
        let admit = |route, tab| {
            state
                .search_gate
                .admit(admission(&state, &actor, tab, route))
                .unwrap()
        };

        let first = admit(Route::Query, "tab-supersede");
        let related = admit(Route::Related, "tab-supersede");
        let headerless = admit(Route::Query, "");
        let _later = [
            admit(Route::Related, "tab-supersede"),
            admit(Route::Query, ""),
        ];
        assert!(
            !first.cancel.is_cancelled(),
            "related/headerless never supersede"
        );
        let _newer = admit(Route::Query, "tab-supersede");
        assert!(first.cancel.is_cancelled());
        assert!(!related.cancel.is_cancelled());
        assert!(!headerless.cancel.is_cancelled());
    }

    #[test]
    fn search_posts_are_read_level() {
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.search/query"),
            AccessLevel::Read
        );
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.search/related"),
            AccessLevel::Read
        );
    }

    #[test]
    fn cookie_search_posts_must_be_same_origin() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("cookie", "auth_example=1".parse().unwrap());
        headers.insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert!(crate::router::cross_origin_refused(
            &headers,
            &Method::POST,
            "/.search/query"
        ));
        headers.insert("sec-fetch-site", "same-origin".parse().unwrap());
        assert!(!crate::router::cross_origin_refused(
            &headers,
            &Method::POST,
            "/.search/query"
        ));
    }
}
