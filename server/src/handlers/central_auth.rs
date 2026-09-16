use crate::auth::handoff::{Handoff, Handoffs};
use crate::auth::oidc::attempts::{
    now, random_secret, Attempt, Attempts, ProviderAttempt, Resume, TestAttempt,
};
use crate::auth::oidc::{config::ProviderConfig, store::ProviderStore};
use crate::auth::{Authenticator, LoginManager};
use crate::multi::users::UserStore;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use silverbullet_server_common::SpacePrimitives;
use std::sync::Arc;

type DestinationPolicy = Arc<dyn Fn(&reqwest::Url) -> Option<String> + Send + Sync>;

pub struct CentralAuth {
    pub providers: Arc<ProviderStore>,
    pub authenticator: Arc<Authenticator>,
    pub users: Arc<UserStore>,
    pub login: Arc<LoginManager>,
    attempts: Attempts,
    handoffs: Handoffs,
    http: reqwest::Client,
    bundle: Box<dyn SpacePrimitives>,
    destination_policy: DestinationPolicy,
    primary_url: Arc<dyn Fn() -> Option<String> + Send + Sync>,
    server_name: Arc<dyn Fn() -> String + Send + Sync>,
}

impl CentralAuth {
    pub fn new(
        providers: Arc<ProviderStore>,
        authenticator: Arc<Authenticator>,
        users: Arc<UserStore>,
        login: Arc<LoginManager>,
        bundle: Box<dyn SpacePrimitives>,
        destination_policy: DestinationPolicy,
    ) -> Result<Self, String> {
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(10));
        if let Ok(path) = std::env::var("SB_OIDC_CA_FILE") {
            let pem =
                std::fs::read(path).map_err(|_| "Cannot read configured OIDC CA certificate")?;
            builder = builder.add_root_certificate(
                reqwest::Certificate::from_pem(&pem).map_err(|_| "Invalid OIDC CA certificate")?,
            );
        }
        Ok(Self {
            providers,
            authenticator,
            users,
            login,
            bundle,
            destination_policy,
            primary_url: Arc::new(|| None),
            server_name: Arc::new(crate::multi::server_config::default_server_name),
            attempts: Attempts::default(),
            handoffs: Handoffs::default(),
            http: builder.build().map_err(|e| e.to_string())?,
        })
    }

    pub fn with_primary_url(
        mut self,
        primary_url: Arc<dyn Fn() -> Option<String> + Send + Sync>,
    ) -> Self {
        self.primary_url = primary_url;
        self
    }

    pub fn with_server_name(mut self, server_name: Arc<dyn Fn() -> String + Send + Sync>) -> Self {
        self.server_name = server_name;
        self
    }

    fn central_origin(&self) -> Option<String> {
        (self.primary_url)().or_else(|| self.providers.configured().map(|c| c.central_origin))
    }

    fn provider_matches_primary(&self, config: &ProviderConfig) -> bool {
        (self.primary_url)().is_none_or(|primary| primary == config.central_origin)
    }

    fn active_provider(&self) -> Option<ProviderConfig> {
        self.providers
            .active()
            .filter(|c| self.provider_matches_primary(c))
    }

    fn browser_token(&self, headers: &HeaderMap) -> Option<String> {
        crate::auth::cookie_value(
            headers,
            &crate::auth::scoped_auth_cookie_name(&crate::auth::request_host(headers), ""),
        )
    }
    fn admin_binding(&self, headers: &HeaderMap) -> Option<String> {
        self.browser_token(headers)
            .map(|token| crate::auth::oauth::challenge_for(&token))
    }
    fn shell(&self) -> Response {
        match self.bundle.read_file(".client/central.html") {
            Ok((bytes, _)) => (
                [
                    ("content-type", "text/html"),
                    ("cache-control", "no-store"),
                    ("referrer-policy", "no-referrer"),
                ],
                bytes,
            )
                .into_response(),
            Err(_) => error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Central login assets are unavailable",
            ),
        }
    }
    fn valid_destination(&self, value: &str) -> Option<String> {
        let url = crate::auth::oidc::config::validated_url(value.split(['?', '#']).next()?).ok()?;
        let central = reqwest::Url::parse(&self.central_origin()?).ok()?;
        if url.scheme() != central.scheme()
            || url.port_or_known_default() != central.port_or_known_default()
        {
            return None;
        }
        if url.origin() == central.origin()
            && (url.path() == "/.dashboard" || url.path().starts_with("/.dashboard/"))
        {
            return Some("/".into());
        }
        (self.destination_policy)(&url)
    }
    fn central_binding_valid(&self, id: &str, attempt: &Attempt, headers: &HeaderMap) -> bool {
        let Some(cookie) = crate::auth::cookie_value(headers, &format!("sb_central_{id}")) else {
            return false;
        };
        attempt.expires > now()
            && attempt.central_binding.as_ref().is_some_and(|binding| {
                crate::auth::config::constant_time_eq(
                    binding.as_bytes(),
                    crate::auth::oauth::challenge_for(&cookie).as_bytes(),
                )
            })
    }
    fn complete(&self, id: &str, username: &str, jwt: &str) -> Result<String, String> {
        let claims = self
            .authenticator
            .verify_browser_jwt(jwt)
            .map_err(|_| "Session expired")?;
        let sid = claims
            .session_id
            .ok_or("Browser sessions are not configured")?;
        let mut entries = self.attempts.entries.lock().unwrap();
        let attempt = entries
            .remove(id)
            .filter(|attempt| attempt.expires > now())
            .ok_or("Sign-in attempt expired")?;
        if claims.username != username
            || !self
                .users
                .session_is_current(username, claims.credential_version.as_deref())
        {
            return Err("Session expired".into());
        }
        self.valid_destination(&attempt.destination)
            .ok_or("Destination no longer belongs to this server")?;
        let origin = reqwest::Url::parse(&attempt.destination)
            .map_err(|_| "Invalid destination")?
            .origin()
            .ascii_serialization();
        let code = self.handoffs.issue(
            Handoff {
                destination: attempt.destination,
                scope: attempt.scope,
                binding: attempt.binding,
                username: username.into(),
                credential_version: claims.credential_version,
                session_id: sid,
                remember: attempt.remember,
                encrypt: attempt.encrypt,
            },
            now(),
        )?;
        Ok(format!(
            "{origin}/.auth/central/return?code={code}&attempt={id}"
        ))
    }

    fn test_owner_current(&self, test: &TestAttempt) -> bool {
        self.users
            .session_is_current(&test.username, test.credential_version.as_deref())
            && self.users.is_admin(&test.username)
            && self
                .authenticator
                .browser_sessions()
                .is_some_and(|sessions| sessions.is_active(&test.session_id, &test.username))
    }

    fn current_user(&self, headers: &HeaderMap) -> Option<String> {
        let cookie = crate::auth::scoped_auth_cookie_name(&crate::auth::request_host(headers), "");
        let token = crate::auth::cookie_value(headers, &cookie)?;
        let claims = self.authenticator.verify_browser_jwt(&token).ok()?;
        self.users
            .session_is_current(&claims.username, claims.credential_version.as_deref())
            .then_some(claims.username)
    }
    fn admin(&self, headers: &HeaderMap) -> Result<String, (StatusCode, &'static str)> {
        let user = self
            .current_user(headers)
            .ok_or((StatusCode::UNAUTHORIZED, "Sign in to continue"))?;
        if !self.users.is_admin(&user) {
            return Err((StatusCode::FORBIDDEN, "Administrator access required"));
        }
        if !crate::auth::browser_sessions::logout_allowed(headers) {
            return Err((StatusCode::FORBIDDEN, "Cross-origin request refused"));
        }
        Ok(user)
    }
}

