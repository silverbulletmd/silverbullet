//! The consent seam: what the authorize endpoint hands over once the client
//! and redirect are verified, and who decides. Server asks the signed-in
//! browser user through a CSRF-checked page; an embedder can approve in-app.

use std::collections::HashSet;

use async_trait::async_trait;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};

use super::clients::McpClient;
use super::{McpCodeGrant, McpOAuthState};
use crate::auth::OAuthError;

/// An authorization request whose client and redirect URI have been checked.
#[derive(Debug, Clone)]
pub struct ConsentRequest {
    pub client: McpClient,
    pub redirect_uri: String,
    pub state: Option<String>,
    pub code_challenge: String,
    pub resource: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsentDecision {
    Approve {
        username: String,
        spaces: Vec<String>,
    },
    Deny,
}

#[async_trait]
pub trait ConsentApprover: Send + Sync {
    /// Runs before a metadata-URL client is resolved, which fetches its
    /// document: an approver that needs a signed-in browser answers here, so
    /// a signed-out request makes the server fetch nothing. `authorize_url`
    /// is the URL to come back to on GET, `None` on POST.
    async fn before_fetch(
        &self,
        _st: &McpOAuthState,
        _headers: &HeaderMap,
        _authorize_url: Option<&str>,
    ) -> Option<Response> {
        None
    }

    /// The page shown when the request cannot go back to the app, because
    /// its client or redirect URI did not check out.
    fn error_page(&self, status: StatusCode, message: &str) -> Response {
        (
            status,
            [(header::CACHE_CONTROL, "no-store")],
            message.to_string(),
        )
            .into_response()
    }

    async fn on_get(
        &self,
        st: &McpOAuthState,
        headers: &HeaderMap,
        authorize_url: &str,
        req: ConsentRequest,
    ) -> Response;

    async fn on_post(
        &self,
        st: &McpOAuthState,
        headers: &HeaderMap,
        req: ConsentRequest,
        form: &[(String, String)],
    ) -> Response;
}

pub const TOO_MANY_APPS: &str =
    "You have too many connected apps. Disconnect one under Connected apps, then connect this app again.";

/// Issues the code for an approval, or the `access_denied` answer, and returns
/// where to send the browser. The chosen spaces must all be writable by the
/// user right now.
pub fn complete_consent(
    st: &McpOAuthState,
    req: &ConsentRequest,
    decision: ConsentDecision,
) -> Result<String, OAuthError> {
    match decision {
        ConsentDecision::Deny => Ok(authorization_redirect(
            &req.redirect_uri,
            &[("error", "access_denied")],
            req.state.as_deref(),
        )),
        ConsentDecision::Approve { username, spaces } => {
            let writable: HashSet<String> = st
                .accounts
                .writable_spaces(&username)
                .into_iter()
                .map(|space| space.id)
                .collect();
            let mut chosen: Vec<String> = Vec::new();
            for space in spaces {
                if !writable.contains(&space) {
                    return Err(OAuthError::InvalidRequest(
                        "a chosen space is not one you can change",
                    ));
                }
                if !chosen.contains(&space) {
                    chosen.push(space);
                }
            }
            let now = (st.now)();
            if !st
                .grants
                .has_room_for(&username, req.client.id(), &req.resource, now)
            {
                return Err(OAuthError::InvalidRequest(TOO_MANY_APPS));
            }
            let credential_version = st.accounts.credential_version(&username);
            let code = st.codes.issue_at(
                McpCodeGrant {
                    username,
                    client_id: req.client.id().to_string(),
                    redirect_uri: req.redirect_uri.clone(),
                    code_challenge: req.code_challenge.clone(),
                    resource: req.resource.clone(),
                    spaces: chosen,
                    credential_version,
                },
                now,
            );
            Ok(authorization_redirect(
                &req.redirect_uri,
                &[("code", &code)],
                req.state.as_deref(),
            ))
        }
    }
}

/// Everything but RFC 3986's unreserved characters.
const QUERY_VALUE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// The redirect back to a client (RFC 6749 §4.1.2), with `state` when the
/// request had one. Only for a redirect URI already checked against the
/// client's declared ones. No `iss` (RFC 9207): Claude.ai rejects callbacks
/// that carry it, and it is optional.
pub fn authorization_redirect(
    redirect_uri: &str,
    params: &[(&str, &str)],
    state: Option<&str>,
) -> String {
    let mut url = redirect_uri.to_string();
    let mut sep = if redirect_uri.contains('?') { '&' } else { '?' };
    let state = state.map(|state| ("state", state));
    for (name, value) in params.iter().copied().chain(state) {
        url.push(sep);
        url.push_str(name);
        url.push('=');
        url.push_str(&utf8_percent_encode(value, QUERY_VALUE).to_string());
        sep = '&';
    }
    url
}

#[cfg(test)]
mod tests {
    use super::authorization_redirect;

    #[test]
    fn redirect_appends_to_an_existing_query_and_encodes() {
        assert_eq!(
            authorization_redirect(
                "https://app.example/cb?x=1",
                &[("code", "a b")],
                Some("s&t")
            ),
            "https://app.example/cb?x=1&code=a%20b&state=s%26t"
        );
        assert_eq!(
            authorization_redirect("http://localhost:1/cb", &[("error", "access_denied")], None),
            "http://localhost:1/cb?error=access_denied"
        );
    }
}
