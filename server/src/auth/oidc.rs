//! Self-contained OpenID Connect authorization-code flow for account-managed
//! servers. The browser round trip is stateless: the return path, PKCE
//! verifier, and nonce live in a short-lived HS256-signed `state` value.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::jwk::{AlgorithmParameters, Jwk, JwkSet, KeyOperations, PublicKeyUse};
use jsonwebtoken::{
    decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::authenticator::Authenticator;
use crate::auth::cookie::{
    auth_cookie_name, is_secure_request, request_host, set_cookie_value, CookieOptions,
};
use crate::auth::login::SESSION_EXPIRY_SECS;
use crate::state::ServerState;

const STATE_TTL_SECS: u64 = 10 * 60;
const STATE_KEY_CONTEXT: &[u8] = b"oidc-state-v1";

/// Environment-backed OIDC relying-party configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl OidcConfig {
    /// OIDC mode activates only when both issuer and client id are non-empty.
    /// The remaining values are checked when a login is attempted so this
    /// method can retain the documented two-variable activation rule.
    pub fn from_env() -> Option<Self> {
        let issuer = nonempty_env("SB_OIDC_ISSUER")?;
        let client_id = nonempty_env("SB_OIDC_CLIENT_ID")?;
        Some(Self {
            issuer,
            client_id,
            client_secret: std::env::var("SB_OIDC_CLIENT_SECRET").unwrap_or_default(),
            redirect_uri: std::env::var("SB_OIDC_REDIRECT_URI")
                .unwrap_or_default()
                .trim()
                .to_string(),
        })
    }
}

fn nonempty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Whether the two OIDC activation variables are configured.
pub fn oidc_enabled() -> bool {
    nonempty_env("SB_OIDC_ISSUER").is_some() && nonempty_env("SB_OIDC_CLIENT_ID").is_some()
}

fn admin_list_contains(value: &str, username: &str) -> bool {
    value
        .split(',')
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .any(|candidate| candidate == username)
}

/// Whether `username` is an OIDC administrator.
///
/// The `SB_PROXY_ADMINS` name is retained for deployment compatibility with
/// the fork this implementation came from. A future upstream change can
/// discuss renaming it to `SB_OIDC_ADMINS` separately.
pub fn oidc_is_admin(username: &str) -> bool {
    std::env::var("SB_PROXY_ADMINS")
        .map(|value| admin_list_contains(&value, username))
        .unwrap_or(false)
}

