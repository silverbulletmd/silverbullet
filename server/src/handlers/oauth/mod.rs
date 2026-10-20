//! The OAuth endpoints: the authorization code flow (`authorize`), the
//! device flow (`device`) and the token endpoint both end in (`token`).

pub mod authorize;
pub mod device;
#[cfg(test)]
mod test_support;
pub mod token;

use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

use crate::auth::{AuthContext, LoginManager, OAuthError};
use crate::router::run_blocking;
use crate::state::ServerState;

/// Percent-encode a value for placement inside a query string.
/// `NON_ALPHANUMERIC` is deliberately aggressive here — correct for values
/// (codes, `state`, redirect URLs) landing inside a `?...` query string.
fn enc(v: &str) -> String {
    utf8_percent_encode(v, NON_ALPHANUMERIC).to_string()
}

/// The JSON error response of RFC 6749 §5.2
impl IntoResponse for OAuthError {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            axum::Json(serde_json::json!({
                "error": self.code(),
                "error_description": self.description(),
            })),
        )
            .into_response()
    }
}

fn auth_not_enabled() -> Response {
    (StatusCode::FORBIDDEN, "Authentication not enabled").into_response()
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
    let login = state.login.as_ref()?;
    let token = session_cookie(headers, login);
    login.verify_browser_session(&token)?;
    let mut browser_headers = headers.clone();
    browser_headers.remove(axum::http::header::AUTHORIZATION);
    state
        .authorizer
        .as_ref()?
        .authorize(&AuthContext {
            method: &axum::http::Method::GET,
            path,
            query,
            headers: &browser_headers,
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

async fn consent_page(state: Arc<ServerState>, context: minijinja::Value) -> Response {
    let shell =
        match run_blocking(move || state.client_bundle.read_file(".client/authorize.html")).await {
            Ok((data, _)) => data,
            Err(_) => return (StatusCode::NOT_FOUND, "Consent page not found").into_response(),
        };
    let mut env = minijinja::Environment::new();
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
    match env.render_str(&String::from_utf8_lossy(&shell), context) {
        Ok(body) => (
            [
                ("content-type", "text/html; charset=utf-8"),
                ("cache-control", "no-store"),
                ("referrer-policy", "no-referrer"),
            ],
            body,
        )
            .into_response(),
        Err(error) => {
            tracing::error!("authorize.html template render failed: {error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Consent page failed to render",
            )
                .into_response()
        }
    }
}
