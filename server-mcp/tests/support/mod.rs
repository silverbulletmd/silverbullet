#![allow(dead_code)] // each test binary uses a different subset

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use axum::Router;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use silverbullet_server::auth::mcp::cimd::CimdFetcher;
use silverbullet_server::auth::mcp::clients::ClientRegistry;
use silverbullet_server::auth::mcp::grants::{ClientKind, GrantStore, NewGrant};
use silverbullet_server::auth::mcp::{
    McpAccessClaims, McpAccountHost, McpCodeGrant, McpOAuthState, ACCESS_TTL_SECS, SCOPE,
};
use silverbullet_server::auth::oauth::{challenge_for, CodeStore};
use silverbullet_server::auth::{Authenticator, BrowserSessions, LoginManager};
use silverbullet_server::handlers::mcp_oauth::{self, SessionConsent};
use silverbullet_server::multi::access::{AnyUserAuth, SessionPolicy};
use silverbullet_server::multi::config::SpaceConfig;
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
use silverbullet_server::multi::manager::MultiManager;
use silverbullet_server::multi::users::{Profile, UserStore};
use silverbullet_server::runtime::fullpage::FullPageShot;
use silverbullet_server::runtime::{LogEntry, RuntimeBackend, RuntimeError, RuntimeSnapshot};
use silverbullet_server_common::space::memory::MemorySpacePrimitives;
use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};
use silverbullet_server_mcp::{mcp_router_gated, Caller, CallerCredential, MultiHost, Tools};
use tower::ServiceExt;

/// The `Host` the OAuth tests call the server on.
pub const HOST: &str = "notes.example.test";
pub const RESOURCE: &str = "http://notes.example.test/.mcp";
pub const REDIRECT: &str = "http://localhost:53682/callback";

/// Each fixture grant is its own app, so a second one does not replace the
/// first.
static FIXTURE_CLIENTS: AtomicU64 = AtomicU64::new(0);

struct FakeRuntime;

impl RuntimeBackend for FakeRuntime {
    fn eval_global(&self, _: &str, _: &str, _: Duration) -> Result<Value, RuntimeError> {
        Ok(json!("ok"))
    }
    fn logs(&self, _: usize, _: Option<i64>) -> Vec<LogEntry> {
        Vec::new()
    }
    fn ready(&self) -> bool {
        true
    }
    fn snapshot(&self) -> Option<RuntimeSnapshot> {
        None
    }
    fn stop(&self, _: bool) -> Result<(), RuntimeError> {
        Ok(())
    }
    fn restart(&self, _: &str) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
        Ok(None)
    }
    fn shutdown(&self) {}
}

/// What the server evaluates to catch the index up before a runtime call.
pub const CATCH_UP_CODE: &str = "index.awaitPendingChanges()";

type EvalFn = dyn Fn(&Script, &str, &str) -> Result<Value, RuntimeError> + Send + Sync;

/// A runtime whose answers a test scripts: `eval` gets the script itself (to
/// push logs), the evaluator name and the code.
pub struct Script {
    eval: Box<EvalFn>,
    /// `(evaluator, code)` of every eval, in order.
    pub calls: Mutex<Vec<(String, String)>>,
    pub logs: Mutex<Vec<LogEntry>>,
    pub png: Vec<u8>,
    pub truncated: bool,
    /// `(selector, full_page)` of every screenshot.
    pub screenshots: Mutex<Vec<(Option<String>, bool)>>,
    /// The server's index catch-ups (`X-Await-Index`), counted apart from
    /// `calls`.
    pub catch_ups: AtomicU64,
    /// Makes each catch-up fail, so the server reports the index `behind`.
    pub catch_up_fails: AtomicBool,
}

impl Script {
    pub fn new(
        eval: impl Fn(&Script, &str, &str) -> Result<Value, RuntimeError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            eval: Box::new(eval),
            calls: Mutex::new(Vec::new()),
            logs: Mutex::new(Vec::new()),
            png: b"\x89PNG\r\n\x1a\nfake".to_vec(),
            truncated: false,
            screenshots: Mutex::new(Vec::new()),
            catch_ups: AtomicU64::new(0),
            catch_up_fails: AtomicBool::new(false),
        }
    }

    pub fn push_log(&self, text: &str, timestamp: i64) {
        self.logs.lock().unwrap().push(LogEntry {
            level: "log".into(),
            text: text.into(),
            timestamp,
        });
    }

    pub fn codes(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|c| c.1.clone())
            .collect()
    }
}

struct ScriptBackend(Arc<Script>);

