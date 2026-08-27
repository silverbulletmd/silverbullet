// Reference implementation & docs:
//   GitHub:  https://github.com/ramosbugs/openidconnect-rs
//   Docs:    https://docs.rs/openidconnect/latest/openidconnect

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::http::HeaderMap;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreProviderMetadata, CoreTokenResponse,
};
use openidconnect::{
    AsyncHttpClient, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet, EndpointNotSet,
    EndpointSet, IssuerUrl, Nonce, PkceCodeChallenge, RedirectUrl, Scope, TokenResponse,
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
#[derive(Clone, Debug)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// Base URL for the redirect URI (e.g. `https://example.com`).
    pub redirect_base: String,
    pub auto_provision: bool,
}

impl OidcConfig {
    /// Read `SB_OIDC_*` from the process environment. Returns `Err` when
    /// required vars are missing, `None` when `SB_OIDC_ISSUER` is absent.
    pub fn from_env() -> Result<Option<Self>, String> {
        Self::from_env_with(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
    }

    /// Configurable variant for testing: accepts an arbitrary getter instead
    /// of reading process environment variables, avoiding `set_var` races in
    /// parallel test threads.
    pub fn from_env_with<F>(get: F) -> Result<Option<Self>, String>
    where
        F: Fn(&str) -> Option<String>,
    {
        let Some(issuer_url) = get("SB_OIDC_ISSUER") else {
            return Ok(None);
        };
        let client_id = get("SB_OIDC_CLIENT_ID")
            .ok_or_else(|| "SB_OIDC_CLIENT_ID required when SB_OIDC_ISSUER is set".to_string())?;
        let client_secret = get("SB_OIDC_CLIENT_SECRET").ok_or_else(|| {
            "SB_OIDC_CLIENT_SECRET required when SB_OIDC_ISSUER is set".to_string()
        })?;
        let redirect_base = get("SB_OIDC_REDIRECT_BASE").ok_or_else(|| {
            "SB_OIDC_REDIRECT_BASE required when SB_OIDC_ISSUER is set".to_string()
        })?;
        let auto_provision = get("SB_OIDC_AUTO_PROVISION")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        Ok(Some(Self {
            issuer_url,
            client_id,
            client_secret,
            redirect_base,
            auto_provision,
        }))
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

    /// Borrow the wrapped `reqwest::Client` for direct (non-crate) requests such
    /// as the token exchange in `exchange_authorization_code`.
    pub fn client(&self) -> &reqwest::Client {
        &self.client
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
            let response = req_builder
                .send()
                .await
                .map_err(|e| HttpError(e.to_string()))?;
            let status = response.status();
            let resp_headers = response.headers().clone();
            let bytes = response
                .bytes()
                .await
                .map_err(|e| HttpError(e.to_string()))?;
            let mut builder = openidconnect::http::Response::builder().status(status.as_u16());
            for (key, value) in resp_headers.iter() {
                builder = builder.header(key, value);
            }
            builder
                .body(bytes.to_vec())
                .map_err(|e| HttpError(e.to_string()))
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
    /// Token endpoint captured from provider discovery. Used for the direct
    /// token exchange below (the openidconnect crate's `exchange_code` path
    /// is bypassed — see `exchange_authorization_code`).
    pub token_endpoint: String,
}

impl OidcState {
    /// Discover provider metadata and build the OIDC client. Env-var endpoint
    /// overrides (`SB_OIDC_AUTH_URL`, `SB_OIDC_TOKEN_URL`) take precedence
    /// over the discovery document.
    pub async fn new(
        config: OidcConfig,
        http_client: reqwest::Client,
    ) -> Result<Arc<Self>, String> {
        let oidc_http = ReqwestAsyncHttpClient::new(http_client);
        let issuer = IssuerUrl::new(config.issuer_url.clone())
            .map_err(|e| format!("invalid issuer: {e}"))?;

        let provider_metadata = CoreProviderMetadata::discover_async(issuer, &oidc_http)
            .await
            .map_err(|e| format!("OIDC discovery failed: {e}"))?;

        let redirect_url = RedirectUrl::new(format!("{}/.oidc/callback", config.redirect_base))
            .map_err(|e| format!("invalid redirect URL: {e}"))?;

        let client = CoreClient::from_provider_metadata(
            provider_metadata.clone(),
            ClientId::new(config.client_id.clone()),
            Some(ClientSecret::new(config.client_secret.clone())),
        )
        .set_redirect_uri(redirect_url);

        let token_endpoint = provider_metadata
            .token_endpoint()
            .ok_or_else(|| "OIDC provider metadata missing token_endpoint".to_string())?
            .url()
            .to_string();

        Ok(Arc::new(Self {
            config,
            client,
            http_client: oidc_http,
            token_endpoint,
        }))
    }
}

const OIDC_COOKIE_TTL_SECS: i64 = 600;
pub(crate) const OIDC_STATE_COOKIE: &str = "sb_oidc_state";

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

fn verify_oidc_cookie(
    headers: &HeaderMap,
    authenticator: &Authenticator,
) -> Result<OidcCookieClaims, String> {
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
        // NOTE: the openidconnect crate injects the `openid` scope itself
        // (client.rs `use_openid_scope`), so only extra scopes belong here.
        .add_scope(Scope::new("profile".to_string()))
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

/// Maximum length for an auto-provisioned username.
const MAX_USERNAME_LEN: usize = 64;

/// Validate and normalize a `preferred_username` claim from an OIDC provider.
///
/// Returns the lowercased, trimmed username on success, or `Err(())` if the
/// value is empty, too long, or contains characters that SilverBullet's
/// `create_user` rejects (`:`, `/`) or control characters.  The caller falls
/// back to `oidc_<sha256-hex>` on `Err` and logs a warning.
fn sanitize_preferred_username(raw: &str) -> Result<String, ()> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() || trimmed.len() > MAX_USERNAME_LEN {
        return Err(());
    }
    if trimmed.contains(':') || trimmed.contains('/') {
        return Err(());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(());
    }
    Ok(trimmed)
}

/// Exchange an authorization code for tokens via a direct `reqwest` POST.
///
/// The openidconnect crate's `exchange_code()` path was found to fail against
/// Dex/Authentik (and any PKCE-requiring provider) with `invalid_grant`, even
/// though an equivalent raw form-encoded request succeeds. We therefore perform
/// the token exchange ourselves using the workspace `reqwest::Client` (the same
/// client already wrapped by `ReqwestAsyncHttpClient`), then deserialize the
/// JSON into the crate's `CoreTokenResponse` so the existing ID-token
/// verification logic is reused unchanged.
async fn exchange_authorization_code(
    state: &OidcState,
    code: &str,
    pkce_verifier: &str,
) -> Result<CoreTokenResponse, String> {
    let redirect_uri = format!("{}/.oidc/callback", state.config.redirect_base);
    // Build the body as an explicit, pre-encoded string and send it via
    // `.body()` so reqwest emits a fixed `Content-Length` rather than
    // `Transfer-Encoding: chunked`. Some providers (Dex, Authentik) misread a
    // chunked token request and silently drop the `code_verifier`, yielding a
    // bogus `invalid_grant`.
    let enc = percent_encoding::utf8_percent_encode;
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", pkce_verifier),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    // Encode only the *values*; the parameter names must stay literal
    // (`grant_type`, `code_verifier`, …) or the provider won't recognize them.
    let body: String = form
        .iter()
        .map(|(k, v)| format!("{}={}", k, enc(v, percent_encoding::NON_ALPHANUMERIC)))
        .collect::<Vec<_>>()
        .join("&");
    let basic = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        format!("{}:{}", state.config.client_id, state.config.client_secret),
    );
    let resp = state
        .http_client
        .client()
        .post(&state.token_endpoint)
        .header("Authorization", format!("Basic {basic}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("OIDC token request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("OIDC token response unreadable: {e}"))?;
    if !status.is_success() {
        return Err(format!("OIDC token exchange failed: {status} {body}"));
    }
    serde_json::from_str::<CoreTokenResponse>(&body)
        .map_err(|e| format!("OIDC token response parse failed: {e}: {body}"))
}

/// Handle the OIDC callback: verify state, exchange code for tokens, verify the
/// ID token, resolve the local user, and issue a session JWT. Returns
/// `(jwt, expiry_secs, return_mount)` where `return_mount` is the path saved
/// in the state cookie (e.g. `/` or `/work/`).
pub async fn handle_callback(
    state: &OidcState,
    query: &str,
    headers: &HeaderMap,
    authenticator: &Arc<Authenticator>,
    credential_version: Option<CredentialVersionFn>,
    users: &UserStore,
) -> Result<(String, u64, String), String> {
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

    let token_response =
        exchange_authorization_code(state, &code, &cookie_claims.pkce_verifier).await?;

    let id_token = token_response
        .id_token()
        .ok_or_else(|| "provider did not return an ID token".to_string())?;
    let nonce = Nonce::new(cookie_claims.nonce);
    let claims = id_token
        .claims(&state.client.id_token_verifier(), &nonce)
        .map_err(|e| format!("ID token verification failed: {e}"))?;

    let subject = claims.subject().as_str().to_string();
    let issuer = state.config.issuer_url.clone();

    // Extract optional profile claims for display name and username selection.
    let preferred_username = claims.preferred_username().map(|u| u.as_str().to_string());
    let display_name = claims
        .name()
        .and_then(|n| n.get(None).map(|v| v.as_str().to_string()));

    let username = match users.resolve_by_oidc_subject(&issuer, &subject) {
        Some(username) => {
            // Existing user — keep display name in sync with the provider.
            let _ = users.sync_oidc_profile(&username, display_name.as_deref());
            username
        }
        None => {
            if !state.config.auto_provision {
                return Err("OIDC subject not linked to any user".to_string());
            }
            let random_password = {
                let mut bytes = [0u8; 32];
                getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
            };
            // Hash the full subject to produce a collision-resistant, filesystem-
            // safe fallback username.
            use sha2::{Digest, Sha256};
            let hash = {
                let mut h = Sha256::new();
                h.update(subject.as_bytes());
                let result = h.finalize();
                result
                    .iter()
                    .take(12)
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            };
            let fallback = format!("oidc_{hash}");

            // Try preferred_username first; fall back to oidc_<hash>.
            let name = match preferred_username
                .as_deref()
                .and_then(|u| sanitize_preferred_username(u).ok())
            {
                Some(sanitized) => {
                    match users.create_user(&sanitized, &random_password, false, Profile::default())
                    {
                        Ok(()) => {
                            let _ = users.link_oidc(&sanitized, &issuer, &subject);
                            let _ = users.sync_oidc_profile(&sanitized, display_name.as_deref());
                            sanitized
                        }
                        Err(_) => {
                            // preferred_username already taken — use fallback.
                            users
                                .create_user(&fallback, &random_password, false, Profile::default())
                                .map_err(|e| format!("auto-provision failed: {e}"))?;
                            users
                                .link_oidc(&fallback, &issuer, &subject)
                                .map_err(|e| format!("auto-provision link failed: {e}"))?;
                            let _ = users.sync_oidc_profile(&fallback, display_name.as_deref());
                            fallback
                        }
                    }
                }
                None => {
                    // No usable preferred_username — use fallback.
                    users
                        .create_user(&fallback, &random_password, false, Profile::default())
                        .map_err(|e| format!("auto-provision failed: {e}"))?;
                    users
                        .link_oidc(&fallback, &issuer, &subject)
                        .map_err(|e| format!("auto-provision link failed: {e}"))?;
                    let _ = users.sync_oidc_profile(&fallback, display_name.as_deref());
                    fallback
                }
            };
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
        .map(|(jwt, secs)| (jwt, secs, cookie_claims.return_mount))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use std::collections::HashMap;

    fn authenticator() -> Arc<Authenticator> {
        Arc::new(Authenticator::from_secret_bytes(
            vec![7u8; 32],
            "test".into(),
        ))
    }

    fn env<'a>(vars: &'a [(&str, &str)]) -> impl Fn(&str) -> Option<String> + 'a {
        let map: HashMap<&str, &str> = vars.iter().copied().collect();
        move |k: &str| map.get(k).map(|v| v.to_string())
    }

    #[test]
    fn sign_cookie_and_verify_round_trip() {
        let auth = authenticator();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as usize;
        let claims = OidcCookieClaims {
            state: "csrf-token".into(),
            nonce: "nonce-value".into(),
            pkce_verifier: "verifier".into(),
            return_mount: "/work/".into(),
            exp: now + 300,
        };
        let cookie_header =
            set_oidc_cookie(&claims, &auth, &HeaderMap::new()).expect("set_oidc_cookie failed");
        // The cookie header looks like "sb_oidc_state=<value>; Path=/; ..."
        let cookie_val = cookie_header
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("sb_oidc_state=")
            .unwrap()
            .to_string();

        // Rebuild a HeaderMap with the cookie set.
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            format!("sb_oidc_state={cookie_val}").parse().unwrap(),
        );
        let verified = verify_oidc_cookie(&headers, &auth).expect("verify_oidc_cookie failed");
        assert_eq!(verified.state, "csrf-token");
        assert_eq!(verified.return_mount, "/work/");
    }

    #[test]
    fn verify_oidc_cookie_rejects_tampered_signature() {
        let auth = authenticator();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as usize;
        let claims = OidcCookieClaims {
            state: "s".into(),
            nonce: "n".into(),
            pkce_verifier: "v".into(),
            return_mount: "/".into(),
            exp: now + 300,
        };
        let cookie_header = set_oidc_cookie(&claims, &auth, &HeaderMap::new()).unwrap();
        let cookie_val = cookie_header.split(';').next().unwrap();
        // Tamper with the last hex char of the signature.
        let mut tampered = cookie_val.to_string();
        let last = tampered.pop().unwrap();
        tampered.push(if last == 'a' { 'b' } else { 'a' });
        let name_val = tampered.strip_prefix("sb_oidc_state=").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            format!("sb_oidc_state={name_val}").parse().unwrap(),
        );
        let err = verify_oidc_cookie(&headers, &auth).unwrap_err();
        assert!(err.contains("mismatch"), "{err}");
    }

    #[test]
    fn verify_oidc_cookie_rejects_expired() {
        let auth = authenticator();
        let past = 1_000u64; // well in the past
        let claims = OidcCookieClaims {
            state: "s".into(),
            nonce: "n".into(),
            pkce_verifier: "v".into(),
            return_mount: "/".into(),
            exp: past as usize,
        };
        let cookie_header = set_oidc_cookie(&claims, &auth, &HeaderMap::new()).unwrap();
        let cookie_val = cookie_header
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("sb_oidc_state=")
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            format!("sb_oidc_state={cookie_val}").parse().unwrap(),
        );
        let err = verify_oidc_cookie(&headers, &auth).unwrap_err();
        assert!(err.contains("expired"), "{err}");
    }

