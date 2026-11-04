//! The authorization server for MCP clients, on the main router of a
//! multi-space server: discovery (RFC 9728, RFC 8414), registration
//! (RFC 7591), the token endpoint and revocation (RFC 7009). Separate from
//! the per-space `/.auth/*` flow: it issues only audience-bound MCP tokens and
//! never the legacy ones space endpoints accept.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Bytes;
use axum::extract::rejection::FormRejection;
use axum::extract::{DefaultBodyLimit, RawQuery, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{from_fn, map_response, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use silverbullet_server_common::SpacePrimitives;

use crate::auth::mcp::client_auth::{self, Credentials};
use crate::auth::mcp::clients::{is_metadata_url, resolve_client, McpClient, DCR_PREFIX};
use crate::auth::mcp::consent::{
    authorization_redirect, complete_consent, ConsentApprover, ConsentDecision, ConsentRequest,
    TOO_MANY_APPS,
};
use crate::auth::mcp::grants::{ClientKind, Grant, NewGrant, RotateError};
use crate::auth::mcp::{
    authorization_server_metadata, canonical_mcp_url, canonical_origin, is_loopback_redirect,
    protected_resource_metadata, redirect_allowed, McpAccessClaims, McpCodeGrant, McpOAuthState,
    McpRefreshClaims, ACCESS_TTL_SECS, SCOPE,
};
use crate::auth::oauth::verify_pkce;
use crate::auth::{LoginManager, OAuthError};

const BODY_LIMIT: usize = 64 * 1024;

/// Server's consent: the signed-in browser user approves on a CSRF-checked
/// page rendered from the client bundle's `authorize.html`.
pub struct SessionConsent {
    pub csrf: Arc<LoginManager>,
    pub bundle: Box<dyn SpacePrimitives>,
}

const AUTHORIZE_PATH: &str = "/.auth/mcp/authorize";

impl SessionConsent {
    /// The value of the session cookie, which the CSRF token is bound to.
    fn session(&self, headers: &HeaderMap) -> String {
        let name = crate::auth::scoped_auth_cookie_name(
            &crate::auth::request_host(headers),
            self.csrf.session_url_prefix(),
        );
        crate::auth::cookie_value(headers, &name).unwrap_or_default()
    }

    fn render(&self, status: StatusCode, context: minijinja::Value) -> Response {
        let Ok((shell, _)) = self.bundle.read_file(".client/authorize.html") else {
            return (StatusCode::NOT_FOUND, "Consent page not found").into_response();
        };
        let mut env = minijinja::Environment::new();
        env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
        match env.render_str(&String::from_utf8_lossy(&shell), context) {
            Ok(body) => (
                status,
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-store"),
                    (header::REFERRER_POLICY, "no-referrer"),
                    (header::X_FRAME_OPTIONS, "DENY"),
                    (header::CONTENT_SECURITY_POLICY, "frame-ancestors 'none'"),
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

    fn signed_out(&self) -> Response {
        self.error_page(
            StatusCode::UNAUTHORIZED,
            "You are no longer signed in. Go back to the app and connect it again.",
        )
    }
}

#[async_trait]
impl ConsentApprover for SessionConsent {
    async fn before_fetch(
        &self,
        st: &McpOAuthState,
        headers: &HeaderMap,
        authorize_url: Option<&str>,
    ) -> Option<Response> {
        if st.accounts.signed_in_user(headers).is_some() {
            return None;
        }
        Some(match authorize_url {
            Some(url) => found(st.accounts.login_url(url)),
            None => self.signed_out(),
        })
    }

    fn error_page(&self, status: StatusCode, message: &str) -> Response {
        self.render(
            status,
            minijinja::context! {
                asset_base => "/.auth/central/assets",
                host_prefix => "",
                mcp => true,
                error => message,
            },
        )
    }

    async fn on_get(
        &self,
        st: &McpOAuthState,
        headers: &HeaderMap,
        authorize_url: &str,
        req: ConsentRequest,
    ) -> Response {
        let Some(username) = st.accounts.signed_in_user(headers) else {
            return found(st.accounts.login_url(authorize_url));
        };
        let spaces: Vec<minijinja::Value> = st
            .accounts
            .writable_spaces(&username)
            .into_iter()
            .map(|space| {
                minijinja::context! { id => space.id, name => space.name, shared => space.shared }
            })
            .collect();
        let redirect_host = reqwest::Url::parse(&req.redirect_uri)
            .ok()
            .and_then(|url| {
                if is_loopback_redirect(&url) {
                    Some("this computer".to_string())
                } else {
                    url.host_str().map(str::to_string)
                }
            })
            .unwrap_or_default();
        let logo_uri = match &req.client {
            McpClient::Cimd(meta) => meta.logo_uri.clone(),
            McpClient::Dcr(_) => None,
        };
        let mut fields = vec![
            ("response_type", "code".to_string()),
            ("client_id", req.client.id().to_string()),
            ("redirect_uri", req.redirect_uri.clone()),
            ("code_challenge", req.code_challenge.clone()),
            ("code_challenge_method", "S256".to_string()),
            ("resource", req.resource.clone()),
            ("scope", SCOPE.to_string()),
        ];
        if let Some(state) = &req.state {
            fields.push(("state", state.clone()));
        }
        self.render(
            StatusCode::OK,
            minijinja::context! {
                mcp => true,
                asset_base => "/.auth/central/assets",
                host_prefix => "",
                space_name => st.accounts.server_name(),
                client_name => req.client.display_name(),
                username => username,
                verified_host => req.client.verified_host(),
                redirect_host => redirect_host,
                logo_uri => logo_uri,
                spaces => spaces,
                fields => fields,
                csrf_token => self.csrf.csrf_token(&self.session(headers)),
            },
        )
    }

    async fn on_post(
        &self,
        st: &McpOAuthState,
        headers: &HeaderMap,
        req: ConsentRequest,
        form: &[(String, String)],
    ) -> Response {
        let Some(username) = st.accounts.signed_in_user(headers) else {
            return self.signed_out();
        };
        // Bound to no session, the token would be the same for every user.
        let session = self.session(headers);
        let expected = self.csrf.csrf_token(&session);
        let sent = single(form, "csrf_token").ok().flatten().unwrap_or("");
        if session.is_empty()
            || !crate::auth::config::constant_time_eq(expected.as_bytes(), sent.as_bytes())
        {
            return self.error_page(
                StatusCode::BAD_REQUEST,
                "This page has expired. Go back to the app and connect it again.",
            );
        }
        let decision = match single(form, "decision") {
            Ok(Some("approve")) => ConsentDecision::Approve {
                username,
                spaces: form
                    .iter()
                    .filter(|(name, _)| name == "space")
                    .map(|(_, value)| value.clone())
                    .collect(),
            },
            Ok(Some("deny")) => ConsentDecision::Deny,
            _ => {
                return self.error_page(StatusCode::BAD_REQUEST, "Choose Allow or Cancel.");
            }
        };
        match complete_consent(st, &req, decision) {
            Ok(location) => found(location),
            Err(error) => self.error_page(StatusCode::BAD_REQUEST, error.description()),
        }
    }
}

fn found(location: String) -> Response {
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, location),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
    )
        .into_response()
}

/// Every route but `/.auth/revoke` answers 404 while `enabled()` is false, so
/// turning MCP off stops new sign-ins and refreshes at once, while apps can
/// still disconnect themselves.
pub fn router(state: Arc<McpOAuthState>, enabled: Arc<dyn Fn() -> bool + Send + Sync>) -> Router {
    let gated = Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(resource_metadata).options(preflight),
        )
        .route(
            "/.well-known/oauth-protected-resource/.mcp",
            get(resource_metadata).options(preflight),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(server_metadata).options(preflight),
        )
        .route("/.auth/mcp/token", post(token).options(preflight))
        .route("/.auth/register", post(register).options(preflight))
        .layer(map_response(with_cors))
        .merge(Router::new().route(AUTHORIZE_PATH, get(authorize_get).post(authorize_post)))
        .layer(from_fn(move |req: Request, next: Next| {
            let enabled = enabled.clone();
            async move {
                if enabled() {
                    next.run(req).await
                } else {
                    StatusCode::NOT_FOUND.into_response()
                }
            }
        }));
    let revocation = Router::new()
        .route("/.auth/revoke", post(revoke).options(preflight))
        .layer(map_response(with_cors));
    gated
        .merge(revocation)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

/// Browser-based clients (MCP Inspector) call these cross-origin; nothing
/// here reads cookies, so any origin may.
async fn with_cors(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

async fn preflight() -> Response {
    (
        StatusCode::NO_CONTENT,
        [
            (header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, OPTIONS"),
            (
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "authorization, content-type, mcp-protocol-version",
            ),
            (header::ACCESS_CONTROL_MAX_AGE, "86400"),
        ],
    )
        .into_response()
}

async fn authorize_get(
    State(st): State<Arc<McpOAuthState>>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Response {
    let query = query.unwrap_or_default();
    let params = parse_pairs(query.as_bytes());
    let authorize_url = format!("{AUTHORIZE_PATH}?{query}");
    match check_authorize(&st, &headers, &params, Some(&authorize_url)).await {
        Ok(req) => st.consent.on_get(&st, &headers, &authorize_url, req).await,
        Err(response) => response,
    }
}

async fn authorize_post(
    State(st): State<Arc<McpOAuthState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let form = parse_pairs(&body);
    match check_authorize(&st, &headers, &form, None).await {
        Ok(req) => st.consent.on_post(&st, &headers, req, &form).await,
        Err(response) => response,
    }
}

fn parse_pairs(bytes: &[u8]) -> Vec<(String, String)> {
    form_urlencoded::parse(bytes).into_owned().collect()
}

/// A parameter's value; `Err` when it is repeated (RFC 6749 §3.1).
fn single<'a>(pairs: &'a [(String, String)], name: &str) -> Result<Option<&'a str>, ()> {
    let mut values = pairs.iter().filter(|(key, _)| key == name);
    let first = values.next().map(|(_, value)| value.as_str());
    match values.next() {
        Some(_) => Err(()),
        None => Ok(first),
    }
}

/// An S256 challenge is a base64url SHA-256 digest: 43 characters.
fn valid_challenge(challenge: &str) -> bool {
    challenge.len() == 43
        && challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Checks the client and its redirect URI first: until both hold, errors are
/// shown here, since sending the browser to an unverified URI would make this
/// server an open redirector. After that, errors go back to the app.
async fn check_authorize(
    st: &McpOAuthState,
    headers: &HeaderMap,
    params: &[(String, String)],
    authorize_url: Option<&str>,
) -> Result<ConsentRequest, Response> {
    let page = |message: &str| st.consent.error_page(StatusCode::BAD_REQUEST, message);
    let (Ok(Some(client_id)), Ok(Some(redirect_uri))) =
        (single(params, "client_id"), single(params, "redirect_uri"))
    else {
        return Err(page(
            "The app's request is missing its client_id or redirect_uri.",
        ));
    };
    if is_metadata_url(client_id) {
        if let Some(response) = st.consent.before_fetch(st, headers, authorize_url).await {
            return Err(response);
        }
    }
    let client = match resolve_client(client_id, &st.clients, &st.cimd).await {
        Ok(client) => client,
        Err(OAuthError::TemporarilyUnavailable) => {
            return Err(st.consent.error_page(
                StatusCode::SERVICE_UNAVAILABLE,
                "The app could not be checked right now. Try again later.",
            ))
        }
        Err(_) => {
            return Err(page(
                "SilverBullet could not verify this app, so it cannot connect.",
            ))
        }
    };
    if !redirect_allowed(redirect_uri, client.redirect_uris()) {
        return Err(page(
            "The app asked to return to an address it did not register, so SilverBullet will not send you there.",
        ));
    }
    let primary = st.accounts.primary_url();
    let resource = canonical_mcp_url(headers, primary.as_deref());
    let state = single(params, "state").ok().flatten();
    match check_parameters(params, &resource) {
        Ok(challenge) => Ok(ConsentRequest {
            client,
            redirect_uri: redirect_uri.to_string(),
            state: state.map(str::to_string),
            code_challenge: challenge.to_string(),
            resource,
        }),
        Err(error) => Err(found(authorization_redirect(
            redirect_uri,
            &[("error", error)],
            state,
        ))),
    }
}

/// The checks whose failure goes back to the app; the error code, or the
/// PKCE challenge.
fn check_parameters<'a>(
    params: &'a [(String, String)],
    resource: &str,
) -> Result<&'a str, &'static str> {
    let one = |name: &str| single(params, name).map_err(|_| "invalid_request");
    one("state")?;
    if one("response_type")? != Some("code") {
        return Err("invalid_request");
    }
    let challenge = one("code_challenge")?.unwrap_or_default();
    if one("code_challenge_method")? != Some("S256") || !valid_challenge(challenge) {
        return Err("invalid_request");
    }
    if check_scope(one("scope")?).is_err() {
        return Err("invalid_scope");
    }
    if one("resource")? != Some(resource) {
        return Err("invalid_target");
    }
    Ok(challenge)
}

async fn resource_metadata(State(st): State<Arc<McpOAuthState>>, headers: HeaderMap) -> Response {
    let primary = st.accounts.primary_url();
    Json(protected_resource_metadata(
        &headers,
        primary.as_deref(),
        &st.accounts.server_name(),
    ))
    .into_response()
}

async fn server_metadata(State(st): State<Arc<McpOAuthState>>, headers: HeaderMap) -> Response {
    let primary = st.accounts.primary_url();
    Json(authorization_server_metadata(&headers, primary.as_deref())).into_response()
}

async fn register(State(st): State<Arc<McpOAuthState>>, body: Bytes) -> Response {
    let Ok(metadata) = serde_json::from_slice::<Value>(&body) else {
        return OAuthError::InvalidClientMetadata("registration must be a JSON object")
            .into_response();
    };
    let now = (st.now)();
    let result = blocking(move || st.clients.register(&metadata, now)).await;
    match result {
        Ok(registration) => (
            StatusCode::CREATED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(registration.response_json()),
        )
            .into_response(),
        Err(error) => error.into_response(),
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct TokenRequest {
    grant_type: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
    client_id: String,
    refresh_token: String,
    resource: Option<String>,
    scope: Option<String>,
    client_assertion_type: Option<String>,
    client_assertion: Option<String>,
}

impl TokenRequest {
    fn credentials(&self) -> Credentials<'_> {
        Credentials {
            assertion_type: self.client_assertion_type.as_deref(),
            assertion: self.client_assertion.as_deref(),
        }
    }
}

async fn token(
    State(st): State<Arc<McpOAuthState>>,
    headers: HeaderMap,
    form: Result<Form<TokenRequest>, FormRejection>,
) -> Response {
    let Ok(Form(req)) = form else {
        return OAuthError::InvalidRequest("expected a form-encoded token request").into_response();
    };
    let result = match req.grant_type.as_str() {
        "authorization_code" => exchange_code(&st, &headers, req).await,
        "refresh_token" => refresh(&st, &headers, req).await,
        "" => Err(OAuthError::InvalidRequest("grant_type is required")),
        _ => Err(OAuthError::UnsupportedGrantType),
    };
    match result {
        Ok(body) => (
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::PRAGMA, "no-cache"),
            ],
            Json(body),
        )
            .into_response(),
        Err(error) => error.into_response(),
    }
}

async fn exchange_code(
    st: &Arc<McpOAuthState>,
    headers: &HeaderMap,
    req: TokenRequest,
) -> Result<Value, OAuthError> {
    let now = (st.now)();
    // Checked before the code is looked up, so the token endpoint cannot be
    // used to make the server fetch arbitrary metadata documents.
    let authenticating = req.client_assertion.is_some();
    if !(req.client_id.starts_with(DCR_PREFIX) || is_metadata_url(&req.client_id)) {
        return Err(client_error(headers, authenticating));
    }
    if req.code.is_empty() {
        return Err(OAuthError::InvalidRequest("code is required"));
    }
    let primary = st.accounts.primary_url();
    // Every check but client authentication uses the code up when it fails,
    // as a guessed or replayed code must not survive a second attempt. A
    // failed client authentication (an assertion that expired, a JWKS that
    // could not be fetched) leaves it for a retry; it is consumed after.
    let Some(code) = st.codes.peek_at(&req.code, now) else {
        return Err(st
            .codes
            .take_at(&req.code, now)
            .err()
            .unwrap_or(OAuthError::InvalidGrant("unknown or already-used code")));
    };
    let resource = match check_code(&code, &req, &canonical_mcp_url(headers, primary.as_deref())) {
        Ok(resource) => resource,
        Err(error) => {
            let _ = st.codes.take_at(&req.code, now);
            return Err(error);
        }
    };
    let client = resolve_client(&req.client_id, &st.clients, &st.cimd)
        .await
        .map_err(|error| match error {
            OAuthError::TemporarilyUnavailable => error,
            _ => client_error(headers, authenticating),
        })?;
    let issuer = canonical_origin(headers, primary.as_deref());
    client_auth::authenticate(
        &st.cimd,
        &client,
        req.credentials(),
        &client_auth::audiences(&issuer),
        now,
    )
    .await?;
    let code = st.codes.take_at(&req.code, now)?;
    let private_key_jwt = client.uses_private_key_jwt();
    if !redirect_allowed(&code.redirect_uri, client.redirect_uris()) {
        return Err(OAuthError::InvalidGrant(
            "redirect_uri is no longer registered for this client",
        ));
    }
    // A code from before a password change, sign out everywhere or disabling
    // must not outlive the grants those changes revoke.
    if !st
        .accounts
        .session_is_current(&code.username, code.credential_version.as_deref())
    {
        return Err(OAuthError::InvalidGrant(
            "the account's sign-in changed; the app must sign in again",
        ));
    }
    let credential_version = code.credential_version.clone();
    // Only spaces still writable now.
    let writable: HashSet<String> = st
        .accounts
        .writable_spaces(&code.username)
        .into_iter()
        .map(|space| space.id)
        .collect();
    let consented = !code.spaces.is_empty();
    let mut spaces: Vec<String> = Vec::new();
    for space in code.spaces {
        if writable.contains(&space) && !spaces.contains(&space) {
            spaces.push(space);
        }
    }
    if consented && spaces.is_empty() {
        return Err(OAuthError::InvalidGrant(
            "none of the approved spaces is writable any more",
        ));
    }
    let new_grant = NewGrant {
        username: code.username,
        client_id: client.id().to_string(),
        client_name: client.display_name(),
        client_kind: match client {
            McpClient::Cimd(_) => ClientKind::Cimd,
            McpClient::Dcr(_) => ClientKind::Dcr,
        },
        verified_host: client.verified_host().map(str::to_string),
        redirect_host: reqwest::Url::parse(&code.redirect_uri)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_default(),
        resource: resource.to_string(),
        spaces,
        scope: SCOPE.into(),
        access: "write".into(),
        credential_version,
    };
    let store = st.clone();
    let grant = blocking(move || {
        let grant = store
            .grants
            .create(new_grant, now)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::QuotaExceeded => OAuthError::InvalidGrant(TOO_MANY_APPS),
                _ => {
                    tracing::error!("could not store MCP grant: {error}");
                    OAuthError::ServerError("could not record the grant")
                }
            })?;
        store.clients.touch(&grant.client_id, now);
        Ok(grant)
    })
    .await?;
    token_pair(st, &grant, now, private_key_jwt)
}

/// The checks of the code against the request that use the code up when
/// they fail; the resource on success.
fn check_code<'a>(
    code: &McpCodeGrant,
    req: &'a TokenRequest,
    expected_resource: &str,
) -> Result<&'a str, OAuthError> {
    if code.client_id != req.client_id {
        return Err(OAuthError::InvalidGrant(
            "code was issued to another client",
        ));
    }
    if code.redirect_uri != req.redirect_uri {
        return Err(OAuthError::InvalidGrant(
            "redirect_uri does not match the authorization request",
        ));
    }
    if !verify_pkce(&code.code_challenge, &req.code_verifier) {
        return Err(OAuthError::InvalidGrant("code_verifier does not match"));
    }
    check_scope(req.scope.as_deref())?;
    let resource = req.resource.as_deref().ok_or(OAuthError::InvalidTarget)?;
    if resource != code.resource || resource != expected_resource {
        return Err(OAuthError::InvalidTarget);
    }
    Ok(resource)
}

