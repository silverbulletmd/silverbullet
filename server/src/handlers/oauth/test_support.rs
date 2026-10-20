//! Helpers for the OAuth endpoint tests: a server with sign-in enabled, and
//! requests through its router.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use tower::ServiceExt;

use super::enc;
use crate::state::ServerState;

pub(super) async fn device_post(
    state: Arc<ServerState>,
    path: &str,
    body: String,
    cookie: Option<&str>,
) -> Response {
    let mut request = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "localhost")
        .header("content-type", "application/x-www-form-urlencoded");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    crate::build_router(state)
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap()
}

pub(super) const CB: &str = "http://127.0.0.1:51234/cb";

pub(super) fn authorize_url(redirect: &str) -> String {
    format!(
        "/.auth/authorize?client_id=silverbullet-app&response_type=code\
         &redirect_uri={}&state=xyz&code_challenge=abc&code_challenge_method=S256\
         &device_name=Zef%27s%20MacBook",
        enc(redirect)
    )
}

/// Every request carries an explicit `Host: localhost` header (matching
/// `router.rs`'s `jwt_authorizer_guards_fs_end_to_end`), so the session
/// cookie name derived by `request_host` is the fixed `auth_localhost`
/// used throughout this module.
pub(super) async fn get(state: Arc<ServerState>, uri: &str, cookie: Option<&str>) -> Response {
    let mut req = Request::builder().uri(uri).header("host", "localhost");
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    crate::build_router(state)
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

pub(super) async fn body_text(resp: Response) -> String {
    String::from_utf8(
        axum::body::to_bytes(resp.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap()
}

/// A state with a real `LoginManager` + `JwtAuthorizer` over one shared
/// `Authenticator`, the consent template seeded into the in-memory bundle,
/// and a session cookie for `alice`. `auth_localhost` is the cookie name
/// `request_host` produces once the request carries `Host: localhost` —
/// the same one `router.rs`'s `jwt_authorizer_guards_fs_end_to_end` uses.
pub(super) fn login_state() -> (Arc<ServerState>, String) {
    login_state_with_prefix("")
}

pub(super) fn login_state_with_prefix(prefix: &str) -> (Arc<ServerState>, String) {
    use crate::auth::authenticator::Authenticator;
    use crate::auth::config::AuthConfig;
    use crate::auth::{JwtAuthorizer, LockoutTimer, LoginManager};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use silverbullet_server_common::SpacePrimitives;

    let template =
        std::fs::read("../client/html/authorize.html").expect("authorize.html must exist (Task 4)");
    let bundle = MemorySpacePrimitives::new();
    bundle
        .write_file(".client/authorize.html", &template, None)
        .unwrap();

    let authenticator = Arc::new(Authenticator::from_parts(
        vec![9u8; 32],
        "c2FsdHNhbHRzYWx0c2Ex".into(),
        "h".into(),
    ));
    let config = AuthConfig::try_parse(Some("alice:s3cret"), None, None, None, None)
        .unwrap()
        .unwrap();
    let lockout = LockoutTimer::from_config(config.lockout_time_secs, config.lockout_limit);
    let login = Arc::new(LoginManager::new(
        authenticator.clone(),
        Arc::new(config),
        48,
        lockout,
        prefix.into(),
    ));

    let mut state = crate::test_support::test_state();
    state.client_bundle = Box::new(bundle);
    state.authorizer = Some(Arc::new(JwtAuthorizer::new(
        authenticator.clone(),
        String::new(),
    )));
    state.login = Some(login);

    let jwt = authenticator
        .issue_token("alice", None, None, None, 3600)
        .unwrap();
    (
        Arc::new(state),
        format!(
            "{}={jwt}",
            crate::auth::scoped_auth_cookie_name("localhost", prefix)
        ),
    )
}

/// Render the consent page, scrape its CSRF token, and build the approve /
/// deny form body the page itself would submit.
pub(super) async fn approve_body(state: &Arc<ServerState>, cookie: &str, approve: bool) -> String {
    let resp = get(state.clone(), &authorize_url(CB), Some(cookie)).await;
    let page = String::from_utf8(
        axum::body::to_bytes(resp.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let marker = "name=\"csrf_token\" value=\"";
    let start = page.find(marker).expect("csrf_token in page") + marker.len();
    let csrf = &page[start..start + page[start..].find('"').unwrap()];
    format!(
        "client_id=silverbullet-app&redirect_uri={}&state=xyz&code_challenge={}\
         &device_name=Test&csrf_token={csrf}&decision={}",
        enc(CB),
        enc(&crate::auth::oauth::challenge_for("verifier-abc")),
        if approve { "approve" } else { "deny" }
    )
}

pub(super) async fn approve(state: Arc<ServerState>, cookie: &str, approve_it: bool) -> Response {
    let body = approve_body(&state, cookie, approve_it).await;
    crate::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/.auth/authorize")
                .header("host", "localhost")
                .header("cookie", cookie)
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
}

/// Approve the consent screen and pull the `code` back out of the
/// resulting `Location` redirect — the code itself is hex digits, so
/// unlike `state`/`redirect_uri` it never needs decoding.
pub(super) async fn approved_code(state: Arc<ServerState>, cookie: &str) -> String {
    let resp = approve(state, cookie, true).await;
    let loc = resp.headers()["location"].to_str().unwrap().to_string();
    let start = loc.find("code=").expect("code in redirect") + "code=".len();
    let end = loc[start..]
        .find('&')
        .map(|i| start + i)
        .unwrap_or(loc.len());
    loc[start..end].to_string()
}

pub(super) fn exchange_body(code: &str) -> String {
    format!(
        "grant_type=authorization_code&code={}&code_verifier=verifier-abc\
         &redirect_uri={}&client_id=silverbullet-app",
        enc(code),
        enc(CB)
    )
}

pub(super) async fn post_token(
    state: Arc<ServerState>,
    body: String,
) -> (StatusCode, serde_json::Value) {
    let resp = crate::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/.auth/token")
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
