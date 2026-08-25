// Reference implementation & docs:
//   GitHub:  https://github.com/ramosbugs/openidconnect-rs
//   Docs:    https://docs.rs/openidconnect/latest/openidconnect

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::http::HeaderMap;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreProviderMetadata,
};
use openidconnect::{
    AsyncHttpClient, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};

use crate::auth::authenticator::Authenticator;
use crate::auth::config::constant_time_eq;
use crate::auth::cookie::{cookie_value, is_secure_request, set_cookie_value, CookieOptions};
use crate::auth::login::LoginManager;
use crate::multi::users::{Profile, UserStore};

/// Client type after discovery + `set_token_uri`: auth URL and token URL are
/// both `EndpointSet`, so `authorize_url` and `exchange_code` are available.
type DiscoveredClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// Environment-driven OIDC configuration. Discovery fetches the provider's
/// `.well-known/openid-configuration`; optional `SB_OIDC_*` overrides take
/// precedence when present.
#[derive(Clone)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// Base URL for the redirect URI (e.g. `https://example.com`).
    pub redirect_base: String,
    pub auto_provision: bool,
}

impl OidcConfig {
    /// Read `SB_OIDC_*` from the process environment. Returns `None` when
    /// `SB_OIDC_ISSUER` is absent — OIDC is disabled.
    pub fn from_env() -> Option<Self> {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let issuer_url = get("SB_OIDC_ISSUER")?;
        let client_id = get("SB_OIDC_CLIENT_ID")
            .expect("SB_OIDC_CLIENT_ID required when SB_OIDC_ISSUER is set");
        let client_secret = get("SB_OIDC_CLIENT_SECRET")
            .expect("SB_OIDC_CLIENT_SECRET required when SB_OIDC_ISSUER is set");
        let redirect_base = get("SB_OIDC_REDIRECT_BASE")
            .expect("SB_OIDC_REDIRECT_BASE required when SB_OIDC_ISSUER is set");
        let auto_provision = get("SB_OIDC_AUTO_PROVISION")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        Some(Self {
            issuer_url,
            client_id,
            client_secret,
            redirect_base,
            auto_provision,
        })
    }
}

/// Error type satisfying `std::error::Error` for `AsyncHttpClient`.
#[derive(Debug)]
pub struct HttpError(String);

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for HttpError {}

/// Async HTTP client adapter wrapping the workspace `reqwest::Client` to
/// implement `openidconnect::AsyncHttpClient`, avoiding a second TLS stack.
#[derive(Clone)]
pub struct ReqwestAsyncHttpClient {
    client: reqwest::Client,
}

impl ReqwestAsyncHttpClient {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

impl<'c> AsyncHttpClient<'c> for ReqwestAsyncHttpClient {
    type Error = HttpError;
    type Future =
        Pin<Box<dyn Future<Output = Result<openidconnect::HttpResponse, Self::Error>> + Send + 'c>>;