async fn refresh(
    st: &Arc<McpOAuthState>,
    headers: &HeaderMap,
    req: TokenRequest,
) -> Result<Value, OAuthError> {
    let now = (st.now)();
    let invalid = || OAuthError::InvalidGrant("refresh token is invalid, expired or revoked");
    let claims = st
        .authenticator
        .verify_mcp_refresh(&req.refresh_token)
        .map_err(|_| invalid())?;
    if req.client_id.is_empty() {
        return Err(OAuthError::InvalidRequest("client_id is required"));
    }
    if req.client_id != claims.client_id {
        return Err(OAuthError::InvalidGrant(
            "refresh token was issued to another client",
        ));
    }
    check_scope(req.scope.as_deref())?;
    // Refresh tokens carry no audience: the grant holds the resource. Checked
    // before rotating, so a request that fails here does not use up the token;
    // an older generation goes straight to `rotate`, which revokes the grant.
    // Also before client authentication, so a dead token never gets as far as
    // spending an assertion or fetching keys.
    let current = st.grants.get_live(&claims.grant, now).ok_or_else(invalid)?;
    if current.username != claims.sub || current.client_id != claims.client_id {
        return Err(invalid());
    }
    if claims.private_key_jwt {
        let client = resolve_client(&req.client_id, &st.clients, &st.cimd)
            .await
            .map_err(|error| match error {
                OAuthError::TemporarilyUnavailable => error,
                _ => OAuthError::InvalidClient,
            })?;
        if !client.uses_private_key_jwt() {
            return Err(OAuthError::InvalidClient);
        }
        let primary = st.accounts.primary_url();
        let issuer = canonical_origin(headers, primary.as_deref());
        client_auth::authenticate(
            &st.cimd,
            &client,
            req.credentials(),
            &client_auth::audiences(&issuer),
            now,
        )
        .await?;
    }
    let fresh = claims.gen == current.refresh_gen || claims.gen + 1 == current.refresh_gen;
    if fresh
        && req
            .resource
            .as_deref()
            .is_some_and(|resource| resource != current.resource)
    {
        return Err(OAuthError::InvalidTarget);
    }
    let store = st.clone();
    let (grant_id, generation) = (claims.grant.clone(), claims.gen);
    let grant = blocking(move || {
        store
            .grants
            .rotate(&grant_id, generation, now)
            .map_err(|error| match error {
                RotateError::Reused => OAuthError::InvalidGrant(
                    "refresh token was already used; the app must sign in again",
                ),
                RotateError::Unknown => {
                    OAuthError::InvalidGrant("refresh token is invalid, expired or revoked")
                }
            })
    })
    .await?;
    if !st
        .accounts
        .session_is_current(&grant.username, grant.credential_version.as_deref())
    {
        let store = st.clone();
        let id = grant.id.clone();
        let _ = blocking(move || {
            store.grants.revoke(&id).map_err(|error| {
                tracing::error!("could not revoke MCP grant: {error}");
                OAuthError::ServerError("could not revoke the grant")
            })
        })
        .await;
        return Err(OAuthError::InvalidGrant(
            "the account's sign-in changed; the app must sign in again",
        ));
    }
    let store = st.clone();
    let client_id = grant.client_id.clone();
    let _ = tokio::task::spawn_blocking(move || store.clients.touch(&client_id, now)).await;
    token_pair(st, &grant, now, claims.private_key_jwt)
}