    #[test]
    fn from_env_returns_none_when_issuer_unset() {
        let getter = env(&[]);
        assert!(OidcConfig::from_env_with(getter).unwrap().is_none());
    }

    #[test]
    fn from_env_returns_err_when_issuer_set_but_client_id_missing() {
        let getter = env(&[("SB_OIDC_ISSUER", "https://issuer.example.com")]);
        let err = OidcConfig::from_env_with(getter).unwrap_err();
        assert!(err.contains("CLIENT_ID"), "{err}");
    }

    #[test]
    fn from_env_returns_config_when_all_vars_present() {
        let getter = env(&[
            ("SB_OIDC_ISSUER", "https://issuer.example.com"),
            ("SB_OIDC_CLIENT_ID", "my-client"),
            ("SB_OIDC_CLIENT_SECRET", "my-secret"),
            ("SB_OIDC_REDIRECT_BASE", "https://sb.example.com"),
        ]);
        let cfg = OidcConfig::from_env_with(getter).unwrap().unwrap();
        assert_eq!(cfg.issuer_url, "https://issuer.example.com");
        assert_eq!(cfg.client_id, "my-client");
        assert!(!cfg.auto_provision);
    }

    // ── sanitize_preferred_username tests ────────────────────────────────────

    #[test]
    fn sanitize_preferred_username_basic_valid() {
        assert_eq!(sanitize_preferred_username("camden").unwrap(), "camden");
    }

