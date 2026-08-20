use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Extension, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use silverbullet_server_common::reconcile::{
    ReconcileRequest, ReconcileResponse, ReconcileRevision,
};
use silverbullet_server_common::revision::{etag_for_hash, hash_from_etag, sha256_hex};
use silverbullet_server_common::space::disk::{is_merge_eligible, MERGE_SIZE_LIMIT};
use silverbullet_server_common::{FileMeta, SpaceError};
use silverbullet_server_merge::{contains_conflict_markers, merge, MergeOutcome};

use crate::auth::Actor;
use crate::handlers::{http_date, space_error_response};
use crate::router::run_blocking;
use crate::state::ServerState;

/// `X-Source` values a mutation may declare (constraint 5); anything else is
/// ignored rather than rejected, since attribution is never load-bearing.
const VALID_WRITE_SOURCES: [&str; 4] = ["editor", "sync", "agent", "external"];

/// Opaque client identifier from `X-Client-Id`, or `None` if absent or over
/// the 64-character limit. Never trusted for identity (constraint 4) --
/// purely a correlation token the client chose for itself.
fn client_id_header(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("X-Client-Id")?.to_str().ok()?;
    if raw.is_empty() || raw.chars().count() > 64 {
        return None;
    }
    Some(raw.to_string())
}

/// `X-Source` header value, or `None` if absent or not one of the declared
/// sources (constraint 5).
fn source_header(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("X-Source")?.to_str().ok()?;
    VALID_WRITE_SOURCES.contains(&raw).then(|| raw.to_string())
}

/// Above this many conflicting hunks, a merge is rejected as ineligible
/// rather than handed back as a giant marker-laden file.
const CONFLICT_HUNK_LIMIT: usize = 100;

/// Attempts to write a merge/apply outcome before giving up and reporting
/// `retry` to the caller, in case a writer bypassing `path_lock` (there are
/// none in this codebase today, but the contract allows for one) raced us.
const MAX_RECONCILE_ATTEMPTS: usize = 3;

pub async fn handle_fs_list(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    let state_inner = state.clone();
    match run_blocking(move || state_inner.space.fetch_file_list()).await {
        Ok(files) => {
            let json = serde_json::to_string(&files).unwrap_or_else(|e| {
                tracing::error!("failed to serialize file list: {e}");
                "[]".to_string()
            });
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("X-Space-Path", &state.space_folder_path)
                .header("Cache-Control", "no-cache")
                .body(Body::from(json))
                .unwrap()
        }
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(e.to_string()))
            .unwrap(),
    }
}

pub async fn handle_fs_get(
    State(state): State<Arc<ServerState>>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Metadata-only probe.
    if headers.get("X-Get-Meta").is_some() {
        let state_inner = state.clone();
        let path_inner = path.clone();
        return match run_blocking(move || {
            let meta = state_inner.space.get_file_meta(&path_inner)?;
            let hash = match state_inner
                .fs_guard
                .hash_for(&*state_inner.space, &path_inner)
            {
                Ok(hash) => Some(hash),
                Err(e) => {
                    tracing::debug!("fs_guard hash_for {path_inner} failed: {e}");
                    None
                }
            };
            Ok::<_, silverbullet_server_common::SpaceError>((meta, hash))
        })
        .await
        {
            Ok((meta, hash)) => {
                let mut builder =
                    set_file_meta_headers(Response::builder().status(StatusCode::OK), &meta)
                        .header("Cache-Control", "no-store");
                if let Some(hash) = hash {
                    builder = builder.header(axum::http::header::ETAG, etag_for_hash(&hash));
                }
                builder.body(Body::empty()).unwrap()
            }
            Err(e) => space_error_response(e),
        };
    }

    // Conditional request: `/.fs` serves mutable files with `Cache-Control:
    // no-cache`, so the browser revalidates on every load. We emit a standard
    // `Last-Modified` validator (see `set_file_meta_headers`) which the browser
    // echoes back verbatim in `If-Modified-Since`; a string match means the file
    // is unchanged and we can answer 304 without reading the (potentially large)
    // body off disk — we only need a metadata-only `get_file_meta` probe here.
    let if_modified_since = headers
        .get(axum::http::header::IF_MODIFIED_SINCE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if let Some(ims) = if_modified_since {
        let state_inner = state.clone();
        let path_inner = path.clone();
        if let Ok(meta) = run_blocking(move || state_inner.space.get_file_meta(&path_inner)).await {
            let last_modified = http_date(meta.last_modified);
            if !last_modified.is_empty() && ims == last_modified {
                return Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(axum::http::header::LAST_MODIFIED, &last_modified)
                    .header(axum::http::header::VARY, "Accept")
                    .body(Body::empty())
                    .unwrap();
            }
        }
    }

    let force_octet_stream = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("application/octet-stream"))
        .unwrap_or(false);

    let state_inner = state.clone();
    let path_inner = path.clone();
    match run_blocking(move || {
        let (data, meta) = state_inner.space.read_file(&path_inner)?;
        let hash = sha256_hex(&data);
        state_inner
            .fs_guard
            .record(&path_inner, &meta, hash.clone());
        Ok((data, meta, hash))
    })
    .await
    {
        Ok((data, mut meta, hash)) => {
            let real_content_type = meta.content_type.clone();
            if force_octet_stream {
                meta.content_type = "application/octet-stream".to_string();
            }
            let mut builder =
                set_file_meta_headers(Response::builder().status(StatusCode::OK), &meta)
                    .header("X-Content-Type", &real_content_type)
                    // Mutable file: revalidate every load. The `Last-Modified`
                    // validator lets the browser get a 304 (handled above)
                    // instead of refetching the full body.
                    .header("Cache-Control", "no-cache")
                    // The body's `Content-Type` depends on the request's `Accept`
                    // (octet-stream vs the real type), so cache must key on it.
                    .header(axum::http::header::VARY, "Accept")
                    .header(axum::http::header::ETAG, etag_for_hash(&hash));
            let last_modified = http_date(meta.last_modified);
            if !last_modified.is_empty() {
                builder = builder.header(axum::http::header::LAST_MODIFIED, &last_modified);
            }
            builder.body(Body::from(data)).unwrap()
        }
        Err(e) => space_error_response(e),
    }
}

