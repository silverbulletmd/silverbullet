//! The admin-only REST API: space and account management. It carries no shell,
//! assets or login of its own — it is nested under `/api/admin` on the unified
//! `/.spaces` surface (see `space_index`), which owns the session. Sessions use
//! the same host-wide account cookie as every prefix-bound space.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{Path as AxumPath, Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::oidc::store::ProviderStore;
use crate::auth::{Authenticator, JwtAuthorizer, RequestAuthorizer};
use crate::multi::access::UserTokenAuthorizer;
use crate::multi::config::{GitSyncMode, SpaceConfig};
use crate::multi::instance::SpaceInstance;
use crate::multi::manager::{ApiError, MultiManager};
use crate::multi::users::{Profile, UserStore};
use crate::revisions::{describe_sync_error, git, keys, redact_credentials, sync};
use crate::router::run_blocking;

pub struct AdminState {
    pub manager: Arc<MultiManager>,
    pub authorizer: Arc<dyn RequestAuthorizer>,
    /// Same credentials, without the admin requirement. Used only to tell
    /// "not logged in" (401) apart from "logged in, but not an admin" (403);
    /// it never grants access on its own.
    pub account_authorizer: Arc<dyn RequestAuthorizer>,
    pub users: Arc<UserStore>,
    /// Server-wide, resolved at startup — see `RuntimeAvailability`.
    pub runtime_availability: crate::runtime::RuntimeAvailability,
    pub provider_store: Option<Arc<ProviderStore>>,
}

impl AdminState {
    /// Uses the same server-wide authenticator as every space. Sessions are
    /// minted by the unified `/.spaces` surface; this state only *authorizes*,
    /// and both cookie sessions and bearer tokens are restricted to current
    /// administrators.
    pub fn new(
        manager: Arc<MultiManager>,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
        runtime_availability: crate::runtime::RuntimeAvailability,
    ) -> Self {
        let is_admin_token = {
            let store = users.clone();
            move |u: &str| store.is_admin(u)
        };
        let is_admin_session = {
            let store = users.clone();
            move |claims: &crate::auth::authenticator::Claims| {
                store.session_is_current(&claims.username, claims.credential_version.as_deref())
                    && store.is_admin(&claims.username)
            }
        };
        let jwt = JwtAuthorizer::with_filter(
            authenticator.clone(),
            String::new(),
            String::new(),
            Box::new(is_admin_session),
        );
        let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(UserTokenAuthorizer::new(
            Box::new(jwt),
            users.clone(),
            Box::new(is_admin_token),
        ));
        let is_current_session = {
            let store = users.clone();
            move |claims: &crate::auth::authenticator::Claims| {
                store.session_is_current(&claims.username, claims.credential_version.as_deref())
            }
        };
        let account_jwt = JwtAuthorizer::with_filter(
            authenticator,
            String::new(),
            String::new(),
            Box::new(is_current_session),
        );
        let account_authorizer: Arc<dyn RequestAuthorizer> = Arc::new(UserTokenAuthorizer::new(
            Box::new(account_jwt),
            users.clone(),
            Box::new(|user: &str| !user.is_empty()),
        ));
        Self {
            manager,
            authorizer,
            account_authorizer,
            users,
            runtime_availability,
            provider_store: None,
        }
    }

    pub fn with_provider_store(mut self, provider_store: Arc<ProviderStore>) -> Self {
        self.provider_store = Some(provider_store);
        self
    }
}

/// Gates every admin API route, distinguishing the two failure modes the
/// client has to treat differently: **401** means there is no valid session,
/// so the browser should go log in; **403** means the caller *is* signed in
/// but is not an administrator, which is a dead end — redirecting it to the
/// login screen would bounce straight back here and loop forever.
async fn require_admin(State(state): State<Arc<AdminState>>, req: Request, next: Next) -> Response {
    // `state.authorizer` alone decides pass/fail. `account_authorizer` is only
    // consulted on the failure path, to choose between 401 and 403 — it must
    // never be able to admit a request that `state.authorizer` rejected.
    let rejection = {
        let ctx = crate::auth::AuthContext {
            method: req.method(),
            path: req.uri().path(),
            query: req.uri().query(),
            headers: req.headers(),
        };
        if state.authorizer.is_authorized(&ctx) {
            None
        } else if state.account_authorizer.is_authorized(&ctx) {
            Some((StatusCode::FORBIDDEN, "Forbidden"))
        } else {
            Some((StatusCode::UNAUTHORIZED, "Unauthorized"))
        }
    };
    match rejection {
        None => next.run(req).await,
        Some(r) => r.into_response(),
    }
}

async fn handle_runtimes(State(state): State<Arc<AdminState>>) -> Response {
    match run_blocking(move || Ok(state.manager.runtime_instances())).await {
        Ok(instances) => Json(instances).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_stop_runtime(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    manage_runtime(state, id, false).await
}

async fn handle_reset_runtime(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    manage_runtime(state, id, true).await
}

async fn manage_runtime(state: Arc<AdminState>, id: String, reset: bool) -> Response {
    match run_blocking(move || Ok(state.manager.manage_runtime(&id, reset))).await {
        Ok(Ok(true)) => StatusCode::NO_CONTENT.into_response(),
        Ok(Ok(false)) => (
            StatusCode::NOT_FOUND,
            Json(json!({"errors": [{"field": "", "message": "Runtime no longer exists"}]})),
        )
            .into_response(),
        Ok(Err(error)) => {
            tracing::error!(%error, "runtime management failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"errors": [{"field": "", "message": "Could not stop or reset runtime. Please retry."}]})),
            )
                .into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_server_config(State(state): State<Arc<AdminState>>) -> Response {
    Json(json!({ "primaryUrl": state.manager.primary_url(), "serverName": state.manager.server_name(), "runtimeApi": state.manager.runtime_enabled() })).into_response()
}

async fn handle_set_server_config(
    State(state): State<Arc<AdminState>>,
    Json(value): Json<serde_json::Value>,
) -> Response {
    let mut fields = [None, None];
    for (index, field) in ["primaryUrl", "serverName"].iter().enumerate() {
        if let Some(value) = value.get(field) {
            let Some(text) = value.as_str() else {
                return api_error(ApiError::Validation(vec![
                    crate::multi::validate::FieldError {
                        field: (*field).into(),
                        message: format!("{field} must be a string"),
                    },
                ]));
            };
            fields[index] = Some(text);
        }
    }
    if !value.is_object() {
        return api_error(ApiError::Validation(vec![
            crate::multi::validate::FieldError {
                field: "serverName".into(),
                message: "server configuration must be an object".into(),
            },
        ]));
    }
    let runtime_api = match value.get("runtimeApi") {
        None => None,
        Some(value) => match value.as_bool() {
            Some(enabled) => Some(enabled),
            None => {
                return api_error(ApiError::Validation(vec![
                    crate::multi::validate::FieldError {
                        field: "runtimeApi".into(),
                        message: "runtimeApi must be a boolean".into(),
                    },
                ]))
            }
        },
    };
    match state
        .manager
        .set_server_config(fields[0], fields[1], runtime_api)
    {
        Ok(()) => handle_server_config(State(state)).await,
        Err(error) => api_error(error),
    }
}

async fn handle_list(State(state): State<Arc<AdminState>>) -> Response {
    Json(state.manager.list()).into_response()
}

fn api_error(e: ApiError) -> Response {
    match e {
        ApiError::Validation(errors) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
        }
        ApiError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(json!({ "errors": [{ "field": "id", "message": "no such space" }] })),
        )
            .into_response(),
        ApiError::Internal(msg) => {
            tracing::error!("admin API internal error: {msg}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "errors": [{ "field": "", "message": msg }] })),
            )
                .into_response()
        }
    }
}

/// Maps `UserStore`'s plain `Err(String)` to a response: a message starting
/// with "no such" (missing user/token) is 404; everything else — invalid
/// username, duplicate username/token, the last-admin guards — is 400. The
/// `field` is derived from the known message prefixes/strings `UserStore`
/// actually produces (see `multi::users`) so the admin UI can highlight the
/// right input; anything unrecognized falls back to `""`. The last-admin
/// guards are matched by their exact strings (not a substring heuristic)
/// so an unrelated message that happens to mention "admin" doesn't get
/// mis-tagged.
fn user_store_error(msg: String) -> Response {
    if msg.starts_with("no such") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "errors": [{ "field": "", "message": msg }] })),
        )
            .into_response();
    }
    let field = if msg.starts_with("invalid username") || msg.starts_with("user ") {
        "username"
    } else if msg.starts_with("invalid SSO provider") {
        "providerId"
    } else if msg.starts_with("invalid SSO enrollment") || msg.starts_with("SSO enrollment") {
        "expectedEmail"
    } else if msg.starts_with("full name") {
        "fullName"
    } else if msg.starts_with("email") {
        "email"
    } else if msg.starts_with("token ") {
        "name"
    } else if msg == "cannot remove the last admin"
        || msg == "cannot demote the last admin"
        || msg == "cannot disable the last admin"
    {
        "admin"
    } else {
        ""
    };
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "errors": [{ "field": field, "message": msg }] })),
    )
        .into_response()
}

