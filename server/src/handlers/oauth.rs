use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Form;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Deserialize;

use crate::auth::oauth::{validate_redirect_uri, CodeGrant, CLIENT_ID};
use crate::auth::{AuthContext, LoginManager};
use crate::router::run_blocking;
use crate::state::ServerState;

/// Percent-encode a value for placement inside a query string.
/// `NON_ALPHANUMERIC` is deliberately aggressive here — correct for values
/// (codes, `state`, redirect URLs) landing inside a `?...` query string.
fn enc(v: &str) -> String {
    utf8_percent_encode(v, NON_ALPHANUMERIC).to_string()
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct AuthorizeParams {
    pub client_id: String,
    pub response_type: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub device_name: String,
}

fn check_params(p: &AuthorizeParams) -> Result<(), &'static str> {
    if p.client_id != CLIENT_ID {
        return Err("unknown client_id");
    }
    if p.response_type != "code" {
        return Err("response_type must be 'code'");
    }
    if p.code_challenge_method != "S256" {
        return Err("code_challenge_method must be 'S256'");
    }
    if p.code_challenge.is_empty() {
        return Err("code_challenge is required");
    }
    if !validate_redirect_uri(&p.redirect_uri) {
        return Err("redirect_uri must be http://127.0.0.1:<port>/<path>");
    }
    Ok(())
}

/// The verified session identity, or `None` when the caller is not signed in.
/// A `HeadlessTokenAuthorizer` hit yields `username: None`; treated as signed
/// out, because a code must be attributable to an account.
fn session_username(
    state: &ServerState,
    headers: &HeaderMap,
    path: &str,
    query: Option<&str>,
) -> Option<String> {
    state
        .authorizer
        .as_ref()?
        .authorize(&AuthContext {
            method: &axum::http::Method::GET,
            path,
            query,
            headers,
        })?
        .username
}

fn session_cookie(headers: &HeaderMap, login: &LoginManager) -> String {
    let name = crate::auth::scoped_auth_cookie_name(
        &crate::auth::request_host(headers),
        login.session_url_prefix(),
    );
    crate::auth::cookie_value(headers, &name).unwrap_or_default()
}