/// Set the `X-*` file-metadata headers the client reads off `/.fs` responses.
pub(crate) fn set_file_meta_headers(
    builder: axum::http::response::Builder,
    meta: &FileMeta,
) -> axum::http::response::Builder {
    builder
        .header("Content-Type", &meta.content_type)
        .header("X-Created", meta.created.to_string())
        .header("X-Last-Modified", meta.last_modified.to_string())
        .header("X-Content-Length", meta.size.to_string())
        .header("X-Permission", &meta.perm)
}

/// Current revision of a file that failed a precondition. The outer `Option`
/// is `None` when the precondition can't be evaluated (missing file, or a
/// value we can't parse) — no meta headers in that case. When `Some`, the
/// `FileMeta` is known; the inner `Option<String>` hash is `None` if
/// `hash_for` itself errored while computing it.
type CurrentRevision = Option<(FileMeta, Option<String>)>;

/// Evaluate `If-Match`/`If-None-Match` against the file's current state.
/// `Ok(None)` means every precondition passed (or there was none). `Ok(Some(_))`
/// carries the current revision to report in a 412 — `None` inside it when the
/// precondition is unevaluable (missing file, or a value we can't parse), in
/// which case we fail closed with no meta headers.
fn evaluate_preconditions(
    space: &dyn silverbullet_server_common::SpacePrimitives,
    fs_guard: &crate::fs_guard::FsGuard,
    path: &str,
    if_match: Option<&str>,
    if_none_match: Option<&str>,
) -> Result<Option<CurrentRevision>, SpaceError> {
    if let Some(raw) = if_none_match {
        if raw.trim() == "*" {
            if let Ok(current) = space.get_file_meta(path) {
                let current_hash = fs_guard.hash_for(space, path).ok();
                return Ok(Some(Some((current, current_hash))));
            }
        } else {
            // We only support the `*` form; any other value (an ETag list)
            // is a precondition we can't evaluate — fail closed rather than
            // silently ignoring it.
            return Ok(Some(None));
        }
    }
    if let Some(raw) = if_match {
        if raw.trim() == "*" {
            // RFC 7232: `If-Match: *` passes iff a current representation exists.
            if space.get_file_meta(path).is_err() {
                return Ok(Some(None));
            }
        } else {
            let expected = hash_from_etag(raw);
            let current_meta = space.get_file_meta(path);
            match (expected, current_meta) {
                (Some(expected), Ok(current)) => {
                    let current_hash = fs_guard.hash_for(space, path)?;
                    if current_hash != expected {
                        return Ok(Some(Some((current, Some(current_hash)))));
                    }
                }
                // Missing file, or a precondition we can't evaluate: fail closed.
                _ => return Ok(Some(None)),
            }
        }
    }
    Ok(None)
}

fn precondition_failed_response(current: CurrentRevision) -> Response {
    let mut builder = Response::builder().status(StatusCode::PRECONDITION_FAILED);
    if let Some((meta, hash)) = current {
        builder = set_file_meta_headers(builder, &meta);
        if let Some(hash) = hash {
            builder = builder.header(axum::http::header::ETAG, etag_for_hash(&hash));
        }
    }
    builder
        .header("Cache-Control", "no-store")
        .body(Body::from("Precondition Failed"))
        .unwrap()
}

pub async fn handle_fs_put(
    State(state): State<Arc<ServerState>>,
    Path(path): Path<String>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let meta = file_meta_from_headers(&headers, &path);
    let if_match = headers
        .get(axum::http::header::IF_MATCH)
        .map(|v| v.to_str().unwrap_or("").to_string());
    let if_none_match = headers
        .get(axum::http::header::IF_NONE_MATCH)
        .map(|v| v.to_str().unwrap_or("").to_string());
    let client_id = client_id_header(&headers);
    let source = source_header(&headers);

    let state_inner = state.clone();
    let path_inner = path.clone();
    let result: Result<Result<(FileMeta, String), CurrentRevision>, SpaceError> =
        run_blocking(move || {
            let lock = state_inner.fs_guard.path_lock(&path_inner);
            let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

            if let Some(current) = evaluate_preconditions(
                &*state_inner.space,
                &state_inner.fs_guard,
                &path_inner,
                if_match.as_deref(),
                if_none_match.as_deref(),
            )? {
                return Ok(Err(current));
            }

            // Hashing runs here, on the blocking pool, so a large-attachment
            // PUT never busies the reactor thread.
            let body_hash = sha256_hex(&body);
            let result_meta = state_inner
                .space
                .write_file(&path_inner, &body, Some(&meta))?;
            state_inner
                .fs_guard
                .record(&path_inner, &result_meta, body_hash.clone());
            state_inner.fs_guard.record_expected_write_with_meta(
                &path_inner,
                &body_hash,
                actor.username,
                client_id,
                source,
                result_meta.size,
                result_meta.last_modified,
            );
            Ok(Ok((result_meta, body_hash)))
        })
        .await;

    match result {
        Ok(Ok((result_meta, body_hash))) => {
            set_file_meta_headers(Response::builder().status(StatusCode::OK), &result_meta)
                .header("Cache-Control", "no-store")
                .header(axum::http::header::ETAG, etag_for_hash(&body_hash))
                .body(Body::from("OK"))
                .unwrap()
        }
        Ok(Err(current)) => precondition_failed_response(current),
        Err(e) => {
            tracing::error!("write failed: {e}");
            space_error_response(e)
        }
    }
}