    #[test]
    fn sanitize_preferred_username_lowercases() {
        assert_eq!(sanitize_preferred_username("Camden").unwrap(), "camden");
    }

    #[test]
    fn sanitize_preferred_username_trims_whitespace() {
        assert_eq!(sanitize_preferred_username("  camden  ").unwrap(), "camden");
    }

    #[test]
    fn sanitize_preferred_username_allows_spaces_and_dots() {
        assert_eq!(
            sanitize_preferred_username("Camden Bock").unwrap(),
            "camden bock"
        );
        assert_eq!(
            sanitize_preferred_username("user.name").unwrap(),
            "user.name"
        );
    }

    #[test]
    fn sanitize_preferred_username_rejects_empty() {
        assert!(sanitize_preferred_username("").is_err());
    }

    #[test]
    fn sanitize_preferred_username_rejects_whitespace_only() {
        assert!(sanitize_preferred_username("   ").is_err());
    }

    #[test]
    fn sanitize_preferred_username_rejects_colon() {
        assert!(sanitize_preferred_username("user:name").is_err());
    }

    #[test]
    fn sanitize_preferred_username_rejects_slash() {
        assert!(sanitize_preferred_username("user/name").is_err());
    }

    #[test]
    fn sanitize_preferred_username_rejects_too_long() {
        assert!(sanitize_preferred_username(&"a".repeat(65)).is_err());
    }

    #[test]
    fn sanitize_preferred_username_accepts_exactly_64() {
        assert!(sanitize_preferred_username(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn sanitize_preferred_username_rejects_control_chars() {
        assert!(sanitize_preferred_username("user\x00name").is_err());
        assert!(sanitize_preferred_username("user\x1fname").is_err());
        assert!(sanitize_preferred_username("user\x7fname").is_err());
    }

    #[test]
    fn sanitize_preferred_username_rejects_newline() {
        assert!(sanitize_preferred_username("user\nname").is_err());
    }
}