pub fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
pub fn browser_error(status: StatusCode, message: &str) -> Response {
    let mut env = minijinja::Environment::new();
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
    let template = r#"<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in could not be completed</title><style>body{font:1rem/1.5 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.5rem}h1{font-size:1.5rem}</style><main><h1>Sign-in could not be completed</h1><p>{{ message }}</p><p><a href="/.dashboard/login">Try signing in again</a></p></main></html>"#;
    let html = env
        .render_str(template, minijinja::context! { message => message })
        .unwrap_or_else(|_| {
            "Sign-in could not be completed. Open /.dashboard/login to try again.".into()
        });
    (status, Html(html)).into_response()
}

fn result(value: Result<(), String>) -> Response {
    match value {
        Ok(()) => Json(json!({"status":"ok"})).into_response(),
        Err(e) => error(StatusCode::BAD_REQUEST, &e),
    }
}

async fn status(State(state): State<Arc<CentralAuth>>, headers: HeaderMap) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    let mut status = state.providers.public_json();
    status["primaryUrl"] = json!((state.primary_url)());
    if !status["active"].is_null() && state.active_provider().is_none() {
        status["enabled"] = json!(false);
    }
    Json(status).into_response()
}
async fn draft(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Json(mut config): Json<ProviderConfig>,
) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    if let Some(primary) = (state.primary_url)() {
        config.central_origin = primary;
    }
    match state.providers.save_draft(config) {
        Ok(revision) => Json(json!({"revision":revision})).into_response(),
        Err(e) => error(StatusCode::BAD_REQUEST, &e),
    }
}
#[derive(Deserialize)]
struct Revision {
    revision: u64,
    #[serde(default)]
    replace: bool,
}
async fn activate(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Json(body): Json<Revision>,
) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    if state
        .providers
        .draft()
        .is_none_or(|(_, config)| !state.provider_matches_primary(&config))
    {
        return error(
            StatusCode::BAD_REQUEST,
            "Save and test the provider at the current primary origin",
        );
    }
    result(
        state
            .providers
            .activate_with_revocation(body.revision, body.replace, |provider| {
                state
                    .authenticator
                    .browser_sessions()
                    .map_or(Ok(()), |sessions| {
                        sessions
                            .revoke_provider(provider)
                            .map_err(|error| error.to_string())
                    })
            }),
    )
}
async fn disable(State(state): State<Arc<CentralAuth>>, headers: HeaderMap) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    result(state.providers.disable_with_revocation(|provider| {
        state
            .authenticator
            .browser_sessions()
            .map_or(Ok(()), |sessions| {
                sessions
                    .revoke_provider(provider)
                    .map_err(|error| error.to_string())
            })
    }))
}

