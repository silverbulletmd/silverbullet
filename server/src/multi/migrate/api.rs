//! The `{prefix}/.setup/migrate/` surface a legacy single-space folder puts
//! up until it is migrated: a gated page to review and run the migration.
//! Every other request is refused and pointed at it.

use std::collections::HashSet;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use silverbullet_server_common::SpacePrimitives;

use super::plan::{
    compute_plan, compute_plan_with_errors, default_edits, AdminChoice, LegacyEnv, PlanEdits,
};
use super::{execute, pending_journal, resume, Blocker, MigrationReport, MigrationSecrets};
use crate::auth::config::{
    constant_time_eq, AuthConfig, DEFAULT_LOCKOUT_LIMIT, DEFAULT_LOCKOUT_TIME_SECS,
};
use crate::auth::cookie::{cookie_value, is_secure_request, set_cookie_value, CookieOptions};
use crate::auth::lockout::LockoutTimer;
use crate::multi::setup_api::asset_content_type;
use crate::multi::validate::FieldError;
use crate::router::run_blocking;

/// Who may migrate: the `SB_USER` account, or whoever has the setup code
/// printed in the server log.
pub enum Gate {
    Credentials(AuthConfig),
    SetupCode(String),
}

/// Switches the server to multi-space, or says why it couldn't.
pub type OnComplete =
    Box<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

pub struct MigrateState {
    pub root: PathBuf,
    pub env: LegacyEnv,
    pub secrets: MigrationSecrets,
    pub gate: Gate,
    pub client_bundle: Box<dyn SpacePrimitives>,
    /// Reported by `/.instance`.
    pub version: String,
    /// Called after a successful run or resume, with the run lock held:
    /// replaces this router with the multi-space stack.
    pub on_complete: OnComplete,
    /// Serializes runs and resumes.
    pub run_lock: tokio::sync::Mutex<()>,
}

const SETUP_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SETUP_CODE_LEN: usize = 8;
const COOKIE_NAME: &str = "sb_migrate";

/// A fresh code for [`Gate::SetupCode`], from an alphabet without look-alikes.
pub fn generate_setup_code() -> String {
    // The largest multiple of the alphabet size that fits a byte: sampling
    // below it keeps every character equally likely.
    let cutoff = (256 / SETUP_CODE_ALPHABET.len() * SETUP_CODE_ALPHABET.len()) as u8;
    let mut code = String::with_capacity(SETUP_CODE_LEN);
    while code.len() < SETUP_CODE_LEN {
        let mut byte = [0u8; 1];
        getrandom::fill(&mut byte).expect("OS RNG must be available");
        if byte[0] < cutoff {
            code.push(SETUP_CODE_ALPHABET[byte[0] as usize % SETUP_CODE_ALPHABET.len()] as char);
        }
    }
    code
}

struct Api {
    state: Arc<MigrateState>,
    /// SHA-256 digests of the session tokens handed out by `api/login`.
    sessions: Mutex<HashSet<[u8; 32]>>,
    lockout: LockoutTimer,
    /// `{prefix}/.setup/migrate/`
    flow_path: String,
    /// Why the last run or resume failed, until one succeeds.
    last_error: Mutex<Option<String>>,
    /// What the last successful run did, for a page that lost its answer.
    last_report: Mutex<Option<MigrationReport>>,
}

impl Api {
    fn gate_name(&self) -> &'static str {
        match self.state.gate {
            Gate::Credentials(_) => "credentials",
            Gate::SetupCode(_) => "code",
        }
    }

    fn signed_in(&self, headers: &HeaderMap) -> bool {
        cookie_value(headers, COOKIE_NAME).is_some_and(|token| {
            self.sessions
                .lock()
                .unwrap()
                .contains(&token_digest(&token))
        })
    }
}

fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

/// The request body as JSON. Anything else is refused, so a cross-site form
/// post can't reach the API.
fn json_body<T: DeserializeOwned>(
    headers: &HeaderMap,
    body: &Bytes,
) -> Result<T, (StatusCode, String)> {
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Expected an application/json body".into(),
        ));
    }
    serde_json::from_slice(body).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn handle_shell(State(api): State<Arc<Api>>) -> Response {
    let state = api.state.clone();
    match run_blocking(move || state.client_bundle.read_file(".client/migrate.html")).await {
        Ok((data, _)) => ([(header::CONTENT_TYPE, "text/html")], data).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Migration UI not found in client bundle",
        )
            .into_response(),
    }
}