impl RuntimeBackend for ScriptBackend {
    fn eval_global(&self, name: &str, arg: &str, _: Duration) -> Result<Value, RuntimeError> {
        if arg == CATCH_UP_CODE {
            self.0.catch_ups.fetch_add(1, Ordering::SeqCst);
            if self.0.catch_up_fails.load(Ordering::SeqCst) {
                return Err(RuntimeError::Timeout);
            }
            return Ok(Value::Null);
        }
        self.0.calls.lock().unwrap().push((name.into(), arg.into()));
        // The real expression evaluator wraps the code as `return <code>`.
        let code = arg.trim_start();
        if name == "sbRuntime.evalLua"
            && (code.starts_with("local ") || code.starts_with("return "))
        {
            return Err(RuntimeError::Eval(
                "Parse error: unexpected symbol near 'local'".into(),
            ));
        }
        (self.0.eval)(&self.0, name, arg)
    }
    fn screenshot(&self, selector: Option<&str>, _: Duration) -> Result<Vec<u8>, RuntimeError> {
        self.0
            .screenshots
            .lock()
            .unwrap()
            .push((selector.map(Into::into), false));
        Ok(self.0.png.clone())
    }
    fn screenshot_full_page(&self, _: Duration) -> Result<FullPageShot, RuntimeError> {
        self.0.screenshots.lock().unwrap().push((None, true));
        Ok(FullPageShot {
            png: self.0.png.clone(),
            truncated: self.0.truncated,
        })
    }
    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        let logs = self.0.logs.lock().unwrap();
        let newer: Vec<LogEntry> = logs
            .iter()
            .filter(|e| since.is_none_or(|s| e.timestamp > s))
            .cloned()
            .collect();
        newer[newer.len().saturating_sub(limit)..].to_vec()
    }
    fn ready(&self) -> bool {
        true
    }
    fn snapshot(&self) -> Option<RuntimeSnapshot> {
        None
    }
    fn stop(&self, _: bool) -> Result<(), RuntimeError> {
        Ok(())
    }
    fn restart(&self, _: &str) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
        Ok(None)
    }
    fn shutdown(&self) {}
}

/// A read-only base layer, as bundled files are served.
struct BaseLayer(MemorySpacePrimitives);

fn read_only(mut meta: FileMeta) -> FileMeta {
    meta.perm = "ro".into();
    meta
}

impl SpacePrimitives for BaseLayer {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        Ok(self
            .0
            .fetch_file_list()?
            .into_iter()
            .map(read_only)
            .collect())
    }
    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.0.get_file_meta(path).map(read_only)
    }
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.0
            .read_file(path)
            .map(|(data, meta)| (data, read_only(meta)))
    }
    fn write_file(
        &self,
        path: &str,
        _: &[u8],
        _: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::ReadOnly(path.into()))
    }
    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::ReadOnly(path.into()))
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub struct Fixture {
    pub manager: Arc<MultiManager>,
    pub users: Arc<UserStore>,
    pub host: Arc<MultiHost>,
    pub tokens: BTreeMap<String, String>,
    pub authenticator: Arc<Authenticator>,
    pub grants: Arc<GrantStore>,
    _dir: tempfile::TempDir,
}

impl Fixture {
    pub fn new() -> Self {
        Self::build(None, Vec::new())
    }

    /// Like `new`, with a scripted runtime in every space.
    pub fn with_runtime(script: Arc<Script>) -> Self {
        Self::build(Some(script), Vec::new())
    }

    /// Like `with_runtime`, with `bundled` (`(path, bytes)`) as every space's
    /// read-only base layer, as a server serves `Library/Std`.
    pub fn with_runtime_and_bundled(script: Arc<Script>, bundled: Vec<(String, Vec<u8>)>) -> Self {
        Self::build(Some(script), bundled)
    }

