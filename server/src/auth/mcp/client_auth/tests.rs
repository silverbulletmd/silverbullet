use super::*;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::json;
use tower::ServiceExt;

use crate::auth::mcp::cimd::ClientMetadata;
use crate::auth::mcp::clients::ClientRegistry;
use crate::auth::mcp::consent::{ConsentApprover, ConsentRequest};
use crate::auth::mcp::grants::GrantStore;
use crate::auth::mcp::{GrantableSpace, McpAccountHost, McpCodeGrant, McpOAuthState};
use crate::auth::oauth::{challenge_for, CodeStore};
use crate::auth::Authenticator;

const RSA_A: &str = include_str!("../../../../tests/fixtures/oidc-test-key.pem");
const RSA_B: &str = include_str!("../../../../tests/fixtures/oidc-test-rotated-key.pem");
const EC: &str = include_str!("../../../../tests/fixtures/mcp-client-ec-key.pem");
const RSA_WEAK: &str = include_str!("../../../../tests/fixtures/mcp-client-rsa1024-key.pem");
const CLIENT: &str = "https://client.example.test/oauth/client.json";
const ISSUER: &str = "http://notes.example.test";
const TOKEN_URL: &str = "http://notes.example.test/.auth/mcp/token";
const NOW: u64 = 1_800_000_000;

fn rsa(pem: &str) -> EncodingKey {
    EncodingKey::from_rsa_pem(pem.as_bytes()).unwrap()
}

fn ec() -> EncodingKey {
    EncodingKey::from_ec_pem(EC.as_bytes()).unwrap()
}

pub fn jwk(key: &EncodingKey, alg: Algorithm, kid: &str) -> Jwk {
    let mut jwk = Jwk::from_encoding_key(key, alg).unwrap();
    jwk.common.key_id = Some(kid.into());
    jwk
}

/// Keys `rsa` (key A), `ps` (key A, for PS256) and `ec`.
fn jwks() -> JwkSet {
    JwkSet {
        keys: vec![
            jwk(&rsa(RSA_A), Algorithm::RS256, "rsa"),
            jwk(&rsa(RSA_A), Algorithm::PS256, "ps"),
            jwk(&ec(), Algorithm::ES256, "ec"),
        ],
    }
}

fn claims(now: u64) -> Value {
    json!({
        "iss": CLIENT,
        "sub": CLIENT,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 120,
        "jti": uuid::Uuid::new_v4().to_string(),
    })
}

fn sign(key: &EncodingKey, alg: Algorithm, kid: &str, claims: &Value) -> String {
    let mut header = Header::new(alg);
    header.kid = Some(kid.into());
    encode(&header, claims, key).unwrap()
}

fn assertion(claims: &Value) -> String {
    sign(&rsa(RSA_A), Algorithm::RS256, "rsa", claims)
}

fn client(jwks: JwksSource, alg: Option<Algorithm>) -> McpClient {
    McpClient::Cimd(Arc::new(ClientMetadata {
        client_id: CLIENT.into(),
        client_name: Some("Notes App".into()),
        logo_uri: None,
        redirect_uris: vec!["https://client.example.test/cb".into()],
        verified_host: "client.example.test".into(),
        auth: ClientAuth::PrivateKeyJwt { jwks, alg },
    }))
}

fn inline() -> McpClient {
    client(JwksSource::Inline(jwks()), None)
}

async fn check(cimd: &CimdFetcher, client: &McpClient, assertion: &str) -> Result<(), OAuthError> {
    authenticate(
        cimd,
        client,
        Credentials {
            assertion_type: Some(ASSERTION_TYPE),
            assertion: Some(assertion),
        },
        &audiences(ISSUER),
        NOW,
    )
    .await
}