fn default_true() -> bool {
    true
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CreateLoginMethod {
    #[default]
    Local,
    Sso,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    #[serde(default = "default_true")]
    seed_index: bool,
    #[serde(flatten)]
    config: SpaceConfig,
}

async fn handle_create(
    State(state): State<Arc<AdminState>>,
    Json(body): Json<CreateBody>,
) -> Response {
    let manager = state.manager.clone();
    let CreateBody {
        seed_index,
        mut config,
    } = body;
    config.git_sync = None;
    match run_blocking(move || Ok(manager.create(config, seed_index))).await {
        Ok(Ok(id)) => Json(json!({ "id": id })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_update(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(cfg): Json<SpaceConfig>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.update(&id, cfg))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_get(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.manager.get(&id) {
        Some(v) => Json(v).into_response(),
        None => api_error(ApiError::NotFound),
    }
}

async fn handle_patch(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<serde_json::Map<String, serde_json::Value>>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.patch(&id, body))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_delete(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let manager = state.manager.clone();
    match run_blocking(move || Ok(manager.delete(&id))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    remote_url: Option<String>,
    remote_name: Option<String>,
    branch: Option<String>,
    credential_mode: GitSyncMode,
    public_key: Option<String>,
    fingerprint: Option<String>,
    ahead: Option<usize>,
    behind: Option<usize>,
    sync: serde_json::Value,
    last_attempt: Option<u64>,
    last_success: Option<u64>,
    version: u64,
    enabled: bool,
    paused: bool,
    dirty: bool,
    pull_interval_secs: u64,
}

fn rev_list_left_right(repo: &Path, left: &str, right: &str) -> Option<(usize, usize)> {
    let out = git::run(
        repo,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{left}...{right}"),
        ],
        &[],
    )
    .ok()?;
    let mut parts = out.split_whitespace();
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn local_commit_count(repo: &Path) -> Option<usize> {
    git::run(repo, &["rev-list", "--count", "HEAD"], &[])
        .ok()
        .and_then(|s| s.trim().parse::<usize>().ok())
}

fn ahead_behind_status(
    repo: &Path,
    target: Option<&sync::RemoteTarget>,
) -> (Option<usize>, Option<usize>) {
    let Some(target) = target else {
        return (local_commit_count(repo), None);
    };
    if let Ok((a, b)) = sync::ahead_behind(repo, &target.branch) {
        return (Some(a), Some(b));
    }
    let tracking_ref = format!("refs/remotes/{}/{}", target.remote, target.branch);
    if git::check(
        repo,
        &["rev-parse", "--verify", "--quiet", &tracking_ref],
        1,
    )
    .unwrap_or(false)
    {
        if let Some((a, b)) = rev_list_left_right(repo, &target.branch, &tracking_ref) {
            return (Some(a), Some(b));
        }
    }
    (local_commit_count(repo), None)
}

/// The repository these routes may touch. `resolve_folder` resolves upward,
/// so on a space nested inside a larger repo it hands back the *enclosing*
/// repository -- which `set_remote` would then write to. The store already
/// refused that space (`auto_commit_allowed` is false), so ask it instead.
pub(super) fn syncable_repo(instance: &SpaceInstance) -> Option<PathBuf> {
    let store = instance.revisions.as_ref()?.store();
    store.auto_commit_allowed().then(|| store.repo_root())?
}

/// Carries a `kind` alongside the usual `errors` array: the admin form has
/// to tell "sync is impossible for this space" apart from "the request
/// failed", and only the former is worth blocking a save over.
fn not_syncable() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({
            "errors": [{
                "field": "revisions",
                "message": "Git sync requires a managed repository of its own. Git sync is unavailable when the space repository contains server settings or keys; use a separate space folder.",
            }],
            "kind": "notSyncable",
        })),
    )
        .into_response()
}

fn remote_url(repo: &Path, remote: &str) -> Option<String> {
    git::run(
        repo,
        &["config", "--get", &format!("remote.{remote}.url")],
        &[],
    )
    .ok()
    .map(|s| s.trim().to_string())
}

fn git_status(repo: &Path, server_root: &Path, id: &str, mode: GitSyncMode) -> GitStatus {
    let target = sync::resolve_target(repo).ok();
    let remote_url = target.as_ref().and_then(|t| remote_url(repo, &t.remote));
    let (ahead, behind) = ahead_behind_status(repo, target.as_ref());
    let public_key = keys::public_key(server_root, id);
    let fingerprint = keys::fingerprint(server_root, id);
    GitStatus {
        remote_url,
        remote_name: target.as_ref().map(|t| t.remote.clone()),
        branch: target.as_ref().map(|t| t.branch.clone()),
        credential_mode: mode,
        public_key,
        fingerprint,
        ahead,
        behind,
        sync: json!({ "state": "idle" }),
        last_attempt: None,
        last_success: None,
        version: 0,
        enabled: !mode.is_off(),
        paused: false,
        dirty: false,
        pull_interval_secs: 300,
    }
}

async fn handle_git_status(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let Some(instance) = state.manager.instance(&id) else {
        return api_error(ApiError::NotFound);
    };
    let Some(repo) = syncable_repo(&instance) else {
        return not_syncable();
    };
    let root = state.manager.root().to_path_buf();
    let engine = instance.revisions.clone();
    let id_for_keys = id.clone();
    let mode = instance.config.git_sync().mode;
    let cadence = instance.config.git_sync().pull_interval_secs;
    let result = run_blocking(move || {
        let mut status = git_status(&repo, &root, &id_for_keys, mode);
        if let Some(engine) = engine {
            let snapshot = engine.sync_snapshot();
            status.sync = serde_json::to_value(&snapshot.sync).unwrap();
            status.last_attempt = snapshot.last_attempt;
            status.last_success = snapshot.last_success;
            status.version = snapshot.version;
            status.enabled = snapshot.enabled;
            status.paused = snapshot.paused;
            status.dirty = snapshot.dirty;
            status.ahead = snapshot.pending.or(status.ahead);
            status.behind = snapshot.incoming.or(status.behind);
        }
        status.pull_interval_secs = cadence;
        Ok(status)
    })
    .await;
    match result {
        Ok(status) => Json(status).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub(super) fn classify_git_test_error(stderr: &str) -> (&'static str, String) {
    // git echoes the whole remote URL on an HTTPS failure, credentials and
    // all, and this message is rendered by the client.
    let message = redact_credentials(stderr).trim().to_string();
    let lower = message.to_ascii_lowercase();
    let kind = if lower.contains("permission denied")
        || lower.contains("authentication failed")
        || (lower.contains("permission to") && lower.contains("denied"))
        || lower.contains("write access to repository")
        || lower.contains("not allowed to push")
    {
        "authFailed"
    } else if lower.contains("not found")
        || lower.contains("does not exist")
        || lower.contains("does not appear to be a git repository")
    {
        "notFound"
    } else if lower.contains("could not resolve hostname")
        || lower.contains("connection timed out")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
        || lower.contains("could not read from remote repository")
    {
        "unreachable"
    } else if lower.contains("non-fast-forward") || lower.contains("[rejected]") {
        "behind"
    } else {
        "other"
    };
    (kind, message)
}

async fn legacy_git_mutation() -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"kind":"draftRequired","errors":[{"field":"gitSync","message":"use a connection draft to change or check Git sync"}]}))).into_response()
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SyncBody {
    #[serde(default)]
    _allow_unrelated: bool,
}