    fn build(script: Option<Arc<Script>>, bundled: Vec<(String, Vec<u8>)>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        let mut tokens = BTreeMap::new();
        for name in ["keeper", "writer-one", "reader", "runtime-off"] {
            users
                .create_user(
                    name,
                    "fixture-password",
                    name == "keeper",
                    Profile::default(),
                )
                .unwrap();
            tokens.insert(
                name.into(),
                users.create_token(name, "fixture-token").unwrap(),
            );
        }
        let authenticator = Arc::new(
            Authenticator::from_secret_bytes(vec![19; 32], "fixture".into())
                .with_browser_sessions(Arc::new(BrowserSessions::load(dir.path()).unwrap())),
        );
        let grants = Arc::new(GrantStore::load(dir.path()).unwrap());
        let deps = InstanceDeps {
            root: dir.path().into(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(move || {
                    let base = MemorySpacePrimitives::new();
                    for (path, bytes) in &bundled {
                        base.write_file(path, bytes, None).unwrap();
                    }
                    Box::new(BaseLayer(base))
                }),
            },
            runtime: Arc::new(move |_| match &script {
                Some(script) => Some(Box::new(ScriptBackend(script.clone()))),
                None => Some(Box::new(FakeRuntime)),
            }),
            runtime_enabled: Arc::new(AtomicBool::new(true)),
            runtime_availability: silverbullet_server::runtime::RuntimeAvailability::Available,
            runtime_idle_timeout: Default::default(),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users: users.clone(),
                authenticator: authenticator.clone(),
                session: Default::default(),
            },
            version: "fixture".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: true,
            index_template: "# Fixture\n".into(),
            shutdown: None,
            search: silverbullet_server::search::SpaceSearch::in_memory(),
        };
        let manager = MultiManager::boot(
            dir.path().into(),
            deps,
            users.usernames().into_iter().collect(),
        )
        .unwrap();
        // Off by default on a real server; the fixtures exercise the endpoint.
        manager
            .set_server_config(
                silverbullet_server::multi::server_config::ServerConfigPatch {
                    mcp: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        let host = Arc::new(
            MultiHost::new(manager.clone(), users.clone())
                .with_oauth(authenticator.clone(), grants.clone()),
        );
        Self {
            manager,
            users,
            host,
            tokens,
            authenticator,
            grants,
            _dir: dir,
        }
    }

    /// `members` maps username to role; `access` is the space-wide default.
    pub fn space(&self, name: &str, prefix: &str, access: &str, members: Value) -> String {
        let config: SpaceConfig = serde_json::from_value(json!({
            "name": name, "binding": {"prefix": prefix},
            "access": access,
            "revisions": "disabled",
            "members": members,
        }))
        .unwrap();
        self.manager.create(config, true).unwrap()
    }

    pub fn config(&self, id: &str) -> SpaceConfig {
        self.manager.instance(id).unwrap().config.clone()
    }

    /// `name` connected through OAuth with every space it can write to now.
    pub fn caller(&self, name: &str) -> Caller {
        let spaces: Vec<String> = self
            .host
            .writable_spaces(name)
            .into_iter()
            .map(|space| space.id)
            .collect();
        let spaces: Vec<&str> = spaces.iter().map(String::as_str).collect();
        self.grant_caller(name, &spaces).1
    }

    /// An access token for [`RESOURCE`] backed by a fresh grant of `spaces`,
    /// and the caller `/.mcp` authenticates it as.
    pub fn grant_caller(&self, name: &str, spaces: &[&str]) -> (String, Caller) {
        self.grant_caller_for(name, spaces, RESOURCE)
    }

    pub fn grant_caller_for(
        &self,
        name: &str,
        spaces: &[&str],
        resource: &str,
    ) -> (String, Caller) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let spaces: Vec<String> = spaces.iter().map(|s| s.to_string()).collect();
        let grant = self
            .grants
            .create(
                NewGrant {
                    username: name.into(),
                    client_id: format!(
                        "sbdcr_{:032x}",
                        FIXTURE_CLIENTS.fetch_add(1, Ordering::Relaxed)
                    ),
                    client_name: "Fixture Client".into(),
                    client_kind: ClientKind::Dcr,
                    verified_host: None,
                    redirect_host: "localhost".into(),
                    resource: resource.into(),
                    spaces: spaces.clone(),
                    scope: SCOPE.into(),
                    access: "write".into(),
                    credential_version: self.users.credential_version(name),
                },
                now,
            )
            .unwrap();
        let issuer = resource.trim_end_matches("/.mcp").to_string();
        let token = self
            .authenticator
            .issue_mcp_access(&McpAccessClaims {
                sub: name.into(),
                aud: resource.into(),
                iss: issuer,
                iat: now,
                exp: now + ACCESS_TTL_SECS,
                grant: grant.id.clone(),
                client_id: grant.client_id.clone(),
                scope: SCOPE.into(),
                spaces: spaces.clone(),
                token_use: String::new(),
            })
            .unwrap();
        let caller = Caller {
            username: name.into(),
            credential: CallerCredential::Grant {
                grant_id: grant.id,
                spaces: spaces.into_iter().collect(),
                credential_version: grant.credential_version,
            },
        };
        (token, caller)
    }
}

pub struct OAuthEnv {
    pub state: Arc<McpOAuthState>,
    /// What `state.now` returns; starts at the wall clock.
    pub clock: Arc<AtomicU64>,
}

impl OAuthEnv {
    pub fn now(&self) -> u64 {
        self.clock.load(Ordering::SeqCst)
    }