#[tokio::test]
async fn valid_assertions_pass_for_each_algorithm() {
    let cimd = CimdFetcher::new();
    let client = inline();
    assert_eq!(
        check(&cimd, &client, &assertion(&claims(NOW))).await,
        Ok(())
    );
    let ps = sign(&rsa(RSA_A), Algorithm::PS256, "ps", &claims(NOW));
    assert_eq!(check(&cimd, &client, &ps).await, Ok(()));
    let es = sign(&ec(), Algorithm::ES256, "ec", &claims(NOW));
    assert_eq!(check(&cimd, &client, &es).await, Ok(()));
    let mut to_issuer = claims(NOW);
    to_issuer["aud"] = json!(["https://elsewhere.example", ISSUER]);
    assert_eq!(check(&cimd, &client, &assertion(&to_issuer)).await, Ok(()));
    let mut no_iat = claims(NOW);
    no_iat.as_object_mut().unwrap().remove("iat");
    assert_eq!(check(&cimd, &client, &assertion(&no_iat)).await, Ok(()));
}

#[tokio::test]
async fn bad_assertions_are_invalid_client() {
    let cimd = CimdFetcher::new();
    let client = inline();
    let with = |name: &str, value: Value| {
        let mut c = claims(NOW);
        c[name] = value;
        c
    };
    let mut no_jti = claims(NOW);
    no_jti.as_object_mut().unwrap().remove("jti");
    let mut no_exp = claims(NOW);
    no_exp.as_object_mut().unwrap().remove("exp");
    let unsigned = |claims: &Value| {
        let b64 =
            |v: &Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string());
        format!(
            "{}.{}.",
            b64(&json!({"alg": "none", "kid": "rsa"})),
            b64(claims)
        )
    };
    let hs_key = EncodingKey::from_secret(b"shared-secret");
    let cases: Vec<(&str, String)> = vec![
        (
            "wrong signature",
            sign(&rsa(RSA_B), Algorithm::RS256, "rsa", &claims(NOW)),
        ),
        (
            "wrong aud",
            assertion(&with("aud", json!("https://other.example/token"))),
        ),
        (
            "wrong aud list",
            assertion(&with("aud", json!(["https://other.example"]))),
        ),
        ("expired", assertion(&with("exp", json!(NOW - 1)))),
        ("exp now", assertion(&with("exp", json!(NOW)))),
        ("no exp", assertion(&no_exp)),
        ("too long", {
            let mut c = with("exp", json!(NOW + 301));
            c["iat"] = json!(NOW);
            assertion(&c)
        }),
        ("too long without iat", {
            let mut c = with("exp", json!(NOW + 301));
            c.as_object_mut().unwrap().remove("iat");
            assertion(&c)
        }),
        (
            "iat in the future",
            assertion(&with("iat", json!(NOW + 61))),
        ),
        (
            "nbf in the future",
            assertion(&with("nbf", json!(NOW + 61))),
        ),
        ("iat not a number", assertion(&with("iat", json!("soon")))),
        (
            "wrong iss",
            assertion(&with("iss", json!("https://other.example/m"))),
        ),
        ("wrong sub", assertion(&with("sub", json!("someone")))),
        ("no jti", assertion(&no_jti)),
        ("empty jti", assertion(&with("jti", json!("")))),
        ("alg none", unsigned(&claims(NOW))),
        (
            "HS256",
            sign(&hs_key, Algorithm::HS256, "rsa", &claims(NOW)),
        ),
        (
            "RS512",
            sign(&rsa(RSA_A), Algorithm::RS512, "rsa", &claims(NOW)),
        ),
        (
            "unknown kid",
            sign(&rsa(RSA_A), Algorithm::RS256, "other", &claims(NOW)),
        ),
        (
            "key of another family",
            sign(&rsa(RSA_A), Algorithm::RS256, "ec", &claims(NOW)),
        ),
        (
            "key registered for another alg",
            sign(&rsa(RSA_A), Algorithm::PS256, "rsa", &claims(NOW)),
        ),
        ("garbage", "not.a.jwt".into()),
    ];
    for (name, token) in cases {
        assert_eq!(
            check(&cimd, &client, &token).await,
            Err(OAuthError::InvalidClient),
            "{name}"
        );
    }
}

#[tokio::test]
async fn hs256_with_a_symmetric_key_in_the_jwks_is_refused() {
    let secret = EncodingKey::from_secret(b"shared-secret");
    let set = JwkSet {
        keys: vec![jwk(&secret, Algorithm::HS256, "oct")],
    };
    let client = client(JwksSource::Inline(set), None);
    let token = sign(&secret, Algorithm::HS256, "oct", &claims(NOW));
    assert_eq!(
        check(&CimdFetcher::new(), &client, &token).await,
        Err(OAuthError::InvalidClient)
    );
}