#[derive(Debug, thiserror::Error)]
pub enum OidcError {
    #[error("invalid OIDC configuration: {0}")]
    InvalidConfiguration(String),
    #[error("OIDC provider request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("OIDC JWT validation failed: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("invalid OIDC state: {0}")]
    InvalidState(&'static str),
    #[error("invalid OIDC response: {0}")]
    InvalidResponse(&'static str),
    #[error("could not obtain secure random bytes")]
    Random,
}

#[derive(Clone, Debug, Deserialize)]
struct DiscoveryDocument {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    #[serde(default)]
    token_endpoint_auth_methods_supported: Vec<String>,
    #[serde(default)]
    end_session_endpoint: Option<String>,
}

/// OIDC client plus the existing SilverBullet session issuer. Discovery is
/// fetched lazily and cached for the lifetime of this server state.
pub struct OidcClient {
    config: OidcConfig,
    authenticator: Arc<Authenticator>,
    state_key: Vec<u8>,
    http: reqwest::Client,
    discovery: tokio::sync::OnceCell<DiscoveryDocument>,
}

impl OidcClient {
    pub fn new(config: OidcConfig, authenticator: Arc<Authenticator>) -> Self {
        let state_key = authenticator.derive_key(STATE_KEY_CONTEXT);
        Self {
            config,
            authenticator,
            state_key,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            discovery: tokio::sync::OnceCell::new(),
        }
    }

    async fn discovery(&self) -> Result<&DiscoveryDocument, OidcError> {
        self.discovery
            .get_or_try_init(|| async {
                let url = format!(
                    "{}/.well-known/openid-configuration",
                    self.config.issuer.trim_end_matches('/')
                );
                let document = self
                    .http
                    .get(url)
                    .send()
                    .await?
                    .error_for_status()?
                    .json::<DiscoveryDocument>()
                    .await?;
                if canonical_issuer(&document.issuer) != canonical_issuer(&self.config.issuer) {
                    return Err(OidcError::InvalidConfiguration(
                        "discovery issuer does not match SB_OIDC_ISSUER".to_string(),
                    ));
                }
                validate_endpoint("authorization_endpoint", &document.authorization_endpoint)?;
                validate_endpoint("token_endpoint", &document.token_endpoint)?;
                validate_endpoint("jwks_uri", &document.jwks_uri)?;
                if let Some(endpoint) = document.end_session_endpoint.as_deref() {
                    validate_endpoint("end_session_endpoint", endpoint)?;
                }
                Ok(document)
            })
            .await
    }

    /// Build the provider authorization URL after cached discovery.
    pub async fn authorize_url(&self, return_to: &str) -> Result<String, OidcError> {
        self.validate_login_config()?;
        let discovery = self.discovery().await?;
        let verifier = random_urlsafe(32)?;
        let nonce = random_urlsafe(24)?;
        let challenge = pkce_challenge(&verifier);
        let state = self.sign_state(
            &safe_return_to(return_to),
            &verifier,
            &nonce,
            now_secs().saturating_add(STATE_TTL_SECS),
        )?;
        self.build_authorize_url(
            &discovery.authorization_endpoint,
            &state,
            &challenge,
            &nonce,
        )
    }

    fn validate_login_config(&self) -> Result<(), OidcError> {
        if self.config.redirect_uri.is_empty() {
            return Err(OidcError::InvalidConfiguration(
                "SB_OIDC_REDIRECT_URI is required".to_string(),
            ));
        }
        validate_endpoint("SB_OIDC_REDIRECT_URI", &self.config.redirect_uri)
    }

    fn build_authorize_url(
        &self,
        authorization_endpoint: &str,
        state: &str,
        challenge: &str,
        nonce: &str,
    ) -> Result<String, OidcError> {
        let mut url = reqwest::Url::parse(authorization_endpoint).map_err(|error| {
            OidcError::InvalidConfiguration(format!("invalid authorization_endpoint: {error}"))
        })?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.config.client_id)
            .append_pair("redirect_uri", &self.config.redirect_uri)
            .append_pair("scope", "openid profile")
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("nonce", nonce);
        Ok(url.into())
    }

    fn sign_state(
        &self,
        return_to: &str,
        code_verifier: &str,
        nonce: &str,
        exp: u64,
    ) -> Result<String, OidcError> {
        let claims = StateClaims {
            return_to: safe_return_to(return_to),
            code_verifier: code_verifier.to_string(),
            nonce: nonce.to_string(),
            exp: exp as usize,
        };
        Ok(encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(&self.state_key),
        )?)
    }

    fn verify_state(&self, state: &str) -> Result<StateClaims, OidcError> {
        let claims = decode::<StateClaims>(
            state,
            &DecodingKey::from_secret(&self.state_key),
            &Validation::new(Algorithm::HS256),
        )?
        .claims;
        if safe_return_to(&claims.return_to) != claims.return_to {
            return Err(OidcError::InvalidState("invalid return path"));
        }
        if !valid_pkce_verifier(&claims.code_verifier) {
            return Err(OidcError::InvalidState("invalid PKCE verifier"));
        }
        if claims.nonce.is_empty() || claims.nonce.len() > 256 {
            return Err(OidcError::InvalidState("invalid nonce"));
        }
        Ok(claims)
    }

