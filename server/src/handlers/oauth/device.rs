//! The device authorization flow (RFC 8628): issuing a device code, and the
//! browser pages where a signed-in user enters, approves or denies it.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Form;
use serde::Deserialize;

use super::{auth_not_enabled, consent_page, enc, session_cookie, session_username};
use crate::auth::client_id::ClientId;
use crate::auth::device::{now, INTERVAL, TTL};
use crate::auth::OAuthError;
use crate::state::ServerState;

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct CodeRequest {
    client_id: String,
    device_name: String,
}

pub async fn issue(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Form(form): Form<CodeRequest>,
) -> Result<Response, OAuthError> {
    let Some(login) = &state.login else {
        return Ok(auth_not_enabled());
    };
    let client = ClientId::parse(&form.client_id)?;
    if form.device_name.len() > 200 {
        return Err(OAuthError::InvalidRequest("device_name is too long"));
    }
    let host = crate::auth::request_host(&headers);
    if host.is_empty() {
        return Err(OAuthError::InvalidRequest("the Host header is missing"));
    }
    let scheme = if crate::auth::is_secure_request(&headers) {
        "https"
    } else {
        "http"
    };
    let uri = format!("{scheme}://{host}{}/.auth/device", login.host_url_prefix());
    let attempt = login
        .device_codes()
        .issue(client, form.device_name, now())?;
    Ok((
        [("cache-control", "no-store")],
        axum::Json(serde_json::json!({
            "device_code": attempt.device_code,
            "user_code": attempt.user_code,
            "verification_uri": uri,
            "verification_uri_complete": format!("{uri}?user_code={}", enc(&attempt.user_code)),
            "expires_in": TTL,
            "interval": INTERVAL,
        })),
    )
        .into_response())
}

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct Verification {
    user_code: String,
    csrf_token: String,
    decision: String,
}

pub async fn verify(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<Verification>,
) -> Result<Response, OAuthError> {
    let Some(login) = &state.login else {
        return Ok(auth_not_enabled());
    };
    let Some(username) = session_username(&state, &headers, "/.auth/device", None) else {
        let from = format!(
            "{}/.auth/device?user_code={}",
            login.host_url_prefix(),
            enc(&query.user_code)
        );
        return Ok((
            StatusCode::FOUND,
            [(
                "location",
                format!("{}/.auth?from={}", login.host_url_prefix(), enc(&from)),
            )],
        )
            .into_response());
    };
    let attempt = if query.user_code.is_empty() {
        None
    } else {
        Some(login.device_codes().lookup(&query.user_code, now())?)
    };
    let client = attempt.as_ref().map(|a| &a.client_id);
    let context = minijinja::context! {
        host_prefix => login.host_url_prefix(),
        space_name => state.boot_config.space_name,
        username => username,
        user_code => attempt.as_ref().map(|a| &a.user_code),
        device_name => attempt.as_ref().map(|a| &a.device_name),
        client_id => client.map(ClientId::as_str),
        client_name => client.and_then(ClientId::display_name),
        csrf_token => login.csrf_token(&session_cookie(&headers, login)),
        device_flow => true,
    };
    Ok(consent_page(state, context).await)
}