    fn call(&'c self, request: openidconnect::HttpRequest) -> Self::Future {
        let (parts, body) = request.into_parts();
        let mut req_builder = self.client.request(parts.method, parts.uri.to_string());
        for (key, value) in parts.headers.iter() {
            req_builder = req_builder.header(key, value);
        }
        req_builder = req_builder.body(body);

        Box::pin(async move {
            let response = req_builder.send().await.map_err(|e| HttpError(e.to_string()))?;
            let status = response.status();
            let resp_headers = response.headers().clone();
            let bytes = response.bytes().await.map_err(|e| HttpError(e.to_string()))?;
            let mut builder = openidconnect::http::Response::builder().status(status.as_u16());
            for (key, value) in resp_headers.iter() {
                builder = builder.header(key, value);
            }
            builder.body(bytes.to_vec()).map_err(|e| HttpError(e.to_string()))
        })
    }
}

/// Signed cookie claims for the OIDC state flow. Intentionally distinct from
/// session `Claims` so it cannot be replayed as a login token.
#[derive(Debug, Serialize, Deserialize)]
pub struct OidcCookieClaims {
    pub state: String,
    pub nonce: String,
    pub pkce_verifier: String,
    pub return_mount: String,
    pub exp: usize,
}

pub struct OidcState {
    pub config: OidcConfig,
    pub client: DiscoveredClient,
    pub http_client: ReqwestAsyncHttpClient,
}

impl OidcState {
    /// Discover provider metadata and build the OIDC client. Env-var endpoint
    /// overrides (`SB_OIDC_AUTH_URL`, `SB_OIDC_TOKEN_URL`) take precedence
    /// over the discovery document.
    pub async fn new(config: OidcConfig, http_client: reqwest::Client) -> Result<Arc<Self>, String> {
        let oidc_http = ReqwestAsyncHttpClient::new(http_client);
        let issuer =
            IssuerUrl::new(config.issuer_url.clone()).map_err(|e| format!("invalid issuer: {e}"))?;

        let provider_metadata = CoreProviderMetadata::discover_async(issuer, &oidc_http)
            .await
            .map_err(|e| format!("OIDC discovery failed: {e}"))?;

        let redirect_url = RedirectUrl::new(format!("{}/__oidc_callback", config.redirect_base))
            .map_err(|e| format!("invalid redirect URL: {e}"))?;

        let client = CoreClient::from_provider_metadata(
            provider_metadata,
            ClientId::new(config.client_id.clone()),
            Some(ClientSecret::new(config.client_secret.clone())),
        )
        .set_redirect_uri(redirect_url);

        Ok(Arc::new(Self {
            config,
            client,
            http_client: oidc_http,
        }))
    }
}

const OIDC_COOKIE_TTL_SECS: i64 = 600;
const OIDC_STATE_COOKIE: &str = "sb_oidc_state";

fn sign_cookie(data: &[u8], authenticator: &Authenticator) -> String {
    let sig = authenticator.sign_hmac(data);
    bytes_to_hex(&sig)
}

fn set_oidc_cookie(
    claims: &OidcCookieClaims,
    authenticator: &Authenticator,
    headers: &HeaderMap,
) -> Result<String, String> {
    let json =
        serde_json::to_vec(claims).map_err(|e| format!("failed to serialize OIDC cookie: {e}"))?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &json);
    let sig = sign_cookie(encoded.as_bytes(), authenticator);
    let value = format!("{encoded}.{sig}");

    let secure = is_secure_request(headers);
    Ok(set_cookie_value(
        OIDC_STATE_COOKIE,
        &value,
        &CookieOptions {
            path: "/".into(),
            max_age_secs: Some(OIDC_COOKIE_TTL_SECS),
            http_only: true,
            secure,
            same_site: "Lax",
        },
    ))
}