    pub fn advance(&self, secs: u64) {
        self.clock.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Fixture {
    pub fn root(&self) -> &Path {
        self._dir.path()
    }

    pub fn oauth(&self) -> OAuthEnv {
        self.oauth_with_session_prefix("")
    }

    /// Like `oauth`, with the consent's CSRF token bound to the session
    /// cookie of `prefix`; `""` is the server-wide cookie the real wiring uses.
    pub fn oauth_with_session_prefix(&self, prefix: &str) -> OAuthEnv {
        let clock = Arc::new(AtomicU64::new(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        ));
        let template = std::fs::read("../client/html/authorize.html").unwrap();
        let bundle = MemorySpacePrimitives::new();
        bundle
            .write_file(".client/authorize.html", &template, None)
            .unwrap();
        let versions = self.users.clone();
        let login = LoginManager::new(
            self.authenticator.clone(),
            Arc::new(AnyUserAuth {
                store: self.users.clone(),
            }),
            48,
            SessionPolicy::default().lockout(),
            prefix.to_string(),
        )
        .with_credential_version(Arc::new(move |username| {
            versions.credential_version(username).unwrap_or_default()
        }));
        let csrf = Arc::new(if prefix.is_empty() {
            login.with_server_wide_session()
        } else {
            login
        });
        let now = clock.clone();
        let state = Arc::new(McpOAuthState {
            authenticator: self.authenticator.clone(),
            accounts: self.host.clone(),
            clients: Arc::new(ClientRegistry::load(self.root()).unwrap()),
            cimd: Arc::new(CimdFetcher::new()),
            grants: self.grants.clone(),
            codes: CodeStore::new(),
            consent: Arc::new(SessionConsent {
                csrf,
                bundle: Box::new(bundle),
            }),
            now: Arc::new(move || now.load(Ordering::SeqCst)),
        });
        OAuthEnv { state, clock }
    }

    /// The multi-space main router with `/.mcp` and the OAuth routes, both
    /// following the admin toggle.
    pub fn app(&self, env: &OAuthEnv) -> Router {
        let tools = Arc::new(Tools::new(self.host.clone(), "2.12.1"));
        let gate = self.manager.clone();
        let enabled: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || gate.mcp_enabled());
        build_main_router(self.manager.clone(), None, "fixture".into())
            .merge(mcp_router_gated(tools, self.host.clone(), enabled.clone()))
            .merge(mcp_oauth::router(env.state.clone(), enabled))
    }

    /// A `Cookie` header value for a server-wide browser session on [`HOST`].
    pub fn browser_cookie(&self, user: &str) -> String {
        let jwt = self
            .authenticator
            .issue_browser_jwt(user, self.users.credential_version(user), None, 3600)
            .unwrap();
        format!(
            "{}={jwt}",
            silverbullet_server::auth::scoped_auth_cookie_name(HOST, "")
        )
    }
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

pub async fn send(app: &Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

pub fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", utf8_percent_encode(v, NON_ALPHANUMERIC)))
        .collect::<Vec<_>>()
        .join("&")
}

pub async fn post_form(app: &Router, path: &str, pairs: &[(&str, &str)]) -> Reply {
    send(
        app,
        Request::post(path)
            .header("host", HOST)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from(form(pairs)))
            .unwrap(),
    )
    .await
}

/// A DCR client that skips the consent page: codes are minted straight into
/// the code store.
pub struct TestClient {
    pub client_id: String,
    pub verifier: String,
}

pub async fn mcp_client(app: &Router) -> TestClient {
    let reply = send(
        app,
        Request::post("/.auth/register")
            .header("host", HOST)
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"client_name": "Test Client", "redirect_uris": ["http://localhost/callback"]})
                    .to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
    TestClient {
        client_id: reply.body["client_id"].as_str().unwrap().to_string(),
        verifier: "fixture-verifier-0123456789-0123456789-0123456789".into(),
    }
}

impl TestClient {
    pub fn code(&self, env: &OAuthEnv, user: &str, spaces: &[&str]) -> String {
        env.state.codes.issue_at(
            McpCodeGrant {
                username: user.into(),
                client_id: self.client_id.clone(),
                redirect_uri: REDIRECT.into(),
                code_challenge: challenge_for(&self.verifier),
                resource: RESOURCE.into(),
                spaces: spaces.iter().map(|s| s.to_string()).collect(),
                credential_version: env.state.accounts.credential_version(user),
            },
            env.now(),
        )
    }

    pub async fn exchange(&self, app: &Router, code: &str) -> Reply {
        post_form(
            app,
            "/.auth/mcp/token",
            &[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", &self.verifier),
                ("redirect_uri", REDIRECT),
                ("client_id", &self.client_id),
                ("resource", RESOURCE),
            ],
        )
        .await
    }

    /// Consent, code exchange; the token response.
    pub async fn connect(
        &self,
        app: &Router,
        env: &OAuthEnv,
        user: &str,
        spaces: &[&str],
    ) -> Value {
        let code = self.code(env, user, spaces);
        let reply = self.exchange(app, &code).await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
        reply.body
    }

    pub async fn refresh(&self, app: &Router, refresh_token: &str) -> Reply {
        post_form(
            app,
            "/.auth/mcp/token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", &self.client_id),
            ],
        )
        .await
    }
}