pub async fn handle_fs_delete(
    State(state): State<Arc<ServerState>>,
    Path(path): Path<String>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let if_match = headers
        .get(axum::http::header::IF_MATCH)
        .map(|v| v.to_str().unwrap_or("").to_string());
    let client_id = client_id_header(&headers);
    let source = source_header(&headers);

    let state_inner = state.clone();
    let path_inner = path.clone();
    let result: Result<Result<(), CurrentRevision>, SpaceError> = run_blocking(move || {
        let lock = state_inner.fs_guard.path_lock(&path_inner);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(current) = evaluate_preconditions(
            &*state_inner.space,
            &state_inner.fs_guard,
            &path_inner,
            if_match.as_deref(),
            None,
        )? {
            return Ok(Err(current));
        }

        // Captured before the delete so the expected-write map is keyed by
        // the revision that's about to vanish (constraint 6) and carries its
        // real size/last-modified, letting the watcher emit a truthful
        // `revision` for the delete event; a lookup failure here just means
        // the delete event goes unattributed (or attributed without a
        // revision), never blocks the delete itself.
        let deleted_hash = state_inner
            .fs_guard
            .hash_for(&*state_inner.space, &path_inner)
            .ok();
        let deleted_meta = state_inner.space.get_file_meta(&path_inner).ok();
        state_inner.space.delete_file(&path_inner)?;
        state_inner.fs_guard.forget(&path_inner);
        if let Some(hash) = deleted_hash {
            match deleted_meta {
                Some(meta) => state_inner.fs_guard.record_expected_write_with_meta(
                    &path_inner,
                    &hash,
                    actor.username,
                    client_id,
                    source,
                    meta.size,
                    meta.last_modified,
                ),
                None => state_inner.fs_guard.record_expected_write(
                    &path_inner,
                    &hash,
                    actor.username,
                    client_id,
                    source,
                ),
            }
        }
        Ok(Ok(()))
    })
    .await;

    match result {
        Ok(Ok(())) => Response::builder()
            .status(StatusCode::OK)
            .body(Body::from("OK"))
            .unwrap(),
        Ok(Err(current)) => precondition_failed_response(current),
        Err(e) => space_error_response(e),
    }
}