pub async fn decide(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Form(form): Form<Verification>,
) -> Result<Response, OAuthError> {
    let Some(login) = &state.login else {
        return Ok(StatusCode::FORBIDDEN.into_response());
    };
    let Some(username) = session_username(&state, &headers, "/.auth/device", None) else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let expected = login.csrf_token(&session_cookie(&headers, login));
    if !crate::auth::config::constant_time_eq(expected.as_bytes(), form.csrf_token.as_bytes()) {
        return Err(OAuthError::InvalidRequest("invalid CSRF token"));
    }
    if !matches!(form.decision.as_str(), "approve" | "deny") {
        return Err(OAuthError::InvalidRequest(
            "decision must be approve or deny",
        ));
    }
    let username = (form.decision == "approve").then_some(username);
    login
        .device_codes()
        .decide(&form.user_code, username, now())?;
    Ok((
        [("cache-control", "no-store")],
        "Decision saved. You can return to the application and close this page.",
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::super::enc;
    use super::super::test_support::*;
    use crate::state::ServerState;

    #[tokio::test]
    async fn device_code_route_issues_an_attempt() {
        let (state, _) = login_state();
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.auth/device/code")
                    .header("host", "localhost")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(
                        "client_id=silverbullet-cli&device_name=Workshop",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["expires_in"], 300);
        assert_eq!(body["interval"], 5);
        assert!(body["device_code"].as_str().unwrap().len() >= 40);
    }

    #[tokio::test]
    async fn device_code_endpoint_rejects_invalid_client_id() {
        let (state, _) = login_state();
        let response = device_post(
            state,
            "/.auth/device/code",
            "client_id=a%20b&device_name=Workshop".into(),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "unauthorized_client");
    }

    #[tokio::test]
    async fn device_browser_approval_tokens_refresh_and_replay() {
        let (state, cookie) = login_state();
        let attempt = state
            .login
            .as_ref()
            .unwrap()
            .device_codes()
            .issue(
                crate::auth::client_id::ClientId::parse("silverbullet-cli").unwrap(),
                "<Workshop>".into(),
                crate::auth::device::now(),
            )
            .unwrap();
        let response = get(
            state.clone(),
            &format!("/.auth/device?user_code={}", attempt.user_code),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let page = String::from_utf8(
            axum::body::to_bytes(response.into_body(), 65536)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(page.contains("&lt;Workshop&gt;"));
        assert!(page.contains("<h1>Authorize access</h1>"));
        assert!(page.contains("Cancel"));
        assert!(page.contains("action=\"/.auth/device\""));
        assert!(!page.contains("name=\"code_challenge\""));
        assert!(page.contains(&attempt.user_code));
        assert!(!page.contains(&attempt.device_code));
        let csrf = state
            .login
            .as_ref()
            .unwrap()
            .csrf_token(cookie.split_once('=').unwrap().1);
        let form = format!(
            "user_code={}&csrf_token={csrf}&decision=approve",
            attempt.user_code
        );
        assert_eq!(
            device_post(state.clone(), "/.auth/device", form.clone(), None)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            device_post(
                state.clone(),
                "/.auth/device",
                form.replace(&csrf, "bogus"),
                Some(&cookie)
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            device_post(state.clone(), "/.auth/device", form.clone(), Some(&cookie))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            device_post(state.clone(), "/.auth/device", form, Some(&cookie))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        let poll = format!(
            "grant_type={}&client_id=silverbullet-cli&device_code={}",
            enc(crate::auth::device::GRANT_TYPE),
            attempt.device_code
        );
        let (status, tokens) = post_token(state.clone(), poll.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(tokens["username"], "alice");
        let refresh = tokens["refresh_token"].as_str().unwrap();
        let (status, _) = post_token(
            state.clone(),
            format!("grant_type=refresh_token&client_id=silverbullet-cli&refresh_token={refresh}"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, error) = post_token(
            state.clone(),
            format!("grant_type=refresh_token&client_id=silverbullet-app&refresh_token={refresh}"),
        )
        .await;
        assert_eq!(error["error"], "invalid_grant");
        let (_, error) = post_token(state, poll).await;
        assert_eq!(error["error"], "invalid_grant");
    }

    #[tokio::test]
    async fn device_code_entry_uses_shared_consent_screen() {
        let (state, cookie) = login_state();
        let response = get(state, "/.auth/device", Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK);
        let page = String::from_utf8(
            axum::body::to_bytes(response.into_body(), 65536)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(page.contains("<h1>Authorize access</h1>"));
        assert!(page.contains("method=\"get\""));
        assert!(page.contains("name=\"user_code\""));
        assert!(page.contains("Code shown by the application"));
        assert!(!page.contains("your terminal"));
        assert!(!page.contains("value=\"approve\""));
    }

    #[tokio::test]
    async fn device_prefill_does_not_approve_and_denial_is_terminal() {
        let (state, cookie) = login_state();
        let login = state.login.as_ref().unwrap();
        let attempt = login
            .device_codes()
            .issue(
                crate::auth::client_id::ClientId::parse("silverbullet-cli").unwrap(),
                "Workshop".into(),
                crate::auth::device::now(),
            )
            .unwrap();
        let response = get(
            state.clone(),
            &format!("/.auth/device?user_code={}", attempt.user_code),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(login
            .device_codes()
            .lookup(&attempt.user_code, crate::auth::device::now())
            .is_ok());
        let csrf = login.csrf_token(cookie.split_once('=').unwrap().1);
        let response = device_post(
            state.clone(),
            "/.auth/device",
            format!(
                "user_code={}&csrf_token={csrf}&decision=deny",
                attempt.user_code
            ),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let saved = String::from_utf8(
            axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(saved.contains("return to the application"));
        let (_, error) = post_token(
            state.clone(),
            format!(
                "grant_type={}&client_id=silverbullet-cli&device_code={}",
                enc(crate::auth::device::GRANT_TYPE),
                attempt.device_code
            ),
        )
        .await;
        assert_eq!(error["error"], "access_denied");
        assert_eq!(
            device_post(state.clone(), "/.auth/device/code", String::new(), None)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn device_login_preserves_space_prefix_and_user_code() {
        let (state, _) = login_state_with_prefix("/notes");
        let response = get(state.clone(), "/.auth/device?user_code=ABCD-EFGH", None).await;
        let location = response.headers()["location"].to_str().unwrap();
        assert!(location.starts_with("/notes/.auth?from="));
        let decoded = percent_encoding::percent_decode_str(location)
            .decode_utf8()
            .unwrap();
        assert!(decoded.contains("/notes/.auth/device?user_code=ABCD"));
        let response = device_post(
            state,
            "/.auth/device/code",
            "client_id=silverbullet-cli".into(),
            None,
        )
        .await;
        let body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 65536)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            body["verification_uri"],
            "http://localhost/notes/.auth/device"
        );
    }

    #[tokio::test]
    async fn device_consent_page_names_the_client() {
        let (state, cookie) = login_state();
        let response = device_post(
            state.clone(),
            "/.auth/device/code",
            "client_id=silverbullet-share&device_name=Remote".into(),
            None,
        )
        .await;
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let issued: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let uri = format!(
            "/.auth/device?user_code={}",
            enc(issued["user_code"].as_str().unwrap())
        );
        let resp = get(state, &uri, Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = body_text(resp).await;
        assert!(body.contains("silverbullet-share"), "{body}");
        assert!(!body.contains("SilverBullet CLI"), "{body}");
    }

    /// Issues a device code for a client through the router
    async fn issue_code(state: Arc<ServerState>, client_id: &str) -> serde_json::Value {
        let response = device_post(
            state,
            "/.auth/device/code",
            format!("client_id={client_id}&device_name=Remote"),
            None,
        )
        .await;
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn the_consent_page_names_silverbullets_own_clients() {
        let (state, cookie) = login_state();
        let issued = issue_code(state.clone(), "silverbullet-cli").await;
        let uri = format!(
            "/.auth/device?user_code={}",
            enc(issued["user_code"].as_str().unwrap())
        );
        let body = body_text(get(state, &uri, Some(&cookie)).await).await;
        assert!(body.contains("SilverBullet CLI is asking"), "{body}");
        assert!(!body.contains("<code>silverbullet-cli</code>"), "{body}");
    }

    #[tokio::test]
    async fn device_grant_errors_carry_a_description_like_other_grants() {
        let (state, _) = login_state();
        let issued = issue_code(state.clone(), "silverbullet-share").await;
        let (status, body) = post_token(
            state,
            format!(
                "grant_type={}&device_code={}&client_id=silverbullet-share",
                enc(crate::auth::device::GRANT_TYPE),
                issued["device_code"].as_str().unwrap()
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "authorization_pending");
        assert!(body["error_description"]
            .as_str()
            .is_some_and(|d| !d.is_empty()));
    }
}
