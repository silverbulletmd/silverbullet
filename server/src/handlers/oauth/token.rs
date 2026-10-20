//! The token endpoint (RFC 6749 §3.2): exchanges an authorization code, a
//! device code (RFC 8628 §3.4) or a refresh token for a token pair.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Form;
use serde::Deserialize;

use super::auth_not_enabled;
use crate::auth::client_id::ClientId;
use crate::auth::device::{now, GRANT_TYPE as DEVICE_GRANT_TYPE};
use crate::auth::OAuthError;
use crate::state::ServerState;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct TokenRequest {
    pub grant_type: String,
    pub device_code: String,
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub refresh_token: String,
    pub client_id: String,
}

pub async fn handle_token(
    State(state): State<Arc<ServerState>>,
    Form(req): Form<TokenRequest>,
) -> Result<Response, OAuthError> {
    let Some(login) = state.login.clone() else {
        return Ok(auth_not_enabled());
    };
    let client = ClientId::parse(&req.client_id)?;
    let username = match req.grant_type.as_str() {
        "authorization_code" => {
            login
                .auth_codes()
                .consume(&req.code, &req.code_verifier, &req.redirect_uri, &client)?
        }
        DEVICE_GRANT_TYPE => login
            .device_codes()
            .poll(&req.device_code, &client, now())?,
        "refresh_token" => login
            .verify_refresh_token(&req.refresh_token, &client)
            .ok_or(OAuthError::InvalidGrant(
                "refresh token is expired, revoked, or not a refresh token",
            ))?,
        _ => return Err(OAuthError::UnsupportedGrantType),
    };

    Ok(match login.issue_tokens(&username, &client) {
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
            tracing::error!("failed to mint tokens: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
        }
    })
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::super::enc;
    use super::super::test_support::*;

    #[tokio::test]
    async fn token_endpoint_rejects_invalid_client_id() {
        let (state, _) = login_state();
        let response = device_post(
            state,
            "/.auth/token",
            "grant_type=refresh_token&refresh_token=x&client_id=a%20b".into(),
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
    async fn token_endpoint_issues_tokens_for_share_client_via_device_grant() {
        let (state, _) = login_state();
        let response = device_post(
            state.clone(),
            "/.auth/device/code",
            "client_id=silverbullet-share&device_name=Remote".into(),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let issued: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let login = state.login.as_ref().unwrap();
        login
            .device_codes()
            .decide(
                issued["user_code"].as_str().unwrap(),
                Some("river".into()),
                crate::auth::device::now(),
            )
            .unwrap();
        let response = device_post(
            state,
            "/.auth/token",
            format!(
                "grant_type={}&device_code={}&client_id=silverbullet-share",
                enc(crate::auth::device::GRANT_TYPE),
                issued["device_code"].as_str().unwrap()
            ),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(body["access_token"].as_str().unwrap().len() > 20);
        assert!(body["refresh_token"].as_str().unwrap().len() > 20);
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