    /// Verify state, exchange the authorization code, and validate the signed
    /// ID token against the provider's JWKS.
    pub async fn handle_callback(
        &self,
        code: &str,
        state: &str,
    ) -> Result<OidcCallback, OidcError> {
        self.validate_login_config()?;
        if code.is_empty() {
            return Err(OidcError::InvalidResponse("authorization code is empty"));
        }
        let state = self.verify_state(state)?;
        let discovery = self.discovery().await?;
        let id_token = self
            .exchange_code(code, &state.code_verifier, discovery)
            .await?;
        let username = self
            .verify_id_token(&id_token, &state.nonce, discovery)
            .await?;
        Ok(OidcCallback {
            username,
            return_to: state.return_to,
        })
    }

    async fn exchange_code(
        &self,
        code: &str,
        verifier: &str,
        discovery: &DiscoveryDocument,
    ) -> Result<String, OidcError> {
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", self.config.redirect_uri.as_str()),
            ("code_verifier", verifier),
        ];

        let use_secret_post = !self.config.client_secret.is_empty()
            && discovery
                .token_endpoint_auth_methods_supported
                .iter()
                .any(|method| method == "client_secret_post")
            && !discovery
                .token_endpoint_auth_methods_supported
                .iter()
                .any(|method| method == "client_secret_basic");

        let mut request = self.http.post(&discovery.token_endpoint);
        if self.config.client_secret.is_empty() {
            form.push(("client_id", self.config.client_id.as_str()));
        } else if use_secret_post {
            form.push(("client_id", self.config.client_id.as_str()));
            form.push(("client_secret", self.config.client_secret.as_str()));
        } else {
            request = request.basic_auth(&self.config.client_id, Some(&self.config.client_secret));
        }

        let token = request
            .form(&form)
            .send()
            .await?
            .error_for_status()?
            .json::<TokenResponse>()
            .await?;
        if token.id_token.is_empty() {
            return Err(OidcError::InvalidResponse(
                "token response did not contain an ID token",
            ));
        }
        Ok(token.id_token)
    }

    async fn verify_id_token(
        &self,
        id_token: &str,
        expected_nonce: &str,
        discovery: &DiscoveryDocument,
    ) -> Result<String, OidcError> {
        let header = decode_header(id_token)?;
        if !supported_signature_algorithm(header.alg) {
            return Err(OidcError::InvalidResponse(
                "unsupported ID-token signing algorithm",
            ));
        }

        let jwks = self
            .http
            .get(&discovery.jwks_uri)
            .send()
            .await?
            .error_for_status()?
            .json::<JwkSet>()
            .await?;
        let jwk = select_jwk(&jwks, header.kid.as_deref(), header.alg)?;
        let key = DecodingKey::from_jwk(jwk)?;
        let mut validation = Validation::new(header.alg);
        validation.set_audience(&[self.config.client_id.as_str()]);
        validation.set_issuer(&[discovery.issuer.as_str()]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<IdTokenClaims>(id_token, &key, &validation)?.claims;

        let Some(nonce) = claims.nonce.as_deref() else {
            return Err(OidcError::InvalidResponse("ID token omitted nonce"));
        };
        if !crate::auth::config::constant_time_eq(nonce.as_bytes(), expected_nonce.as_bytes()) {
            return Err(OidcError::InvalidResponse("ID-token nonce mismatch"));
        }
        if (claims.aud.len() > 1 || claims.azp.is_some())
            && claims.azp.as_deref() != Some(self.config.client_id.as_str())
        {
            return Err(OidcError::InvalidResponse(
                "ID-token authorized party mismatch",
            ));
        }
        username_from_claims(&claims)
    }

    /// Mint the ordinary host-wide SilverBullet session used by
    /// `JwtAuthorizer` after OIDC authentication succeeds.
    pub fn issue_session(&self, username: &str) -> Result<(String, u64), OidcError> {
        let jwt = self
            .authenticator
            .issue_jwt(username, SESSION_EXPIRY_SECS)?;
        Ok((jwt, SESSION_EXPIRY_SECS))
    }

    async fn logout_url(&self) -> String {
        if let Ok(discovery) = self.discovery().await {
            if let Some(endpoint) = discovery.end_session_endpoint.as_ref() {
                return endpoint.clone();
            }
        }
        let candidate = format!("{}/end-session/", self.config.issuer.trim_end_matches('/'));
        reqwest::Url::parse(&candidate)
            .map(String::from)
            .unwrap_or_else(|_| "/".to_string())
    }
}

