//! Client ID Metadata Documents: an MCP client may use an https URL as its
//! `client_id`, and the server fetches the JSON document at that URL to learn
//! its name and redirect URIs. The fetch goes to a host the client chose, so
//! it is guarded against reaching the server's own network.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::Algorithm;
use reqwest::header::{self, HeaderMap, HeaderValue};
use reqwest::{redirect, StatusCode, Url};
use serde_json::{Map, Value};

use super::client_auth::{parse_jwks, ReplayCache, SIGNING_ALGS, SIGNING_ALG_NAMES};
use super::net::{is_public_ip, PublicOnlyResolver};
use super::redirect::is_loopback_redirect;
use crate::auth::OAuthError;

const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_BODY: usize = 65_536;
const MAX_CACHE_ENTRIES: usize = 1_000;
const DEFAULT_TTL: Duration = Duration::from_secs(3600);
const MIN_TTL: Duration = Duration::from_secs(300);
const MAX_TTL: Duration = Duration::from_secs(86_400);
const FAILURE_TTL: Duration = Duration::from_secs(60);
const MAX_NAME_CHARS: usize = 100;
/// The least time between two fetches of one JWKS when an assertion names a
/// key it does not have, so unknown `kid`s cannot make the server hammer it.
pub(super) const JWKS_REFETCH_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientMetadata {
    pub client_id: String,
    pub client_name: Option<String>,
    pub logo_uri: Option<String>,
    pub redirect_uris: Vec<String>,
    pub verified_host: String,
    pub auth: ClientAuth,
}

/// How the client authenticates at the token endpoint
/// (`token_endpoint_auth_method`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientAuth {
    None,
    /// RFC 7523 client assertions; `alg` is the registered
    /// `token_endpoint_auth_signing_alg`, when there is one.
    PrivateKeyJwt {
        jwks: JwksSource,
        alg: Option<Algorithm>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JwksSource {
    Uri(String),
    Inline(JwkSet),
}

pub fn validate_cimd_url(id: &str) -> Result<Url, OAuthError> {
    validate(id, false)
}

fn validate(id: &str, allow_http_loopback: bool) -> Result<Url, OAuthError> {
    let bad = || OAuthError::InvalidRequest("client_id is not a valid client metadata URL");
    let url = Url::parse(id).map_err(|_| bad())?;
    let http_loopback =
        allow_http_loopback && url.scheme() == "http" && url.host_str() == Some("localhost");
    if url.scheme() != "https" && !http_loopback {
        return Err(bad());
    }
    // Parsing normalises dot segments, case and default ports away; the
    // document must name exactly this string as its client_id, so anything
    // the parser rewrote is refused rather than silently fetched elsewhere.
    if url.as_str() != id
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() == "/"
        || url.path().split('/').any(|s| {
            matches!(
                s.to_ascii_lowercase().as_str(),
                "." | ".." | "%2e" | "%2e%2e" | ".%2e" | "%2e."
            )
        })
    {
        return Err(bad());
    }
    let host = url.host_str().ok_or_else(bad)?;
    if !public_host(host) {
        return Err(OAuthError::UnauthorizedClient);
    }
    Ok(url)
}

/// An IP-literal host never reaches the resolver, so it is checked here.
fn public_host(host: &str) -> bool {
    let literal = host.trim_start_matches('[').trim_end_matches(']');
    literal.parse::<IpAddr>().map_or(true, is_public_ip)
}

fn validate_jwks_uri(uri: &str, allow_http_loopback: bool) -> Result<Url, OAuthError> {
    let bad = || OAuthError::InvalidClientMetadata("jwks_uri must be a public https URL");
    let url = Url::parse(uri).map_err(|_| bad())?;
    let http_loopback =
        allow_http_loopback && url.scheme() == "http" && url.host_str() == Some("localhost");
    if (url.scheme() != "https" && !http_loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !url.host_str().is_some_and(public_host)
    {
        return Err(bad());
    }
    Ok(url)
}

struct CacheEntry<T> {
    result: Result<Arc<T>, OAuthError>,
    expires: Instant,
    fetched: Instant,
}

/// Fetched documents by URL, failures included, capped in size.
pub(super) struct Cache<T> {
    entries: Mutex<HashMap<String, CacheEntry<T>>>,
}

impl<T> Default for Cache<T> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> Cache<T> {
    /// The cached result, whether it is still fresh, and when it was fetched.
    fn get(&self, key: &str, now: Instant) -> Option<(Result<Arc<T>, OAuthError>, bool, Instant)> {
        let cache = self.entries.lock().unwrap();
        let entry = cache.get(key)?;
        Some((cloned(&entry.result), entry.expires > now, entry.fetched))
    }

    fn remove(&self, key: &str) {
        self.entries.lock().unwrap().remove(key);
    }

    pub(super) fn store(&self, key: String, result: Result<Arc<T>, OAuthError>, expires: Instant) {
        let mut cache = self.entries.lock().unwrap();
        if cache.len() >= MAX_CACHE_ENTRIES && !cache.contains_key(&key) {
            let now = Instant::now();
            cache.retain(|_, e| e.expires > now);
            if cache.len() >= MAX_CACHE_ENTRIES {
                if let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, e)| e.expires)
                    .map(|(k, _)| k.clone())
                {
                    cache.remove(&oldest);
                }
            }
        }
        let fetched = Instant::now();
        cache.insert(
            key,
            CacheEntry {
                result,
                expires,
                fetched,
            },
        );
    }

    #[cfg(test)]
    pub(super) fn backdate(&self, key: &str, by: Duration) {
        if let Some(entry) = self.entries.lock().unwrap().get_mut(key) {
            entry.fetched = entry.fetched.checked_sub(by).unwrap();
        }
    }

    #[cfg(test)]
    pub(super) fn clear(&self) {
        self.entries.lock().unwrap().clear();
    }
}

