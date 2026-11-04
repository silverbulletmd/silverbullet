//! Client authentication at the token endpoint. Most MCP clients are public
//! (`none`); a client whose metadata document registers `private_key_jwt`
//! proves itself with an RFC 7523 client assertion, signed with a key from
//! the JWKS its document names.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Mutex;

use base64::Engine;
use jsonwebtoken::jwk::{AlgorithmParameters, EllipticCurve, Jwk, JwkSet, PublicKeyUse};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde_json::Value;

use super::cimd::{CimdFetcher, ClientAuth, JwksSource};
use super::clients::McpClient;
use crate::auth::OAuthError;

pub const ASSERTION_TYPE: &str = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
pub const SIGNING_ALGS: [Algorithm; 3] = [Algorithm::RS256, Algorithm::PS256, Algorithm::ES256];
pub const SIGNING_ALG_NAMES: [&str; 3] = ["RS256", "PS256", "ES256"];
const MAX_LIFETIME_SECS: u64 = 300;
/// How far ahead of this server's clock `iat` and `nbf` may be.
const CLOCK_SKEW_SECS: u64 = 60;
const MAX_JTI_BYTES: usize = 256;
/// Live `jti`s remembered per client. A full allowance refuses only that
/// client, so no one client can lock the others out.
const MAX_JTIS_PER_CLIENT: usize = 500;
/// Clients with live `jti`s past which expired entries are swept.
const SWEEP_CLIENTS: usize = 1_000;
/// Keys tried for one assertion when several match.
const MAX_CANDIDATE_KEYS: usize = 10;
const MIN_RSA_BITS: usize = 2048;

/// What the client sent to authenticate, from the token request.
#[derive(Debug, Default, Clone, Copy)]
pub struct Credentials<'a> {
    pub assertion_type: Option<&'a str>,
    pub assertion: Option<&'a str>,
}

/// Authenticates `client` by its registered method. `audiences` are the
/// values this server answers to in `aud`: its token endpoint and issuer.
/// A public client that sends an assertion anyway is not refused: it is
/// authenticated by the method it registered, which needs nothing.
pub async fn authenticate(
    cimd: &CimdFetcher,
    client: &McpClient,
    credentials: Credentials<'_>,
    audiences: &[String],
    now: u64,
) -> Result<(), OAuthError> {
    let McpClient::Cimd(meta) = client else {
        return Ok(());
    };
    let ClientAuth::PrivateKeyJwt { jwks, alg } = &meta.auth else {
        return Ok(());
    };
    if credentials.assertion_type != Some(ASSERTION_TYPE) {
        return Err(OAuthError::InvalidClient);
    }
    let assertion = credentials
        .assertion
        .filter(|a| !a.is_empty())
        .ok_or(OAuthError::InvalidClient)?;
    let claims = verify_signature(cimd, jwks, *alg, assertion).await?;
    let checked = check_claims(&claims, &meta.client_id, audiences, now)?;
    cimd.assertions
        .first_use(&meta.client_id, checked.jti, checked.exp, now)
}

/// The assertion's claims, once its signature checks out against the
/// client's JWKS. An unknown `kid` refetches a remote JWKS once (the fetcher
/// rate-limits that), since the client may have rotated its keys.
async fn verify_signature(
    cimd: &CimdFetcher,
    jwks: &JwksSource,
    registered: Option<Algorithm>,
    assertion: &str,
) -> Result<Value, OAuthError> {
    let fail = |_: jsonwebtoken::errors::Error| OAuthError::InvalidClient;
    let unfetchable = |_: OAuthError| OAuthError::InvalidClient;
    let header = decode_header(assertion).map_err(fail)?;
    if !SIGNING_ALGS.contains(&header.alg) || registered.is_some_and(|alg| alg != header.alg) {
        return Err(OAuthError::InvalidClient);
    }
    let kid = header.kid.as_deref();
    let keys = match jwks {
        JwksSource::Inline(set) => candidate_keys(set, kid, header.alg),
        JwksSource::Uri(uri) => {
            let set = cimd.jwks(uri, false).await.map_err(unfetchable)?;
            let keys = candidate_keys(&set, kid, header.alg);
            if keys.is_empty() && kid.is_some() {
                let set = cimd.jwks(uri, true).await.map_err(unfetchable)?;
                candidate_keys(&set, kid, header.alg)
            } else {
                keys
            }
        }
    };
    let mut validation = Validation::new(header.alg);
    // Time and audience are checked against this server's own clock and
    // URLs below; the library would use the system clock.
    validation.validate_exp = false;
    validation.validate_nbf = false;
    validation.validate_aud = false;
    validation.required_spec_claims = HashSet::new();
    keys.iter()
        .find_map(|key| decode::<Value>(assertion, key, &validation).ok())
        .map(|data| data.claims)
        .ok_or(OAuthError::InvalidClient)
}

/// The keys that may have signed the assertion: those `kid` names (several
/// may share one during a rotation), or every key when it names none. Each
/// must be a signing key of the family `alg` needs.
fn candidate_keys(set: &JwkSet, kid: Option<&str>, alg: Algorithm) -> Vec<DecodingKey> {
    set.keys
        .iter()
        .filter(|jwk| kid.is_none() || jwk.common.key_id.as_deref() == kid)
        .filter(|jwk| usable(jwk, alg))
        .filter_map(|jwk| DecodingKey::from_jwk(jwk).ok())
        .take(MAX_CANDIDATE_KEYS)
        .collect()
}