fn tick_outcome_json(outcome: sync::TickOutcome) -> serde_json::Value {
    match outcome {
        sync::TickOutcome::Idle => json!({ "outcome": "idle" }),
        sync::TickOutcome::Merged => json!({ "outcome": "merged" }),
        sync::TickOutcome::Pushed => json!({ "outcome": "pushed" }),
        sync::TickOutcome::MergedAndPushed => json!({ "outcome": "mergedAndPushed" }),
        sync::TickOutcome::Conflicted(paths) => {
            json!({ "outcome": "conflicted", "paths": paths })
        }
    }
}

async fn handle_git_sync_now(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
    Json(_body): Json<SyncBody>,
) -> Response {
    let Some(instance) = state.manager.instance(&id) else {
        return api_error(ApiError::NotFound);
    };
    let Some(engine) = instance.revisions.clone() else {
        return api_error(ApiError::Internal(
            "git sync is not enabled for this space".into(),
        ));
    };
    if syncable_repo(&instance).is_none() {
        return not_syncable();
    }
    let result = run_blocking(move || Ok(engine.sync_now(false))).await;
    match result {
        Ok(Ok(outcome)) => Json(tick_outcome_json(outcome)).into_response(),
        Ok(Err(e)) => {
            let (kind, message) = describe_sync_error(&e);
            let fallback = if message.is_empty() {
                kind.clone()
            } else {
                message.clone()
            };
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "errors": [{ "field": "", "message": fallback }],
                    "kind": kind,
                    "message": message,
                })),
            )
                .into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_list_users(State(state): State<Arc<AdminState>>) -> Response {
    Json(state.users.list()).into_response()
}