pub fn router(state: Arc<CentralAuth>) -> Router {
    Router::new()
        .route("/.auth/central/public", get(public_config))
        .route("/.auth/central/profile", get(local_profile))
        .route("/.auth/central/logout", post(local_logout))
        .route("/.auth/central/signed-out", get(unlock_page))
        .route("/.auth/central/assets/{file}", get(asset))
        .route("/.auth/central/start", get(start))
        .route("/.auth/central/login", get(login_page))
        .route("/.auth/central/context", get(context))
        .route("/.auth/central/local", post(local_login))
        .route("/.auth/central/provider", post(provider_login))
        .route("/.auth/central/oidc/callback", get(provider_callback))
        .route("/.auth/central/return", get(return_to_host))
        .route("/.auth/central/unlock", get(unlock_page))
        .route("/.auth/central/resume", get(resume_context))
        .route(
            "/.dashboard/api/admin/authentication/test",
            post(test_provider),
        )
        .route(
            "/.dashboard/api/admin/authentication/test/{id}",
            get(test_result),
        )
        .route("/.dashboard/api/admin/authentication", get(status))
        .route(
            "/.dashboard/api/admin/authentication/draft",
            axum::routing::put(draft),
        )
        .route(
            "/.dashboard/api/admin/authentication/activate",
            post(activate),
        )
        .route(
            "/.dashboard/api/admin/authentication/disable",
            post(disable),
        )
        .layer(axum::extract::DefaultBodyLimit::max(32 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            origin_guard,
        ))
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                response
                    .headers_mut()
                    .insert("cache-control", "no-store".parse().unwrap());
                response
                    .headers_mut()
                    .insert("referrer-policy", "no-referrer".parse().unwrap());
                response
                    .headers_mut()
                    .insert("x-frame-options", "DENY".parse().unwrap());
                response.headers_mut().insert(
                    "content-security-policy",
                    "frame-ancestors 'none'".parse().unwrap(),
                );
                response.headers_mut().insert(
                    "cross-origin-resource-policy",
                    "same-origin".parse().unwrap(),
                );
                response
            },
        ))
        .with_state(state)
}

async fn origin_guard(
    State(state): State<Arc<CentralAuth>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path();
    if !matches!(
        path,
        "/.auth/central/public"
            | "/.auth/central/profile"
            | "/.auth/central/logout"
            | "/.auth/central/signed-out"
            | "/.dashboard/api/admin/authentication"
    ) && !path.starts_with("/.auth/central/assets/")
        && crate::auth::oidc::config::validated_url(&origin(request.headers())).is_err()
    {
        return error(
            StatusCode::FORBIDDEN,
            "SSO requires HTTPS or localhost. Use local password login over HTTP.",
        );
    }
    let destination_route = matches!(
        path,
        "/.auth/central/public"
            | "/.auth/central/start"
            | "/.auth/central/return"
            | "/.auth/central/unlock"
            | "/.auth/central/resume"
            | "/.auth/central/profile"
            | "/.auth/central/logout"
            | "/.auth/central/signed-out"
    ) || path.starts_with("/.auth/central/assets/");
    if !destination_route
        && (state.primary_url)().is_some_and(|primary| primary != origin(request.headers()))
    {
        return error(StatusCode::FORBIDDEN, "Use the configured primary origin");
    }
    let navigation = matches!(
        path,
        "/.auth/central/start"
            | "/.auth/central/login"
            | "/.auth/central/return"
            | "/.auth/central/oidc/callback"
            | "/.auth/central/unlock"
            | "/.auth/central/signed-out"
            | "/.auth/central/public"
    ) || path.starts_with("/.auth/central/assets/");
    if !navigation && !crate::auth::browser_sessions::logout_allowed(request.headers()) {
        return error(StatusCode::FORBIDDEN, "Cross-origin request refused");
    }
    next.run(request).await
}