#[tokio::test]
async fn registered_signing_alg_is_enforced() {
    let client = client(JwksSource::Inline(jwks()), Some(Algorithm::RS256));
    let cimd = CimdFetcher::new();
    assert_eq!(
        check(&cimd, &client, &assertion(&claims(NOW))).await,
        Ok(())
    );
    let es = sign(&ec(), Algorithm::ES256, "ec", &claims(NOW));
    assert_eq!(
        check(&cimd, &client, &es).await,
        Err(OAuthError::InvalidClient)
    );
}

#[tokio::test]
async fn replayed_jti_is_refused() {
    let cimd = CimdFetcher::new();
    let client = inline();
    let token = assertion(&claims(NOW));
    assert_eq!(check(&cimd, &client, &token).await, Ok(()));
    assert_eq!(
        check(&cimd, &client, &token).await,
        Err(OAuthError::InvalidClient)
    );
}

#[tokio::test]
async fn missing_or_mistyped_assertion_is_invalid_client() {
    let cimd = CimdFetcher::new();
    let client = inline();
    let token = assertion(&claims(NOW));
    for credentials in [
        Credentials::default(),
        Credentials {
            assertion_type: Some(ASSERTION_TYPE),
            assertion: None,
        },
        Credentials {
            assertion_type: Some(ASSERTION_TYPE),
            assertion: Some(""),
        },
        Credentials {
            assertion_type: None,
            assertion: Some(&token),
        },
        Credentials {
            assertion_type: Some("urn:ietf:params:oauth:client-assertion-type:saml2-bearer"),
            assertion: Some(&token),
        },
    ] {
        assert_eq!(
            authenticate(&cimd, &client, credentials, &audiences(ISSUER), NOW).await,
            Err(OAuthError::InvalidClient),
            "{credentials:?}"
        );
    }
}

#[tokio::test]
async fn public_clients_ignore_assertions() {
    let cimd = CimdFetcher::new();
    let public = McpClient::Cimd(Arc::new(ClientMetadata {
        client_id: CLIENT.into(),
        client_name: None,
        logo_uri: None,
        redirect_uris: vec![],
        verified_host: "client.example.test".into(),
        auth: ClientAuth::None,
    }));
    for credentials in [
        Credentials::default(),
        Credentials {
            assertion_type: Some(ASSERTION_TYPE),
            assertion: Some("not.a.jwt"),
        },
    ] {
        assert_eq!(
            authenticate(&cimd, &public, credentials, &audiences(ISSUER), NOW).await,
            Ok(())
        );
    }
}

#[test]
fn replay_cache_forgets_expired_and_is_bounded() {
    let cache = ReplayCache::with_cap(2);
    cache.first_use("c", "a", NOW + 10, NOW).unwrap();
    assert_eq!(
        cache.first_use("c", "a", NOW + 10, NOW + 5),
        Err(OAuthError::InvalidClient)
    );
    cache.first_use("c", "b", NOW + 10, NOW).unwrap();
    assert_eq!(
        cache.first_use("c", "c", NOW + 10, NOW),
        Err(OAuthError::TemporarilyUnavailable)
    );
    cache.first_use("c", "c", NOW + 30, NOW + 10).unwrap();
    cache.first_use("c", "a", NOW + 30, NOW + 10).unwrap();
}

#[test]
fn replay_cap_only_locks_out_the_client_that_filled_it() {
    let cache = ReplayCache::with_cap(2);
    cache.first_use("noisy", "1", NOW + 300, NOW).unwrap();
    cache.first_use("noisy", "2", NOW + 300, NOW).unwrap();
    assert_eq!(
        cache.first_use("noisy", "3", NOW + 300, NOW),
        Err(OAuthError::TemporarilyUnavailable)
    );
    assert_eq!(cache.first_use("quiet", "1", NOW + 300, NOW), Ok(()));
}

