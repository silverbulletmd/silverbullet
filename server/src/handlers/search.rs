//! `/.search/*`: the space's search backend over HTTP. Errors are 4xx JSON
//! because the client treats any 5xx as being offline.

use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Extension, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use silverbullet_server_search::ripgrep::limits;
use silverbullet_server_search::{
    Admission, Capabilities, QueryRequest, QueryResult, RawRequest, RawResult, RequestCx,
    SearchError, StatusResponse,
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
        .route("/.search/rg", post(handle_rg))
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

/// Structured searches only read the space, unlike raw passthrough.
pub(crate) fn is_read_post(path: &str) -> bool {
    matches!(path, "/.search/query" | "/.search/related")
}

/// Every search endpoint refuses cross-origin cookie requests, reads included.
pub(crate) fn needs_same_origin(path: &str) -> bool {
    path.starts_with("/.search/")
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
    Raw,
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
        // widgets running raw or related searches in parallel must not cancel each other.
        supersede: route == Route::Query && !tab.is_empty(),
        deadline: if route == Route::Raw {
            limits::RAW_DEADLINE
        } else {
            limits::DEADLINE
        },
    }
}

const PUBLIC_VISITORS: &str = "Search isn't available to public visitors";

/// A caller with no identity (no username) and no real write access. Write
/// without a username comes either from a bearer token (an authenticated
/// client, not a visitor) or from an open server's default grant. The latter
/// is the only way to hold it on a space that is open to anonymous readers but
/// not to anonymous writers: a single-user server without auth that is
/// read-only. `state.authorizer` cannot tell these apart, because every
/// instance wraps its authorizer, even an absent one, so it is never `None`.
fn is_public_visitor(state: &ServerState, actor: &Actor) -> bool {
    let open_read_only = state.anonymous_readable && !state.anonymous_writable;
    actor.username.is_none() && (actor.level < AccessLevel::Write || open_read_only)
}