pub struct OidcCallback {
    pub username: String,
    pub return_to: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct StateClaims {
    return_to: String,
    code_verifier: String,
    nonce: String,
    exp: usize,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: String,
}

#[derive(Debug, Deserialize)]
struct IdTokenClaims {
    sub: String,
    #[serde(default)]
    preferred_username: Option<String>,
    aud: IdTokenAudience,
    #[serde(default)]
    azp: Option<String>,
    #[serde(default)]
    nonce: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum IdTokenAudience {
    One(String),
    Many(Vec<String>),
}

impl IdTokenAudience {
    fn len(&self) -> usize {
        match self {
            Self::One(value) => usize::from(!value.is_empty()),
            Self::Many(values) => values.len(),
        }
    }
}

fn username_from_claims(claims: &IdTokenClaims) -> Result<String, OidcError> {
    let candidate = claims
        .preferred_username
        .as_deref()
        .map(str::trim)
        .filter(|username| !username.is_empty())
        .unwrap_or_else(|| claims.sub.trim());
    if candidate.is_empty() || candidate.len() > 256 || candidate.chars().any(char::is_control) {
        return Err(OidcError::InvalidResponse(
            "ID token did not contain a usable username",
        ));
    }
    Ok(candidate.to_string())
}

fn canonical_issuer(issuer: &str) -> &str {
    issuer.trim().trim_end_matches('/')
}

fn validate_endpoint(name: &str, value: &str) -> Result<(), OidcError> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| OidcError::InvalidConfiguration(format!("invalid {name}: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(OidcError::InvalidConfiguration(format!(
            "{name} must be an absolute HTTP(S) URL"
        )));
    }
    Ok(())
}

fn random_urlsafe(bytes: usize) -> Result<String, OidcError> {
    let mut value = vec![0u8; bytes];
    getrandom::getrandom(&mut value).map_err(|_| OidcError::Random)?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn valid_pkce_verifier(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
}

fn safe_return_to(value: &str) -> String {
    let safe = value.len() <= 4096
        && value.starts_with('/')
        && !value.starts_with("//")
        && !value.starts_with("/\\")
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value.parse::<axum::http::Uri>().is_ok_and(|uri| {
            uri.scheme().is_none() && uri.authority().is_none() && uri.path().starts_with('/')
        });
    if safe {
        value.to_string()
    } else {
        "/".to_string()
    }
}

fn supported_signature_algorithm(algorithm: Algorithm) -> bool {
    matches!(
        algorithm,
        Algorithm::RS256
            | Algorithm::RS384
            | Algorithm::RS512
            | Algorithm::PS256
            | Algorithm::PS384
            | Algorithm::PS512
            | Algorithm::ES256
            | Algorithm::ES384
    )
}

fn select_jwk<'a>(
    set: &'a JwkSet,
    kid: Option<&str>,
    algorithm: Algorithm,
) -> Result<&'a Jwk, OidcError> {
    if let Some(kid) = kid {
        return set
            .keys
            .iter()
            .find(|key| key.common.key_id.as_deref() == Some(kid) && jwk_usable(key, algorithm))
            .ok_or(OidcError::InvalidResponse(
                "no matching ID-token verification key",
            ));
    }

    let mut candidates = set.keys.iter().filter(|key| jwk_usable(key, algorithm));
    let Some(key) = candidates.next() else {
        return Err(OidcError::InvalidResponse(
            "no usable ID-token verification key",
        ));
    };
    if candidates.next().is_some() {
        return Err(OidcError::InvalidResponse(
            "ID token omitted key id with multiple usable keys",
        ));
    }
    Ok(key)
}