/// Fetches what a client publishes about itself: its metadata document and,
/// for `private_key_jwt`, its JWKS. Also remembers the client assertions
/// already used, since it is the state every token request shares.
pub struct CimdFetcher {
    client: reqwest::Client,
    allow_http_loopback: bool,
    pub(super) documents: Cache<ClientMetadata>,
    pub(super) key_sets: Cache<JwkSet>,
    pub(super) assertions: ReplayCache,
}

impl Default for CimdFetcher {
    fn default() -> Self {
        Self::new()
    }
}

impl CimdFetcher {
    pub fn new() -> Self {
        Self::build(PublicOnlyResolver::new(), false)
    }

    #[cfg(test)]
    pub fn for_tests(allow_http_loopback: bool) -> Self {
        let resolver = if allow_http_loopback {
            PublicOnlyResolver::allowing_loopback()
        } else {
            PublicOnlyResolver::new()
        };
        Self::build(resolver, allow_http_loopback)
    }

    fn build(resolver: PublicOnlyResolver, allow_http_loopback: bool) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
        let client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .timeout(TIMEOUT)
            .dns_resolver(Arc::new(resolver))
            // A proxy would resolve the host itself, past the resolver.
            .no_proxy()
            .https_only(!allow_http_loopback)
            .default_headers(headers)
            .build()
            .expect("CIMD HTTP client");
        Self {
            client,
            allow_http_loopback,
            documents: Cache::default(),
            key_sets: Cache::default(),
            assertions: ReplayCache::default(),
        }
    }

    pub async fn fetch(&self, client_id: &str) -> Result<Arc<ClientMetadata>, OAuthError> {
        let url = validate(client_id, self.allow_http_loopback)?;
        let now = Instant::now();
        if let Some((result, true, _)) = self.documents.get(client_id, now) {
            return result;
        }
        let downloaded = self.download(url.clone()).await.and_then(|(body, ttl)| {
            Ok((parse_document(&url, &body, self.allow_http_loopback)?, ttl))
        });
        let (result, ttl) = match downloaded {
            Ok((meta, ttl)) => (Ok(Arc::new(meta)), ttl),
            Err(e) => (Err(e), Some(FAILURE_TTL)),
        };
        match ttl {
            Some(ttl) => self
                .documents
                .store(client_id.to_string(), cloned(&result), now + ttl),
            None => self.documents.remove(client_id),
        }
        result
    }

    /// The JWKS at `uri`, cached like documents. `refresh` asks for a fresh
    /// copy, which is fetched only when the cached one is older than
    /// [`JWKS_REFETCH_INTERVAL`].
    pub async fn jwks(&self, uri: &str, refresh: bool) -> Result<Arc<JwkSet>, OAuthError> {
        let url = validate_jwks_uri(uri, self.allow_http_loopback)?;
        let now = Instant::now();
        let cached = self.key_sets.get(uri, now);
        if let Some((result, fresh, fetched)) = &cached {
            let recent = now.duration_since(*fetched) < JWKS_REFETCH_INTERVAL;
            if (*fresh && !refresh) || (refresh && recent) {
                return cloned(result);
            }
        }
        let downloaded = self.download(url).await.and_then(|(body, ttl)| {
            let set = serde_json::from_slice::<Value>(&body)
                .ok()
                .as_ref()
                .and_then(parse_jwks)
                .ok_or(OAuthError::InvalidClientMetadata("JWKS has no usable keys"))?;
            Ok((set, ttl))
        });
        let (result, expires) = match (downloaded, cached) {
            // Kept even when not cacheable, so the refetch limit holds.
            (Ok((set, ttl)), _) => (Ok(Arc::new(set)), now + ttl.unwrap_or_default()),
            // A failed refetch keeps the keys that worked; only the attempt
            // is recorded, so the next one waits its turn.
            (Err(_), Some((Ok(set), _, _))) => (Ok(set), now + FAILURE_TTL),
            (Err(e), _) => (Err(e), now + FAILURE_TTL),
        };
        self.key_sets
            .store(uri.to_string(), cloned(&result), expires);
        result
    }

    /// The body at `url`, within the size limit, and how long it may be
    /// cached (`None`: not at all).
    async fn download(&self, url: Url) -> Result<(Vec<u8>, Option<Duration>), OAuthError> {
        let unreachable =
            || OAuthError::InvalidClientMetadata("client metadata document could not be fetched");
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| unreachable())?;
        if response.status() != StatusCode::OK {
            return Err(unreachable());
        }
        let too_large = OAuthError::InvalidClientMetadata("client metadata document is too large");
        if response
            .content_length()
            .is_some_and(|len| len > MAX_BODY as u64)
        {
            return Err(too_large);
        }
        let ttl = cache_ttl(response.headers());
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unreachable())? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err(too_large);
            }
            body.extend_from_slice(&chunk);
        }
        Ok((body, ttl))
    }
}