async fn handle_get_user(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    match state.users.get(&name) {
        Some(user) => Json(user).into_response(),
        None => user_store_error(format!("no such user {name:?}")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateUserBody {
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    login_method: CreateLoginMethod,
    #[serde(default)]
    provider_id: String,
    #[serde(default)]
    expected_email: String,
    #[serde(default)]
    admin: bool,
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    email: String,
}

async fn handle_create_user(
    State(state): State<Arc<AdminState>>,
    Json(body): Json<CreateUserBody>,
) -> Response {
    let profile = match Profile::parse(&body.full_name, &body.email) {
        Ok(profile) => profile,
        Err(e) => return user_store_error(e),
    };
    let users = state.users.clone();
    let active_provider_id = state
        .provider_store
        .as_ref()
        .and_then(|providers| providers.active())
        .map(|provider| provider.provider_id);
    let result = run_blocking(move || match body.login_method {
        CreateLoginMethod::Local => {
            Ok(users.create_user(&body.username, &body.password, body.admin, profile))
        }
        CreateLoginMethod::Sso => {
            let provider_id = match uuid::Uuid::parse_str(&body.provider_id) {
                Ok(provider_id) => provider_id.to_string(),
                Err(_) => return Ok(Err("invalid SSO provider ID".into())),
            };
            if active_provider_id.as_deref() != Some(provider_id.as_str()) {
                return Ok(Err("invalid SSO provider: provider is not active".into()));
            }
            Ok(users.create_sso_user(
                &body.username,
                &provider_id,
                &body.expected_email,
                body.admin,
                profile,
            ))
        }
    })
    .await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileBody {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    email: String,
}

async fn handle_set_user_profile(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<ProfileBody>,
) -> Response {
    let profile = match Profile::parse(&body.full_name, &body.email) {
        Ok(profile) => profile,
        Err(e) => return user_store_error(e),
    };
    let users = state.users.clone();
    match run_blocking(move || Ok(users.set_profile(&name, profile))).await {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Deletes the account first, then atomically sweeps it out of every space's
/// `members` and shrinks the manager's known-users set to the store's
/// post-delete usernames.
async fn handle_delete_user(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    let users = state.users.clone();
    let name_for_store = name.clone();
    match run_blocking(move || Ok(users.delete_user(&name_for_store))).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return user_store_error(e),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
    state.manager.revoke_user_runtime(&name);
    let manager = state.manager.clone();
    let users_for_sweep = state.users.clone();
    let name_for_sweep = name;
    match run_blocking(move || {
        let new_known_users = users_for_sweep.usernames();
        Ok(manager.remove_member_everywhere(&name_for_sweep, new_known_users))
    })
    .await
    {
        Ok(Ok(())) => Json(json!({ "status": "ok" })).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

async fn handle_set_user_password(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<PasswordBody>,
) -> Response {
    let users = state.users.clone();
    let runtime_user = name.clone();
    let result = run_blocking(move || Ok(users.set_password(&name, &body.password))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.revoke_user_runtime(&runtime_user);
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// Signs `name` out of every session — the only revocation lever for an
/// account with no password to change.
async fn handle_delete_sessions(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    let users = state.users.clone();
    let runtime_user = name.clone();
    let result = run_blocking(move || Ok(users.bump_session_epoch(&name))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.revoke_user_runtime(&runtime_user);
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct SetAdminBody {
    admin: bool,
}

async fn handle_set_admin(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<SetAdminBody>,
) -> Response {
    let users = state.users.clone();
    let runtime_user = name.clone();
    let result = run_blocking(move || Ok(users.set_admin(&name, body.admin))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.revoke_user_runtime(&runtime_user);
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct SetDisabledBody {
    disabled: bool,
}

async fn handle_set_disabled(
    State(state): State<Arc<AdminState>>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<SetDisabledBody>,
) -> Response {
    let users = state.users.clone();
    let runtime_user = name.clone();
    match run_blocking(move || Ok(users.set_disabled(&name, body.disabled))).await {
        Ok(Ok(())) => {
            state.manager.revoke_user_runtime(&runtime_user);
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct CreateTokenBody {
    name: String,
}

async fn handle_create_token(
    State(state): State<Arc<AdminState>>,
    AxumPath(user): AxumPath<String>,
    Json(body): Json<CreateTokenBody>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.create_token(&user, &body.name))).await;
    match result {
        Ok(Ok(token)) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "token": token })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_delete_token(
    State(state): State<Arc<AdminState>>,
    AxumPath((user, token_name)): AxumPath<(String, String)>,
) -> Response {
    let users = state.users.clone();
    let result = run_blocking(move || Ok(users.delete_token(&user, &token_name))).await;
    match result {
        Ok(Ok(())) => {
            state.manager.set_known_users(state.users.usernames());
            Json(json!({ "status": "ok" })).into_response()
        }
        Ok(Err(e)) => user_store_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

#[derive(Deserialize)]
struct DirsQuery {
    #[serde(default)]
    path: String,
}

async fn handle_fs_dirs(
    State(state): State<Arc<AdminState>>,
    axum::extract::Query(q): axum::extract::Query<DirsQuery>,
) -> Response {
    let root = state.manager.root().to_path_buf();
    let result = run_blocking(move || Ok(dir_completion(&root, &q.path))).await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

async fn handle_server_info(State(state): State<Arc<AdminState>>) -> Response {
    Json(json!({ "runtimeApi": state.runtime_availability, "runtimeApiEnabled": state.manager.runtime_enabled(), "primaryUrl": state.manager.primary_url() })).into_response()
}

/// Path status + subdirectory suggestions for a folder-picker field. Relative
/// input resolves against the server root; directory names only. Shared with
/// the setup surface (`GET /.setup/api/fs/dirs`) so both the admin space form
/// and the first-run wizard drive the same picker off one implementation.
pub(crate) fn dir_completion(root: &std::path::Path, input: &str) -> serde_json::Value {
    let input_is_absolute = std::path::Path::new(input).is_absolute();
    let resolved = {
        let p = std::path::Path::new(input);
        if input_is_absolute {
            p.to_path_buf()
        } else {
            root.join(p)
        }
    };
    let status = match std::fs::metadata(&resolved) {
        Ok(m) if m.is_dir() => "exists",
        Ok(_) => "notADirectory",
        Err(_) => "missing",
    };
    let writable = status == "exists"
        && std::fs::metadata(&resolved)
            .map(|m| !m.permissions().readonly())
            .unwrap_or(false);

    let (parent, partial) = if status == "exists" || input.ends_with('/') {
        (resolved.clone(), String::new())
    } else {
        (
            resolved
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| root.to_path_buf()),
            resolved
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
    };
    let mut suggestions: Vec<String> = std::fs::read_dir(&parent)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    !name.starts_with('.') && name.starts_with(&partial)
                })
                .map(|e| {
                    let path = e.path();
                    // For relative input, keep suggestions relative to the
                    // server root; absolute input keeps absolute suggestions.
                    let shown = if input_is_absolute {
                        path.as_path()
                    } else {
                        path.strip_prefix(root).unwrap_or(path.as_path())
                    };
                    shown.to_string_lossy().to_string()
                })
                .collect()
        })
        .unwrap_or_default();
    suggestions.sort();
    suggestions.truncate(50);

    json!({ "status": status, "writable": writable, "suggestions": suggestions })
}

/// The admin route table. Deliberately returns an UNGATED router: the gate is
/// applied by the only caller, `build_admin_api_router`. Add new admin routes
/// here — because this function cannot express a layer, a route added anywhere
/// in it is gated, with no ordering rule to remember.
fn admin_api_routes() -> Router<Arc<AdminState>> {
    Router::new()
        .route("/spaces", get(handle_list).post(handle_create))
        .route(
            "/spaces/{id}",
            get(handle_get)
                .put(handle_update)
                .patch(handle_patch)
                .delete(handle_delete),
        )
        .merge(super::git_connection::routes())
        .route("/spaces/{id}/git", get(handle_git_status))
        .route(
            "/spaces/{id}/git/remote",
            axum::routing::put(legacy_git_mutation),
        )
        .route(
            "/spaces/{id}/git/key",
            post(legacy_git_mutation).delete(legacy_git_mutation),
        )
        .route("/spaces/{id}/git/test", post(legacy_git_mutation))
        .route("/spaces/{id}/git/sync", post(handle_git_sync_now))
        .route("/fs/dirs", get(handle_fs_dirs))
        .route("/server-info", get(handle_server_info))
        .route("/runtimes", get(handle_runtimes))
        .route("/runtimes/{id}/stop", post(handle_stop_runtime))
        .route("/runtimes/{id}/reset", post(handle_reset_runtime))
        .route(
            "/server-config",
            get(handle_server_config).put(handle_set_server_config),
        )
        .route("/users", get(handle_list_users).post(handle_create_user))
        .route(
            "/users/{name}",
            get(handle_get_user)
                .put(handle_set_admin)
                .delete(handle_delete_user),
        )
        .route("/users/{name}/password", post(handle_set_user_password))
        .route("/users/{name}/disabled", post(handle_set_disabled))
        .route(
            "/users/{name}/sessions",
            axum::routing::delete(handle_delete_sessions),
        )
        .route(
            "/users/{name}/profile",
            axum::routing::put(handle_set_user_profile),
        )
        .route("/users/{name}/tokens", post(handle_create_token))
        .route(
            "/users/{name}/tokens/{token_name}",
            axum::routing::delete(handle_delete_token),
        )
}

/// The admin-only API surface, gated by a single `require_admin` layer.
///
/// Returned already finalized with its state so it can be nested into a router
/// carrying a different state type.
pub fn build_admin_api_router(state: Arc<AdminState>) -> Router {
    admin_api_routes()
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin))
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use crate::multi::manager::MultiManager;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn test_authenticator() -> Arc<Authenticator> {
        Arc::new(Authenticator::from_secret_bytes(vec![9; 32], "v1".into()))
    }

    fn deps(
        root: &std::path::Path,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
    ) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            runtime: Arc::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users,
                authenticator,
                session: crate::multi::access::SessionPolicy::default(),
            },
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: false,
            index_template: "# Test space\n".into(),
            shutdown: None,
        }
    }

    pub(crate) fn admin_router(
        dir: &tempfile::TempDir,
    ) -> (axum::Router, Arc<MultiManager>, Arc<UserStore>) {
        admin_router_with_runtime(dir, crate::runtime::RuntimeAvailability::Available)
    }

    pub(crate) fn admin_router_with_runtime(
        dir: &tempfile::TempDir,
        runtime_availability: crate::runtime::RuntimeAvailability,
    ) -> (axum::Router, Arc<MultiManager>, Arc<UserStore>) {
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("admin", "adminpw1", true, Profile::default())
            .unwrap();
        let authenticator = test_authenticator();
        let manager = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path(), users.clone(), authenticator.clone()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        let state = Arc::new(AdminState::new(
            manager.clone(),
            users.clone(),
            authenticator,
            runtime_availability,
        ));
        // Nested at `/api` so these tests address the same URIs the unified
        // surface exposes at `/api/admin/...` minus its own prefix.
        let router = axum::Router::new().nest("/api", build_admin_api_router(state));
        (router, manager, users)
    }

    fn admin_router_with_provider(
        dir: &tempfile::TempDir,
    ) -> (axum::Router, Arc<UserStore>, String) {
        let (_router, manager, users) = admin_router(dir);
        let providers = Arc::new(ProviderStore::open(dir.path()).unwrap());
        let revision = providers
            .save_draft(crate::auth::oidc::config::ProviderConfig {
                provider_id: String::new(),
                preset: "oidc".into(),
                issuer: "https://identity.example.test".into(),
                central_origin: "https://login.example.test".into(),
                client_id: "silverbullet".into(),
                client_secret: "test-secret".into(),
                workspace_domain: String::new(),
                button_label: "Continue with Example".into(),
            })
            .unwrap();
        providers.mark_tested(revision).unwrap();
        providers.activate(revision).unwrap();
        let provider_id = providers.active().unwrap().provider_id;
        let state = Arc::new(
            AdminState::new(
                manager,
                users.clone(),
                test_authenticator(),
                crate::runtime::RuntimeAvailability::Available,
            )
            .with_provider_store(providers),
        );
        let router = axum::Router::new().nest("/api", build_admin_api_router(state));
        (router, users, provider_id)
    }

    /// The API no longer mints sessions — `/.spaces/api/login` does (see
    /// `space_index`). `test_authenticator()` is deterministic, so forge the
    /// very cookie that surface would have set. Reading `credential_version`
    /// live keeps the forged session subject to revocation exactly as a real
    /// one is.
    fn session_cookie(users: &UserStore, username: &str) -> String {
        let jwt = test_authenticator()
            .issue_jwt_with_version(
                username,
                users.credential_version(username).unwrap_or_default(),
                3600,
            )
            .unwrap();
        format!(
            "{}={jwt}",
            crate::auth::scoped_auth_cookie_name("localhost", "")
        )
    }

    async fn send(router: &axum::Router, req: Request<Body>) -> axum::response::Response {
        router.clone().oneshot(req).await.unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .header("host", "localhost")
            .body(Body::empty())
            .unwrap()
    }

    fn del(uri: &str) -> Request<Body> {
        Request::builder()
            .method("DELETE")
            .uri(uri)
            .header("host", "localhost")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn runtime_server_toggle_persists_and_preserves_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _manager, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"runtimeApi":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_json(response).await["runtimeApi"], false);
        let stored =
            super::super::server_config::ServerConfig::load(&dir.path().join("server.json"))
                .unwrap();
        assert!(!stored.runtime_api);
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"serverName":"Notebook"}"#,
            &cookie,
        )
        .await;
        assert_eq!(body_json(response).await["runtimeApi"], false);
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"runtimeApi":"yes"}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn server_config_is_admin_gated_and_reports_validation_errors() {
        let dir = tempfile::tempdir().unwrap();
        let (router, manager, users) = admin_router(&dir);
        assert_eq!(
            send(&router, get("/api/server-config")).await.status(),
            StatusCode::UNAUTHORIZED
        );
        let cookie = session_cookie(&users, "admin");
        let response = authed(&router, "GET", "/api/server-config", "", &cookie).await;
        assert_eq!(
            body_json(response).await,
            json!({ "primaryUrl": null, "serverName": "SilverBullet", "runtimeApi": true })
        );
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"primaryUrl":"ftp://notes.example.test"}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body_json(response).await["errors"][0]["field"],
            "primaryUrl"
        );
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"primaryUrl":"https://Manager.Example.test/"}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_json(response).await["primaryUrl"],
            "https://manager.example.test"
        );
        assert_eq!(
            manager.primary_url().as_deref(),
            Some("https://manager.example.test")
        );
    }

    #[tokio::test]
    async fn server_name_updates_preserve_primary_url_and_omitted_name() {
        let dir = tempfile::tempdir().unwrap();
        let (router, manager, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        manager
            .set_primary_url("https://manager.example.test")
            .unwrap();
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"serverName":"  Notebook Server  "}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_json(response).await,
            json!({"primaryUrl":"https://manager.example.test", "serverName":"Notebook Server", "runtimeApi":true})
        );
        let response = authed(
            &router,
            "PUT",
            "/api/server-config",
            r#"{"primaryUrl":"https://other.example.test"}"#,
            &cookie,
        )
        .await;
        assert_eq!(body_json(response).await["serverName"], "Notebook Server");
        for value in [
            json!({"serverName":"  "}),
            json!({"serverName":null}),
            json!({"serverName":"x".repeat(101)}),
        ] {
            let response = authed(
                &router,
                "PUT",
                "/api/server-config",
                &value.to_string(),
                &cookie,
            )
            .await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                body_json(response).await["errors"][0]["field"],
                "serverName"
            );
        }
        assert_eq!(manager.server_name(), "Notebook Server");
    }

    #[tokio::test]
    async fn server_info_reports_runtime_availability_and_is_admin_gated() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _manager, users) =
            admin_router_with_runtime(&dir, crate::runtime::RuntimeAvailability::NoChrome);

        let resp = send(&router, get("/api/server-info")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        let cookie = session_cookie(&users, "admin");
        let resp = authed(&router, "GET", "/api/server-info", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            body_json(resp).await,
            serde_json::json!({ "runtimeApi": { "status": "no_chrome" }, "runtimeApiEnabled": true, "primaryUrl": null }),
        );
    }

    #[test]
    fn admin_and_spaces_share_one_authenticator() {
        use crate::multi::config::{Binding, SpaceAccess, SpaceConfig};
        use crate::multi::instance::{build_instance, InstanceStatus};

        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("admin", "adminpw1", true, Profile::default())
            .unwrap();
        let authenticator = test_authenticator();

        // The admin surface persists its signing secret to the *admin* file
        // under the data root.
        let manager = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path(), users.clone(), authenticator.clone()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        AdminState::new(
            manager,
            users.clone(),
            authenticator.clone(),
            crate::runtime::RuntimeAvailability::Available,
        );

        // A private (users-backed) space whose folder resolves to the data
        // root persists its own secret to the *space* file in that same dir.
        let cfg = SpaceConfig {
            name: "Root".into(),
            folder: dir.path().to_str().unwrap().to_string(),
            binding: Binding::Prefix { prefix: "/".into() },
            access: Some(SpaceAccess::None),
            legacy_public: None,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            git_sync: None,
            revisions_commit: None,
            extra: Default::default(),
        };
        let inst = build_instance(
            "root",
            &cfg,
            &deps(dir.path(), users.clone(), authenticator.clone()),
        );
        assert!(
            matches!(inst.status, InstanceStatus::Running),
            "{:?}",
            inst.status
        );

        assert!(Arc::strong_count(&authenticator) > 1);
    }

    #[tokio::test]
    async fn api_is_gated_and_an_admin_session_unlocks_it() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        assert_eq!(
            send(&r, get("/api/spaces")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        let cookie = session_cookie(&users, "admin");
        assert!(cookie.starts_with("auth_localhost="), "{cookie}");
        let resp = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        // A valid session for a *non-admin* account is still refused — but as
        // 403, not 401: the caller is signed in, so sending it to the login
        // screen would only bounce it back here.
        users
            .create_user("bob", "pw123456", false, Profile::default())
            .unwrap();
        let bob = session_cookie(&users, "bob");
        let resp = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &bob)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    /// The 401/403 split the unified `/.spaces` client depends on: no session
    /// at all is 401 (go log in), a valid non-admin session is 403 (a dead
    /// end the client must render as an error, never as a redirect).
    #[tokio::test]
    async fn admin_api_is_401_without_a_session_and_403_for_a_non_admin() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);

        assert_eq!(
            send(&r, get("/api/spaces")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        let garbage = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", "auth_localhost=not-a-jwt")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(garbage.status(), StatusCode::UNAUTHORIZED);

        users
            .create_user("alice", "alicepw12", false, Profile::default())
            .unwrap();
        let alice = session_cookie(&users, "alice");
        let forbidden = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &alice)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        // Promoting her flips the same session to allowed, confirming the 403
        // was about the role and not about the session being unreadable.
        users.set_admin("alice", true).unwrap();
        let allowed = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("cookie", &alice)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    async fn authed(
        router: &axum::Router,
        method: &str,
        uri: &str,
        body: &str,
        cookie: &str,
    ) -> axum::response::Response {
        send(
            router,
            Request::builder()
                .method(method)
                .uri(uri)
                .header("host", "localhost")
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(if body.is_empty() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
    }

    async fn body_json(resp: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// Create a space through the API and return its id.
    async fn create_space(router: &axum::Router, cookie: &str, body: &str) -> String {
        let resp = authed(router, "POST", "/api/spaces", body, cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        body_json(resp).await["id"].as_str().unwrap().to_string()
    }

    fn git_run(repo: &std::path::Path, args: &[&str]) -> String {
        crate::revisions::git::run(repo, args, &[]).unwrap()
    }

    fn space_folder(root: &std::path::Path, id: &str) -> std::path::PathBuf {
        root.join("spaces").join(id)
    }

    #[tokio::test]
    async fn legacy_git_mutations_are_unavailable() {
        let (router, cookie, id, dir) = git_fixture().await;
        let repo = space_folder(dir.path(), &id);
        for (method, suffix, body) in [
            ("PUT", "remote", r#"{"url":"git@example.test:notes.git"}"#),
            ("POST", "key", "{}"),
            ("DELETE", "key", "{}"),
        ] {
            let response = authed(
                &router,
                method,
                &format!("/api/spaces/{id}/git/{suffix}"),
                body,
                &cookie,
            )
            .await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        assert!(git::run(&repo, &["remote", "get-url", "origin"], &[]).is_err());
        assert!(keys::public_key(dir.path(), &id).is_none());
    }

    async fn git_fixture() -> (axum::Router, String, String, tempfile::TempDir) {
        git_fixture_with_mode("key").await
    }

    async fn git_fixture_with_mode(
        mode: &str,
    ) -> (axum::Router, String, String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            &format!(
                r#"{{"name":"Git","binding":{{"prefix":"/git"}},"revisions":"managed",
                "gitSync":{{"mode":"{mode}","pullIntervalSecs":0}},"seedIndex":false}}"#
            ),
        )
        .await;
        (router, cookie, id, dir)
    }

    #[tokio::test]
    async fn status_reports_local_commit_count_before_the_first_fetch() {
        let (router, cookie, id, dir) = git_fixture().await;
        let repo = space_folder(dir.path(), &id);
        std::fs::write(repo.join("note.md"), "a\n").unwrap();
        git_run(&repo, &["add", "-A"]);
        git_run(
            &repo,
            &[
                "-c",
                "user.email=t@x.test",
                "-c",
                "user.name=T",
                "commit",
                "-qm",
                "one",
            ],
        );

        let status = body_json(
            authed(
                &router,
                "GET",
                &format!("/api/spaces/{id}/git"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(status["ahead"], 1, "{status}");
        assert!(status["behind"].is_null(), "{status}");
    }

    #[tokio::test]
    async fn status_reports_zero_ahead_for_a_fresh_clone_not_its_whole_history() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let remote = tempfile::tempdir().unwrap();
        git_run(remote.path(), &["init", "-q", "--bare"]);
        let seed = tempfile::tempdir().unwrap();
        git_run(
            std::path::Path::new("."),
            &[
                "clone",
                "-q",
                remote.path().to_str().unwrap(),
                seed.path().to_str().unwrap(),
            ],
        );
        for i in 1..=3 {
            std::fs::write(
                seed.path().join(format!("f{i}.md")),
                "x
",
            )
            .unwrap();
            git_run(seed.path(), &["add", "-A"]);
            git_run(
                seed.path(),
                &[
                    "-c",
                    "user.email=t@x.test",
                    "-c",
                    "user.name=T",
                    "commit",
                    "-qm",
                    &format!("c{i}"),
                ],
            );
        }
        let branch = git_run(seed.path(), &["symbolic-ref", "--short", "HEAD"])
            .trim()
            .to_string();
        git_run(seed.path(), &["push", "-q", "origin", &branch]);

        let clone = tempfile::tempdir().unwrap();
        git_run(
            std::path::Path::new("."),
            &[
                "clone",
                "-q",
                remote.path().to_str().unwrap(),
                clone.path().to_str().unwrap(),
            ],
        );

        let body = format!(
            r#"{{"name":"Cloned","binding":{{"prefix":"/cloned"}},"revisions":"managed","folder":"{}","seedIndex":false}}"#,
            clone.path().display()
        );
        let id = create_space(&router, &cookie, &body).await;

        let status = body_json(
            authed(
                &router,
                "GET",
                &format!("/api/spaces/{id}/git"),
                "",
                &cookie,
            )
            .await,
        )
        .await;
        assert_eq!(status["ahead"], 0, "{status}");
        assert_eq!(status["behind"], 0, "{status}");
    }

    async fn draft_request(
        router: &axum::Router,
        cookie: &str,
        id: &str,
        method: &str,
        suffix: &str,
        body: serde_json::Value,
    ) -> serde_json::Value {
        let response = authed(
            router,
            method,
            &format!("/api/spaces/{id}/git{suffix}"),
            &body.to_string(),
            cookie,
        )
        .await;
        let status = response.status();
        let value = body_json(response).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        value
    }
    #[tokio::test]
    async fn draft_key_and_cancel_preserve_live_connection() {
        let (router, cookie, id, dir) = git_fixture().await;
        let repo = space_folder(dir.path(), &id);
        git_run(
            &repo,
            &["remote", "add", "origin", "git@example.test:existing.git"],
        );
        let original = keys::generate(dir.path(), &id).unwrap();
        let draft = draft_request(&router, &cookie, &id, "POST", "/draft", json!({})).await;
        let suffix = format!("/draft/{}", draft["id"].as_str().unwrap());
        let next = draft_request(
            &router,
            &cookie,
            &id,
            "POST",
            &format!("{suffix}/key"),
            json!({"version":draft["version"]}),
        )
        .await;
        assert_ne!(next["publicKey"], original);
        assert!(next.get("privateKey").is_none());
        assert_eq!(keys::public_key(dir.path(), &id).unwrap(), original);
        draft_request(&router, &cookie, &id, "DELETE", &suffix, json!({})).await;
        assert_eq!(
            git_run(&repo, &["remote", "get-url", "origin"]).trim(),
            "git@example.test:existing.git"
        );
        assert_eq!(keys::public_key(dir.path(), &id).unwrap(), original);
    }
    #[tokio::test]
    async fn checked_draft_apply_pause_resume_and_disconnect() {
        let (router, cookie, id, dir) = git_fixture().await;
        let remote = tempfile::TempDir::new().unwrap();
        git_run(remote.path(), &["init", "-q", "--bare"]);
        let draft = draft_request(&router, &cookie, &id, "POST", "/draft", json!({})).await;
        let suffix = format!("/draft/{}", draft["id"].as_str().unwrap());
        let updated = draft_request(&router,&cookie,&id,"PUT",&suffix,json!({"version":draft["version"],"url":remote.path(),"mode":"manual","pullIntervalSecs":0})).await;
        let checked = draft_request(
            &router,
            &cookie,
            &id,
            "POST",
            &format!("{suffix}/test"),
            json!({"version":updated["version"]}),
        )
        .await;
        assert_eq!(checked["test"]["reachable"], true);
        assert_eq!(checked["test"]["kind"], "emptyRepo");
        assert!(git::run(
            &space_folder(dir.path(), &id),
            &["remote", "get-url", "origin"],
            &[]
        )
        .is_err());
        let stale = authed(
            &router,
            "POST",
            &format!("/api/spaces/{id}/git{suffix}/apply"),
            &json!({"version":updated["version"]}).to_string(),
            &cookie,
        )
        .await;
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        draft_request(
            &router,
            &cookie,
            &id,
            "POST",
            &format!("{suffix}/apply"),
            json!({"version":checked["version"]}),
        )
        .await;
        assert_eq!(
            git_run(
                &space_folder(dir.path(), &id),
                &["remote", "get-url", "origin"]
            )
            .trim(),
            remote.path().to_str().unwrap()
        );
        let repo = space_folder(dir.path(), &id);
        std::fs::write(repo.join("Note.md"), "A note\n").unwrap();
        git_run(&repo, &["add", "Note.md"]);
        git_run(
            &repo,
            &[
                "-c",
                "user.name=Sample",
                "-c",
                "user.email=sample@example.test",
                "commit",
                "-qm",
                "Create note",
            ],
        );
        draft_request(&router, &cookie, &id, "POST", "/sync", json!({})).await;
        let mut successful = draft_request(&router, &cookie, &id, "GET", "", json!({})).await;
        for _ in 0..100 {
            if successful["lastSuccess"].is_number() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            successful = draft_request(&router, &cookie, &id, "GET", "", json!({})).await;
        }
        assert!(successful["lastSuccess"].is_number(), "{successful}");
        for (action, paused) in [("pause", true), ("resume", false)] {
            draft_request(
                &router,
                &cookie,
                &id,
                "POST",
                &format!("/{action}"),
                json!({}),
            )
            .await;
            let status = draft_request(&router, &cookie, &id, "GET", "", json!({})).await;
            assert_eq!(status["paused"], paused);
            assert_eq!(status["credentialMode"], "manual");
            assert_eq!(status["lastSuccess"], successful["lastSuccess"]);
        }
        let response = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"name":"Renamed","gitSync":{"mode":"key"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let status = draft_request(&router, &cookie, &id, "GET", "", json!({})).await;
        assert_eq!(status["credentialMode"], "manual");
        draft_request(&router, &cookie, &id, "DELETE", "/connection", json!({})).await;
        let status = draft_request(&router, &cookie, &id, "GET", "", json!({})).await;
        assert_eq!(status["enabled"], false);
        assert_eq!(
            git_run(
                &space_folder(dir.path(), &id),
                &["remote", "get-url", "origin"]
            )
            .trim(),
            remote.path().to_str().unwrap()
        );
    }
    #[tokio::test]
    async fn draft_apply_rejects_external_remote_upstream_and_key_edits() {
        for field in ["remote.origin.url", "branch.main.merge", "key"] {
            let (router, cookie, id, dir) = git_fixture().await;
            let repo = space_folder(dir.path(), &id);
            git_run(&repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
            git_run(
                &repo,
                &["remote", "add", "origin", "git@example.test:original.git"],
            );
            keys::generate(dir.path(), &id).unwrap();
            let remote = tempfile::TempDir::new().unwrap();
            git_run(remote.path(), &["init", "-q", "--bare"]);
            let draft = draft_request(&router, &cookie, &id, "POST", "/draft", json!({})).await;
            let suffix = format!("/draft/{}", draft["id"].as_str().unwrap());
            let updated = draft_request(&router,&cookie,&id,"PUT",&suffix,json!({"version":draft["version"],"url":remote.path(),"mode":"manual","pullIntervalSecs":0})).await;
            let checked = draft_request(
                &router,
                &cookie,
                &id,
                "POST",
                &format!("{suffix}/test"),
                json!({"version":updated["version"]}),
            )
            .await;
            if field == "key" {
                keys::generate(dir.path(), &id).unwrap();
            } else {
                git_run(
                    &repo,
                    &[
                        "config",
                        field,
                        if field == "remote.origin.url" {
                            "git@example.test:unseen.git"
                        } else {
                            "refs/heads/unseen"
                        },
                    ],
                );
            }
            let before_config = std::fs::read(repo.join(".git/config")).unwrap();
            let before_key = std::fs::read(keys::key_path(dir.path(), &id)).unwrap();
            let response = authed(
                &router,
                "POST",
                &format!("/api/spaces/{id}/git{suffix}/apply"),
                &json!({"version":checked["version"]}).to_string(),
                &cookie,
            )
            .await;
            assert_eq!(
                response.status(),
                StatusCode::CONFLICT,
                "unseen {field} edit must be preserved"
            );
            assert_eq!(
                std::fs::read(repo.join(".git/config")).unwrap(),
                before_config
            );
            assert_eq!(
                std::fs::read(keys::key_path(dir.path(), &id)).unwrap(),
                before_key
            );
        }
    }

    #[tokio::test]
    async fn concurrent_connection_editors_cannot_both_activate() {
        let (router, cookie, id, dir) = git_fixture().await;
        let remote = tempfile::TempDir::new().unwrap();
        git_run(remote.path(), &["init", "-q", "--bare"]);
        let mut candidates = Vec::new();
        for _ in 0..2 {
            let draft = draft_request(&router, &cookie, &id, "POST", "/draft", json!({})).await;
            let suffix = format!("/draft/{}", draft["id"].as_str().unwrap());
            let updated = draft_request(&router,&cookie,&id,"PUT",&suffix,json!({"version":draft["version"],"url":remote.path(),"mode":"manual","pullIntervalSecs":0})).await;
            let checked = draft_request(
                &router,
                &cookie,
                &id,
                "POST",
                &format!("{suffix}/test"),
                json!({"version":updated["version"]}),
            )
            .await;
            candidates.push((
                format!("/api/spaces/{id}/git{suffix}/apply"),
                json!({"version":checked["version"]}).to_string(),
            ));
        }
        let (left, right) = tokio::join!(
            authed(&router, "POST", &candidates[0].0, &candidates[0].1, &cookie),
            authed(&router, "POST", &candidates[1].0, &candidates[1].1, &cookie)
        );
        assert!(
            (left.status() == StatusCode::OK && right.status() == StatusCode::CONFLICT)
                || (right.status() == StatusCode::OK && left.status() == StatusCode::CONFLICT)
        );
        assert_eq!(
            git_run(
                &space_folder(dir.path(), &id),
                &["remote", "get-url", "origin"]
            )
            .trim(),
            remote.path().to_str().unwrap()
        );
    }

    #[tokio::test]
    async fn every_connection_route_requires_admin() {
        let (router, _cookie, id, _dir) = git_fixture().await;
        for (method, suffix) in [
            ("GET", ""),
            ("POST", "/draft"),
            ("PUT", "/draft/sample"),
            ("DELETE", "/draft/sample"),
            ("POST", "/draft/sample/key"),
            ("POST", "/draft/sample/test"),
            ("POST", "/draft/sample/apply"),
            ("POST", "/pause"),
            ("POST", "/resume"),
            ("DELETE", "/connection"),
            ("POST", "/sync"),
        ] {
            let request = Request::builder()
                .method(method)
                .uri(format!("/api/spaces/{id}/git{suffix}"))
                .header("host", "localhost")
                .body(Body::empty())
                .unwrap();
            assert_eq!(
                send(&router, request).await.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {suffix}"
            );
        }
    }
    #[test]
    fn connection_error_classification_redacts_credentials() {
        assert_eq!(
            classify_git_test_error("Permission denied (publickey).").0,
            "authFailed"
        );
        assert_eq!(
            classify_git_test_error("! [rejected] main -> main (non-fast-forward)").0,
            "behind"
        );
        assert_eq!(
            classify_git_test_error("fatal: /missing does not appear to be a git repository").0,
            "notFound"
        );
        let (_, message) =
            classify_git_test_error("fatal: https://sample:secret@example.test/notes not found");
        assert!(!message.contains("secret"));
    }

    #[tokio::test]
    async fn get_single_space_returns_the_collection_shape() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Work");
        assert!(v.get("status").is_some(), "{v}");
    }

    #[tokio::test]
    async fn get_unknown_space_is_404() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let resp = authed(&router, "GET", "/api/spaces/nope", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn patch_carrying_unknown_auth_is_400() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"auth":{"mode":"inherit"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );
    }

    #[tokio::test]
    async fn patch_name_only_leaves_other_fields_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"},"readOnly":true}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"name":"Renamed"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Renamed");
        assert_eq!(
            v["readOnly"], true,
            "PATCH must not reset unnamed fields: {v}"
        );
    }

    #[tokio::test]
    async fn patch_members_with_an_unknown_user_is_400() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        // Validation is not relaxed for PATCH: an unknown member fails exactly
        // as it does through PUT. `admin_router` boots with no known users.
        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            r#"{"members":{"ghost":{}}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn patch_empty_body_is_a_noop_returning_ok() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let id = create_space(
            &router,
            &cookie,
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
        )
        .await;

        let resp = authed(
            &router,
            "PATCH",
            &format!("/api/spaces/{id}"),
            "{}",
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = authed(&router, "GET", &format!("/api/spaces/{id}"), "", &cookie).await;
        let v = body_json(resp).await;
        assert_eq!(v["name"], "Work");
    }

    #[tokio::test]
    async fn crud_lifecycle_over_http() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        let id = v["id"].as_str().unwrap().to_string();

        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert_eq!(v[&id]["status"]["state"], "running");

        let resp = authed(
            &r,
            "PUT",
            &format!("/api/spaces/{id}"),
            &format!(r#"{{"name":"Work","folder":"spaces/{id}","binding":{{"prefix":"/w2"}}}}"#),
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Dup","binding":{"prefix":"/w2"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(!v["errors"].as_array().unwrap().is_empty(), "{v}");

        let resp = authed(&r, "DELETE", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = authed(&r, "DELETE", &format!("/api/spaces/{id}"), "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn fs_dirs_completion_and_status() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("alpha")).unwrap();
        std::fs::create_dir_all(dir.path().join("alps")).unwrap();
        std::fs::create_dir_all(dir.path().join("beta")).unwrap();
        std::fs::write(dir.path().join("afile"), "x").unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        assert_eq!(
            send(&r, get("/api/fs/dirs?path=al")).await.status(),
            StatusCode::UNAUTHORIZED
        );

        // Partial relative path completes against the server root, and the
        // suggestions stay relative to it (not absolute).
        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=al", "", &cookie).await).await;
        assert_eq!(v["status"], "missing");
        let sugg: Vec<String> = v["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        assert!(sugg.iter().any(|s| s == "alpha"), "{sugg:?}");
        assert!(sugg.iter().any(|s| s == "alps"), "{sugg:?}");
        assert!(!sugg.iter().any(|s| s == "beta"), "{sugg:?}");

        let abs = format!("{}/al", dir.path().display());
        let v =
            body_json(authed(&r, "GET", &format!("/api/fs/dirs?path={abs}"), "", &cookie).await)
                .await;
        let abs_sugg: Vec<String> = v["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        assert!(
            abs_sugg
                .iter()
                .any(|s| s.ends_with("/alpha") && s.starts_with('/')),
            "{abs_sugg:?}"
        );

        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=alpha", "", &cookie).await).await;
        assert_eq!(v["status"], "exists");

        let v = body_json(authed(&r, "GET", "/api/fs/dirs?path=afile", "", &cookie).await).await;
        assert_eq!(v["status"], "notADirectory");
    }

    #[tokio::test]
    async fn port_check_endpoint_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let response = authed(&r, "GET", "/api/net/port?port=4000", "", &cookie).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn admin_api_token_of_admin_user_works_and_member_token_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        users
            .create_user("bob", "pw123456", false, Profile::default())
            .unwrap();
        let admin_tok = users.create_token("admin", "ci").unwrap();
        let bob_tok = users.create_token("bob", "ci").unwrap();
        let ok = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(ok.status(), StatusCode::OK);
        let no = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {bob_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        // Bob's token is a real credential, so this is 403 (authenticated,
        // not permitted) rather than 401 — same split as cookie sessions.
        assert_eq!(no.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn user_crud_lifecycle_over_http_incl_last_admin_guard() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        // The sole admin can't be demoted or deleted through itself. (These
        // are guard failures — the store is untouched, so `cookie` stays a
        // valid admin session for everything that follows. Actually flipping
        // `admin`'s own flag would 401 the rest of this test, since
        // `require_admin` re-checks admin-ness live on every request.)
        let resp = authed(&r, "PUT", "/api/users/admin", r#"{"admin":false}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["message"]
                .as_str()
                .unwrap()
                .contains("last admin"),
            "{v}"
        );
        let resp = authed(&r, "DELETE", "/api/users/admin", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], false);
        assert_eq!(v["admin"]["admin"], true);

        // A stable user-detail route gets the same redacted shape as one
        // entry in the collection and never exposes password/token hashes.
        let v = body_json(authed(&r, "GET", "/api/users/bob", "", &cookie).await).await;
        assert_eq!(v["admin"], false);
        assert!(v.get("passwordHash").is_none(), "{v}");
        let resp = authed(&r, "GET", "/api/users/ghost", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["errors"][0]["field"], "username");

        let resp = authed(&r, "PUT", "/api/users/bob", r#"{"admin":true}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], true);

        let resp = authed(&r, "PUT", "/api/users/bob", r#"{"admin":false}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert_eq!(v["bob"]["admin"], false);

        let resp = authed(&r, "DELETE", "/api/users/bob", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert!(v.get("bob").is_none());

        let resp = authed(&r, "DELETE", "/api/users/ghost", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let resp = authed(&r, "PUT", "/api/users/ghost", r#"{"admin":true}"#, &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn create_user_stores_the_profile() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let body = r#"{"username":"ada","password":"pw123456","admin":false,
                       "fullName":"Ada Lovelace","email":"ada@example.org"}"#;
        let resp = authed(&r, "POST", "/api/users", body, &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            users.profile("ada").unwrap().email.as_deref(),
            Some("ada@example.org")
        );
    }

    #[tokio::test]
    async fn create_sso_user_and_disable_it_over_http() {
        let dir = tempfile::tempdir().unwrap();
        let (r, users, provider_id) = admin_router_with_provider(&dir);
        let cookie = session_cookie(&users, "admin");
        let body = serde_json::json!({
            "username": "morgan-notes",
            "loginMethod": "sso",
            "providerId": provider_id,
            "expectedEmail": "Morgan@Example.TEST",
            "admin": false,
            "fullName": "Morgan Example",
            "email": "morgan@example.test"
        });
        let resp = authed(&r, "POST", "/api/users", &body.to_string(), &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let account =
            body_json(authed(&r, "GET", "/api/users/morgan-notes", "", &cookie).await).await;
        assert_eq!(account["loginMethod"], "sso");
        assert_eq!(account["sso"]["expectedEmail"], "Morgan@example.test");
        assert_eq!(account["disabled"], false);

        let resp = authed(
            &r,
            "POST",
            "/api/users/morgan-notes/disabled",
            r#"{"disabled":true}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(!users.is_enabled("morgan-notes"));
    }

    #[tokio::test]
    async fn sso_user_creation_rejects_invalid_provider_ids_and_password_reset() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let invalid = r#"{"username":"morgan","loginMethod":"sso","providerId":"current-provider","expectedEmail":"morgan@example.test"}"#;
        let resp = authed(&r, "POST", "/api/users", invalid, &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_json(resp).await["errors"][0]["field"], "providerId");

        users
            .create_sso_user(
                "morgan",
                "11111111-1111-4111-8111-111111111111",
                "morgan@example.test",
                false,
                Profile::default(),
            )
            .unwrap();
        let resp = authed(
            &r,
            "POST",
            "/api/users/morgan/password",
            r#"{"password":"local-secret"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(!users.verify_password("morgan", "local-secret"));
    }

    #[tokio::test]
    async fn sso_user_creation_requires_the_active_provider() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        let body = r#"{"username":"morgan","loginMethod":"sso","providerId":"11111111-1111-4111-8111-111111111111","expectedEmail":"morgan@example.test"}"#;
        let resp = authed(&r, "POST", "/api/users", body, &cookie).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_json(resp).await["errors"][0]["field"], "providerId");
        assert!(!users.usernames().contains("morgan"));
    }

    #[tokio::test]
    async fn set_profile_rejects_a_git_ident_breaker() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        users
            .create_user("ada", "pw123456", false, Profile::default())
            .unwrap();
        let resp = authed(
            &r,
            "PUT",
            "/api/users/ada/profile",
            r#"{"fullName":"Ada <ada@example.org>","email":""}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn token_endpoint_returns_plaintext_once_and_gates_admin_api() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/users/admin/tokens",
                r#"{"name":"ci"}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let admin_tok = v["token"].as_str().unwrap().to_string();
        assert!(admin_tok.starts_with("sbt_"), "{admin_tok}");

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/users/bob/tokens",
                r#"{"name":"ci"}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let bob_tok = v["token"].as_str().unwrap().to_string();

        let ok = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(ok.status(), StatusCode::OK);

        let no = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {bob_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(no.status(), StatusCode::FORBIDDEN);

        let resp = authed(&r, "DELETE", "/api/users/admin/tokens/ci", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let no_more = send(
            &r,
            Request::builder()
                .uri("/api/spaces")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {admin_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(no_more.status(), StatusCode::UNAUTHORIZED);

        let resp = authed(&r, "DELETE", "/api/users/admin/tokens/nope", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn password_reset_endpoint_revokes_existing_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users/admin/password",
            r#"{"password":"newpw12345"}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Resetting the password revoked the session that performed the
        // reset: the JWT still verifies, but its credential version is stale.
        assert_eq!(
            authed(&r, "GET", "/api/users", "", &cookie).await.status(),
            StatusCode::UNAUTHORIZED
        );
        // A session minted after the reset is accepted again. (Whether the
        // *password* itself now works at login is the unified surface's
        // concern — see `space_index`'s
        // `password_reset_through_the_admin_api_changes_the_login_result`.)
        let new_cookie = session_cookie(&users, "admin");
        assert_eq!(
            authed(&r, "GET", "/api/users", "", &new_cookie)
                .await
                .status(),
            StatusCode::OK
        );

        let resp = authed(
            &r,
            "POST",
            "/api/users/ghost/password",
            r#"{"password":"whatever12"}"#,
            &new_cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deleting_sessions_requires_admin_and_bumps_one_user() {
        let dir = tempfile::tempdir().unwrap();
        let (router, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");
        users
            .create_user("bob", "pw123456", false, Profile::default())
            .unwrap();
        let before = users.credential_version("bob").unwrap();
        let carol_before = users.credential_version("admin").unwrap();

        let anon = send(&router, del("/api/users/bob/sessions")).await;
        assert_eq!(anon.status(), StatusCode::UNAUTHORIZED);

        let resp = authed(&router, "DELETE", "/api/users/bob/sessions", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_ne!(users.credential_version("bob").unwrap(), before);
        assert_eq!(users.credential_version("admin").unwrap(), carol_before);

        let resp = authed(&router, "DELETE", "/api/users/ghost/sessions", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deleting_user_sweeps_membership_from_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/users",
            r#"{"username":"bob","password":"pw123456","admin":false}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                r#"{"name":"Team","binding":{"prefix":"/team"},"members":{"bob":{}}}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();

        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert!(
            v[&id]["members"].as_object().unwrap().contains_key("bob"),
            "{v}"
        );

        let resp = authed(&r, "DELETE", "/api/users/bob", "", &cookie).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // `members` is omitted entirely once empty (skip_serializing_if), so
        // "no key" and "key present but without bob" both count as swept.
        let v = body_json(authed(&r, "GET", "/api/spaces", "", &cookie).await).await;
        assert!(
            !v[&id]["members"]
                .as_object()
                .is_some_and(|m| m.contains_key("bob")),
            "{v}"
        );
        let v = body_json(authed(&r, "GET", "/api/users", "", &cookie).await).await;
        assert!(v.get("bob").is_none());

        let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        assert!(!raw.contains("bob"), "{raw}");
    }

    #[tokio::test]
    async fn auth_field_rejected_on_create_and_update() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _m, users) = admin_router(&dir);
        let cookie = session_cookie(&users, "admin");

        let resp = authed(
            &r,
            "POST",
            "/api/spaces",
            r#"{"name":"Work","binding":{"prefix":"/work"},"auth":{"mode":"none"}}"#,
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );

        // A space created without the unknown field can be updated — just not
        // by introducing it.
        let v = body_json(
            authed(
                &r,
                "POST",
                "/api/spaces",
                r#"{"name":"Work","binding":{"prefix":"/work"}}"#,
                &cookie,
            )
            .await,
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();

        let resp = authed(
            &r,
            "PUT",
            &format!("/api/spaces/{id}"),
            &format!(
                r#"{{"name":"Work","folder":"spaces/{id}","binding":{{"prefix":"/work"}},"auth":{{"mode":"none"}}}}"#
            ),
            &cookie,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert!(
            v["errors"][0]["field"].as_str().unwrap().ends_with(".auth"),
            "{v}"
        );
    }
}