fn jwk_usable(key: &Jwk, algorithm: Algorithm) -> bool {
    if key.common.public_key_use == Some(PublicKeyUse::Encryption) {
        return false;
    }
    if key
        .common
        .key_operations
        .as_ref()
        .is_some_and(|ops| !ops.contains(&KeyOperations::Verify))
    {
        return false;
    }
    if key
        .common
        .key_algorithm
        .is_some_and(|key_alg| key_alg.to_string() != format!("{algorithm:?}"))
    {
        return false;
    }
    matches!(
        (&key.algorithm, algorithm),
        (
            AlgorithmParameters::RSA(_),
            Algorithm::RS256
                | Algorithm::RS384
                | Algorithm::RS512
                | Algorithm::PS256
                | Algorithm::PS384
                | Algorithm::PS512
        ) | (
            AlgorithmParameters::EllipticCurve(_),
            Algorithm::ES256 | Algorithm::ES384
        )
    )
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Relative login URL used by the authorization middleware's 401 response.
pub(crate) fn login_location(host_prefix: &str, return_to: &str) -> String {
    let return_to = safe_return_to(return_to);
    let encoded =
        percent_encoding::utf8_percent_encode(&return_to, percent_encoding::NON_ALPHANUMERIC);
    format!("{host_prefix}/.oidc/login?return_to={encoded}")
}

#[derive(Default, Deserialize)]
pub struct LoginQuery {
    #[serde(default)]
    return_to: String,
}

#[derive(Default, Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// `GET /.oidc/login` — discover the provider and begin code+PKCE.
pub async fn handle_login(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<LoginQuery>,
) -> Response {
    let Some(oidc) = state.oidc.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match oidc.authorize_url(&query.return_to).await {
        Ok(location) => redirect_response(location),
        Err(error) => {
            tracing::error!("could not start OIDC login: {error}");
            (StatusCode::BAD_GATEWAY, "OIDC provider unavailable").into_response()
        }
    }
}

/// `GET /.oidc/callback` — exchange and verify, then mint an SB cookie.
pub async fn handle_callback(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let Some(oidc) = state.oidc.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if query.error.is_some() {
        return (StatusCode::UNAUTHORIZED, "OIDC authorization was denied").into_response();
    }
    let (Some(code), Some(signed_state)) = (query.code.as_deref(), query.state.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "Missing OIDC callback parameters").into_response();
    };

    let callback = match oidc.handle_callback(code, signed_state).await {
        Ok(callback) => callback,
        Err(error) => {
            tracing::warn!("OIDC callback rejected: {error}");
            return (StatusCode::UNAUTHORIZED, "OIDC callback rejected").into_response();
        }
    };
    let (jwt, max_age) = match oidc.issue_session(&callback.username) {
        Ok(session) => session,
        Err(error) => {
            tracing::error!("failed to mint OIDC session: {error}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let options = CookieOptions {
        path: "/".to_string(),
        max_age_secs: Some(max_age as i64),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut response = redirect_response(callback.return_to);
    append_session_cookie(&mut response, &headers, &jwt, &options);
    response
}

/// `GET /.oidc/logout` — clear the host-wide SB session, then send the
/// browser through the provider's RP-initiated logout endpoint when present.
pub async fn handle_logout(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let Some(oidc) = state.oidc.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let options = CookieOptions {
        path: "/".to_string(),
        max_age_secs: Some(0),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    let mut response = redirect_response(oidc.logout_url().await);
    append_session_cookie(&mut response, &headers, "", &options);
    response
}

fn redirect_response(location: String) -> Response {
    let Ok(location) = HeaderValue::from_str(&location) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert(header::LOCATION, location);
    response
}

fn append_session_cookie(
    response: &mut Response,
    headers: &HeaderMap,
    value: &str,
    options: &CookieOptions,
) {
    let name = auth_cookie_name(&request_host(headers));
    let cookie = set_cookie_value(&name, value, options);
    if let Ok(cookie) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_client(secret: u8) -> OidcClient {
        OidcClient::new(
            OidcConfig {
                issuer: "https://id.example/application/o/wiki/".to_string(),
                client_id: "silverbullet".to_string(),
                client_secret: "secret".to_string(),
                redirect_uri: "https://wiki.example/.oidc/callback".to_string(),
            },
            Arc::new(Authenticator::from_secret_bytes(
                vec![secret; 32],
                "test".to_string(),
            )),
        )
    }

    #[test]
    fn signed_state_round_trips_and_rejects_wrong_secret() {
        let client = test_client(1);
        let verifier = URL_SAFE_NO_PAD.encode([7u8; 32]);
        let state = client
            .sign_state(
                "/notes/today?mode=edit",
                &verifier,
                "nonce-1",
                now_secs() + 300,
            )
            .unwrap();
        let claims = client.verify_state(&state).unwrap();
        assert_eq!(claims.return_to, "/notes/today?mode=edit");
        assert_eq!(claims.code_verifier, verifier);
        assert_eq!(claims.nonce, "nonce-1");
        assert!(test_client(2).verify_state(&state).is_err());
    }

    #[test]
    fn signed_state_rejects_expiry_and_external_return_paths() {
        let client = test_client(1);
        let verifier = URL_SAFE_NO_PAD.encode([8u8; 32]);
        let expired = client.sign_state("/", &verifier, "nonce", 1).unwrap();
        assert!(client.verify_state(&expired).is_err());
        assert_eq!(safe_return_to("https://evil.example/"), "/");
        assert_eq!(safe_return_to("//evil.example/"), "/");
        assert_eq!(safe_return_to("/safe/path?q=1"), "/safe/path?q=1");
    }

    #[test]
    fn authorization_url_contains_code_pkce_and_oidc_parameters() {
        let client = test_client(1);
        let url = client
            .build_authorize_url(
                "https://id.example/authorize",
                "signed-state",
                "pkce-challenge",
                "nonce-1",
            )
            .unwrap();
        let url = reqwest::Url::parse(&url).unwrap();
        let query: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            url.as_str().split('?').next(),
            Some("https://id.example/authorize")
        );
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("client_id").map(String::as_str),
            Some("silverbullet")
        );
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("https://wiki.example/.oidc/callback")
        );
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some("openid profile")
        );
        assert_eq!(query.get("state").map(String::as_str), Some("signed-state"));
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some("pkce-challenge")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(query.get("nonce").map(String::as_str), Some("nonce-1"));
    }

    #[test]
    fn pkce_uses_s256() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn preferred_username_falls_back_to_subject() {
        let claims = |preferred_username: Option<&str>, sub: &str| IdTokenClaims {
            sub: sub.to_string(),
            preferred_username: preferred_username.map(str::to_string),
            aud: IdTokenAudience::One("silverbullet".to_string()),
            azp: None,
            nonce: Some("nonce".to_string()),
        };
        assert_eq!(
            username_from_claims(&claims(Some(" alice "), "subject-1")).unwrap(),
            "alice"
        );
        assert_eq!(
            username_from_claims(&claims(Some(" "), "subject-1")).unwrap(),
            "subject-1"
        );
        assert!(username_from_claims(&claims(None, "")).is_err());
    }

    #[test]
    fn login_location_keeps_return_path_local() {
        assert_eq!(
            login_location("", "/work/.config?x=1"),
            "/.oidc/login?return_to=%2Fwork%2F%2Econfig%3Fx%3D1"
        );
        assert_eq!(
            login_location("/work", "https://evil.example"),
            "/work/.oidc/login?return_to=%2F"
        );
    }

    #[test]
    fn historical_admin_list_is_trimmed_and_exact() {
        assert!(admin_list_contains("alice, root ,bob", "root"));
        assert!(!admin_list_contains("alice, root ,bob", "roo"));
        assert!(!admin_list_contains("alice,,bob", ""));
    }
}