fn usable(jwk: &Jwk, alg: Algorithm) -> bool {
    if jwk
        .common
        .public_key_use
        .as_ref()
        .is_some_and(|u| *u != PublicKeyUse::Signature)
    {
        return false;
    }
    if jwk
        .common
        .key_algorithm
        .is_some_and(|ka| Algorithm::from_str(&ka.to_string()).ok() != Some(alg))
    {
        return false;
    }
    match (&jwk.algorithm, alg) {
        (AlgorithmParameters::RSA(rsa), Algorithm::RS256 | Algorithm::PS256) => {
            rsa_bits(&rsa.n).is_some_and(|bits| bits >= MIN_RSA_BITS)
        }
        (AlgorithmParameters::EllipticCurve(ec), Algorithm::ES256) => {
            ec.curve == EllipticCurve::P256
        }
        _ => false,
    }
}

struct Checked<'a> {
    jti: &'a str,
    exp: u64,
}

fn check_claims<'a>(
    claims: &'a Value,
    client_id: &str,
    audiences: &[String],
    now: u64,
) -> Result<Checked<'a>, OAuthError> {
    let fail = || OAuthError::InvalidClient;
    let text = |name: &str| claims.get(name).and_then(Value::as_str);
    if text("iss") != Some(client_id) || text("sub") != Some(client_id) {
        return Err(fail());
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(aud)) => audiences.contains(aud),
        Some(Value::Array(auds)) => auds.iter().any(|aud| {
            aud.as_str()
                .is_some_and(|aud| audiences.iter().any(|a| a == aud))
        }),
        _ => false,
    };
    if !aud_ok {
        return Err(fail());
    }
    let time = |name: &str| -> Result<Option<u64>, OAuthError> {
        match claims.get(name) {
            None => Ok(None),
            Some(value) => numeric_date(value).map(Some).ok_or_else(fail),
        }
    };
    let exp = time("exp")?.ok_or_else(fail)?;
    let iat = time("iat")?;
    let nbf = time("nbf")?;
    let ahead = now + CLOCK_SKEW_SECS;
    if exp <= now || iat.is_some_and(|t| t > ahead) || nbf.is_some_and(|t| t > ahead) {
        return Err(fail());
    }
    let start = iat.or(nbf).unwrap_or(now);
    if exp.saturating_sub(start) > MAX_LIFETIME_SECS {
        return Err(fail());
    }
    let jti = text("jti")
        .filter(|jti| !jti.is_empty() && jti.len() <= MAX_JTI_BYTES)
        .ok_or_else(fail)?;
    Ok(Checked { jti, exp })
}

/// The size of an RSA modulus given as base64url (RFC 7518 §6.3.1.1).
fn rsa_bits(n: &str) -> Option<usize> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(n)
        .ok()?;
    let first = bytes.iter().position(|&b| b != 0)?;
    Some((bytes.len() - first) * 8 - bytes[first].leading_zeros() as usize)
}

/// RFC 7519 NumericDate: seconds, possibly fractional.
fn numeric_date(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64))
}

/// The `jti`s of accepted assertions, kept until they expire so each one is
/// used once. Bounded per client: past its allowance, with nothing expired to
/// drop, that client's new assertions are refused for now rather than the
/// oldest forgotten early.
#[derive(Default)]
pub struct ReplayCache {
    seen: Mutex<HashMap<String, HashMap<String, u64>>>,
    cap: Option<usize>,
}

impl ReplayCache {
    #[cfg(test)]
    fn with_cap(cap: usize) -> Self {
        Self {
            seen: Mutex::default(),
            cap: Some(cap),
        }
    }

    pub fn first_use(
        &self,
        client_id: &str,
        jti: &str,
        exp: u64,
        now: u64,
    ) -> Result<(), OAuthError> {
        let mut seen = self
            .seen
            .lock()
            .map_err(|_| OAuthError::TemporarilyUnavailable)?;
        if seen.len() >= SWEEP_CLIENTS && !seen.contains_key(client_id) {
            seen.retain(|_, jtis| {
                jtis.retain(|_, until| *until > now);
                !jtis.is_empty()
            });
        }
        let jtis = seen.entry(client_id.to_string()).or_default();
        if jtis.get(jti).is_some_and(|&until| until > now) {
            return Err(OAuthError::InvalidClient);
        }
        let cap = self.cap.unwrap_or(MAX_JTIS_PER_CLIENT);
        if jtis.len() >= cap {
            jtis.retain(|_, until| *until > now);
            if jtis.len() >= cap {
                return Err(OAuthError::TemporarilyUnavailable);
            }
        }
        jtis.insert(jti.to_string(), exp);
        Ok(())
    }
}

/// Shared by the fetcher and the tests: a JWKS whose keys deserialize, with
/// the ones that do not (unknown key types) dropped.
pub(super) fn parse_jwks(value: &Value) -> Option<JwkSet> {
    let keys: Vec<Jwk> = value
        .get("keys")?
        .as_array()?
        .iter()
        .filter_map(|key| serde_json::from_value(key.clone()).ok())
        .collect();
    (!keys.is_empty()).then_some(JwkSet { keys })
}

/// The `aud` values a client assertion may name: the token endpoint, or the
/// issuer, as the metadata advertises them.
pub fn audiences(issuer: &str) -> Vec<String> {
    vec![format!("{issuer}/.auth/mcp/token"), issuer.to_string()]
}

#[cfg(test)]
mod tests;