fn parse_document(
    url: &Url,
    body: &[u8],
    allow_http_loopback: bool,
) -> Result<ClientMetadata, OAuthError> {
    let invalid = OAuthError::InvalidClientMetadata;
    let doc: Value = serde_json::from_slice(body)
        .map_err(|_| invalid("client metadata document is not JSON"))?;
    let doc = doc
        .as_object()
        .ok_or(invalid("client metadata document is not a JSON object"))?;
    if doc.get("client_id").and_then(Value::as_str) != Some(url.as_str()) {
        return Err(invalid(
            "client_id does not match the metadata document URL",
        ));
    }
    let auth = match doc.get("token_endpoint_auth_method") {
        None => ClientAuth::None,
        Some(Value::String(m)) if m == "none" => ClientAuth::None,
        Some(Value::String(m)) if m == "private_key_jwt" => {
            private_key_jwt(doc, allow_http_loopback)?
        }
        Some(_) => {
            return Err(invalid(
                "token_endpoint_auth_method must be none or private_key_jwt",
            ))
        }
    };
    let redirect_uris: Vec<String> = doc
        .get("redirect_uris")
        .and_then(Value::as_array)
        .ok_or(invalid("redirect_uris is required"))?
        .iter()
        .map(|uri| uri.as_str().map(str::to_string))
        .collect::<Option<_>>()
        .ok_or(OAuthError::InvalidRedirectUri(
            "redirect_uris must be strings",
        ))?;
    if redirect_uris.is_empty() {
        return Err(invalid("redirect_uris is required"));
    }
    if !redirect_uris.iter().all(|uri| redirect_acceptable(uri)) {
        return Err(OAuthError::InvalidRedirectUri(
            "redirect URIs must be https or loopback http",
        ));
    }
    let verified_host = url.host_str().unwrap_or_default().to_string();
    let logo_uri = doc
        .get("logo_uri")
        .and_then(Value::as_str)
        .filter(|logo| {
            Url::parse(logo).is_ok_and(|logo| {
                logo.scheme() == "https" && logo.host_str() == Some(verified_host.as_str())
            })
        })
        .map(str::to_string);
    Ok(ClientMetadata {
        client_id: url.as_str().to_string(),
        client_name: doc
            .get("client_name")
            .and_then(Value::as_str)
            .and_then(clean_name),
        logo_uri,
        redirect_uris,
        verified_host,
        auth,
    })
}

