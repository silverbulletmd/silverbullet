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
use silverbullet_server_search::{
    limits, Admission, Capabilities, QueryMode, QueryRequest, QueryResult, RelatedRequest,
    RequestCx, SearchBackend, SearchError, StatusResponse,
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

/// What a request asks of the backend: a query, in the mode it will run in,
/// or related pages.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Query(QueryMode),
    Related,
}

fn admission<'a>(state: &'a ServerState, actor: &'a Actor, tab: &'a str, op: Op) -> Admission<'a> {
    Admission {
        space: &state.space_folder_path,
        user: actor.username.as_deref(),
        writer: actor.level == AccessLevel::Write,
        tab,
        // Only a tab's interactive search supersedes its previous one; scripts and
        // widgets running related searches in parallel must not cancel each other.
        supersede: matches!(op, Op::Query(_)) && !tab.is_empty(),
        deadline: limits::DEADLINE,
    }
}

const PUBLIC_VISITORS: &str = "Search isn't available to public visitors";

/// Who is asking, resolved once per request: a member may use everything the
/// backend offers; a public visitor only the backend's `public_modes()`, and
/// never related pages.
enum Audience<'a> {
    Member,
    Public(&'a [QueryMode]),
}

impl<'a> Audience<'a> {
    /// A caller with no identity (no username) and no real write access is a
    /// public visitor. Write without a username comes either from a bearer
    /// token (an authenticated client, not a visitor) or from an open server's
    /// default grant (or a headless/runtime cookie on it). On a space that is
    /// open to anonymous readers but not to anonymous writers (a single-user
    /// server without auth that is read-only), such Write is treated as a
    /// visitor's. `state.authorizer` cannot tell these apart, because every
    /// instance wraps its authorizer, even an absent one, so it is never `None`.
    fn of(state: &'a ServerState, actor: &Actor) -> Self {
        let open_read_only = state.anonymous_readable && !state.anonymous_writable;
        if actor.username.is_none() && (actor.level < AccessLevel::Write || open_read_only) {
            Audience::Public(state.search.public_modes())
        } else {
            Audience::Member
        }
    }

    /// The mode a query without one runs in: the backend's default, except for
    /// a public visitor when that default isn't public (a semantic space still
    /// building), who gets the first public mode instead.
    fn default_mode(&self, backend: &dyn SearchBackend) -> QueryMode {
        let mode = backend.default_mode();
        match self {
            Audience::Public(public) if !public.contains(&mode) => {
                public.first().copied().unwrap_or(mode)
            }
            _ => mode,
        }
    }

    /// Refuses public visitors before admission. A query passes only in one
    /// of the public modes: its mode is the one it will run in (`handle_query`
    /// resolves a missing one first, with [`Audience::default_mode`]). Related
    /// pages never pass.
    fn allows(&self, op: Op) -> Result<(), SearchError> {
        match (self, op) {
            (Audience::Member, _) => Ok(()),
            (Audience::Public(public), Op::Query(mode)) if public.contains(&mode) => Ok(()),
            (Audience::Public(_), _) => Err(SearchError::Unavailable(PUBLIC_VISITORS.into())),
        }
    }

    /// Public visitors see only the modes they may use, and no related pages;
    /// with none, search reads as unavailable to them.
    fn status(&self, backend: &dyn SearchBackend) -> StatusResponse {
        let public = match self {
            Audience::Member => return backend.status(),
            Audience::Public(public) => *public,
        };
        if public.is_empty() {
            return unavailable_status(PUBLIC_VISITORS);
        }
        let mut status = backend.status();
        status
            .capabilities
            .modes
            .retain(|mode| public.contains(mode));
        status.capabilities.related = false;
        status
    }
}

/// The status of a search the caller can't use (mirrored by the client's
/// fallback status).
fn unavailable_status(reason: &str) -> StatusResponse {
    StatusResponse {
        backend: None,
        model: None,
        capabilities: Capabilities {
            modes: vec![],
            related: false,
        },
        ready: false,
        progress: None,
        reason: Some(reason.into()),
    }
}

fn admit(
    state: &ServerState,
    actor: &Actor,
    headers: &HeaderMap,
    op: Op,
) -> Result<RequestCx, SearchError> {
    let tab = search_client(headers);
    state.search_gate.admit(admission(state, actor, &tab, op))
}

pub async fn handle_status(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
) -> Json<StatusResponse> {
    Json(Audience::of(&state, &actor).status(state.search.as_ref()))
}

pub async fn handle_query(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    SearchJson(mut req): SearchJson<QueryRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    let audience = Audience::of(&state, &actor);
    // Resolved once, so the mode checked here is the mode the backend runs.
    let mode = req
        .mode
        .unwrap_or_else(|| audience.default_mode(state.search.as_ref()));
    req.mode = Some(mode);
    let op = Op::Query(mode);
    audience.allows(op)?;
    let cx = admit(&state, &actor, &headers, op)?;
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

pub async fn handle_related(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    SearchJson(req): SearchJson<RelatedRequest>,
) -> Result<Json<QueryResult>, SearchFailure> {
    Audience::of(&state, &actor).allows(Op::Related)?;
    let cx = admit(&state, &actor, &headers, Op::Related)?;
    Ok(Json(state.search.related(req, cx).await?))
}

#[cfg(test)]
mod tests;