/// What `handle_fs_reconcile`'s `run_blocking` closure produced: either a
/// completed reconciliation or one of the hand-built error responses (never
/// a `SpaceError`, so callers can't mistake these for 500s).
enum ReconcileOutcome {
    Response(ReconcileResponse),
    BadRequest(&'static str),
    TooLarge(&'static str),
    Conflict(&'static str),
}

pub async fn handle_fs_reconcile(
    State(state): State<Arc<ServerState>>,
    Path(path): Path<String>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let attribution = WriteAttribution {
        actor: actor.username,
        client_id: client_id_header(&headers),
        source: source_header(&headers),
    };
    let outcome = run_blocking(move || {
        let request: ReconcileRequest = match serde_json::from_slice(&body) {
            Ok(r) => r,
            Err(_) => return Ok(ReconcileOutcome::BadRequest("Malformed JSON body")),
        };

        if sha256_hex(request.base_text.as_bytes()) != request.base_hash {
            return Ok(ReconcileOutcome::BadRequest(
                "baseHash does not match sha256(baseText)",
            ));
        }
        if sha256_hex(request.proposed_text.as_bytes()) != request.proposed_hash {
            return Ok(ReconcileOutcome::BadRequest(
                "proposedHash does not match sha256(proposedText)",
            ));
        }

        let max_text_size = request.base_text.len().max(request.proposed_text.len());
        if max_text_size > MERGE_SIZE_LIMIT {
            return Ok(ReconcileOutcome::TooLarge(
                "Text exceeds the reconciliation size limit",
            ));
        }

        if !is_merge_eligible(&path, max_text_size) {
            return Ok(ReconcileOutcome::Conflict(
                "Path is not eligible for reconciliation",
            ));
        }
        if contains_conflict_markers(&request.base_text)
            || contains_conflict_markers(&request.proposed_text)
        {
            return Ok(ReconcileOutcome::Conflict(
                "Input already contains SB conflict markers",
            ));
        }

        let lock = state.fs_guard.path_lock(&path);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        match reconcile_locked(&state, &path, &request, &attribution)? {
            Ok(resp) => Ok(ReconcileOutcome::Response(resp)),
            Err(msg) => Ok(ReconcileOutcome::Conflict(msg)),
        }
    })
    .await;

    match outcome {
        Ok(ReconcileOutcome::Response(resp)) => reconcile_response(resp),
        Ok(ReconcileOutcome::BadRequest(msg)) => bad_request(msg),
        Ok(ReconcileOutcome::TooLarge(msg)) => too_large(msg),
        Ok(ReconcileOutcome::Conflict(msg)) => reconcile_conflict(msg),
        // A 404 would tell the client this server has no reconciliation
        // endpoint at all, which it latches for the session; a file vanishing
        // mid-operation is a conflict it can safely fall back from.
        Err(SpaceError::NotFound) => reconcile_conflict("File vanished during reconciliation"),
        Err(e) => space_error_response(e),
    }
}

/// Read `path`, translating a missing file into `Ok(None)` rather than
/// `SpaceError::NotFound` so callers can treat "no current file" as data.
fn read_optional(
    state: &ServerState,
    path: &str,
) -> Result<Option<(Vec<u8>, FileMeta)>, SpaceError> {
    match state.space.read_file(path) {
        Ok((data, meta)) => Ok(Some((data, meta))),
        Err(SpaceError::NotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

fn revision_of(meta: &FileMeta, hash: String) -> ReconcileRevision {
    ReconcileRevision {
        algorithm: "sha256".to_string(),
        hash,
        size: meta.size,
        last_modified: meta.last_modified,
    }
}

/// Actor/client/source to attribute a reconcile's write(s) to (constraint 6).
/// A single reconcile call can write more than once across its retry loop,
/// so this is threaded through rather than read from headers at each site.
struct WriteAttribution {
    actor: Option<String>,
    client_id: Option<String>,
    source: Option<String>,
}

fn write_and_record(
    state: &ServerState,
    path: &str,
    text: &str,
    hash: String,
    attribution: &WriteAttribution,
) -> Result<(FileMeta, ReconcileRevision), SpaceError> {
    let meta = state.space.write_file(path, text.as_bytes(), None)?;
    state.fs_guard.record(path, &meta, hash.clone());
    state.fs_guard.record_expected_write_with_meta(
        path,
        &hash,
        attribution.actor.clone(),
        attribution.client_id.clone(),
        attribution.source.clone(),
        meta.size,
        meta.last_modified,
    );
    let revision = revision_of(&meta, hash);
    Ok((meta, revision))
}

/// Evaluate and apply the three-way reconciliation for `path`, run under
/// `fs_guard.path_lock`. `Ok(Err(_))` carries a 409 message for eligibility,
/// UTF-8, marker, or hunk-count problems discovered on the *current* file
/// content — those are never `SpaceError`s.
fn reconcile_locked(
    state: &ServerState,
    path: &str,
    req: &ReconcileRequest,
    attribution: &WriteAttribution,
) -> Result<Result<ReconcileResponse, &'static str>, SpaceError> {
    for attempt in 0..MAX_RECONCILE_ATTEMPTS {
        let Some((current_bytes, current_meta)) = read_optional(state, path)? else {
            let (_, revision) = write_and_record(
                state,
                path,
                &req.proposed_text,
                req.proposed_hash.clone(),
                attribution,
            )?;
            return Ok(Ok(ReconcileResponse::Applied {
                revision,
                text: req.proposed_text.clone(),
            }));
        };

        let current_hash = sha256_hex(&current_bytes);

        if current_hash == req.proposed_hash {
            // No-op: the file already holds the proposed content, so nothing
            // is written here -- only the hash cache is refreshed, never an
            // expected write (there's no new write to attribute).
            state
                .fs_guard
                .record(path, &current_meta, current_hash.clone());
            return Ok(Ok(ReconcileResponse::Applied {
                revision: revision_of(&current_meta, current_hash),
                text: req.proposed_text.clone(),
            }));
        }

        if current_hash == req.base_hash {
            let (_, revision) = write_and_record(
                state,
                path,
                &req.proposed_text,
                req.proposed_hash.clone(),
                attribution,
            )?;
            return Ok(Ok(ReconcileResponse::Applied {
                revision,
                text: req.proposed_text.clone(),
            }));
        }

        let Ok(current_str) = String::from_utf8(current_bytes) else {
            return Ok(Err("Current file is not valid UTF-8"));
        };
        if current_str.len() > MERGE_SIZE_LIMIT {
            return Ok(Err("Current file exceeds the reconciliation size limit"));
        }
        if contains_conflict_markers(&current_str) {
            return Ok(Err("Current file already contains SB conflict markers"));
        }

        let (status_is_merged, text) = match merge(&req.base_text, &req.proposed_text, &current_str)
        {
            MergeOutcome::Clean(text) => (true, text),
            MergeOutcome::Conflicted { text, hunk_count } if hunk_count <= CONFLICT_HUNK_LIMIT => {
                (false, text)
            }
            MergeOutcome::Conflicted { .. } => return Ok(Err("Too many conflicting hunks")),
        };

        let revalidated = read_optional(state, path)?;
        let revalidated_hash = revalidated.as_ref().map(|(bytes, _)| sha256_hex(bytes));
        if revalidated_hash.as_deref() != Some(current_hash.as_str()) {
            if attempt + 1 == MAX_RECONCILE_ATTEMPTS {
                return Ok(Ok(match revalidated {
                    Some((bytes, meta)) => ReconcileResponse::Retry {
                        revision: revision_of(&meta, sha256_hex(&bytes)),
                    },
                    None => {
                        let (_, revision) = write_and_record(
                            state,
                            path,
                            &req.proposed_text,
                            req.proposed_hash.clone(),
                            attribution,
                        )?;
                        ReconcileResponse::Applied {
                            revision,
                            text: req.proposed_text.clone(),
                        }
                    }
                }));
            }
            continue;
        }

        let hash = sha256_hex(text.as_bytes());
        let (_, revision) = write_and_record(state, path, &text, hash, attribution)?;
        return Ok(Ok(if status_is_merged {
            ReconcileResponse::Merged { revision, text }
        } else {
            ReconcileResponse::Conflicted { revision, text }
        }));
    }
    unreachable!("loop always returns within MAX_RECONCILE_ATTEMPTS iterations")
}

fn reconcile_response(resp: ReconcileResponse) -> Response {
    let revision = match &resp {
        ReconcileResponse::Applied { revision, .. }
        | ReconcileResponse::Merged { revision, .. }
        | ReconcileResponse::Conflicted { revision, .. }
        | ReconcileResponse::Retry { revision } => revision.clone(),
    };
    let json = serde_json::to_vec(&resp).unwrap_or_default();
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header(axum::http::header::ETAG, etag_for_hash(&revision.hash))
        .header("Cache-Control", "no-store")
        .body(Body::from(json))
        .unwrap()
}

fn bad_request(msg: &str) -> Response {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header("Content-Type", "text/plain")
        .header("Cache-Control", "no-store")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

fn too_large(msg: &str) -> Response {
    Response::builder()
        .status(StatusCode::PAYLOAD_TOO_LARGE)
        .header("Content-Type", "text/plain")
        .header("Cache-Control", "no-store")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

fn reconcile_conflict(msg: &str) -> Response {
    Response::builder()
        .status(StatusCode::CONFLICT)
        .header("Content-Type", "text/plain")
        .header("Cache-Control", "no-store")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

/// Parse the client's `X-*` write headers into a `FileMeta`.
fn file_meta_from_headers(headers: &HeaderMap, path: &str) -> FileMeta {
    let header_str = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let header_i64 = |name: &str| {
        header_str(name)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64)
    };
    FileMeta {
        name: path.to_string(),
        created: header_i64("X-Created"),
        last_modified: header_i64("X-Last-Modified"),
        content_type: header_str("Content-Type").unwrap_or("").to_string(),
        size: header_str("X-Content-Length")
            .or_else(|| header_str("Content-Length"))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64),
        perm: header_str("X-Permission").unwrap_or("ro").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn list_returns_written_files() {
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(Arc::new(state))
            .oneshot(Request::builder().uri("/.fs").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let files: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(files
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["name"] == "a.md"));
    }

    #[tokio::test]
    async fn get_returns_bytes_and_headers() {
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        // Full metadata-header contract the client reads off a GET.
        assert!(resp.headers().get("X-Created").is_some());
        assert!(resp.headers().get("X-Last-Modified").is_some());
        assert_eq!(resp.headers().get("X-Content-Length").unwrap(), "5");
        assert_eq!(resp.headers().get("X-Permission").unwrap(), "rw");
        let content_type = resp
            .headers()
            .get("Content-Type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let x_content_type = resp
            .headers()
            .get("X-Content-Type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(!content_type.is_empty());
        // On a normal GET the served Content-Type equals the real one.
        assert_eq!(content_type, x_content_type);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"hello");
    }

    #[tokio::test]
    async fn fs_get_supports_conditional_304() {
        let state = Arc::new(test_state());
        state.space.write_file("big.js", b"payload", None).unwrap();
        // First request: 200 with a standard `Last-Modified` header.
        let r1 = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs/big.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r1.status(), StatusCode::OK);
        let last_modified = r1
            .headers()
            .get("last-modified")
            .expect("Last-Modified present")
            .to_str()
            .unwrap()
            .to_string();
        assert!(!last_modified.is_empty());

        // Re-request echoing that value back: 304 Not Modified, empty body, but
        // the `Last-Modified` validator is still present.
        let r2 = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs/big.js")
                    .header("if-modified-since", &last_modified)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r2.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            r2.headers().get("last-modified").unwrap().to_str().unwrap(),
            last_modified
        );
        let body = axum::body::to_bytes(r2.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());

        // A stale `If-Modified-Since` must still serve the full body with 200.
        let r3 = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.fs/big.js")
                    .header("if-modified-since", "Tue, 01 Jan 1980 00:00:00 GMT")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r3.status(), StatusCode::OK);
        let body = axum::body::to_bytes(r3.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"payload");
    }

    #[tokio::test]
    async fn meta_probe_is_no_store_content_is_revalidatable() {
        // Regression guard: the empty-body X-Get-Meta probe and the full-body
        // content GET share the same URL. If the probe were cacheable, a browser
        // would revalidate a later content read against the cached EMPTY body and
        // serve nothing. So the probe MUST be `no-store`; the content GET stays a
        // revalidatable `no-cache` + `Last-Modified`.
        let state = Arc::new(test_state());
        state.space.write_file("x.md", b"hello", None).unwrap();

        // Metadata probe: no-store, empty body, but X-* metadata present.
        let meta = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs/x.md")
                    .header("X-Get-Meta", "true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(meta.status(), StatusCode::OK);
        assert_eq!(
            meta.headers()
                .get("cache-control")
                .unwrap()
                .to_str()
                .unwrap(),
            "no-store"
        );
        assert!(meta.headers().get("X-Last-Modified").is_some());
        let meta_body = axum::body::to_bytes(meta.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(meta_body.is_empty());

        // Content GET: revalidatable, full body.
        let content = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.fs/x.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(content.status(), StatusCode::OK);
        assert_eq!(
            content
                .headers()
                .get("cache-control")
                .unwrap()
                .to_str()
                .unwrap(),
            "no-cache"
        );
        assert!(content.headers().get("last-modified").is_some());
        // Content varies by `Accept` (octet-stream vs real type), so the cache
        // must key on it.
        assert_eq!(
            content.headers().get("vary").unwrap().to_str().unwrap(),
            "Accept"
        );
        let content_body = axum::body::to_bytes(content.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&content_body[..], b"hello");
    }

    #[tokio::test]
    async fn get_with_octet_stream_accept_overrides_content_type() {
        // The subtlest part of the /.fs contract: an `accept: application/octet-stream`
        // request forces the body Content-Type to octet-stream while the real type
        // is preserved in X-Content-Type.
        let state = test_state();
        state.space.write_file("a.md", b"hello", None).unwrap();
        let resp = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .header("accept", "application/octet-stream")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("Content-Type").unwrap(),
            "application/octet-stream"
        );
        let real = resp
            .headers()
            .get("X-Content-Type")
            .unwrap()
            .to_str()
            .unwrap();
        assert_ne!(real, "application/octet-stream");
        assert!(real.contains("markdown") || real.starts_with("text/"));
    }

    #[tokio::test]
    async fn get_missing_is_404() {
        let resp = crate::build_router(Arc::new(test_state()))
            .oneshot(
                Request::builder()
                    .uri("/.fs/nope.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn put_then_get_roundtrips() {
        let app = crate::build_router(Arc::new(test_state()));
        let put = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        let get = app
            .oneshot(
                Request::builder()
                    .uri("/.fs/note.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(get.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"content");
    }

    #[tokio::test]
    async fn get_and_meta_probe_serve_content_etag() {
        let state = Arc::new(test_state());
        state.space.write_file("a.md", b"hello", None).unwrap();
        let expected = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"hello"),
        );

        let get = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            get.headers().get("etag").unwrap().to_str().unwrap(),
            expected
        );

        let probe = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/.fs/a.md")
                    .header("X-Get-Meta", "true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            probe.headers().get("etag").unwrap().to_str().unwrap(),
            expected
        );
    }

    #[tokio::test]
    async fn put_response_carries_etag_of_written_content() {
        let state = Arc::new(test_state());
        let put = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);
        let expected = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"content"),
        );
        assert_eq!(
            put.headers().get("etag").unwrap().to_str().unwrap(),
            expected
        );
    }

    #[tokio::test]
    async fn put_with_client_and_source_headers_records_an_expected_write() {
        let state = Arc::new(test_state());
        let put = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .header("X-Client-Id", "client-123")
                    .header("X-Source", "editor")
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);
        let hash = silverbullet_server_common::revision::sha256_hex(b"content");
        let ew = state
            .fs_guard
            .lookup_expected_write("note.md", &hash)
            .expect("expected write recorded");
        assert_eq!(ew.client_id.as_deref(), Some("client-123"));
        assert_eq!(ew.source.as_deref(), Some("editor"));
        // No authorizer configured in `test_state`, so `Actor.username` is
        // `None` (open server, never a fabricated identity).
        assert_eq!(ew.actor, None);
    }

    #[tokio::test]
    async fn put_with_an_invalid_source_value_is_ignored_not_rejected() {
        let state = Arc::new(test_state());
        let put = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .header("X-Source", "not-a-real-source")
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        // Attribution is never load-bearing: an unrecognized source doesn't
        // fail the write.
        assert_eq!(put.status(), StatusCode::OK);
        let hash = silverbullet_server_common::revision::sha256_hex(b"content");
        let ew = state
            .fs_guard
            .lookup_expected_write("note.md", &hash)
            .expect("expected write recorded");
        assert_eq!(ew.source, None);
    }

    #[tokio::test]
    async fn put_with_an_oversize_client_id_is_ignored() {
        let state = Arc::new(test_state());
        let oversize = "x".repeat(65);
        let put = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .header("X-Client-Id", oversize)
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);
        let hash = silverbullet_server_common::revision::sha256_hex(b"content");
        let ew = state
            .fs_guard
            .lookup_expected_write("note.md", &hash)
            .expect("expected write recorded");
        assert_eq!(ew.client_id, None);
    }

    #[tokio::test]
    async fn put_by_an_authenticated_user_records_their_username_as_actor() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;

        let mut state = test_state();
        let auth = std::sync::Arc::new(Authenticator::from_secret_bytes(vec![7u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        state.authorizer = Some(std::sync::Arc::new(JwtAuthorizer::new(auth, "tok".into())));
        let state = Arc::new(state);

        let put = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/note.md")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .body(Body::from("content"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        let hash = silverbullet_server_common::revision::sha256_hex(b"content");
        let ew = state
            .fs_guard
            .lookup_expected_write("note.md", &hash)
            .expect("expected write recorded");
        assert_eq!(ew.actor.as_deref(), Some("alice"));
    }

    #[tokio::test]
    async fn delete_records_an_expected_write_keyed_by_the_deleted_hash() {
        let state = Arc::new(test_state());
        state.space.write_file("gone.md", b"bye", None).unwrap();
        let del = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/.fs/gone.md")
                    .header("X-Client-Id", "client-9")
                    .header("X-Source", "editor")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del.status(), StatusCode::OK);
        let hash = silverbullet_server_common::revision::sha256_hex(b"bye");
        let ew = state
            .fs_guard
            .lookup_expected_write("gone.md", &hash)
            .expect("expected write recorded for the deleted revision");
        assert_eq!(ew.client_id.as_deref(), Some("client-9"));
        assert_eq!(ew.source.as_deref(), Some("editor"));
        assert_eq!(ew.size, Some(3), "size of the deleted content (\"bye\")");
        assert!(
            ew.last_modified.is_some(),
            "delete must capture a last_modified so the watcher can emit a truthful revision"
        );
    }

    #[tokio::test]
    async fn delete_then_get_is_404() {
        let state = test_state();
        state.space.write_file("gone.md", b"x", None).unwrap();
        let app = crate::build_router(Arc::new(state));
        let del = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/.fs/gone.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del.status(), StatusCode::OK);
        let get = app
            .oneshot(
                Request::builder()
                    .uri("/.fs/gone.md")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn conditional_put_matching_succeeds_stale_412s() {
        let state = Arc::new(test_state());
        state.space.write_file("c.md", b"v1", None).unwrap();
        let etag_v1 = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"v1"),
        );

        let ok = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/c.md")
                    .header("if-match", &etag_v1)
                    .body(Body::from("v2"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);

        // Same (now stale) precondition again: rejected, file unchanged,
        // response carries the CURRENT revision.
        let stale = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/c.md")
                    .header("if-match", &etag_v1)
                    .body(Body::from("v3"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::PRECONDITION_FAILED);
        let etag_v2 = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"v2"),
        );
        assert_eq!(
            stale.headers().get("etag").unwrap().to_str().unwrap(),
            etag_v2
        );
        assert!(stale.headers().get("X-Last-Modified").is_some());
        let (data, _) = state.space.read_file("c.md").unwrap();
        assert_eq!(&data, b"v2");
    }

    #[tokio::test]
    async fn if_match_on_missing_file_412s_and_malformed_fails_closed() {
        let state = Arc::new(test_state());
        let missing = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/nope.md")
                    .header("if-match", "\"sha256:00\"")
                    .body(Body::from("x"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::PRECONDITION_FAILED);
        assert!(state.space.get_file_meta("nope.md").is_err());

        state.space.write_file("m.md", b"v", None).unwrap();
        let malformed = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/m.md")
                    .header("if-match", "W/\"sha256:beef\"")
                    .body(Body::from("x"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(malformed.status(), StatusCode::PRECONDITION_FAILED);
    }

    #[tokio::test]
    async fn if_match_with_non_visible_ascii_bytes_fails_closed() {
        let state = Arc::new(test_state());
        state.space.write_file("bin.md", b"v1", None).unwrap();
        let req = Request::builder()
            .method("PUT")
            .uri("/.fs/bin.md")
            .header(
                "if-match",
                axum::http::HeaderValue::from_bytes(b"\"sha256:\xFF\"").unwrap(),
            )
            .body(Body::from("v2"))
            .unwrap();
        let resp = crate::build_router(state.clone())
            .oneshot(req)
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::PRECONDITION_FAILED);
        let (data, _) = state.space.read_file("bin.md").unwrap();
        assert_eq!(&data, b"v1");
    }

    #[tokio::test]
    async fn if_none_match_non_star_value_fails_closed() {
        let state = Arc::new(test_state());
        state.space.write_file("q.md", b"v1", None).unwrap();
        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/q.md")
                    .header("if-none-match", "\"sha256:deadbeef\"")
                    .body(Body::from("v2"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::PRECONDITION_FAILED);
        let (data, _) = state.space.read_file("q.md").unwrap();
        assert_eq!(&data, b"v1");
    }

    #[tokio::test]
    async fn if_match_star_passes_iff_file_exists() {
        let state = Arc::new(test_state());
        let missing = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/absent.md")
                    .header("if-match", "*")
                    .body(Body::from("x"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::PRECONDITION_FAILED);

        state.space.write_file("present.md", b"v1", None).unwrap();
        let exists = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/present.md")
                    .header("if-match", "*")
                    .body(Body::from("v2"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(exists.status(), StatusCode::OK);
        let (data, _) = state.space.read_file("present.md").unwrap();
        assert_eq!(&data, b"v2");
    }

    #[tokio::test]
    async fn if_none_match_star_creates_once() {
        let state = Arc::new(test_state());
        let app = crate::build_router(state.clone());
        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/new.md")
                    .header("if-none-match", "*")
                    .body(Body::from("first"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create.status(), StatusCode::OK);
        let dup = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/new.md")
                    .header("if-none-match", "*")
                    .body(Body::from("second"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(dup.status(), StatusCode::PRECONDITION_FAILED);
        let (data, _) = state.space.read_file("new.md").unwrap();
        assert_eq!(&data, b"first");
    }

    #[tokio::test]
    async fn conditional_delete() {
        let state = Arc::new(test_state());
        state.space.write_file("d.md", b"v1", None).unwrap();
        let wrong = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/.fs/d.md")
                    .header("if-match", "\"sha256:deadbeef\"")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::PRECONDITION_FAILED);
        assert!(state.space.read_file("d.md").is_ok());

        let right_etag = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"v1"),
        );
        let right = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/.fs/d.md")
                    .header("if-match", &right_etag)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(right.status(), StatusCode::OK);
        assert!(state.space.read_file("d.md").is_err());
    }

    #[tokio::test]
    async fn concurrent_conditional_puts_exactly_one_wins() {
        let state = Arc::new(test_state());
        state.space.write_file("race.md", b"base", None).unwrap();
        let etag = silverbullet_server_common::revision::etag_for_hash(
            &silverbullet_server_common::revision::sha256_hex(b"base"),
        );
        let req = |body: &'static str| {
            Request::builder()
                .method("PUT")
                .uri("/.fs/race.md")
                .header("if-match", &etag)
                .body(Body::from(body))
                .unwrap()
        };
        let (a, b) = tokio::join!(
            crate::build_router(state.clone()).oneshot(req("A")),
            crate::build_router(state.clone()).oneshot(req("B")),
        );
        let statuses = [a.unwrap().status(), b.unwrap().status()];
        assert!(statuses.contains(&StatusCode::OK));
        assert!(statuses.contains(&StatusCode::PRECONDITION_FAILED));
    }

    fn reconcile_body(
        base_hash: &str,
        base_text: &str,
        proposed_hash: &str,
        proposed_text: &str,
    ) -> Body {
        Body::from(
            serde_json::json!({
                "baseHash": base_hash,
                "baseText": base_text,
                "proposedHash": proposed_hash,
                "proposedText": proposed_text,
            })
            .to_string(),
        )
    }

    #[tokio::test]
    async fn reconcile_fast_forward_applies_proposed() {
        let state = Arc::new(test_state());
        state
            .space
            .write_file("a.md", b"base text\n", None)
            .unwrap();
        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base text\n");
        let proposed = "proposed text\n";
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        "base text\n",
                        &proposed_hash,
                        proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp.headers().get("etag").is_some());
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/json"
        );
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"], "applied");
        assert_eq!(json["revision"]["hash"], proposed_hash);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(&data, proposed.as_bytes());
    }

    #[tokio::test]
    async fn reconcile_records_an_expected_write_for_the_applied_revision() {
        let state = Arc::new(test_state());
        state
            .space
            .write_file("a.md", b"base text\n", None)
            .unwrap();
        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base text\n");
        let proposed = "proposed text\n";
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .header("X-Client-Id", "client-7")
                    .header("X-Source", "sync")
                    .body(reconcile_body(
                        &base_hash,
                        "base text\n",
                        &proposed_hash,
                        proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let ew = state
            .fs_guard
            .lookup_expected_write("a.md", &proposed_hash)
            .expect("expected write recorded for the reconciled revision");
        assert_eq!(ew.client_id.as_deref(), Some("client-7"));
        assert_eq!(ew.source.as_deref(), Some("sync"));
    }

    #[tokio::test]
    async fn reconcile_idempotent_when_current_already_matches_proposed() {
        let state = Arc::new(test_state());
        state
            .space
            .write_file("a.md", b"same text\n", None)
            .unwrap();
        let meta_before = state.space.get_file_meta("a.md").unwrap();

        let base_text = "different base\n";
        let base_hash = silverbullet_server_common::revision::sha256_hex(base_text.as_bytes());
        let proposed = "same text\n";
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        base_text,
                        &proposed_hash,
                        proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"], "applied");

        let meta_after = state.space.get_file_meta("a.md").unwrap();
        assert_eq!(meta_after.last_modified, meta_before.last_modified);
    }

    #[tokio::test]
    async fn reconcile_clean_merge_combines_non_overlapping_edits() {
        let state = Arc::new(test_state());
        let base = "line1\nline2\nline3\n";
        let current = "line1\nline2\nline3-current\n";
        state
            .space
            .write_file("a.md", current.as_bytes(), None)
            .unwrap();

        let proposed = "line1-proposed\nline2\nline3\n";
        let base_hash = silverbullet_server_common::revision::sha256_hex(base.as_bytes());
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let expected = match silverbullet_server_merge::merge(base, proposed, current) {
            silverbullet_server_merge::MergeOutcome::Clean(text) => text,
            other => panic!("expected a clean merge, got {other:?}"),
        };

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(&base_hash, base, &proposed_hash, proposed))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"], "merged");
        assert_eq!(json["text"], expected);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(String::from_utf8(data).unwrap(), expected);
    }

    #[tokio::test]
    async fn reconcile_overlapping_edits_produce_conflict_markers() {
        let state = Arc::new(test_state());
        let base = "line1\nline2\n";
        let current = "current-line1\nline2\n";
        state
            .space
            .write_file("a.md", current.as_bytes(), None)
            .unwrap();

        let proposed = "proposed-line1\nline2\n";
        let base_hash = silverbullet_server_common::revision::sha256_hex(base.as_bytes());
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let expected = match silverbullet_server_merge::merge(base, proposed, current) {
            silverbullet_server_merge::MergeOutcome::Conflicted { text, .. } => text,
            other => panic!("expected a conflict, got {other:?}"),
        };
        assert!(silverbullet_server_merge::contains_conflict_markers(
            &expected
        ));

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(&base_hash, base, &proposed_hash, proposed))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"], "conflicted");
        assert_eq!(json["text"], expected);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(String::from_utf8(data).unwrap(), expected);
    }

    #[tokio::test]
    async fn reconcile_recreates_file_deleted_concurrently() {
        let state = Arc::new(test_state());
        let base_text = "base\n";
        let proposed = "proposed\n";
        let base_hash = silverbullet_server_common::revision::sha256_hex(base_text.as_bytes());
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/gone.md")
                    .body(reconcile_body(
                        &base_hash,
                        base_text,
                        &proposed_hash,
                        proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["status"], "applied");
        let (data, _) = state.space.read_file("gone.md").unwrap();
        assert_eq!(&data, proposed.as_bytes());
    }

    #[tokio::test]
    async fn reconcile_hash_mismatch_is_bad_request() {
        let state = Arc::new(test_state());
        state.space.write_file("a.md", b"original\n", None).unwrap();
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(b"proposed\n");

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        "not-the-real-hash",
                        "base\n",
                        &proposed_hash,
                        "proposed\n",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(&data, b"original\n");
    }

    #[tokio::test]
    async fn reconcile_ineligible_path_is_conflict() {
        let state = Arc::new(test_state());
        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base");
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(b"proposed");

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/image.png")
                    .body(reconcile_body(
                        &base_hash,
                        "base",
                        &proposed_hash,
                        "proposed",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
    }

    #[tokio::test]
    async fn reconcile_rejects_when_current_file_already_has_markers() {
        let state = Arc::new(test_state());
        let marked = "<<<<<<< SB sha256:aa\nx\n=======\ny\n>>>>>>> SB sha256:bb\n";
        state
            .space
            .write_file("a.md", marked.as_bytes(), None)
            .unwrap();

        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base\n");
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(b"proposed\n");

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        "base\n",
                        &proposed_hash,
                        "proposed\n",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn reconcile_rejects_proposed_text_containing_markers() {
        let state = Arc::new(test_state());
        state.space.write_file("a.md", b"current\n", None).unwrap();

        let proposed = "<<<<<<< SB sha256:aa\nx\n=======\ny\n>>>>>>> SB sha256:bb\n";
        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base\n");
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        "base\n",
                        &proposed_hash,
                        proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(&data, b"current\n");
    }

    #[tokio::test]
    async fn reconcile_oversize_proposed_is_413() {
        let state = Arc::new(test_state());
        let base_text = "base\n";
        let proposed = "a".repeat(super::MERGE_SIZE_LIMIT + 1);
        let base_hash = silverbullet_server_common::revision::sha256_hex(base_text.as_bytes());
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        base_text,
                        &proposed_hash,
                        &proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn reconcile_non_utf8_current_file_is_conflict() {
        let state = Arc::new(test_state());
        let invalid_utf8: &[u8] = &[0x62, 0xff, 0xfe, 0x0a];
        state.space.write_file("a.md", invalid_utf8, None).unwrap();

        let base_hash = silverbullet_server_common::revision::sha256_hex(b"base\n");
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(b"proposed\n");

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(reconcile_body(
                        &base_hash,
                        "base\n",
                        &proposed_hash,
                        "proposed\n",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(&data, invalid_utf8);
    }

    #[tokio::test]
    async fn reconcile_malformed_json_body_is_bad_request() {
        let state = Arc::new(test_state());
        state.space.write_file("a.md", b"original\n", None).unwrap();

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/a.md")
                    .body(Body::from("not json"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let (data, _) = state.space.read_file("a.md").unwrap();
        assert_eq!(&data, b"original\n");
    }

    #[tokio::test]
    async fn reconcile_oversize_wins_over_ineligible_path() {
        // Both the size limit (413) and path eligibility (409) are violated;
        // the size check runs first and must win.
        let state = Arc::new(test_state());
        let base_text = "base\n";
        let proposed = "a".repeat(super::MERGE_SIZE_LIMIT + 1);
        let base_hash = silverbullet_server_common::revision::sha256_hex(base_text.as_bytes());
        let proposed_hash = silverbullet_server_common::revision::sha256_hex(proposed.as_bytes());

        let resp = crate::build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.fs/image.png")
                    .body(reconcile_body(
                        &base_hash,
                        base_text,
                        &proposed_hash,
                        &proposed,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}