/// RFC 7591 §2: the keys come from `jwks_uri` or inline `jwks`, never both.
fn private_key_jwt(
    doc: &Map<String, Value>,
    allow_http_loopback: bool,
) -> Result<ClientAuth, OAuthError> {
    let invalid = OAuthError::InvalidClientMetadata;
    let alg = match doc.get("token_endpoint_auth_signing_alg") {
        None => None,
        Some(Value::String(name)) => Some(
            SIGNING_ALG_NAMES
                .iter()
                .position(|known| known == name)
                .map(|i| SIGNING_ALGS[i])
                .ok_or(invalid(
                    "token_endpoint_auth_signing_alg must be RS256, PS256 or ES256",
                ))?,
        ),
        Some(_) => {
            return Err(invalid(
                "token_endpoint_auth_signing_alg must be RS256, PS256 or ES256",
            ))
        }
    };
    let jwks = match (doc.get("jwks_uri"), doc.get("jwks")) {
        (Some(Value::String(uri)), None) => {
            validate_jwks_uri(uri, allow_http_loopback)?;
            JwksSource::Uri(uri.clone())
        }
        (None, Some(set)) => {
            JwksSource::Inline(parse_jwks(set).ok_or(invalid("jwks has no usable keys"))?)
        }
        (Some(_), Some(_)) => return Err(invalid("jwks_uri and jwks are mutually exclusive")),
        _ => return Err(invalid("private_key_jwt needs a jwks_uri or jwks")),
    };
    Ok(ClientAuth::PrivateKeyJwt { jwks, alg })
}

/// `OAuthError` is not `Clone`; cached results are handed out repeatedly.
fn cloned<T>(result: &Result<Arc<T>, OAuthError>) -> Result<Arc<T>, OAuthError> {
    use OAuthError::*;
    match result {
        Ok(meta) => Ok(meta.clone()),
        Err(e) => Err(match e {
            InvalidRequest(d) => InvalidRequest(d),
            InvalidGrant(d) => InvalidGrant(d),
            UnauthorizedClient => UnauthorizedClient,
            UnsupportedGrantType => UnsupportedGrantType,
            AuthorizationPending => AuthorizationPending,
            SlowDown => SlowDown,
            ExpiredToken => ExpiredToken,
            AccessDenied => AccessDenied,
            InvalidTarget => InvalidTarget,
            InvalidScope => InvalidScope,
            InvalidClientMetadata(d) => InvalidClientMetadata(d),
            InvalidRedirectUri(d) => InvalidRedirectUri(d),
            TemporarilyUnavailable => TemporarilyUnavailable,
            InvalidClient => InvalidClient,
            ServerError(d) => ServerError(d),
        }),
    }
}

fn redirect_acceptable(uri: &str) -> bool {
    Url::parse(uri).is_ok_and(|u| {
        (u.scheme() == "https" || is_loopback_redirect(&u))
            && u.username().is_empty()
            && u.password().is_none()
            && u.fragment().is_none()
    })
}

pub(super) fn clean_name(name: &str) -> Option<String> {
    let cleaned: String = name.chars().filter(|&c| !hidden_char(c)).collect();
    let cleaned: String = cleaned.trim().chars().take(MAX_NAME_CHARS).collect();
    let cleaned = cleaned.trim_end();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// Control characters, plus the invisible ones that could make a client name
/// read differently on the consent page: bidi marks, overrides and isolates,
/// and zero-width characters.
fn hidden_char(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{061C}'
                | '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

fn cache_ttl(headers: &HeaderMap) -> Option<Duration> {
    let mut ttl = DEFAULT_TTL;
    for value in headers.get_all(header::CACHE_CONTROL) {
        let Ok(value) = value.to_str() else { continue };
        for directive in value.split(',').map(str::trim) {
            let directive = directive.to_ascii_lowercase();
            if directive == "no-store" {
                return None;
            }
            if let Some(secs) = directive
                .strip_prefix("max-age=")
                .and_then(|s| s.trim_matches('"').parse::<u64>().ok())
            {
                ttl = Duration::from_secs(secs).clamp(MIN_TTL, MAX_TTL);
            }
        }
    }
    Some(ttl)
}

#[cfg(test)]
mod tests;
