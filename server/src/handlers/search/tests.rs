use crate::auth::{AccessLevel, AuthContext, AuthOutcome, RequestAuthorizer};
use crate::test_support::test_state;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use silverbullet_server_common::space::DiskSpacePrimitives;
use silverbullet_server_search::{
    BoxFut, Capabilities, Match, QueryMode, QueryRequest, QueryResult, RelatedRequest, RequestCx,
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
async fn ignoring_state(dir: &std::path::Path, ignore: &str, grant: Grant) -> crate::ServerState {
    let mut state = test_state();
    let folder = dir.to_string_lossy().to_string();
    let disk = DiskSpacePrimitives::new(&folder, ignore).unwrap();
    let matcher = disk.gitignore_matcher();
    state.space = Arc::new(disk);
    state.search = crate::search::full_text_backend(
        "test",
        state.space.clone(),
        matcher,
        crate::search::Location::Memory,
        tokio::sync::broadcast::channel(1).1,
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
    /// The modes queries ran in, in order.
    seen: std::sync::Mutex<Vec<QueryMode>>,
}

impl Stub {
    fn new(query: fn() -> Result<QueryResult, SearchError>) -> Self {
        Self {
            query,
            modes: &[QueryMode::Words],
            public: &[],
            related: false,
            seen: Default::default(),
        }
    }

    /// Words and Phrase, with related pages; public visitors get `public`.
    fn indexed(public: &'static [QueryMode]) -> Self {
        Self {
            query: one_match,
            modes: &[QueryMode::Words, QueryMode::Phrase],
            public,
            related: true,
            seen: Default::default(),
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
        req: QueryRequest,
        _cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        self.seen.lock().unwrap().extend(req.mode);
        let result = (self.query)();
        Box::pin(async move { result })
    }

    fn related<'a>(
        &'a self,
        _req: RelatedRequest,
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
    ) -> Result<silverbullet_server_common::FileMeta, silverbullet_server_common::SpaceError> {
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
    ) -> Result<silverbullet_server_common::FileMeta, silverbullet_server_common::SpaceError> {
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
    state.search = crate::search::in_memory_full_text(space.clone()).0;
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
        r#"{"page":"A","exclude":["B"]}"#,
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
    let (status, body) = call(state, Method::POST, "/.search/query", r#"{"query":"fern"}"#).await;
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
        ("/.search/related", r#"{"page":"Fern","exclude":["Index"]}"#),
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

/// Review Focus 2 (the HTTP half): on a semantic space that is still
/// building, Natural is the default but not public, so a visitor's
/// mode-less query runs in Words; a signed-in reader's runs in Natural.
#[tokio::test]
async fn a_mode_less_public_query_runs_in_the_first_public_mode() {
    let stub = Arc::new(Stub {
        modes: &[QueryMode::Natural, QueryMode::Words],
        ..Stub::indexed(&[QueryMode::Words])
    });
    for (user, expected) in [
        (None, QueryMode::Words),
        (Some("reader"), QueryMode::Natural),
    ] {
        let mut state = test_state();
        state.search = stub.clone();
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Read), user)));
        let state = Arc::new(state);
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"x"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{user:?}: {body}");
        assert_eq!(stub.seen.lock().unwrap().pop(), Some(expected), "{user:?}");
    }
    let state = public_stub_state(Stub {
        modes: &[QueryMode::Natural, QueryMode::Words],
        ..Stub::indexed(&[QueryMode::Words])
    });
    let (status, body) = call(
        state,
        Method::POST,
        "/.search/query",
        r#"{"query":"x","mode":"natural"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

/// Review Focus 2: a visitor always gets Words and Phrase, and Natural
/// only once the backend lists it as public (a ready semantic index).
/// A refused Natural query never reaches the backend, so it never takes
/// a place in the semantic query queue.
#[tokio::test]
async fn a_public_visitor_gets_natural_only_once_it_is_public() {
    const BUILDING: &[QueryMode] = &[QueryMode::Words, QueryMode::Phrase];
    const READY: &[QueryMode] = &[QueryMode::Natural, QueryMode::Words, QueryMode::Phrase];
    for (public, natural) in [(BUILDING, StatusCode::NOT_FOUND), (READY, StatusCode::OK)] {
        let stub = Arc::new(Stub {
            modes: READY,
            ..Stub::indexed(public)
        });
        let mut state = test_state();
        state.search = stub.clone();
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Read), None)));
        let state = Arc::new(state);
        for (mode, expected) in [
            ("words", StatusCode::OK),
            ("phrase", StatusCode::OK),
            ("natural", natural),
        ] {
            let req = format!(r#"{{"query":"x","mode":"{mode}"}}"#);
            let (status, body) = call(state.clone(), Method::POST, "/.search/query", &req).await;
            assert_eq!(status, expected, "{public:?} {mode}: {body}");
        }
        let ran = stub.seen.lock().unwrap().clone();
        assert_eq!(
            ran.contains(&QueryMode::Natural),
            natural == StatusCode::OK,
            "{public:?}: {ran:?}"
        );
    }
}

/// A space on disk searched through a real `SemanticBackend` (in RAM,
/// with the fake embedder), returned once both its indexes are ready.
async fn semantic_state(dir: &std::path::Path, grant: Grant) -> crate::ServerState {
    use silverbullet_server_search::semantic::test_model::FakeEmbedder;
    use silverbullet_server_search::semantic::SemanticService;
    let mut state = test_state();
    let folder = dir.to_string_lossy().to_string();
    let disk = DiskSpacePrimitives::new(&folder, "").unwrap();
    let matcher = disk.gitignore_matcher();
    state.space = Arc::new(disk);
    let service = SemanticService::with_embedder(Arc::new(FakeEmbedder::new()));
    state.search = crate::search::engine(
        "test",
        state.space.clone(),
        matcher,
        crate::search::Location::Memory,
        tokio::sync::broadcast::channel(1).1,
        Some((service.clone(), "test")),
    );
    state.space_folder_path = folder.clone();
    state.boot_config.space_folder_path = folder;
    state.authorizer = Some(Arc::new(grant));
    wait_ready(&state).await;
    state
}

/// No page has the query word "clinking" or one close to it, so the
/// full-text index finds nothing; the fake embedder hashes it to the
/// same dimension as "chain", so meaning finds `Chain`.
fn bike_space() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("Chain.md"),
        "# Chain\nOil the chain after rain.\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("Coffee.md"),
        "# Coffee\nGrind the beans fresh.\n",
    )
    .unwrap();
    dir
}