#[tokio::test]
async fn keys_sharing_a_kid_or_without_one_are_each_tried() {
    let cimd = CimdFetcher::new();
    let shared = client(
        JwksSource::Inline(JwkSet {
            keys: vec![
                jwk(&rsa(RSA_B), Algorithm::RS256, "dup"),
                jwk(&rsa(RSA_A), Algorithm::RS256, "dup"),
            ],
        }),
        None,
    );
    let token = sign(&rsa(RSA_A), Algorithm::RS256, "dup", &claims(NOW));
    assert_eq!(check(&cimd, &shared, &token).await, Ok(()));

    let unnamed = |key: &EncodingKey| {
        let mut jwk = Jwk::from_encoding_key(key, Algorithm::RS256).unwrap();
        jwk.common.key_id = None;
        jwk
    };
    let anonymous = client(
        JwksSource::Inline(JwkSet {
            keys: vec![unnamed(&rsa(RSA_B)), unnamed(&rsa(RSA_A))],
        }),
        None,
    );
    let token = encode(&Header::new(Algorithm::RS256), &claims(NOW), &rsa(RSA_A)).unwrap();
    assert_eq!(check(&cimd, &anonymous, &token).await, Ok(()));
    let wrong = encode(
        &Header::new(Algorithm::RS256),
        &claims(NOW),
        &EncodingKey::from_rsa_pem(RSA_WEAK.as_bytes()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        check(&cimd, &anonymous, &wrong).await,
        Err(OAuthError::InvalidClient)
    );
}

#[tokio::test]
async fn rsa_keys_under_2048_bits_are_refused() {
    let weak = EncodingKey::from_rsa_pem(RSA_WEAK.as_bytes()).unwrap();
    let client = client(
        JwksSource::Inline(JwkSet {
            keys: vec![jwk(&weak, Algorithm::RS256, "weak")],
        }),
        None,
    );
    let token = sign(&weak, Algorithm::RS256, "weak", &claims(NOW));
    assert_eq!(
        check(&CimdFetcher::new(), &client, &token).await,
        Err(OAuthError::InvalidClient)
    );
}

#[tokio::test]
async fn remote_jwks_unknown_kid_refetches_once() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let rotated = Arc::new(AtomicUsize::new(0));
    let hits = Arc::new(AtomicUsize::new(0));
    let (state, counter) = (rotated.clone(), hits.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = axum::Router::new().route(
        "/jwks",
        axum::routing::get(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            let kid = if state.load(Ordering::SeqCst) == 0 {
                "old"
            } else {
                "rsa"
            };
            async move { axum::Json(json!({"keys": [jwk(&rsa(RSA_A), Algorithm::RS256, kid)]})) }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let uri = format!("http://localhost:{port}/jwks");
    let cimd = CimdFetcher::for_tests(true);
    let client = client(JwksSource::Uri(uri.clone()), None);

    // Warm the cache with the old set, past the refetch interval.
    cimd.jwks(&uri, false).await.unwrap();
    cimd.key_sets
        .backdate(&uri, crate::auth::mcp::cimd::JWKS_REFETCH_INTERVAL);
    rotated.store(1, Ordering::SeqCst);
    assert_eq!(
        check(&cimd, &client, &assertion(&claims(NOW))).await,
        Ok(())
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);

    // Another unknown kid right away does not fetch again.
    let other = sign(&rsa(RSA_A), Algorithm::RS256, "missing", &claims(NOW));
    assert_eq!(
        check(&cimd, &client, &other).await,
        Err(OAuthError::InvalidClient)
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn unreachable_jwks_is_invalid_client() {
    let client = client(JwksSource::Uri("https://10.0.0.1/jwks.json".into()), None);
    assert_eq!(
        check(&CimdFetcher::new(), &client, &assertion(&claims(NOW))).await,
        Err(OAuthError::InvalidClient)
    );
}

// The token endpoint, end to end, for a `private_key_jwt` client.

struct Accounts;

impl McpAccountHost for Accounts {
    fn signed_in_user(&self, _: &HeaderMap) -> Option<String> {
        None
    }
    fn writable_spaces(&self, _: &str) -> Vec<GrantableSpace> {
        vec![GrantableSpace {
            id: "team".into(),
            name: "Team".into(),
            shared: false,
        }]
    }
    fn credential_version(&self, _: &str) -> Option<String> {
        None
    }
    fn session_is_current(&self, _: &str, _: Option<&str>) -> bool {
        true
    }
    fn login_url(&self, return_to: &str) -> String {
        return_to.into()
    }
    fn server_name(&self) -> String {
        "Notes".into()
    }
}

struct NoConsent;

#[async_trait::async_trait]
impl ConsentApprover for NoConsent {
    async fn on_get(
        &self,
        _: &McpOAuthState,
        _: &HeaderMap,
        _: &str,
        _: ConsentRequest,
    ) -> axum::response::Response {
        unreachable!()
    }
    async fn on_post(
        &self,
        _: &McpOAuthState,
        _: &HeaderMap,
        _: ConsentRequest,
        _: &[(String, String)],
    ) -> axum::response::Response {
        unreachable!()
    }
}

const VERIFIER: &str = "fixture-verifier-0123456789-0123456789-0123456789";
const REDIRECT: &str = "https://client.example.test/cb";
const RESOURCE: &str = "http://notes.example.test/.mcp";

struct Env {
    _dir: tempfile::TempDir,
    state: Arc<McpOAuthState>,
    app: axum::Router,
    now: u64,
}

fn env(client: McpClient) -> Env {
    let dir = tempfile::tempdir().unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let cimd = CimdFetcher::new();
    let McpClient::Cimd(meta) = client else {
        unreachable!()
    };
    cimd.documents.store(
        CLIENT.into(),
        Ok(meta),
        Instant::now() + Duration::from_secs(3600),
    );
    let state = Arc::new(McpOAuthState {
        authenticator: Arc::new(Authenticator::from_secret_bytes(vec![7; 32], "h".into())),
        accounts: Arc::new(Accounts),
        clients: Arc::new(ClientRegistry::load(dir.path()).unwrap()),
        cimd: Arc::new(cimd),
        grants: Arc::new(GrantStore::load(dir.path()).unwrap()),
        codes: CodeStore::new(),
        consent: Arc::new(NoConsent),
        now: Arc::new(move || now),
    });
    let app = crate::handlers::mcp_oauth::router(state.clone(), Arc::new(|| true));
    Env {
        _dir: dir,
        state,
        app,
        now,
    }
}

impl Env {
    fn code(&self) -> String {
        self.state.codes.issue_at(
            McpCodeGrant {
                username: "writer-one".into(),
                client_id: CLIENT.into(),
                redirect_uri: REDIRECT.into(),
                code_challenge: challenge_for(VERIFIER),
                resource: RESOURCE.into(),
                spaces: vec!["team".into()],
                credential_version: None,
            },
            self.now,
        )
    }

    async fn post(&self, pairs: &[(&str, &str)]) -> (StatusCode, Value) {
        let body: String = form_urlencoded::Serializer::new(String::new())
            .extend_pairs(pairs)
            .finish();
        let response = self
            .app
            .clone()
            .oneshot(
                Request::post("/.auth/mcp/token")
                    .header("host", "notes.example.test")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn exchange(&self, code: &str, assertion: Option<&str>) -> (StatusCode, Value) {
        let mut pairs = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", VERIFIER),
            ("redirect_uri", REDIRECT),
            ("client_id", CLIENT),
            ("resource", RESOURCE),
        ];
        if let Some(assertion) = assertion {
            pairs.push(("client_assertion_type", ASSERTION_TYPE));
            pairs.push(("client_assertion", assertion));
        }
        self.post(&pairs).await
    }

    async fn refresh(&self, token: &str, assertion: Option<&str>) -> (StatusCode, Value) {
        let mut pairs = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", token),
            ("client_id", CLIENT),
        ];
        if let Some(assertion) = assertion {
            pairs.push(("client_assertion_type", ASSERTION_TYPE));
            pairs.push(("client_assertion", assertion));
        }
        self.post(&pairs).await
    }
}

#[tokio::test]
async fn private_key_jwt_client_exchanges_code_and_refreshes() {
    let env = env(inline());
    let (status, body) = env
        .exchange(&env.code(), Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let refresh_token = body["refresh_token"].as_str().unwrap().to_string();

    let (status, body) = env.refresh(&refresh_token, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert_eq!(body["error"], "invalid_client");

    let (status, body) = env
        .refresh(&refresh_token, Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The rotated refresh token still needs an assertion.
    let rotated = body["refresh_token"].as_str().unwrap();
    let (status, _) = env.refresh(rotated, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = env
        .refresh(rotated, Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn token_endpoint_refuses_bad_assertions() {
    let env = env(inline());
    let mut wrong_aud = claims(env.now);
    wrong_aud["aud"] = json!("https://other.example/.auth/mcp/token");
    let mut expired = claims(env.now);
    expired["exp"] = json!(env.now - 1);
    let replayed = assertion(&claims(env.now));
    let (status, body) = env.exchange(&env.code(), Some(&replayed)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for (name, token) in [
        ("missing", None),
        (
            "wrong signature",
            Some(sign(&rsa(RSA_B), Algorithm::RS256, "rsa", &claims(env.now))),
        ),
        ("wrong aud", Some(assertion(&wrong_aud))),
        ("expired", Some(assertion(&expired))),
        ("replayed", Some(replayed.clone())),
    ] {
        let (status, body) = env.exchange(&env.code(), token.as_deref()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{name}: {body}");
        assert_eq!(body["error"], "invalid_client", "{name}");
    }
}

#[tokio::test]
async fn pkce_still_applies_to_private_key_jwt_clients() {
    let env = env(inline());
    let code = env.code();
    let token = assertion(&claims(env.now));
    let (status, body) = env
        .post(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            (
                "code_verifier",
                "wrong-verifier-0123456789-0123456789-0123456789",
            ),
            ("redirect_uri", REDIRECT),
            ("client_id", CLIENT),
            ("resource", RESOURCE),
            ("client_assertion_type", ASSERTION_TYPE),
            ("client_assertion", &token),
        ])
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"], "invalid_grant");
    // A PKCE failure still uses the code up.
    let (status, body) = env
        .exchange(&code, Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"], "invalid_grant");
}

#[tokio::test]
async fn failed_client_authentication_keeps_the_code() {
    let env = env(inline());
    let code = env.code();
    let mut expired = claims(env.now);
    expired["exp"] = json!(env.now - 1);
    for token in [None, Some(assertion(&expired))] {
        let (status, body) = env.exchange(&code, token.as_deref()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    }
    let (status, body) = env
        .exchange(&code, Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = env
        .exchange(&code, Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"], "invalid_grant");
}

#[tokio::test]
async fn refresh_of_a_revoked_grant_never_checks_the_assertion() {
    let env = env(inline());
    let (status, body) = env
        .exchange(&env.code(), Some(&assertion(&claims(env.now))))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let refresh_token = body["refresh_token"].as_str().unwrap();
    let payload = refresh_token.split('.').nth(1).unwrap();
    let refresh_claims: Value = serde_json::from_slice(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(payload)
            .unwrap(),
    )
    .unwrap();
    env.state
        .grants
        .revoke(refresh_claims["grant"].as_str().unwrap())
        .unwrap();
    let token = assertion(&claims(env.now));
    let (status, body) = env.refresh(refresh_token, Some(&token)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"], "invalid_grant");
    // The assertion's jti was not spent on the dead grant.
    assert_eq!(
        authenticate(
            &env.state.cimd,
            &inline(),
            Credentials {
                assertion_type: Some(ASSERTION_TYPE),
                assertion: Some(&token),
            },
            &audiences(ISSUER),
            env.now,
        )
        .await,
        Ok(())
    );
}

#[tokio::test]
async fn public_cimd_client_refreshes_without_fetching_or_assertion() {
    let public = McpClient::Cimd(Arc::new(ClientMetadata {
        client_id: CLIENT.into(),
        client_name: None,
        logo_uri: None,
        redirect_uris: vec![REDIRECT.into()],
        verified_host: "client.example.test".into(),
        auth: ClientAuth::None,
    }));
    let env = env(public);
    let (status, body) = env
        .exchange(&env.code(), Some("ignored.assertion.value"))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    env.state.cimd.documents.clear();
    let (status, body) = env
        .refresh(body["refresh_token"].as_str().unwrap(), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