pub async fn handle_authorize_get(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(params): Query<AuthorizeParams>,
    axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
) -> Response {
    let Some(login) = state.login.clone() else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };
    if let Err(msg) = check_params(&params) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }

    let query = raw_query.unwrap_or_default();
    let Some(username) = session_username(&state, &headers, "/.auth/authorize", Some(&query))
    else {
        let from = format!("{}/.auth/authorize?{}", login.host_url_prefix(), query);
        let location = format!("{}/.auth?from={}", login.host_url_prefix(), enc(&from));
        return (StatusCode::FOUND, [("location", location)]).into_response();
    };

    let s = state.clone();
    let shell =
        match run_blocking(move || s.client_bundle.read_file(".client/authorize.html")).await {
            Ok((data, _)) => data,
            Err(_) => return (StatusCode::NOT_FOUND, "Consent page not found").into_response(),
        };

    let csrf = login.csrf_token(&session_cookie(&headers, &login));
    let Some(body) = render(
        &shell,
        login.host_url_prefix(),
        &state.boot_config.space_name,
        &username,
        &params,
        &csrf,
    ) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Consent page failed to render",
        )
            .into_response();
    };
    (
        [
            (axum::http::header::CONTENT_TYPE, "text/html"),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

/// `None` on a template render failure — the caller must fail closed (500),
/// never serve a blank page as if it were a successful consent screen.
fn render(
    shell: &[u8],
    host_prefix: &str,
    space_name: &str,
    username: &str,
    p: &AuthorizeParams,
    csrf_token: &str,
) -> Option<Vec<u8>> {
    let shell = String::from_utf8_lossy(shell);
    let mut env = minijinja::Environment::new();
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
    let device_name = if p.device_name.is_empty() {
        "An application"
    } else {
        &p.device_name
    };
    let ctx = minijinja::context! {
        host_prefix => host_prefix,
        space_name => space_name,
        username => username,
        device_name => device_name,
        client_id => &p.client_id,
        redirect_uri => &p.redirect_uri,
        state => &p.state,
        code_challenge => &p.code_challenge,
        csrf_token => csrf_token,
    };
    match env.render_str(&shell, ctx) {
        Ok(rendered) => Some(rendered.into_bytes()),
        Err(err) => {
            tracing::error!("authorize.html template render failed: {err}");
            None
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct AuthorizeDecision {
    pub client_id: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub device_name: String,
    pub csrf_token: String,
    pub decision: String,
}

pub async fn handle_authorize_post(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Form(form): Form<AuthorizeDecision>,
) -> Response {
    let Some(login) = state.login.clone() else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };
    // The code store's `issue` performs no redirect_uri validation of its own,
    // and `consume` only exact-matches whatever was stored here — so the
    // loopback-only guarantee holds end-to-end only if this handler validates
    // before constructing the `CodeGrant`. `check_params` (shared with the GET
    // path) is what enforces that.
    let params = AuthorizeParams {
        client_id: form.client_id.clone(),
        response_type: "code".into(),
        redirect_uri: form.redirect_uri.clone(),
        state: form.state.clone(),
        code_challenge: form.code_challenge.clone(),
        code_challenge_method: "S256".into(),
        device_name: form.device_name.clone(),
    };
    if let Err(msg) = check_params(&params) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let Some(username) = session_username(&state, &headers, "/.auth/authorize", None) else {
        return (StatusCode::UNAUTHORIZED, "Not signed in").into_response();
    };
    let expected = login.csrf_token(&session_cookie(&headers, &login));
    if !crate::auth::config::constant_time_eq(expected.as_bytes(), form.csrf_token.as_bytes()) {
        return (StatusCode::BAD_REQUEST, "Invalid CSRF token").into_response();
    }

    // RFC 6749 §4.1.2: append with `&` when redirect_uri already carries a
    // query, `?` otherwise. `validate_redirect_uri` permits either.
    let sep = if form.redirect_uri.contains('?') {
        '&'
    } else {
        '?'
    };
    let location = if form.decision == "approve" {
        let code = login.auth_codes().issue(CodeGrant {
            username,
            code_challenge: form.code_challenge,
            redirect_uri: form.redirect_uri.clone(),
            client_id: form.client_id,
        });
        format!(
            "{}{sep}code={}&state={}",
            form.redirect_uri,
            enc(&code),
            enc(&form.state)
        )
    } else {
        format!(
            "{}{sep}error=access_denied&state={}",
            form.redirect_uri,
            enc(&form.state)
        )
    };
    (StatusCode::FOUND, [("location", location)]).into_response()
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct TokenRequest {
    pub grant_type: String,
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub refresh_token: String,
    pub client_id: String,
}

pub async fn handle_token(
    State(state): State<Arc<ServerState>>,
    Form(req): Form<TokenRequest>,
) -> Response {
    let Some(login) = state.login.clone() else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };
    if req.client_id != CLIENT_ID {
        return oauth_error(&crate::auth::OAuthError::UnauthorizedClient);
    }

    let username = match req.grant_type.as_str() {
        "authorization_code" => match login.auth_codes().consume(
            &req.code,
            &req.code_verifier,
            &req.redirect_uri,
            &req.client_id,
        ) {
            Ok(u) => u,
            Err(e) => return oauth_error(&e),
        },
        "refresh_token" => match login.verify_refresh_token(&req.refresh_token) {
            Some(u) => u,
            None => {
                return oauth_error(&crate::auth::OAuthError::InvalidGrant(
                    "refresh token is expired, revoked, or not a refresh token",
                ))
            }
        },
        _ => return oauth_error(&crate::auth::OAuthError::UnsupportedGrantType),
    };

    match login.issue_device_tokens(&username) {
        Ok(tokens) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            axum::Json(serde_json::json!({
                "access_token": tokens.access_token,
                "token_type": "Bearer",
                "expires_in": tokens.expires_in,
                "refresh_token": tokens.refresh_token,
                "username": username,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("failed to mint device tokens: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
        }
    }
}

fn oauth_error(err: &crate::auth::OAuthError) -> Response {
    (
        StatusCode::BAD_REQUEST,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        axum::Json(serde_json::json!({
            "error": err.code(),
            "error_description": err.description(),
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    const CB: &str = "http://127.0.0.1:51234/cb";

    fn authorize_url(redirect: &str) -> String {
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
    async fn get(state: Arc<ServerState>, uri: &str, cookie: Option<&str>) -> Response {
        let mut req = Request::builder().uri(uri).header("host", "localhost");
        if let Some(c) = cookie {
            req = req.header("cookie", c);
        }
        crate::build_router(state)
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    /// The App's pre-flight probe (`browser_auth.rs::run_flow`) tells "no auth
    /// configured" apart from "wrong URL, no space bound here" by status code
    /// alone, so a bare probe must land on 400 (missing/invalid params),
    /// never 404 — 404 is reserved for "no space at this path".
    #[tokio::test]
    async fn a_bare_authorize_request_with_no_query_params_is_bad_request() {
        let (state, _) = login_state();
        let resp = get(state, "/.auth/authorize", None).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_unauthenticated_request_is_sent_to_the_login_page() {
        let (state, _) = login_state();
        let resp = get(state, &authorize_url(CB), None).await;
        assert_eq!(resp.status(), StatusCode::FOUND);
        let loc = resp.headers()["location"].to_str().unwrap().to_string();
        assert!(loc.starts_with("/.auth?from="), "{loc}");
        // `enc()` (NON_ALPHANUMERIC) also escapes `_`, so `code_challenge`
        // doesn't survive as a literal substring of the still-encoded
        // `from=` value the way it would under a looser encoder — decode
        // before checking that the PKCE params reached the redirect target.
        let decoded = percent_encoding::percent_decode_str(&loc)
            .decode_utf8()
            .unwrap();
        assert!(decoded.contains("code_challenge"), "{loc}");
    }

    #[tokio::test]
    async fn a_non_loopback_redirect_uri_is_rejected_without_redirecting() {
        let (state, cookie) = login_state();
        let resp = get(
            state,
            &authorize_url("https://evil.example.com/cb"),
            Some(&cookie),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_unknown_client_id_is_rejected() {
        let (state, cookie) = login_state();
        let uri = authorize_url(CB).replace("silverbullet-app", "someone-else");
        let resp = get(state, &uri, Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn plain_pkce_is_rejected() {
        let (state, cookie) = login_state();
        let uri =
            authorize_url(CB).replace("code_challenge_method=S256", "code_challenge_method=plain");
        let resp = get(state, &uri, Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_authenticated_request_renders_the_consent_page() {
        let (state, cookie) = login_state();
        let resp = get(state, &authorize_url(CB), Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = String::from_utf8(
            axum::body::to_bytes(resp.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(
            body.contains("Zef&#x27;s MacBook"),
            "device name must be escaped: {body}"
        );
        assert!(body.contains("csrf_token"));
    }

    #[tokio::test]
    async fn approving_redirects_to_the_callback_with_a_code_and_the_state() {
        let (state, cookie) = login_state();
        let resp = approve(state, &cookie, true).await;
        assert_eq!(resp.status(), StatusCode::FOUND);
        let loc = resp.headers()["location"].to_str().unwrap();
        assert!(loc.starts_with("http://127.0.0.1:51234/cb?code="), "{loc}");
        assert!(loc.contains("state=xyz"), "{loc}");
    }

    #[tokio::test]
    async fn cancelling_redirects_with_access_denied_and_the_state() {
        let (state, cookie) = login_state();
        let resp = approve(state, &cookie, false).await;
        let loc = resp.headers()["location"].to_str().unwrap();
        assert!(loc.contains("error=access_denied"), "{loc}");
        assert!(loc.contains("state=xyz"), "{loc}");
    }

    #[tokio::test]
    async fn approving_without_a_valid_csrf_token_is_rejected() {
        let (state, cookie) = login_state();
        let body = approve_body(&state, &cookie, true)
            .await
            .replace("csrf_token=", "csrf_token=bogus");
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.auth/authorize")
                    .header("host", "localhost")
                    .header("cookie", &cookie)
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    /// A state with a real `LoginManager` + `JwtAuthorizer` over one shared
    /// `Authenticator`, the consent template seeded into the in-memory bundle,
    /// and a session cookie for `alice`. `auth_localhost` is the cookie name
    /// `request_host` produces once the request carries `Host: localhost` —
    /// the same one `router.rs`'s `jwt_authorizer_guards_fs_end_to_end` uses.
    fn login_state() -> (Arc<ServerState>, String) {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::config::AuthConfig;
        use crate::auth::{JwtAuthorizer, LockoutTimer, LoginManager};
        use silverbullet_server_common::space::MemorySpacePrimitives;
        use silverbullet_server_common::SpacePrimitives;

        let template = std::fs::read("../client/html/authorize.html")
            .expect("authorize.html must exist (Task 4)");
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
            String::new(),
        ));

        let mut state = crate::test_support::test_state();
        state.client_bundle = Box::new(bundle);
        state.authorizer = Some(Arc::new(JwtAuthorizer::new(
            authenticator.clone(),
            String::new(),
        )));
        state.login = Some(login);

        let jwt = authenticator
            .issue_token("alice", None, None, 3600)
            .unwrap();
        (Arc::new(state), format!("auth_localhost={jwt}"))
    }

    /// Render the consent page, scrape its CSRF token, and build the approve /
    /// deny form body the page itself would submit.
    async fn approve_body(state: &Arc<ServerState>, cookie: &str, approve: bool) -> String {
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

    async fn approve(state: Arc<ServerState>, cookie: &str, approve_it: bool) -> Response {
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
    async fn approved_code(state: Arc<ServerState>, cookie: &str) -> String {
        let resp = approve(state, cookie, true).await;
        let loc = resp.headers()["location"].to_str().unwrap().to_string();
        let start = loc.find("code=").expect("code in redirect") + "code=".len();
        let end = loc[start..]
            .find('&')
            .map(|i| start + i)
            .unwrap_or(loc.len());
        loc[start..end].to_string()
    }

    fn exchange_body(code: &str) -> String {
        format!(
            "grant_type=authorization_code&code={}&code_verifier=verifier-abc\
             &redirect_uri={}&client_id=silverbullet-app",
            enc(code),
            enc(CB)
        )
    }

    async fn post_token(state: Arc<ServerState>, body: String) -> (StatusCode, serde_json::Value) {
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

    #[tokio::test]
    async fn a_code_exchanges_for_a_token_pair() {
        let (state, cookie) = login_state();
        let code = approved_code(state.clone(), &cookie).await;
        let (status, body) = post_token(
            state,
            format!(
                "grant_type=authorization_code&code={code}&code_verifier=verifier-abc\
                 &redirect_uri=http%3A%2F%2F127.0.0.1%3A51234%2Fcb&client_id=silverbullet-app"
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["token_type"], "Bearer");
        assert_eq!(body["username"], "alice");
        assert_eq!(body["expires_in"], 365 * 24 * 3600);
        assert!(body["access_token"].as_str().unwrap().len() > 20);
        assert!(body["refresh_token"].as_str().unwrap().len() > 20);
    }

    #[tokio::test]
    async fn the_access_token_authorizes_a_protected_route() {
        let (state, cookie) = login_state();
        let code = approved_code(state.clone(), &cookie).await;
        let (_, body) = post_token(state.clone(), exchange_body(&code)).await;
        let token = body["access_token"].as_str().unwrap();
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.config")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_wrong_verifier_is_invalid_grant() {
        let (state, cookie) = login_state();
        let code = approved_code(state.clone(), &cookie).await;
        let (status, body) = post_token(
            state,
            exchange_body(&code).replace("verifier-abc", "verifier-wrong"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_grant");
    }

    #[tokio::test]
    async fn a_code_cannot_be_exchanged_twice() {
        let (state, cookie) = login_state();
        let code = approved_code(state.clone(), &cookie).await;
        let (first, _) = post_token(state.clone(), exchange_body(&code)).await;
        assert_eq!(first, StatusCode::OK);
        let (second, body) = post_token(state, exchange_body(&code)).await;
        assert_eq!(second, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_grant");
    }

    #[tokio::test]
    async fn a_refresh_token_yields_a_new_pair_and_an_access_token_does_not() {
        let (state, cookie) = login_state();
        let code = approved_code(state.clone(), &cookie).await;
        let (_, first) = post_token(state.clone(), exchange_body(&code)).await;

        let refresh = first["refresh_token"].as_str().unwrap();
        let (status, body) = post_token(
            state.clone(),
            format!("grant_type=refresh_token&refresh_token={refresh}&client_id=silverbullet-app"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["username"], "alice");

        let access = first["access_token"].as_str().unwrap();
        let (status, body) = post_token(
            state,
            format!("grant_type=refresh_token&refresh_token={access}&client_id=silverbullet-app"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_grant");
    }

    #[tokio::test]
    async fn an_unknown_grant_type_is_unsupported_grant_type() {
        let (state, _) = login_state();
        let (status, body) = post_token(
            state,
            "grant_type=password&client_id=silverbullet-app".into(),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "unsupported_grant_type");
    }
}