fn token_pair(
    st: &McpOAuthState,
    grant: &Grant,
    now: u64,
    private_key_jwt: bool,
) -> Result<Value, OAuthError> {
    let issuer = grant
        .resource
        .strip_suffix("/.mcp")
        .unwrap_or(&grant.resource)
        .to_string();
    let failed = |error: jsonwebtoken::errors::Error| {
        tracing::error!("could not sign MCP token: {error}");
        OAuthError::ServerError("could not issue tokens")
    };
    let access_token = st
        .authenticator
        .issue_mcp_access(&McpAccessClaims {
            sub: grant.username.clone(),
            aud: grant.resource.clone(),
            iss: issuer,
            iat: now,
            exp: now + ACCESS_TTL_SECS,
            grant: grant.id.clone(),
            client_id: grant.client_id.clone(),
            scope: SCOPE.into(),
            spaces: grant.spaces.clone(),
            token_use: String::new(),
        })
        .map_err(failed)?;
    let refresh_token = st
        .authenticator
        .issue_mcp_refresh(&McpRefreshClaims {
            sub: grant.username.clone(),
            grant: grant.id.clone(),
            gen: grant.refresh_gen,
            client_id: grant.client_id.clone(),
            exp: grant.expires_at,
            token_use: String::new(),
            private_key_jwt,
        })
        .map_err(failed)?;
    Ok(json!({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TTL_SECS,
        "refresh_token": refresh_token,
        "scope": SCOPE,
    }))
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RevokeRequest {
    token: String,
    client_id: Option<String>,
}

/// RFC 7009 §2.2: 200 whether or not the token was valid, so the answer
/// reveals nothing about it.
async fn revoke(
    State(st): State<Arc<McpOAuthState>>,
    headers: HeaderMap,
    form: Result<Form<RevokeRequest>, FormRejection>,
) -> Response {
    if let Ok(Form(req)) = form {
        let primary = st.accounts.primary_url();
        let audience = canonical_mcp_url(&headers, primary.as_deref());
        let found = st
            .authenticator
            .verify_mcp_access(&req.token, &audience)
            .map(|claims| (claims.grant, claims.client_id))
            .or_else(|_| {
                st.authenticator
                    .verify_mcp_refresh(&req.token)
                    .map(|claims| (claims.grant, claims.client_id))
            });
        if let Ok((grant, client_id)) = found {
            let client_matches = req
                .client_id
                .as_deref()
                .is_none_or(|id| id.is_empty() || id == client_id);
            if client_matches {
                let store = st.clone();
                let _ = blocking(move || {
                    store.grants.revoke(&grant).map_err(|error| {
                        tracing::error!("could not revoke MCP grant: {error}");
                        OAuthError::ServerError("could not revoke the grant")
                    })
                })
                .await;
            }
        }
    }
    (StatusCode::OK, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

fn check_scope(scope: Option<&str>) -> Result<(), OAuthError> {
    match scope {
        None => Ok(()),
        Some(scope)
            if scope
                .split(' ')
                .filter(|s| !s.is_empty())
                .all(|s| s == SCOPE) =>
        {
            Ok(())
        }
        Some(_) => Err(OAuthError::InvalidScope),
    }
}

/// RFC 6749 §5.2 wants 401 `invalid_client` when the client tried to
/// authenticate (an `Authorization` header or a client assertion); a public
/// client that did not gets `unauthorized_client`.
fn client_error(headers: &HeaderMap, assertion: bool) -> OAuthError {
    if assertion || headers.contains_key(header::AUTHORIZATION) {
        OAuthError::InvalidClient
    } else {
        OAuthError::UnauthorizedClient
    }
}

/// The grant and client stores write and fsync their files.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, OAuthError> + Send + 'static,
) -> Result<T, OAuthError> {
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|error| {
            tracing::error!("blocking task failed: {error}");
            Err(OAuthError::ServerError("internal error"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPLATE: &str = include_str!("../../../client/html/authorize.html");

    fn render(context: minijinja::Value) -> String {
        let mut env = minijinja::Environment::new();
        env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
        env.render_str(TEMPLATE, context).unwrap()
    }

    #[test]
    fn legacy_authorize_page_still_renders() {
        let page = render(minijinja::context! {
            host_prefix => "/notes",
            space_name => "Notes",
            username => "writer-one",
            device_name => "An application",
            client_id => "silverbullet-cli",
            client_name => "SilverBullet CLI",
            redirect_uri => "http://127.0.0.1:5000/cb",
            state => "s",
            code_challenge => "c",
            csrf_token => "t",
            device_flow => false,
        });
        assert!(page.contains("href=\"/notes/.client/app.css\""), "{page}");
        assert!(page.contains("src=\"/notes/.client/logo.png\""));
        assert!(page.contains("<h1>Authorize access</h1>"));
        assert!(page.contains("action=\"&#x2f;notes/.auth/authorize\""));
        assert!(!page.contains("/.auth/central/assets"));
    }

    #[test]
    fn mcp_error_page_uses_central_assets() {
        let page = render(minijinja::context! {
            asset_base => "/.auth/central/assets",
            host_prefix => "",
            mcp => true,
            error => "Nope <b>",
        });
        assert!(page.contains("href=\"/.auth/central/assets/app.css\""));
        assert!(page.contains("Nope &lt;b&gt;"));
        assert!(!page.contains("<form"));
    }

    #[test]
    fn repeated_parameters_are_refused() {
        let pairs = parse_pairs(b"a=1&b=2&a=3&c=x%20y");
        assert_eq!(single(&pairs, "a"), Err(()));
        assert_eq!(single(&pairs, "b"), Ok(Some("2")));
        assert_eq!(single(&pairs, "c"), Ok(Some("x y")));
        assert_eq!(single(&pairs, "d"), Ok(None));
    }

    #[test]
    fn challenge_must_be_an_s256_digest() {
        assert!(valid_challenge(&crate::auth::oauth::challenge_for("v")));
        assert!(!valid_challenge("short"));
        assert!(!valid_challenge(&"a".repeat(42).replace('a', "+")));
        assert!(!valid_challenge(&format!("{}=", "a".repeat(42))));
    }
}