async fn handle_asset(State(api): State<Arc<Api>>, AxumPath(file): AxumPath<String>) -> Response {
    if file.contains("..") || file.contains('/') {
        return (StatusCode::BAD_REQUEST, "Invalid asset path").into_response();
    }
    let state = api.state.clone();
    let path = format!(".client/{file}");
    match run_blocking(move || state.client_bundle.read_file(&path)).await {
        Ok((data, _)) => {
            ([(header::CONTENT_TYPE, asset_content_type(&file))], data).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

/// Anonymous callers learn only which gate to show and whether a migration
/// was interrupted; the plan's details are for signed-in callers.
async fn handle_status(State(api): State<Arc<Api>>, headers: HeaderMap) -> Response {
    let root = api.state.root.clone();
    let journal = run_blocking(move || Ok(pending_journal(&root)))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    let mut status = json!({
        "gate": api.gate_name(),
        "signedIn": false,
        "interrupted": !matches!(journal, Ok(None)),
    });
    if api.signed_in(&headers) {
        status["signedIn"] = json!(true);
        status["running"] = json!(api.state.run_lock.try_lock().is_err());
        status["defaults"] = json!(default_edits(&api.state.env));
        match journal {
            Ok(Some(journal)) => status["pendingPlan"] = json!(journal.plan),
            Ok(None) => {}
            Err(e) => status["error"] = json!(e),
        }
        if let Some(e) = api.last_error.lock().unwrap().as_ref() {
            status["lastError"] = json!(e);
        }
        if let Some(report) = api.last_report.lock().unwrap().as_ref() {
            status["report"] = json!(report);
        }
    }
    Json(status).into_response()
}

#[derive(Deserialize)]
struct LoginBody {
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    code: String,
}

async fn handle_login(State(api): State<Arc<Api>>, headers: HeaderMap, body: Bytes) -> Response {
    let login: LoginBody = match json_body(&headers, &body) {
        Ok(login) => login,
        Err((status, message)) => return error(status, message),
    };
    if api.lockout.is_locked() {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many failed attempts — please wait and try again",
        );
    }
    let authorized = match &api.state.gate {
        Gate::Credentials(config) => config.authorize(&login.username, &login.password),
        Gate::SetupCode(code) => constant_time_eq(
            login.code.trim().to_ascii_uppercase().as_bytes(),
            code.as_bytes(),
        ),
    };
    if !authorized {
        api.lockout.add_count();
        let message = match api.state.gate {
            Gate::Credentials(_) => "Invalid username and/or password",
            Gate::SetupCode(_) => "Invalid setup code",
        };
        return error(StatusCode::UNAUTHORIZED, message);
    }

    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS RNG must be available");
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    api.sessions.lock().unwrap().insert(token_digest(&token));
    let options = CookieOptions {
        path: api.flow_path.clone(),
        max_age_secs: None,
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Strict",
    };
    let mut response = Json(json!({ "status": "ok" })).into_response();
    if let Ok(value) = set_cookie_value(COOKIE_NAME, &token, &options).parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

async fn handle_plan(State(api): State<Arc<Api>>, headers: HeaderMap, body: Bytes) -> Response {
    if !api.signed_in(&headers) {
        return error(StatusCode::UNAUTHORIZED, "Sign in first");
    }
    let edits: PlanEdits = match json_body(&headers, &body) {
        Ok(edits) => edits,
        Err((status, message)) => return error(status, message),
    };
    let state = api.state.clone();
    match run_blocking(move || Ok(compute_plan_with_errors(&state.root, &state.env, &edits))).await
    {
        // The plan comes with the errors that don't change it (the
        // administrator and visitors), so the page can preview it meanwhile.
        Ok(Ok((plan, errors))) => Json(json!({ "plan": plan, "errors": errors })).into_response(),
        Ok(Err(errors)) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
        }
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunBody {
    /// Ignored when an interrupted migration is resumed.
    #[serde(default)]
    edits: Option<PlanEdits>,
    #[serde(default)]
    backup_confirmed: bool,
}

enum RunError {
    BadRequest(String),
    Fields(Vec<FieldError>),
    Conflict(String),
    Failed(String),
}

impl IntoResponse for RunError {
    fn into_response(self) -> Response {
        match self {
            RunError::BadRequest(message) => error(StatusCode::BAD_REQUEST, message),
            RunError::Fields(errors) => {
                (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
            }
            RunError::Conflict(message) => error(StatusCode::CONFLICT, message),
            RunError::Failed(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
        }
    }
}

/// Resumes an interrupted migration, or runs a plan recomputed from `body`.
/// The journal goes first: a crash can leave it next to `spaces.json`.
fn run(state: &MigrateState, body: RunBody) -> Result<MigrationReport, RunError> {
    if pending_journal(&state.root)
        .map_err(RunError::Failed)?
        .is_some()
    {
        return resume(&state.root).map_err(RunError::Failed);
    }
    if state.root.join("spaces.json").exists() {
        return Err(RunError::Conflict(
            "This folder was already migrated. Reload the page.".into(),
        ));
    }
    if !body.backup_confirmed {
        return Err(RunError::BadRequest(
            "Confirm that you have a backup of this folder.".into(),
        ));
    }
    let edits = body
        .edits
        .ok_or_else(|| RunError::BadRequest("The plan is missing.".into()))?;
    let plan = compute_plan(&state.root, &state.env, &edits).map_err(RunError::Fields)?;
    if !plan.blockers.is_empty() {
        let messages: Vec<String> = plan.blockers.iter().map(Blocker::message).collect();
        return Err(RunError::Conflict(messages.join("\n")));
    }
    let mut secrets = state.secrets.clone();
    if let AdminChoice::CreateNew { password, .. } = edits.admin {
        secrets.password = Some(password);
    }
    execute(&state.root, &plan, &secrets).map_err(RunError::Failed)
}

async fn handle_run(State(api): State<Arc<Api>>, headers: HeaderMap, body: Bytes) -> Response {
    if !api.signed_in(&headers) {
        return error(StatusCode::UNAUTHORIZED, "Sign in first");
    }
    let body: RunBody = match json_body(&headers, &body) {
        Ok(body) => body,
        Err((status, message)) => return error(status, message),
    };
    // A task of its own, so a client or proxy that gives up on the request
    // can't stop the run halfway or skip the switch to multi-space.
    let task = tokio::spawn(async move {
        let _guard = api.state.run_lock.lock().await;
        let state = api.state.clone();
        let result = run_blocking(move || Ok(run(&state, body)))
            .await
            .unwrap_or_else(|e| Err(RunError::Failed(e.to_string())));
        match &result {
            Ok(report) => {
                tracing::info!("migration of {} complete", api.state.root.display());
                *api.last_error.lock().unwrap() = None;
                *api.last_report.lock().unwrap() = Some(report.clone());
                if let Err(e) = (api.state.on_complete)().await {
                    let message = format!("The migration is complete, but the server could not switch to multi-space: {e}. Check the server log, then restart the server.");
                    tracing::error!("{message}");
                    *api.last_error.lock().unwrap() = Some(message.clone());
                    return Err(RunError::Failed(message));
                }
            }
            Err(RunError::Failed(message)) => {
                *api.last_error.lock().unwrap() = Some(message.clone());
                tracing::error!("migration failed: {message}");
            }
            Err(_) => {}
        }
        result
    });
    match task.await {
        Ok(Ok(report)) => Json(report).into_response(),
        Ok(Err(e)) => e.into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// Space requests and page loads from before the migration: reads and
/// navigations are pointed at the flow, writes are refused so clients keep
/// their unsynced edits.
async fn handle_fallback(State(api): State<Arc<Api>>, req: Request) -> Response {
    let message = "This server is being upgraded, check back soon.";
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return (StatusCode::UNAUTHORIZED, message).into_response();
    }
    let navigation = req
        .headers()
        .get("sec-fetch-mode")
        .is_some_and(|mode| mode == "navigate");
    let status = if navigation {
        StatusCode::FOUND
    } else {
        StatusCode::UNAUTHORIZED
    };
    (status, [(header::LOCATION, api.flow_path.clone())], message).into_response()
}

pub fn build_migrate_router(state: Arc<MigrateState>) -> Router {
    let prefix = state.env.url_prefix.clone();
    let lockout = match &state.gate {
        Gate::Credentials(config) => {
            LockoutTimer::from_config(config.lockout_time_secs, config.lockout_limit)
        }
        Gate::SetupCode(_) => {
            LockoutTimer::from_config(DEFAULT_LOCKOUT_TIME_SECS, DEFAULT_LOCKOUT_LIMIT)
        }
    };
    let flow = format!("{prefix}/.setup/migrate/");
    let api = Arc::new(Api {
        state,
        sessions: Mutex::new(HashSet::new()),
        lockout,
        flow_path: flow.clone(),
        last_error: Mutex::new(None),
        last_report: Mutex::new(None),
    });

    let instance_id = uuid::Uuid::new_v4().to_string();
    let version = api.state.version.clone();
    let handle_instance = move || {
        let body = json!({ "instance": instance_id, "version": version }).to_string();
        async move {
            (
                [
                    (header::CONTENT_TYPE, "application/json"),
                    (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
                ],
                body,
            )
        }
    };
    let mut router = Router::new().route("/.instance", get(handle_instance.clone()));
    if !prefix.is_empty() {
        router = router.route(&format!("{prefix}/.instance"), get(handle_instance));
    }
    router
        .route(&flow, get(handle_shell))
        .route(&format!("{flow}assets/{{file}}"), get(handle_asset))
        .route(&format!("{flow}api/status"), get(handle_status))
        .route(&format!("{flow}api/login"), post(handle_login))
        .route(&format!("{flow}api/plan"), post(handle_plan))
        .route(&format!("{flow}api/run"), post(handle_run))
        .fallback(handle_fallback)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::migrate::plan::tests::legacy_env;
    use crate::multi::migrate::{
        compute_plan, default_edits, AdminChoice, Journal, PlanEdits, JOURNAL_FILE,
    };
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use axum::response::Response;
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    struct Fixture {
        _dir: tempfile::TempDir,
        root: PathBuf,
        env: LegacyEnv,
        completed: Arc<AtomicUsize>,
    }

    fn install(vars: &[(&str, &str)]) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.md"), "# Hello").unwrap();
        let env = legacy_env(root.to_str().unwrap(), vars);
        Fixture {
            _dir: dir,
            root,
            env,
            completed: Arc::new(AtomicUsize::new(0)),
        }
    }

    const CODE: &str = "ABCD2345";

    fn credentials(limit: &str) -> Gate {
        Gate::Credentials(
            AuthConfig::parse(Some("pat:se:cret"), None, Some(limit), Some("60"), None).unwrap(),
        )
    }

    fn router(f: &Fixture, gate: Gate) -> Router {
        build_migrate_router(state(f, gate))
    }

    fn state(f: &Fixture, gate: Gate) -> Arc<MigrateState> {
        let completed = f.completed.clone();
        state_with(
            f,
            gate,
            Box::new(move || {
                completed.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(()) })
            }),
        )
    }

    fn state_with(f: &Fixture, gate: Gate, on_complete: OnComplete) -> Arc<MigrateState> {
        let bundle = MemorySpacePrimitives::new();
        bundle
            .write_file(".client/migrate.html", b"<html>MIGRATE</html>", None)
            .unwrap();
        bundle
            .write_file(".client/migrate.js", b"//migrate js", None)
            .unwrap();
        Arc::new(MigrateState {
            root: f.root.clone(),
            env: f.env.clone(),
            secrets: MigrationSecrets {
                password: f.env.user.as_ref().map(|(_, pass)| pass.clone()),
                auth_token: f.env.auth_token.clone(),
            },
            gate,
            client_bundle: Box::new(bundle),
            version: "test".into(),
            on_complete,
            run_lock: tokio::sync::Mutex::new(()),
        })
    }

    async fn send(router: &Router, req: Request<Body>) -> Response {
        router.clone().oneshot(req).await.unwrap()
    }

    fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
        let mut req = Request::builder().uri(uri);
        if let Some(cookie) = cookie {
            req = req.header(header::COOKIE, cookie);
        }
        req.body(Body::empty()).unwrap()
    }

    fn post_json(uri: &str, body: &str, cookie: Option<&str>) -> Request<Body> {
        let mut req = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(cookie) = cookie {
            req = req.header(header::COOKIE, cookie);
        }
        req.body(Body::from(body.to_string())).unwrap()
    }

    async fn body_json(resp: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// The `name=value` part of the `sb_migrate` cookie a successful sign-in sets.
    async fn sign_in(router: &Router, prefix: &str, body: &str) -> String {
        let resp = send(
            router,
            post_json(&format!("{prefix}/.setup/migrate/api/login"), body, None),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let set_cookie = resp.headers()[header::SET_COOKIE].to_str().unwrap();
        set_cookie.split(';').next().unwrap().to_string()
    }

    fn run_body(edits: &PlanEdits, backup_confirmed: bool) -> String {
        serde_json::json!({ "edits": edits, "backupConfirmed": backup_confirmed }).to_string()
    }

    #[tokio::test]
    async fn space_requests_redirect_to_migration() {
        let f = install(&[("SB_URL_PREFIX", "/wiki"), ("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        for uri in ["/wiki/.fs/", "/.fs/", "/wiki/.config", "/.ping", "/index"] {
            let resp = send(&r, get(uri, None)).await;
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{uri}");
            assert_eq!(
                resp.headers()[header::LOCATION],
                "/wiki/.setup/migrate/",
                "{uri}"
            );
        }

        let put = Request::builder()
            .method("PUT")
            .uri("/.fs/a.md")
            .body(Body::from("edit"))
            .unwrap();
        let resp = send(&r, put).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert!(resp.headers().get(header::LOCATION).is_none());

        let navigate = Request::builder()
            .uri("/wiki/Some%20Page")
            .header("sec-fetch-mode", "navigate")
            .body(Body::empty())
            .unwrap();
        let resp = send(&r, navigate).await;
        assert_eq!(resp.status(), StatusCode::FOUND);
        assert_eq!(resp.headers()[header::LOCATION], "/wiki/.setup/migrate/");
    }

    #[tokio::test]
    async fn shell_assets_and_instance_are_served() {
        let f = install(&[("SB_URL_PREFIX", "/wiki"), ("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        for uri in [
            "/wiki/.setup/migrate/",
            "/wiki/.setup/migrate/assets/migrate.js",
            "/.instance",
        ] {
            assert_eq!(
                send(&r, get(uri, None)).await.status(),
                StatusCode::OK,
                "{uri}"
            );
        }
        let resp = send(&r, get("/wiki/.setup/migrate/assets/..%2Fx", None)).await;
        assert_ne!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn plan_requires_sign_in() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let edits = serde_json::to_string(&default_edits(&f.env)).unwrap();
        for cookie in [None, Some("sb_migrate=forged")] {
            let resp = send(&r, post_json("/.setup/migrate/api/plan", &edits, cookie)).await;
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), true),
                None,
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert!(!f.root.join("spaces.json").exists());

        let status = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert_eq!(
            status,
            serde_json::json!({ "gate": "credentials", "signedIn": false, "interrupted": false })
        );
    }

    #[tokio::test]
    async fn credentials_gate() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("2"));
        let login = "/.setup/migrate/api/login";
        for body in [
            r#"{"username":"pat","password":"wrong"}"#,
            r#"{"username":"pat","password":"se"}"#,
        ] {
            let resp = send(&r, post_json(login, body, None)).await;
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{body}");
        }
        let right = r#"{"username":"pat","password":"se:cret"}"#;
        let resp = send(&r, post_json(login, right, None)).await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(resp.headers().get(header::SET_COOKIE).is_none());

        let r = router(&f, credentials("10"));
        let form = Request::builder()
            .method("POST")
            .uri(login)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::from("username=pat&password=se%3Acret"))
            .unwrap();
        let resp = send(&r, form).await;
        assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert!(resp.headers().get(header::SET_COOKIE).is_none());

        let resp = send(&r, post_json(login, right, None)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let set_cookie = resp.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(set_cookie.starts_with("sb_migrate="), "{set_cookie}");
        assert!(set_cookie.contains("; HttpOnly"), "{set_cookie}");
        assert!(set_cookie.contains("SameSite=Strict"), "{set_cookie}");
        assert!(set_cookie.contains("Path=/.setup/migrate/"), "{set_cookie}");
        assert!(!set_cookie.contains("Secure"), "{set_cookie}");
        let cookie = set_cookie.split(';').next().unwrap();

        let edits = serde_json::to_string(&default_edits(&f.env)).unwrap();
        let resp = send(
            &r,
            post_json("/.setup/migrate/api/plan", &edits, Some(cookie)),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let answer = body_json(resp).await;
        assert_eq!(answer["errors"], json!([]), "{answer}");
        let plan = &answer["plan"];
        assert_eq!(plan["moves"].as_array().unwrap().len(), 1, "{plan}");

        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(cookie))).await).await;
        assert_eq!(status["signedIn"], true);
    }

    #[tokio::test]
    async fn secure_cookie_over_https() {
        let f = install(&[("SB_URL_PREFIX", "/wiki"), ("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let req = Request::builder()
            .method("POST")
            .uri("/wiki/.setup/migrate/api/login")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-forwarded-proto", "https")
            .body(Body::from(r#"{"username":"pat","password":"se:cret"}"#))
            .unwrap();
        let resp = send(&r, req).await;
        let set_cookie = resp.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(set_cookie.contains("; Secure"), "{set_cookie}");
        assert!(
            set_cookie.contains("Path=/wiki/.setup/migrate/"),
            "{set_cookie}"
        );
    }

    #[tokio::test]
    async fn setup_code_gate() {
        let f = install(&[]);
        let r = router(&f, Gate::SetupCode(CODE.into()));
        let status = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert_eq!(status["gate"], "code");

        for body in [r#"{"code":"ABCD2346"}"#, r#"{"code":""}"#, "{}"] {
            let resp = send(&r, post_json("/.setup/migrate/api/login", body, None)).await;
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{body}");
        }
        let cookie = sign_in(&r, "", r#"{"code":" abcd2345 "}"#).await;
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["signedIn"], true);
    }

    #[test]
    fn setup_codes_are_unambiguous() {
        let code = generate_setup_code();
        assert_eq!(code.len(), 8);
        assert!(
            code.chars()
                .all(|c| SETUP_CODE_ALPHABET.contains(&(c as u8))),
            "{code}"
        );
        assert_ne!(code, generate_setup_code());
    }

    #[tokio::test]
    async fn run_requires_backup_confirmation() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), false),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(f.root.join("index.md").exists());
        assert!(!f.root.join("spaces.json").exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn plan_with_only_admin_errors_still_returns_the_plan() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let mut edits = serde_json::to_value(default_edits(&f.env)).unwrap();
        edits["admin"] = json!({ "kind": "createNew", "username": "", "password": "" });
        let plan_request = |edits: &serde_json::Value| {
            post_json(
                "/.setup/migrate/api/plan",
                &edits.to_string(),
                Some(&cookie),
            )
        };

        let resp = send(&r, plan_request(&edits)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let answer = body_json(resp).await;
        let fields: Vec<&str> = answer["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert_eq!(fields, ["adminUsername", "adminPassword"], "{answer}");
        assert_eq!(answer["plan"]["moves"].as_array().unwrap().len(), 1);

        // Visitors "none" without accounts is also a field error with a plan.
        edits["admin"] = json!({ "kind": "noAccounts" });
        edits["visitors"] = json!("none");
        let answer = body_json(send(&r, plan_request(&edits)).await).await;
        assert_eq!(answer["errors"][0]["field"], "visitors", "{answer}");
        assert!(answer["plan"].is_object(), "{answer}");

        // A bad URL leaves nothing to preview.
        edits["visitors"] = json!("read");
        edits["prefix"] = json!("");
        let resp = send(&r, plan_request(&edits)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let answer = body_json(resp).await;
        assert!(answer.get("plan").is_none(), "{answer}");
        assert_eq!(answer["errors"][0]["field"], "prefix", "{answer}");
    }

    #[tokio::test]
    async fn run_still_rejects_admin_errors() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let mut edits = default_edits(&f.env);
        edits.admin = AdminChoice::CreateNew {
            username: String::new(),
            password: String::new(),
        };
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&edits, true),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(f.completed.load(Ordering::SeqCst), 0);
        assert!(f.root.join("index.md").exists());
    }

    #[tokio::test]
    async fn blocked_plan_cannot_run() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        std::fs::create_dir(f.root.join("spaces")).unwrap();
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), true),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let error = body_json(resp).await["error"].as_str().unwrap().to_string();
        assert!(error.contains("already contains \"spaces\""), "{error}");
        assert!(f.root.join("index.md").exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn concurrent_runs_execute_once() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let body = run_body(&default_edits(&f.env), true);
        let (a, b) = tokio::join!(
            r.clone()
                .oneshot(post_json("/.setup/migrate/api/run", &body, Some(&cookie))),
            r.clone()
                .oneshot(post_json("/.setup/migrate/api/run", &body, Some(&cookie))),
        );
        let mut responses = [a.unwrap(), b.unwrap()];
        responses.sort_by_key(|resp| resp.status());
        let [ok, conflict] = responses;
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let report = body_json(ok).await;
        assert_eq!(report["moved"].as_array().unwrap().len(), 1, "{report}");
        let error = body_json(conflict).await["error"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(error.contains("already migrated"), "{error}");
        assert!(f.root.join("spaces.json").exists());
        assert!(f.root.join("spaces/notes/index.md").exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 1);
    }

    /// A client or proxy that gives up on a long `api/run` must not stop the
    /// migration halfway or keep the server from switching to multi-space.
    #[tokio::test]
    async fn dropped_run_request_still_completes() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let state = state(&f, credentials("10"));
        let r = build_migrate_router(state.clone());
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let body = run_body(&default_edits(&f.env), true);

        let held = state.run_lock.lock().await;
        let request = r
            .clone()
            .oneshot(post_json("/.setup/migrate/api/run", &body, Some(&cookie)));
        let timed_out = tokio::time::timeout(std::time::Duration::from_millis(200), request).await;
        assert!(timed_out.is_err(), "the run should wait for the lock");
        drop(held);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while f.completed.load(Ordering::SeqCst) == 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "the run never completed"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(f.root.join("spaces.json").exists());
        assert!(f.root.join("spaces/notes/index.md").exists());
    }

    /// A run still moving files has a journal too; it must not look
    /// interrupted, or the page would ask to finish it.
    #[tokio::test]
    async fn status_reports_a_run_in_progress() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let state = state(&f, credentials("10"));
        let r = build_migrate_router(state.clone());
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["running"], false, "{status}");

        let held = state.run_lock.lock().await;
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["running"], true, "{status}");
        let anonymous = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert!(anonymous.get("running").is_none(), "{anonymous}");
        drop(held);
    }

    /// Until the swap, a page that lost its `api/run` answer (a proxy gave up)
    /// can still show the report.
    #[tokio::test]
    async fn status_carries_the_report_while_the_swap_is_pending() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let release = Arc::new(tokio::sync::Notify::new());
        let wait = release.clone();
        let r = build_migrate_router(state_with(
            &f,
            credentials("10"),
            Box::new(move || {
                let wait = wait.clone();
                Box::pin(async move {
                    wait.notified().await;
                    Ok(())
                })
            }),
        ));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let run = tokio::spawn(r.clone().oneshot(post_json(
            "/.setup/migrate/api/run",
            &run_body(&default_edits(&f.env), true),
            Some(&cookie),
        )));

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let status = loop {
            let status =
                body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
            if status.get("report").is_some() {
                break status;
            }
            assert!(std::time::Instant::now() < deadline, "no report: {status}");
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        };
        assert_eq!(status["running"], true, "{status}");
        assert_eq!(status["interrupted"], false, "{status}");
        assert_eq!(status["report"]["moved"].as_array().unwrap().len(), 1);
        assert_eq!(status["report"]["spacePrefix"], "/", "{status}");

        release.notify_one();
        assert_eq!(run.await.unwrap().unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_failed_switch_to_multi_space_is_reported() {
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let r = build_migrate_router(state_with(
            &f,
            credentials("10"),
            Box::new(|| Box::pin(async { Err("no spaces could boot".to_string()) })),
        ));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), true),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let error = body_json(resp).await["error"].as_str().unwrap().to_string();
        assert!(error.contains("no spaces could boot"), "{error}");
        assert!(error.contains("server log"), "{error}");
        assert!(error.contains("restart"), "{error}");
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["lastError"].as_str().unwrap(), error, "{status}");
        assert_eq!(status["running"], false, "{status}");
        assert_eq!(status["interrupted"], false, "{status}");
        assert!(status["report"].is_object(), "{status}");
    }

    /// A move that fails leaves the journal; the page then shows the
    /// interrupted migration with the error, not the plan form.
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_run_shows_the_interrupted_migration_and_its_error() {
        use std::os::unix::fs::PermissionsExt;
        let f = install(&[("SB_USER", "pat:se:cret")]);
        let stuck = f.root.join("Journal");
        std::fs::create_dir(&stuck).unwrap();
        std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(stuck.join("probe"), "").is_ok() {
            // Running as root: permissions don't stop the move.
            return;
        }
        let r = router(&f, credentials("10"));
        let cookie = sign_in(&r, "", r#"{"username":"pat","password":"se:cret"}"#).await;
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), true),
                Some(&cookie),
            ),
        )
        .await;
        std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["interrupted"], true, "{status}");
        assert!(status["pendingPlan"].is_object(), "{status}");
        let error = status["lastError"].as_str().unwrap();
        assert!(error.contains("\"Journal\""), "{error}");
        let anonymous = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert!(anonymous.get("lastError").is_none(), "{anonymous}");

        let resp = send(
            &r,
            post_json("/.setup/migrate/api/run", "{}", Some(&cookie)),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert!(status.get("lastError").is_none(), "{status}");
        assert_eq!(f.completed.load(Ordering::SeqCst), 1);
    }

    /// A crash between writing `spaces.json` and deleting the journal still
    /// boots the migration page, which must be able to finish.
    #[tokio::test]
    async fn journal_next_to_spaces_json_is_finished() {
        let f = install(&[]);
        interrupt(&f.root, &f.env);
        std::fs::write(f.root.join("spaces.json"), "{}").unwrap();
        let r = router(&f, Gate::SetupCode(CODE.into()));
        let cookie = sign_in(&r, "", &format!(r#"{{"code":"{CODE}"}}"#)).await;
        let resp = send(
            &r,
            post_json("/.setup/migrate/api/run", "{}", Some(&cookie)),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(f.root.join("spaces/notes/index.md").exists());
        assert!(!f.root.join(JOURNAL_FILE).exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 1);
    }

    fn interrupt(root: &Path, env: &LegacyEnv) {
        let mut edits = default_edits(env);
        edits.admin = crate::multi::migrate::AdminChoice::NoAccounts;
        let plan = compute_plan(root, env, &edits).unwrap();
        let journal = Journal {
            plan,
            users: Default::default(),
            salt: None,
            keep_auth_file: false,
        };
        std::fs::write(
            root.join(JOURNAL_FILE),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
    }

    #[tokio::test]
    async fn interrupted_status() {
        let f = install(&[]);
        interrupt(&f.root, &f.env);
        let r = router(&f, Gate::SetupCode(CODE.into()));

        let status = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert_eq!(
            status,
            serde_json::json!({ "gate": "code", "signedIn": false, "interrupted": true })
        );

        let cookie = sign_in(&r, "", &format!(r#"{{"code":"{CODE}"}}"#)).await;
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["interrupted"], true);
        assert!(status.get("error").is_none(), "{status}");

        // The submitted edits are ignored: the journal's plan is finished.
        let mut edits = default_edits(&f.env);
        edits.folder = "elsewhere".into();
        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&edits, true),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(f.root.join("spaces/notes/index.md").exists());
        assert!(f.root.join("spaces.json").exists());
        assert!(!f.root.join(JOURNAL_FILE).exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn damaged_journal_is_shown_to_signed_in_callers_only() {
        let f = install(&[]);
        std::fs::write(f.root.join(JOURNAL_FILE), "{\"plan\": ").unwrap();
        let r = router(&f, Gate::SetupCode(CODE.into()));

        let status = body_json(send(&r, get("/.setup/migrate/api/status", None)).await).await;
        assert_eq!(
            status,
            serde_json::json!({ "gate": "code", "signedIn": false, "interrupted": true })
        );

        let cookie = sign_in(&r, "", &format!(r#"{{"code":"{CODE}"}}"#)).await;
        let status =
            body_json(send(&r, get("/.setup/migrate/api/status", Some(&cookie))).await).await;
        assert_eq!(status["interrupted"], true);
        let error = status["error"].as_str().unwrap();
        assert!(error.contains(JOURNAL_FILE), "{error}");

        let resp = send(
            &r,
            post_json(
                "/.setup/migrate/api/run",
                &run_body(&default_edits(&f.env), true),
                Some(&cookie),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(f.root.join("index.md").exists());
        assert_eq!(f.completed.load(Ordering::SeqCst), 0);
    }
}