/// Refuses public visitors before any rg process can start. Structured
/// searches pass when the backend allows anonymous search (ripgrep does not);
/// raw `/.search/rg` always runs rg, so it never passes.
fn refuse_public_visitors(
    state: &ServerState,
    actor: &Actor,
    route: Route,
) -> Result<(), SearchError> {
    let allowed = route != Route::Raw && state.search.allows_anonymous();
    if is_public_visitor(state, actor) && !allowed {
        return Err(SearchError::Unavailable(PUBLIC_VISITORS.into()));
    }
    Ok(())
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

pub async fn handle_status(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
) -> Json<StatusResponse> {
    if let Err(error) = refuse_public_visitors(&state, &actor, Route::Query) {
        return Json(StatusResponse {
            backend: None,
            model: None,
            capabilities: Capabilities {
                modes: vec![],
                related: false,
            },
            ready: false,
            progress: None,
            reason: Some(error.to_string()),
        });
    }
    Json(state.search.status())
}

pub async fn handle_query(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    Json(req): Json<QueryRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    refuse_public_visitors(&state, &actor, Route::Query)?;
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
    Json(req): Json<RelatedRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    refuse_public_visitors(&state, &actor, Route::Related)?;
    let cx = admit(&state, &actor, &headers, Route::Related)?;
    let result = state
        .search
        .related(req.page, req.limit.unwrap_or(10), cx)
        .await?;
    Ok(Json(result))
}

pub async fn handle_rg(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    Json(req): Json<RawRequest>,
) -> Result<Json<RawResult>, SearchFailure> {
    refuse_public_visitors(&state, &actor, Route::Raw)?;
    let cx = admit(&state, &actor, &headers, Route::Raw)?;
    let result = state.search.raw(req, cx).await?;
    if result.timed_out {
        if let Some(m) = state.metrics.as_ref() {
            m.search_timeouts.inc();
        }
    }
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

    /// Whether rg is installed; with `SB_REQUIRE_RIPGREP=1` a missing rg fails the test instead.
    fn has_rg() -> bool {
        let found = silverbullet_server_search::ripgrep::discover::binary().is_some();
        assert!(
            found || !silverbullet_server_search::ripgrep::discover::ripgrep_required(),
            "SB_REQUIRE_RIPGREP=1 but rg is not installed"
        );
        found
    }

    struct Grant(Option<AccessLevel>, Option<&'static str>);
    impl RequestAuthorizer for Grant {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            let mut outcome = AuthOutcome::anonymous();
            outcome.grant = self.0;
            outcome.username = self.1.map(String::from);
            Some(outcome)
        }
    }

    fn disk_state(dir: &std::path::Path, grant: Grant) -> Arc<crate::ServerState> {
        Arc::new(ignoring_state(dir, "", grant))
    }

    fn ignoring_state(dir: &std::path::Path, ignore: &str, grant: Grant) -> crate::ServerState {
        let mut state = test_state();
        let folder = dir.to_string_lossy().to_string();
        state.space = Arc::new(DiskSpacePrimitives::new(&folder, ignore).unwrap());
        state.search = crate::search::backend_for(dir, state.space.clone());
        state.space_folder_path = folder.clone();
        state.boot_config.space_folder_path = folder;
        state.authorizer = Some(Arc::new(grant));
        state
    }

    /// Answers every request with fixed results, so dispatch is observable without rg.
    struct Stub {
        query: fn() -> Result<QueryResult, SearchError>,
        anonymous: bool,
    }

    impl SearchBackend for Stub {
        fn allows_anonymous(&self) -> bool {
            self.anonymous
        }

        fn status(&self) -> StatusResponse {
            StatusResponse {
                backend: Some("stub".into()),
                model: None,
                capabilities: Capabilities {
                    modes: vec![QueryMode::Words],
                    related: false,
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
    }

    fn stub_state(
        user: &'static str,
        query: fn() -> Result<QueryResult, SearchError>,
    ) -> Arc<crate::ServerState> {
        let mut state = test_state();
        state.search = Arc::new(Stub {
            query,
            anonymous: false,
        });
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
    async fn backends_without_raw_refuse_it_as_unsupported() {
        let state = stub_state("stub-raw-writer", one_match);
        let (status, body) = call(state, Method::POST, "/.search/rg", r#"{"args":["x"]}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"], "unsupported");
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

    #[tokio::test]
    async fn spaces_not_on_disk_report_why_and_refuse_searches() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = test_state();
        state.authorizer = Some(Arc::new(Grant(
            Some(AccessLevel::Write),
            Some("missing-writer"),
        )));
        state.search = crate::search::backend_for(&dir.path().join("missing"), state.space.clone());
        let state = Arc::new(state);
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backend"], serde_json::Value::Null);
        assert_eq!(body["reason"], "Search needs a space stored on disk");
        for (path, req) in [
            ("/.search/query", r#"{"query":"fern"}"#),
            ("/.search/rg", r#"{"args":["fern"]}"#),
        ] {
            let (status, body) = call(state.clone(), Method::POST, path, req).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
            assert_eq!(body["error"], "unavailable", "{path}");
        }
    }

    #[tokio::test]
    async fn status_is_readable_and_reports_ripgrep() {
        let dir = tempfile::tempdir().unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader")));
        let (status, body) = call(state, Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["capabilities"]["modes"],
            serde_json::json!(["words", "phrase", "regex"])
        );
        if has_rg() {
            assert_eq!(body["backend"], "ripgrep");
        }
    }

    #[tokio::test]
    async fn readers_can_query_but_not_run_raw_ripgrep() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), Some("reader")));
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        if has_rg() {
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["items"][0]["page"], "Fern");
        } else {
            assert_eq!(status, StatusCode::NOT_FOUND);
            assert_eq!(body["error"], "unavailable");
        }
        let (status, _) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn errors_are_typed_and_never_5xx() {
        let dir = tempfile::tempdir().unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Write), Some("writer")));
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
        let mut state = Arc::try_unwrap(disk_state(
            dir.path(),
            Grant(Some(AccessLevel::Write), Some("w")),
        ))
        .ok()
        .unwrap();
        state.boot_config.enable_client_encryption = true;
        let (status, body) = call(Arc::new(state), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        if has_rg() {
            assert_eq!(body["backend"], "ripgrep");
        }
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
        );
        let (status, body) = call(
            Arc::new(state),
            Method::POST,
            "/.search/query",
            r#"{"query":"quartz"}"#,
        )
        .await;
        if !has_rg() {
            return;
        }
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["total"], 1, "{body}");
        assert_eq!(body["items"][0]["page"], "Notes");
    }

    const PUBLIC: &str = "Search isn't available to public visitors";

    async fn assert_refused_to_public(state: Arc<crate::ServerState>) {
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            serde_json::json!({
                "backend": null,
                "model": null,
                "capabilities": {"modes": [], "related": false},
                "ready": false,
                "progress": null,
                "reason": PUBLIC,
            })
        );
        for (path, req) in [
            ("/.search/query", r#"{"query":"fern"}"#),
            ("/.search/related", r#"{"page":"Fern"}"#),
        ] {
            let (status, body) = call(state.clone(), Method::POST, path, req).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
            assert_eq!(
                body,
                serde_json::json!({"error": "unavailable", "message": PUBLIC}),
                "{path}"
            );
        }
    }

    fn fern_space() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        dir
    }

    #[tokio::test]
    async fn ripgrep_search_is_refused_to_public_visitors() {
        let dir = fern_space();
        let mut state = ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Read), None));
        state.anonymous_readable = true;
        assert_refused_to_public(Arc::new(state)).await;
    }

    #[tokio::test]
    async fn a_forged_client_id_or_bare_cookie_is_still_a_public_visitor() {
        let dir = fern_space();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Read), None));
        for (client, cookie) in [
            ("tab-1", None),
            ("writer-tab-0000", None),
            ("", Some("auth_localhost=forged")),
        ] {
            let mut req = Request::builder()
                .method(Method::POST)
                .uri("/.search/query")
                .header("content-type", "application/json")
                .header("x-search-client", client)
                .header("sec-fetch-site", "same-origin");
            if let Some(cookie) = cookie {
                req = req.header("cookie", cookie);
            }
            let res = crate::build_router(state.clone())
                .oneshot(req.body(Body::from(r#"{"query":"fern"}"#)).unwrap())
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
        );
        state.anonymous_readable = true;
        let state = Arc::new(state);
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["reason"], serde_json::Value::Null, "{body}");
        let (status, body) =
            call(state, Method::POST, "/.search/query", r#"{"query":"fern"}"#).await;
        if has_rg() {
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["items"][0]["page"], "Fern");
        }
    }

    /// A single-user server without auth, flagged the way `multi::instance` flags it.
    fn open_single_user(dir: &std::path::Path, read_only: bool) -> crate::ServerState {
        let mut state = ignoring_state(dir, "", Grant(None, None));
        state.authorizer = None;
        state.anonymous_readable = true;
        state.anonymous_writable = !read_only;
        state.boot_config.read_only = read_only;
        state
    }

    async fn assert_raw_refused_to_public(state: Arc<crate::ServerState>) {
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
        assert_eq!(
            body,
            serde_json::json!({"error": "unavailable", "message": PUBLIC})
        );
    }

    #[tokio::test]
    async fn a_single_user_server_without_auth_searches_unless_read_only() {
        let dir = fern_space();
        let state = Arc::new(open_single_user(dir.path(), false));
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"fern"}"#,
        )
        .await;
        let (rg_status, rg_body) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        if has_rg() {
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["items"][0]["page"], "Fern");
            assert_eq!(rg_status, StatusCode::OK, "{rg_body}");
        }
        let state = Arc::new(open_single_user(dir.path(), true));
        assert_refused_to_public(state.clone()).await;
        assert_raw_refused_to_public(state).await;
    }

    #[tokio::test]
    async fn a_token_caller_on_a_read_only_server_with_auth_still_searches() {
        // An `SB_AUTH_TOKEN` bearer: trusted, so Write without a username.
        let dir = fern_space();
        let mut state = ignoring_state(dir.path(), "", Grant(Some(AccessLevel::Write), None));
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
        let (rg_status, rg_body) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        if has_rg() {
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(rg_status, StatusCode::OK, "{rg_body}");
        }
    }

    #[tokio::test]
    async fn raw_rg_is_refused_to_public_visitors_whatever_the_backend_allows() {
        let dir = fern_space();
        let mut state = open_single_user(dir.path(), true);
        state.search = Arc::new(Stub {
            query: one_match,
            anonymous: true,
        });
        let state = Arc::new(state);
        let (status, body) = call(
            state.clone(),
            Method::POST,
            "/.search/query",
            r#"{"query":"x"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_raw_refused_to_public(state).await;
    }

    #[tokio::test]
    async fn backends_that_allow_anonymous_serve_public_visitors() {
        let mut state = test_state();
        state.search = Arc::new(Stub {
            query: one_match,
            anonymous: true,
        });
        state.authorizer = Some(Arc::new(Grant(Some(AccessLevel::Read), None)));
        let state = Arc::new(state);
        let (status, body) = call(state.clone(), Method::GET, "/.search/status", "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backend"], "stub");
        let (status, body) = call(state, Method::POST, "/.search/query", r#"{"query":"x"}"#).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"][0]["page"], "Stub Page");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_fourth_concurrent_search_is_busy_after_the_queue_wait() {
        use silverbullet_server_search::ripgrep::{Engine, RipgrepBackend};
        use std::os::unix::fs::PermissionsExt;
        let dir = fern_space();
        let bin_dir = tempfile::tempdir().unwrap();
        let bin = bin_dir.path().join("slow-rg");
        std::fs::write(&bin, "#!/bin/sh\nsleep 2\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut state = ignoring_state(
            dir.path(),
            "",
            Grant(Some(AccessLevel::Write), Some("writer")),
        );
        state.search = Arc::new(RipgrepBackend::new(
            dir.path().to_path_buf(),
            Engine::Ready(bin),
            Arc::new(crate::search::SpaceSearchView(state.space.clone())),
        ));
        state.metrics = Some(Arc::new(crate::metrics::Metrics::new()));
        let state = Arc::new(state);
        let started = std::time::Instant::now();
        let rg = || {
            call(
                state.clone(),
                Method::POST,
                "/.search/rg",
                r#"{"args":["fern","."]}"#,
            )
        };
        let (a, b, c, d) = tokio::join!(rg(), rg(), rg(), rg());
        let results = [a, b, c, d];
        let busy: Vec<_> = results
            .iter()
            .filter(|(status, _)| *status == StatusCode::TOO_MANY_REQUESTS)
            .collect();
        assert_eq!(busy.len(), 1, "{results:?}");
        assert_eq!(busy[0].1["error"], "busy");
        assert!(results.iter().all(|(status, _)| !status.is_server_error()));
        assert!(started.elapsed() >= std::time::Duration::from_secs(1));
        assert_eq!(state.metrics.as_ref().unwrap().search_rejections.get(), 1);
    }

    #[tokio::test]
    async fn writers_can_run_raw_ripgrep() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Fern.md"), "fern fronds\n").unwrap();
        let state = disk_state(dir.path(), Grant(Some(AccessLevel::Write), Some("writer")));
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["fern","."]}"#,
        )
        .await;
        if !has_rg() {
            return;
        }
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["exitCode"], 0, "{body}");
        let out = body["stdoutBase64"].as_str().unwrap();
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(out)
            .unwrap();
        assert!(String::from_utf8_lossy(&decoded).contains("fern"));
    }

    #[tokio::test]
    async fn raw_ripgrep_cannot_read_space_ignored_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("private")).unwrap();
        std::fs::write(dir.path().join("private/Payroll.md"), "quartz salary\n").unwrap();
        std::fs::write(dir.path().join("Notes.md"), "quartz notes\n").unwrap();
        let state = Arc::new(ignoring_state(
            dir.path(),
            "private/",
            Grant(Some(AccessLevel::Write), Some("writer")),
        ));
        if !has_rg() {
            return;
        }
        let decode = |body: &serde_json::Value| {
            use base64::Engine;
            let out = body["stdoutBase64"].as_str().unwrap_or_default();
            String::from_utf8(
                base64::engine::general_purpose::STANDARD
                    .decode(out)
                    .unwrap(),
            )
            .unwrap()
        };
        for args in [
            r#"{"args":["-e","quartz","."]}"#,
            r#"{"args":["-g","private/**","-e","quartz"]}"#,
            r#"{"args":["-e","quartz","private"]}"#,
        ] {
            let (status, body) = call(state.clone(), Method::POST, "/.search/rg", args).await;
            assert_eq!(status, StatusCode::OK, "{args}: {body}");
            let out = decode(&body);
            assert!(!out.contains("salary"), "{args}: {out}");
        }
        let (_, body) = call(
            state.clone(),
            Method::POST,
            "/.search/rg",
            r#"{"args":["-e","quartz","."]}"#,
        )
        .await;
        assert!(decode(&body).contains("Notes.md"));
        let (status, body) = call(
            state,
            Method::POST,
            "/.search/rg",
            r#"{"args":["-e","","private/Payroll.md"]}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
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
        use silverbullet_server_search::ripgrep::limits;
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
        assert_eq!(deadline(Route::Raw), limits::RAW_DEADLINE);
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
        let raw = admit(Route::Raw, "tab-supersede");
        let related = admit(Route::Related, "tab-supersede");
        let headerless = admit(Route::Query, "");
        let _later = [
            admit(Route::Raw, "tab-supersede"),
            admit(Route::Related, "tab-supersede"),
            admit(Route::Query, ""),
        ];
        assert!(
            !first.cancel.is_cancelled(),
            "raw/related/headerless never supersede"
        );
        let _newer = admit(Route::Query, "tab-supersede");
        assert!(first.cancel.is_cancelled());
        assert!(!raw.cancel.is_cancelled());
        assert!(!related.cancel.is_cancelled());
        assert!(!headerless.cancel.is_cancelled());
    }

    #[test]
    fn search_posts_are_read_level_except_raw() {
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.search/query"),
            AccessLevel::Read
        );
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.search/related"),
            AccessLevel::Read
        );
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.search/rg"),
            AccessLevel::Write
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