async fn local_profile(State(state): State<Arc<CentralAuth>>, headers: HeaderMap) -> Response {
    let Some(username) = state.current_user(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sign in to continue");
    };
    let profile = state.users.profile(&username).unwrap_or_default();
    Json(json!({"username":username,"fullName":profile.full_name,"admin":state.users.is_admin(&username)})).into_response()
}

async fn local_logout(State(state): State<Arc<CentralAuth>>, headers: HeaderMap) -> Response {
    if let Some(token) = state.browser_token(&headers) {
        if state.login.revoke_browser_session(&token).is_err() {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "Could not sign out");
        }
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    auth_cookie(&mut response, &headers, "", 0);
    response
}

async fn asset(State(state): State<Arc<CentralAuth>>, Path(file): Path<String>) -> Response {
    if file.contains("..") || file.contains('/') || file.contains('\\') {
        return error(StatusCode::BAD_REQUEST, "Invalid asset path");
    }
    match state.bundle.read_file(&format!(".client/{file}")) {
        Ok((bytes, _)) => {
            let content_type = match file.rsplit('.').next() {
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                _ => "application/octet-stream",
            };
            ([("content-type", content_type)], bytes).into_response()
        }
        Err(_) => error(StatusCode::NOT_FOUND, "Asset not found"),
    }
}

