//! The authorization code flow with PKCE (RFC 6749 §4.1, RFC 7636) for
//! native apps on a loopback redirect (RFC 8252): a consent page, and the
//! decision that redirects back with a code.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Form;
use serde::Deserialize;

use super::{auth_not_enabled, consent_page, enc, session_cookie, session_username};
use crate::auth::client_id::ClientId;
use crate::auth::oauth::{validate_redirect_uri, CodeGrant};
use crate::state::ServerState;

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

/// What the consent page and the decision both rely on; returns the client.
/// The code store only exact-matches redirect_uri, so the loopback
/// constraint is checked here, before a grant is issued.
fn check_client(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
) -> Result<ClientId, &'static str> {
    let client = ClientId::parse(client_id).map_err(|_| "invalid client_id")?;
    if code_challenge.is_empty() {
        return Err("code_challenge is required");
    }
    if !validate_redirect_uri(redirect_uri) {
        return Err("redirect_uri must be http://127.0.0.1:<port>/<path>");
    }
    Ok(client)
}

fn check_params(p: &AuthorizeParams) -> Result<ClientId, &'static str> {
    if p.response_type != "code" {
        return Err("response_type must be 'code'");
    }
    if p.code_challenge_method != "S256" {
        return Err("code_challenge_method must be 'S256'");
    }
    check_client(&p.client_id, &p.redirect_uri, &p.code_challenge)
}

pub async fn handle_authorize_get(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(params): Query<AuthorizeParams>,
    axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
) -> Response {
    let Some(login) = state.login.clone() else {
        return auth_not_enabled();
    };
    let client = match check_params(&params) {
        Ok(client) => client,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };

    let query = raw_query.unwrap_or_default();
    let Some(username) = session_username(&state, &headers, "/.auth/authorize", Some(&query))
    else {
        let from = format!("{}/.auth/authorize?{}", login.host_url_prefix(), query);
        let location = format!("{}/.auth?from={}", login.host_url_prefix(), enc(&from));
        return (StatusCode::FOUND, [("location", location)]).into_response();
    };

    let csrf = login.csrf_token(&session_cookie(&headers, &login));
    let device_name = if params.device_name.is_empty() {
        "An application"
    } else {
        &params.device_name
    };
    let context = minijinja::context! {
        host_prefix => login.host_url_prefix(),
        space_name => state.boot_config.space_name,
        username => username,
        device_name => device_name,
        client_id => client.as_str(),
        client_name => client.display_name(),
        redirect_uri => params.redirect_uri,
        state => params.state,
        code_challenge => params.code_challenge,
        csrf_token => csrf,
        device_flow => false,
    };
    consent_page(state, context).await
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
        return auth_not_enabled();
    };
    let client = match check_client(&form.client_id, &form.redirect_uri, &form.code_challenge) {
        Ok(client) => client,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
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
            client_id: client,
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::super::test_support::*;

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
        let uri = authorize_url(CB).replace("silverbullet-app", "bad%20id");
        let resp = get(state, &uri, Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn authorize_accepts_other_valid_client_id() {
        let (state, cookie) = login_state();
        let uri = authorize_url(CB).replace("silverbullet-app", "silverbullet-share");
        let resp = get(state, &uri, Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(body_text(resp).await.contains("silverbullet-share"));
    }

    #[tokio::test]
    async fn authorize_still_rejects_non_loopback_redirect() {
        let (state, cookie) = login_state();
        let uri = authorize_url("https://evil.example/cb")
            .replace("silverbullet-app", "silverbullet-share");
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
        assert!(body.contains("name=\"code_challenge\""));
        assert!(body.contains("name=\"redirect_uri\""));
        assert!(!body.contains("name=\"user_code\""));
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

    #[tokio::test]
    async fn device_bearer_cannot_authorize_a_new_device_without_browser_cookie() {
        let (state, cookie) = login_state();
        let token = cookie.split_once('=').unwrap().1;
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri(authorize_url(CB))
                    .header("host", "localhost")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
    }
}