/// Whether `body`'s first match came from the semantic half: a page
/// found by meaning alone has a chunk passage without highlights.
fn found_by_meaning(body: &serde_json::Value) -> bool {
    body["items"][0]["page"] == "Chain" && body["items"][0]["highlights"] == serde_json::json!([])
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_semantic_space_answers_natural_queries_over_http() {
    let dir = bike_space();
    let state =
        Arc::new(semantic_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader"))).await);
    let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["backend"], "semantic", "{body}");
    assert_eq!(body["model"], "test-fake", "{body}");
    assert_eq!(
        body["capabilities"],
        serde_json::json!({"modes": ["natural", "words", "phrase"], "related": true})
    );
    let (status, body) = call(
        state.clone(),
        Method::POST,
        "/.search/query",
        r#"{"query":"clinking","mode":"natural"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(found_by_meaning(&body), "{body}");
    assert!(body["notice"].is_null(), "{body}");
    let (status, body) = call(
        state,
        Method::POST,
        "/.search/related",
        r#"{"page":"Chain"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// Once the semantic index is ready, Natural is public, so a visitor's
/// mode-less query runs in Natural like a signed-in reader's.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_mode_less_public_query_runs_in_natural_once_it_is_public() {
    let dir = bike_space();
    let mut state = semantic_state(dir.path(), Grant(Some(AccessLevel::Read), None)).await;
    state.anonymous_readable = true;
    let state = Arc::new(state);
    let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["capabilities"],
        serde_json::json!({"modes": ["natural", "words", "phrase"], "related": false})
    );
    let (status, body) = call(
        state.clone(),
        Method::POST,
        "/.search/query",
        r#"{"query":"clinking"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(found_by_meaning(&body), "ran in Natural: {body}");
    let (status, body) = call(
        state,
        Method::POST,
        "/.search/query",
        r#"{"query":"clinking","mode":"words"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!found_by_meaning(&body), "Words differs: {body}");
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

#[tokio::test]
async fn admission_maps_the_actor_route_and_tab() {
    use super::{admission, Op};
    use silverbullet_server_search::limits;
    let state = test_state();
    let writer = actor(AccessLevel::Write, Some("w"));
    let a = admission(&state, &writer, "tab-1", Op::Query(QueryMode::Words));
    assert_eq!(a.space, state.space_folder_path);
    assert_eq!((a.user, a.writer), (Some("w"), true));
    assert!(a.supersede);
    let signed_out = actor(AccessLevel::Write, None);
    let a = admission(&state, &signed_out, "", Op::Query(QueryMode::Words));
    assert_eq!((a.user, a.writer), (None, true));
    assert!(!a.supersede);
    let reader = actor(AccessLevel::Read, Some("r"));
    let a = admission(&state, &reader, "", Op::Query(QueryMode::Words));
    assert_eq!((a.user, a.writer), (Some("r"), false));
    let deadline = |route| admission(&state, &writer, "tab-1", route).deadline;
    assert_eq!(deadline(Op::Query(QueryMode::Words)), limits::DEADLINE);
    assert_eq!(deadline(Op::Related), limits::DEADLINE);
}

#[tokio::test]
async fn only_a_tabs_queries_supersede_each_other() {
    use super::{admission, Op};
    let state = test_state();
    let actor = actor(AccessLevel::Write, Some("supersede-writer"));
    let admit = |route, tab| {
        state
            .search_gate
            .admit(admission(&state, &actor, tab, route))
            .unwrap()
    };

    let first = admit(Op::Query(QueryMode::Words), "tab-supersede");
    let related = admit(Op::Related, "tab-supersede");
    let headerless = admit(Op::Query(QueryMode::Words), "");
    let _later = [
        admit(Op::Related, "tab-supersede"),
        admit(Op::Query(QueryMode::Words), ""),
    ];
    assert!(
        !first.cancel.is_cancelled(),
        "related/headerless never supersede"
    );
    let _newer = admit(Op::Query(QueryMode::Words), "tab-supersede");
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
