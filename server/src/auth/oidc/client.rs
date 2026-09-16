use std::future::Future;
use std::io;
use std::pin::Pin;

use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreClientAuthMethod, CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm, CoreJwsSigningAlgorithm, CoreProviderMetadata,
    CoreUserInfoClaims,
};
use openidconnect::{
    AccessTokenHash, AdditionalClaims, AuthType, AuthorizationCode, ClientId, ClientSecret,
    CsrfToken, EndpointMaybeSet, EndpointNotSet, EndpointSet, HttpRequest, HttpResponse, IdToken,
    IssuerUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope,
};
use serde::{Deserialize, Serialize};

use super::{
    config::{validated_url, ProviderConfig},
    identity::VerifiedIdentity,
};

pub struct Authorization {
    pub url: String,
    pub state: String,
    pub nonce: String,
    pub verifier: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OrganizationClaims {
    hd: Option<String>,
}
impl AdditionalClaims for OrganizationClaims {}

type DiscoveredClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;
type OrganizationIdToken = IdToken<
    OrganizationClaims,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;

struct BoundedHttp<'a>(&'a reqwest::Client);

impl<'c> openidconnect::AsyncHttpClient<'c> for BoundedHttp<'_> {
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = io::Result<HttpResponse>> + Send + 'c>>;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(request_provider(self.0, request))
    }
}

async fn request_provider(
    http: &reqwest::Client,
    request: HttpRequest,
) -> io::Result<HttpResponse> {
    const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
    validated_url(&request.uri().to_string()).map_err(io::Error::other)?;
    let request = reqwest::Request::try_from(request).map_err(io::Error::other)?;
    let url = request.url().clone();
    let mut response = http.execute(request).await.map_err(io::Error::other)?;
    if response.url() != &url || response.status().is_redirection() {
        return Err(io::Error::other("provider redirects are not allowed"));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(io::Error::other("provider response exceeds limit"));
    }
    let mut builder = axum::http::Response::builder().status(response.status());
    for (name, value) in response.headers() {
        builder = builder.header(name, value);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(io::Error::other)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(io::Error::other("provider response exceeds limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    builder.body(bytes).map_err(io::Error::other)
}

async fn discover(
    config: &ProviderConfig,
    http: &reqwest::Client,
) -> Result<DiscoveredClient, String> {
    validated_url(&config.issuer)?;
    let transport = BoundedHttp(http);
    let metadata = CoreProviderMetadata::discover_async(
        IssuerUrl::new(config.issuer.clone()).map_err(|_| "Invalid provider issuer")?,
        &transport,
    )
    .await
    .map_err(|_| "Could not discover the identity provider")?;
    validated_url(metadata.authorization_endpoint().as_str())?;
    let methods = metadata.token_endpoint_auth_methods_supported();
    let auth_type = if methods
        .is_none_or(|methods| methods.contains(&CoreClientAuthMethod::ClientSecretBasic))
    {
        AuthType::BasicAuth
    } else if methods
        .is_some_and(|methods| methods.contains(&CoreClientAuthMethod::ClientSecretPost))
    {
        AuthType::RequestBody
    } else {
        return Err("Provider must support client_secret_basic or client_secret_post".into());
    };
    Ok(CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_auth_type(auth_type)
    .set_redirect_uri(
        RedirectUrl::new(config.callback_url()).map_err(|_| "Invalid provider callback URL")?,
    ))
}

pub async fn begin(
    config: &ProviderConfig,
    http: &reqwest::Client,
) -> Result<Authorization, String> {
    let client = discover(config, http).await?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let mut request = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".into()))
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(challenge);
    if !config.workspace_domain.is_empty() {
        request = request.add_extra_param("hd", &config.workspace_domain);
    }
    let (url, state, nonce) = request.url();
    Ok(Authorization {
        url: url.to_string(),
        state: state.secret().clone(),
        nonce: nonce.secret().clone(),
        verifier: verifier.secret().clone(),
    })
}

pub async fn finish(
    config: &ProviderConfig,
    http: &reqwest::Client,
    code: &str,
    nonce: &str,
    verifier: &str,
) -> Result<VerifiedIdentity, String> {
    let client = discover(config, http).await?;
    let transport = BoundedHttp(http);
    let tokens = client
        .exchange_code(AuthorizationCode::new(code.into()))
        .map_err(|_| "Provider has no token endpoint")?
        .set_pkce_verifier(PkceCodeVerifier::new(verifier.into()))
        .request_async(&transport)
        .await
        .map_err(|_| "Identity provider rejected the code exchange")?;
    let raw_id_token = tokens
        .extra_fields()
        .id_token()
        .ok_or("Provider did not return an ID token")?;
    let id_token: OrganizationIdToken = raw_id_token
        .to_string()
        .parse()
        .map_err(|_| "Provider returned an invalid ID token")?;
    let verifier = client.id_token_verifier();
    let claims = id_token
        .claims(&verifier, &Nonce::new(nonce.into()))
        .map_err(|_| "ID token signature or claims did not validate")?;
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            tokens.access_token(),
            id_token
                .signing_alg()
                .map_err(|_| "Invalid ID token signing algorithm")?,
            id_token
                .signing_key(&verifier)
                .map_err(|_| "Invalid ID token signing key")?,
        )
        .map_err(|_| "Could not validate access token hash")?;
        if &actual != expected {
            return Err("Access token hash did not validate".into());
        }
    }
    let mut identity = VerifiedIdentity {
        issuer: claims.issuer().as_str().to_string(),
        subject: claims.subject().as_str().to_string(),
        email: claims.email().map(|value| value.as_str().to_string()),
        email_verified: claims.email_verified() == Some(true),
        full_name: claims
            .name()
            .and_then(|name| name.get(None))
            .map(|value| value.as_str().to_string()),
        hosted_domain: claims.additional_claims().hd.clone(),
    };
    if identity.email.is_none() {
        let info: CoreUserInfoClaims = client
            .user_info(
                tokens.access_token().clone(),
                Some(claims.subject().clone()),
            )
            .map_err(|_| "Provider did not supply an email or UserInfo endpoint")?
            .request_async(&transport)
            .await
            .map_err(|_| "Provider UserInfo did not validate")?;
        identity.email = info.email().map(|value| value.as_str().to_string());
        identity.email_verified = info.email_verified() == Some(true);
        if identity.full_name.is_none() {
            identity.full_name = info
                .name()
                .and_then(|name| name.get(None))
                .map(|value| value.as_str().to_string());
        }
    }
    validate_identity_policy(config, &identity)?;
    Ok(identity)
}

pub fn validate_identity_policy(
    config: &ProviderConfig,
    identity: &VerifiedIdentity,
) -> Result<(), String> {
    if !identity.email_verified || identity.email.as_ref().is_none_or(|email| email.is_empty()) {
        return Err("The identity provider must supply a verified email address".into());
    }
    if !config.workspace_domain.is_empty()
        && !identity
            .hosted_domain
            .as_ref()
            .is_some_and(|domain| domain.eq_ignore_ascii_case(&config.workspace_domain))
    {
        return Err(
            "This account does not belong to the configured Google Workspace organization".into(),
        );
    }
    Ok(())
}