fn origin(headers: &HeaderMap) -> String {
    format!(
        "{}://{}",
        if crate::auth::is_secure_request(headers) {
            "https"
        } else {
            "http"
        },
        crate::auth::request_host(headers)
    )
}
fn cookie(response: &mut Response, headers: &HeaderMap, name: &str, value: &str, seconds: u64) {
    let options = crate::auth::CookieOptions {
        path: "/".into(),
        max_age_secs: Some(seconds as i64),
        http_only: true,
        secure: crate::auth::is_secure_request(headers),
        same_site: "Lax",
    };
    if let Ok(value) = crate::auth::cookie::set_cookie_value(name, value, &options).parse() {
        response
            .headers_mut()
            .append(axum::http::header::SET_COOKIE, value);
    }
}
fn auth_cookie(response: &mut Response, headers: &HeaderMap, jwt: &str, seconds: u64) {
    cookie(
        response,
        headers,
        &crate::auth::scoped_auth_cookie_name(&crate::auth::request_host(headers), ""),
        jwt,
        seconds,
    );
}
async fn public_config(State(state): State<Arc<CentralAuth>>, headers: HeaderMap) -> Response {
    if crate::auth::oidc::config::validated_url(&origin(&headers)).is_err() {
        return Json(json!({"primaryUrl":(state.primary_url)(),"serverName":(state.server_name)(),"configured":null,"provider":null})).into_response();
    }
    Json(json!({"primaryUrl":(state.primary_url)(),"serverName":(state.server_name)(),"configured":state.central_origin().map(|c|json!({"centralOrigin":c})),"provider":state.active_provider().map(|c|json!({"buttonLabel":c.button_label}))})).into_response()
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct StartQuery {
    destination: String,
    encrypt: bool,
}
async fn start(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<StartQuery>,
) -> Response {
    let Some(central_origin) = state.central_origin() else {
        return error(StatusCode::BAD_REQUEST, "Central login is not configured");
    };
    let Some(scope) = state.valid_destination(&query.destination) else {
        return error(
            StatusCode::BAD_REQUEST,
            "This destination is not configured on this server",
        );
    };
    let Ok(destination) = reqwest::Url::parse(&query.destination) else {
        return error(StatusCode::BAD_REQUEST, "Invalid destination");
    };
    if destination.origin().ascii_serialization() != origin(&headers) {
        return error(
            StatusCode::BAD_REQUEST,
            "Start sign-in on the destination hostname",
        );
    }
    let id = random_secret();
    let binding = random_secret();
    let mut entries = state.attempts.entries.lock().unwrap();
    entries.retain(|_, a| a.expires > now());
    if entries.len() >= 1024 {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Try again shortly.",
        );
    }
    entries.insert(
        id.clone(),
        Attempt {
            expires: now() + 600,
            destination: query.destination,
            scope,
            binding: crate::auth::oauth::challenge_for(&binding),
            central_binding: None,
            csrf: random_secret(),
            remember: false,
            encrypt: query.encrypt,
            provider: None,
            test: None,
        },
    );
    let mut response = Redirect::to(&format!(
        "{}/.auth/central/login?attempt={id}",
        central_origin
    ))
    .into_response();
    cookie(
        &mut response,
        &headers,
        &format!("sb_attempt_{id}"),
        &binding,
        600,
    );
    response
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct AttemptQuery {
    attempt: String,
    resume: String,
}
async fn login_page(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<AttemptQuery>,
) -> Response {
    let mut entries = state.attempts.entries.lock().unwrap();
    let Some(attempt) = entries
        .get_mut(&query.attempt)
        .filter(|a| a.expires > now())
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "Sign-in expired. Open the space to try again.",
        );
    };
    let central = if attempt.test.is_some() {
        (state.primary_url)().or_else(|| state.providers.draft().map(|(_, c)| c.central_origin))
    } else {
        state.central_origin()
    };
    if central.is_none_or(|central| central != origin(&headers)) {
        return error(
            StatusCode::BAD_REQUEST,
            "Use the configured central login address",
        );
    }
    let already_bound = state.central_binding_valid(&query.attempt, attempt, &headers);
    let fresh = if already_bound {
        None
    } else {
        if attempt.central_binding.is_some() {
            return error(
                StatusCode::BAD_REQUEST,
                "This sign-in attempt belongs to another browser",
            );
        }
        let secret = random_secret();
        attempt.central_binding = Some(crate::auth::oauth::challenge_for(&secret));
        Some(secret)
    };
    let is_test = attempt.test.is_some();
    let encrypt = attempt.encrypt;
    drop(entries);
    let mut response = if !is_test {
        if let (Some(user), Some(token)) =
            (state.current_user(&headers), state.browser_token(&headers))
        {
            if encrypt
                && state.users.login_method(&user) == Some(crate::multi::users::LoginMethod::Local)
            {
                state.shell()
            } else {
                match state.complete(&query.attempt, &user, &token) {
                    Ok(url) => Redirect::to(&url).into_response(),
                    Err(e) => return error(StatusCode::BAD_REQUEST, &e),
                }
            }
        } else {
            state.shell()
        }
    } else {
        state.shell()
    };
    if let Some(secret) = fresh {
        cookie(
            &mut response,
            &headers,
            &format!("sb_central_{}", query.attempt),
            &secret,
            600,
        );
    }
    response
}
async fn context(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<AttemptQuery>,
) -> Response {
    let entries = state.attempts.entries.lock().unwrap();
    let Some(attempt) = entries
        .get(&query.attempt)
        .filter(|a| state.central_binding_valid(&query.attempt, a, &headers))
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "Sign-in expired. Start again from your space.",
        );
    };
    let provider = if attempt.test.is_some() {
        state
            .providers
            .draft()
            .map(|(_, c)| c)
            .filter(|c| state.provider_matches_primary(c))
    } else {
        state.active_provider()
    };
    Json(json!({"csrf":attempt.csrf,"encrypt":attempt.encrypt,"rememberMeDays":state.login.remember_me_days(),"provider":provider.map(|c|json!({"buttonLabel":c.button_label})),"test":attempt.test.is_some(),"destination":attempt.destination,"encryptionSalt":state.login.salt()})).into_response()
}
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct LoginBody {
    attempt: String,
    csrf: String,
    username: String,
    password: String,
    remember_me: bool,
    client_encryption: bool,
    test_proof: String,
}
fn check_attempt(
    state: &CentralAuth,
    headers: &HeaderMap,
    body: &LoginBody,
) -> Result<(), (StatusCode, &'static str)> {
    if !crate::auth::browser_sessions::logout_allowed(headers) {
        return Err((StatusCode::FORBIDDEN, "Cross-origin request refused"));
    }
    let entries = state.attempts.entries.lock().unwrap();
    let Some(attempt) = entries
        .get(&body.attempt)
        .filter(|a| state.central_binding_valid(&body.attempt, a, headers))
    else {
        return Err((StatusCode::BAD_REQUEST, "Sign-in attempt expired"));
    };
    if !crate::auth::config::constant_time_eq(attempt.csrf.as_bytes(), body.csrf.as_bytes()) {
        return Err((StatusCode::FORBIDDEN, "Sign-in verification failed"));
    }
    Ok(())
}
async fn local_login(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if let Err((status, message)) = check_attempt(&state, &headers, &body) {
        return error(status, message);
    }
    if state.login.is_locked() {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many failed attempts. Please wait.",
        );
    }
    if !state.login.authorize(&body.username, &body.password) {
        state.login.record_failure();
        return error(StatusCode::UNAUTHORIZED, "Invalid username or password");
    }
    {
        let mut entries = state.attempts.entries.lock().unwrap();
        let Some(attempt) = entries.get_mut(&body.attempt) else {
            return error(StatusCode::BAD_REQUEST, "Sign-in expired");
        };
        if attempt.test.is_some() {
            return error(StatusCode::BAD_REQUEST, "Use the provider to test SSO");
        }
        attempt.remember = body.remember_me;
        attempt.encrypt = body.client_encryption;
    }
    let (jwt, secs) = match state.login.issue_session(&body.username, body.remember_me) {
        Ok(v) => v,
        Err(_) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not start a session",
            )
        }
    };
    match state.complete(&body.attempt, &body.username, &jwt) {
        Ok(redirect) => {
            let mut response = Json(json!({"redirect":redirect})).into_response();
            auth_cookie(&mut response, &headers, &jwt, secs);
            response
        }
        Err(e) => error(StatusCode::BAD_REQUEST, &e),
    }
}
async fn provider_login(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if let Err((status, message)) = check_attempt(&state, &headers, &body) {
        return error(status, message);
    }
    let testing = {
        let entries = state.attempts.entries.lock().unwrap();
        entries
            .get(&body.attempt)
            .and_then(|attempt| attempt.test.clone())
    };
    if let Some(test) = &testing {
        if !state.test_owner_current(test)
            || !crate::auth::config::constant_time_eq(
                test.proof_hash.as_bytes(),
                crate::auth::oauth::challenge_for(&body.test_proof).as_bytes(),
            )
        {
            return error(
                StatusCode::FORBIDDEN,
                "Start this test from its administrator setup window",
            );
        }
    }
    let config = if let Some(test) = &testing {
        state
            .providers
            .draft()
            .filter(|(revision, c)| *revision == test.revision && state.provider_matches_primary(c))
            .map(|(_, config)| config)
    } else {
        state.active_provider()
    };
    let Some(config) = config else {
        return error(StatusCode::BAD_REQUEST, "Single sign-on is not enabled");
    };
    let authorization = match crate::auth::oidc::client::begin(&config, &state.http).await {
        Ok(v) => v,
        Err(e) => return error(StatusCode::BAD_GATEWAY, &e),
    };
    let mut entries = state.attempts.entries.lock().unwrap();
    let Some(attempt) = entries.get_mut(&body.attempt) else {
        return error(StatusCode::BAD_REQUEST, "Sign-in expired");
    };
    if !state.central_binding_valid(&body.attempt, attempt, &headers) {
        return error(StatusCode::BAD_REQUEST, "Sign-in expired");
    }
    attempt.remember = body.remember_me;
    attempt.encrypt = body.client_encryption;
    attempt.provider = Some(ProviderAttempt {
        state: authorization.state,
        nonce: authorization.nonce,
        verifier: authorization.verifier,
        config,
    });
    Json(json!({"redirect":authorization.url})).into_response()
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Callback {
    state: String,
    code: String,
    error: String,
}
async fn provider_callback(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<Callback>,
) -> Response {
    let taken = {
        let mut entries = state.attempts.entries.lock().unwrap();
        let id = entries
            .iter()
            .find(|(_, a)| {
                a.provider.as_ref().is_some_and(|p| {
                    crate::auth::config::constant_time_eq(
                        p.state.as_bytes(),
                        query.state.as_bytes(),
                    )
                })
            })
            .map(|(id, _)| id.clone());
        let Some(id) = id else {
            return browser_error(
                StatusCode::BAD_REQUEST,
                "Unknown or already completed sign-in",
            );
        };
        let attempt = entries.get_mut(&id).unwrap();
        if !state.central_binding_valid(&id, attempt, &headers) {
            return browser_error(StatusCode::BAD_REQUEST, "Sign-in verification expired");
        }
        let provider = attempt.provider.take().unwrap();
        if provider.config.central_origin != origin(&headers) {
            return browser_error(StatusCode::BAD_REQUEST, "Wrong callback hostname");
        }
        (id, provider, attempt.test.clone(), attempt.remember)
    };
    let (id, provider, testing, remember) = taken;
    let identity = if !query.error.is_empty() {
        Err("Sign-in was cancelled or refused by the provider".into())
    } else {
        crate::auth::oidc::client::finish(
            &provider.config,
            &state.http,
            &query.code,
            &provider.nonce,
            &provider.verifier,
        )
        .await
    };
    if state
        .attempts
        .entries
        .lock()
        .unwrap()
        .get(&id)
        .is_none_or(|attempt| attempt.expires <= now())
    {
        return browser_error(
            StatusCode::BAD_REQUEST,
            "Sign-in expired. Start again from your space.",
        );
    }
    if let Some(test) = testing {
        let identity = if state.test_owner_current(&test) {
            identity
        } else {
            Err("The administrator session expired. Start a new test.".into())
        };
        let value = match identity {
            Ok(identity) => match state.providers.mark_tested(test.revision) {
                Ok(()) => {
                    json!({"status":"success","email":identity.email,"emailVerified":identity.email_verified,"fullName":identity.full_name,"issuer":identity.issuer,"subject":identity.subject,"workspaceDomain":identity.hosted_domain,"admissionAllowed":true})
                }
                Err(e) => json!({"status":"error","error":e}),
            },
            Err(e) => json!({"status":"error","error":e}),
        };
        state
            .attempts
            .results
            .lock()
            .unwrap()
            .insert(id.clone(), (now() + 600, test.owner, value));
        state.attempts.entries.lock().unwrap().remove(&id);
        return Html("<!doctype html><meta name=viewport content='width=device-width'><title>SSO test complete</title><p>Sign-in test finished. Return to the Authentication setup page to review the result.</p><button onclick='window.close()'>Close window</button>").into_response();
    }
    let identity = match identity {
        Ok(i) => i,
        Err(e) => return browser_error(StatusCode::UNAUTHORIZED, &e),
    };
    let issued=state.providers.with_active_config(&provider.config,|| {
        let username=state.users.resolve_or_bind_sso(&provider.config.provider_id,&identity).map_err(|_| "Your account hasn't been added to this server or is disabled. Contact your administrator.".to_string())?;
        let (jwt,secs)=state.login.issue_provider_session(&username,remember,&provider.config.provider_id).map_err(|_| "Could not start a session".to_string())?;
        Ok((username,jwt,secs))
    });
    let (username, jwt, secs) = match issued {
        Ok(value) => value,
        Err(error) => return browser_error(StatusCode::FORBIDDEN, &error),
    };
    match state.complete(&id, &username, &jwt) {
        Ok(url) => {
            let mut response = Redirect::to(&url).into_response();
            auth_cookie(&mut response, &headers, &jwt, secs);
            response
        }
        Err(e) => browser_error(StatusCode::BAD_REQUEST, &e),
    }
}
#[derive(Deserialize)]
struct ReturnQuery {
    code: String,
    attempt: String,
}
async fn return_to_host(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<ReturnQuery>,
) -> Response {
    let binding = crate::auth::cookie_value(&headers, &format!("sb_attempt_{}", query.attempt))
        .unwrap_or_default();
    let Some(grant) = state.handoffs.consume(
        &query.code,
        &origin(&headers),
        &crate::auth::oauth::challenge_for(&binding),
        now(),
    ) else {
        return browser_error(
            StatusCode::BAD_REQUEST,
            "Sign-in return expired or belongs to another browser. Open the space to try again.",
        );
    };
    if state.valid_destination(&grant.destination).is_none() {
        return browser_error(
            StatusCode::BAD_REQUEST,
            "Destination is no longer configured",
        );
    }
    if !state
        .users
        .session_is_current(&grant.username, grant.credential_version.as_deref())
    {
        return browser_error(StatusCode::UNAUTHORIZED, "Session expired");
    }
    let jwt = match state.authenticator.issue_browser_jwt_for_session(
        &grant.username,
        grant.credential_version,
        &grant.session_id,
        u64::MAX,
    ) {
        Ok(v) => v,
        Err(_) => return browser_error(StatusCode::UNAUTHORIZED, "Session expired"),
    };
    let resume_id = random_secret();
    {
        let mut resumes = state.attempts.resumes.lock().unwrap();
        resumes.retain(|_, r| r.expires > now());
        if resumes.len() >= 1024 {
            return browser_error(StatusCode::TOO_MANY_REQUESTS, "Too many sign-in returns");
        }
        resumes.insert(
            resume_id.clone(),
            Resume {
                attempt_id: query.attempt.clone(),
                expires: now() + 600,
                destination: grant.destination,
                scope: grant.scope,
                session_id: grant.session_id,
                username: grant.username,
                encrypt: grant.encrypt,
            },
        );
    }
    let mut response =
        Redirect::to(&format!("/.auth/central/unlock?resume={resume_id}")).into_response();
    let secs = state
        .authenticator
        .verify_browser_jwt(&jwt)
        .map(|c| (c.exp as u64).saturating_sub(now()))
        .unwrap_or(0);
    auth_cookie(&mut response, &headers, &jwt, secs);
    cookie(
        &mut response,
        &headers,
        &format!("sb_attempt_{}", query.attempt),
        "",
        0,
    );
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    response
}
async fn unlock_page(State(state): State<Arc<CentralAuth>>) -> Response {
    state.shell()
}
async fn resume_context(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Query(query): Query<AttemptQuery>,
) -> Response {
    let Some(token) = state.browser_token(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sign in to unlock this space");
    };
    let Ok(claims) = state.authenticator.verify_browser_jwt(&token) else {
        return error(StatusCode::UNAUTHORIZED, "Session expired");
    };
    if !state
        .users
        .session_is_current(&claims.username, claims.credential_version.as_deref())
    {
        return error(StatusCode::UNAUTHORIZED, "Session expired");
    }
    let resumes = state.attempts.resumes.lock().unwrap();
    let Some(resume) = resumes.get(&query.resume).filter(|r| {
        r.expires > now()
            && Some(&r.session_id) == claims.session_id.as_ref()
            && r.username == claims.username
    }) else {
        return error(StatusCode::BAD_REQUEST, "Unlock attempt expired");
    };
    if reqwest::Url::parse(&resume.destination)
        .ok()
        .is_none_or(|u| u.origin().ascii_serialization() != origin(&headers))
    {
        return error(StatusCode::FORBIDDEN, "Wrong destination hostname");
    }
    Json(json!({"attempt":resume.attempt_id,"destination":resume.destination,"scope":resume.scope,"encrypt":resume.encrypt,"username":resume.username,"loginMethod":state.users.login_method(&resume.username),"encryptionSalt":state.login.salt(),"centralOrigin":state.central_origin()})).into_response()
}
async fn test_provider(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Json(body): Json<Revision>,
) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    let Some((revision, config)) = state
        .providers
        .draft()
        .filter(|(revision, c)| *revision == body.revision && state.provider_matches_primary(c))
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "Save this configuration before testing",
        );
    };
    let Some(owner) = state.admin_binding(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Session expired");
    };
    let Some(token) = state.browser_token(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Session expired");
    };
    let Ok(claims) = state.authenticator.verify_browser_jwt(&token) else {
        return error(StatusCode::UNAUTHORIZED, "Session expired");
    };
    let Some(session_id) = claims.session_id else {
        return error(StatusCode::UNAUTHORIZED, "Browser session required");
    };
    let proof = random_secret();
    let id = random_secret();
    let mut entries = state.attempts.entries.lock().unwrap();
    entries.retain(|_, a| a.expires > now());
    if entries.len() >= 1024 {
        return error(StatusCode::TOO_MANY_REQUESTS, "Too many pending tests");
    }
    let mut results = state.attempts.results.lock().unwrap();
    results.retain(|_, (expires, _, _)| *expires > now());
    if results.len() >= 1024 {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many recent tests. Try again shortly.",
        );
    }
    entries.insert(
        id.clone(),
        Attempt {
            expires: now() + 600,
            destination: format!("{}/.dashboard/authentication", origin(&headers)),
            scope: "/".into(),
            binding: random_secret(),
            central_binding: None,
            csrf: random_secret(),
            remember: false,
            encrypt: false,
            provider: None,
            test: Some(TestAttempt {
                revision,
                owner: owner.clone(),
                username: claims.username,
                session_id,
                credential_version: claims.credential_version,
                proof_hash: crate::auth::oauth::challenge_for(&proof),
            }),
        },
    );
    results.insert(
        id.clone(),
        (now() + 600, owner, json!({"status":"running"})),
    );
    Json(
        json!({"id":id,"proof":proof,"url":format!("{}/.auth/central/login?attempt={id}",config.central_origin)}),
    )
    .into_response()
}
async fn test_result(
    State(state): State<Arc<CentralAuth>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err((status, message)) = state.admin(&headers) {
        return error(status, message);
    }
    let owner = state.admin_binding(&headers).unwrap_or_default();
    let results = state.attempts.results.lock().unwrap();
    match results
        .get(&id)
        .filter(|(expires, binding, _)| *expires > now() && *binding == owner)
    {
        Some((_, _, value)) => Json(value.clone()).into_response(),
        None => error(
            StatusCode::NOT_FOUND,
            "Test expired. Start a new sign-in test.",
        ),
    }
}