fn verify_oidc_cookie(headers: &HeaderMap, authenticator: &Authenticator) -> Result<OidcCookieClaims, String> {
    let raw = cookie_value(headers, OIDC_STATE_COOKIE)
        .ok_or_else(|| "missing OIDC state cookie".to_string())?;
    let (encoded, sig) = raw
        .split_once('.')
        .ok_or_else(|| "malformed OIDC state cookie".to_string())?;

    let expected = sign_cookie(encoded.as_bytes(), authenticator);
    // constant_time_eq prevents timing side-channels on the signature.
    if !constant_time_eq(expected.as_bytes(), sig.as_bytes()) {
        return Err("OIDC state cookie signature mismatch".to_string());
    }

    let json = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| format!("invalid OIDC cookie encoding: {e}"))?;
    let claims: OidcCookieClaims =
        serde_json::from_slice(&json).map_err(|e| format!("invalid OIDC cookie claims: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;
    if claims.exp < now {
        return Err("OIDC state cookie expired".to_string());
    }

    Ok(claims)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Build the authorization URL and signed state cookie for the OIDC login flow.
pub fn start_login(
    state: &OidcState,
    return_mount: &str,
    authenticator: &Authenticator,
    headers: &HeaderMap,
) -> Result<(String, String), String> {
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_url, csrf_token, nonce) = state
        .client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;

    let claims = OidcCookieClaims {
        state: csrf_token.secret().clone(),
        nonce: nonce.secret().clone(),
        pkce_verifier: pkce_verifier.secret().clone(),
        return_mount: return_mount.to_string(),
        exp: now + OIDC_COOKIE_TTL_SECS as usize,
    };

    let cookie = set_oidc_cookie(&claims, authenticator, headers)?;
    Ok((auth_url.to_string(), cookie))
}

/// Dummy verifier — `issue_session` never calls `verify`, so this is safe.
struct OidcCredentials;

impl crate::auth::Credentials for OidcCredentials {
    fn verify(&self, _u: &str, _p: &str) -> bool {
        false
    }
}

pub type CredentialVersionFn = Arc<dyn Fn(&str) -> String + Send + Sync>;

/// Handle the OIDC callback: verify state, exchange code for tokens, verify the
/// ID token, resolve the local user, and issue a session JWT.
pub async fn handle_callback(
    state: &OidcState,
    query: &str,
    headers: &HeaderMap,
    authenticator: &Arc<Authenticator>,
    credential_version: Option<CredentialVersionFn>,
    users: &UserStore,
) -> Result<(String, u64), String> {
    let params: std::collections::HashMap<String, String> =
        openidconnect::url::form_urlencoded::parse(query.as_bytes())
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();

    let code = params
        .get("code")
        .ok_or_else(|| "missing code parameter".to_string())?
        .clone();
    let returned_state = params
        .get("state")
        .ok_or_else(|| "missing state parameter".to_string())?;

    let cookie_claims = verify_oidc_cookie(headers, authenticator)?;

    if cookie_claims.state != *returned_state {
        return Err("OIDC state mismatch".to_string());
    }

    let token_response = state
        .client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| format!("OIDC code exchange setup failed: {e}"))?
        .set_pkce_verifier(PkceCodeVerifier::new(cookie_claims.pkce_verifier))
        .request_async(&state.http_client)
        .await
        .map_err(|e| format!("OIDC token exchange failed: {e}"))?;

    let id_token = token_response
        .id_token()
        .ok_or_else(|| "provider did not return an ID token".to_string())?;
    let nonce = Nonce::new(cookie_claims.nonce);
    let claims = id_token
        .claims(&state.client.id_token_verifier(), &nonce)
        .map_err(|e| format!("ID token verification failed: {e}"))?;

    let subject = claims.subject().as_str().to_string();
    let issuer = state.config.issuer_url.clone();

    let username = match users.resolve_by_oidc_subject(&issuer, &subject) {
        Some(username) => username,
        None => {
            if !state.config.auto_provision {
                return Err("OIDC subject not linked to any user".to_string());
            }
            let random_password = {
                let mut bytes = [0u8; 32];
                getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
            };
            let name = format!("oidc_{}", &subject[..subject.len().min(20)]);
            users
                .create_user(&name, &random_password, false, Profile::default())
                .map_err(|e| format!("auto-provision failed: {e}"))?;
            users
                .link_oidc(&name, &issuer, &subject)
                .map_err(|e| format!("auto-provision link failed: {e}"))?;
            name
        }
    };

    let remember = params.get("remember").map(|v| v == "true").unwrap_or(false);
    let login = LoginManager::new(
        authenticator.clone(),
        Arc::new(OidcCredentials),
        168,
        crate::auth::lockout::LockoutTimer::from_config(0, 0),
        String::new(),
    );
    let login = if let Some(provider) = credential_version {
        login.with_credential_version(provider)
    } else {
        login
    };
    login
        .issue_session(&username, remember)
        .map_err(|e| format!("failed to issue session: {e}"))
}
