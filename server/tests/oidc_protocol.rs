use axum::{
    extract::{Form, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use openidconnect::{core::CoreRsaPrivateSigningKey, JsonWebKeyId, PrivateSigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use silverbullet_server::auth::oidc::{
    client::{begin, finish},
    config::ProviderConfig,
};
use std::sync::{Arc, Mutex};

const KEY: &str = include_str!("fixtures/oidc-test-key.pem");
const ROTATED_KEY: &str = include_str!("fixtures/oidc-test-rotated-key.pem");
struct Provider {
    issuer: String,
    claims: Mutex<Value>,
    userinfo: Mutex<Value>,
    challenge: Mutex<String>,
    post_auth: bool,
    token_mode: Mutex<String>,
    bad_signature: std::sync::atomic::AtomicBool,
    oversized_metadata: std::sync::atomic::AtomicBool,
}
struct Fixture {
    provider: Arc<Provider>,
    config: ProviderConfig,
    http: reqwest::Client,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new(post_auth: bool) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("http://{}", listener.local_addr().unwrap());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let provider = Arc::new(Provider {
            issuer: issuer.clone(),
            claims: Mutex::new(json!({
                "iss": issuer, "sub":"subject-river", "aud":"test-client", "iat":now, "exp":now+300,
                "nonce":"nonce", "email":"river@example.test", "email_verified":true, "name":"River Example", "hd":"example.test"
            })),
            userinfo: Mutex::new(
                json!({"sub":"subject-river","email":"river@example.test","email_verified":true}),
            ),
            challenge: Mutex::new(String::new()),
            post_auth,
            token_mode: Mutex::new(String::new()),
            bad_signature: std::sync::atomic::AtomicBool::new(false),
            oversized_metadata: std::sync::atomic::AtomicBool::new(false),
        });
        let app = Router::new()
            .route("/.well-known/openid-configuration", get(metadata))
            .route("/jwks", get(jwks))
            .route("/token", post(token))
            .route("/userinfo", get(userinfo))
            .with_state(provider.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let config = ProviderConfig {
            provider_id: "work".into(),
            issuer,
            central_origin: "https://login.example.test".into(),
            client_id: "test-client".into(),
            client_secret: "test-secret".into(),
            workspace_domain: String::new(),
            button_label: "Continue".into(),
        };
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        Self {
            provider,
            config,
            http,
            task,
        }
    }
    async fn authorize(&self) -> silverbullet_server::auth::oidc::client::Authorization {
        let auth = begin(&self.config, &self.http).await.unwrap();
        let url = reqwest::Url::parse(&auth.url).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(params["code_challenge_method"], "S256");
        assert_eq!(
            params["redirect_uri"],
            "https://login.example.test/.auth/central/oidc/callback"
        );
        assert!(params["scope"].split(' ').any(|s| s == "openid"));
        assert!(params["scope"].split(' ').any(|s| s == "email"));
        assert_eq!(params["nonce"], auth.nonce);
        assert_eq!(params["state"], auth.state);
        assert!(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(&auth.state)
                .unwrap()
                .len()
                >= 16
        );
        *self.provider.challenge.lock().unwrap() = params["code_challenge"].clone();
        self.provider.claims.lock().unwrap()["nonce"] = auth.nonce.clone().into();
        auth
    }
}
async fn metadata(State(p): State<Arc<Provider>>) -> Json<Value> {
    let mut document = json!({"issuer":p.issuer,"authorization_endpoint":format!("{}/authorize",p.issuer),"token_endpoint":format!("{}/token",p.issuer),"jwks_uri":format!("{}/jwks",p.issuer),"userinfo_endpoint":format!("{}/userinfo",p.issuer),"response_types_supported":["code"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"],"token_endpoint_auth_methods_supported":[if p.post_auth {"client_secret_post"} else {"client_secret_basic"}]});
    if p.oversized_metadata
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        document["padding"] = "x".repeat(1024 * 1024 + 1).into();
    }
    if p.token_mode.lock().unwrap().as_str() == "discovery-mismatch" {
        document["issuer"] = "https://different.example".into();
    }
    Json(document)
}
async fn jwks(State(p): State<Arc<Provider>>) -> Json<Value> {
    let key_data = if p.token_mode.lock().unwrap().as_str() == "rotate" {
        ROTATED_KEY
    } else {
        KEY
    };
    let key =
        CoreRsaPrivateSigningKey::from_pem(key_data, Some(JsonWebKeyId::new("fixture".into())))
            .unwrap();
    Json(json!({"keys":[key.as_verification_key()]}))
}
async fn token(
    State(p): State<Arc<Provider>>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let mode = p.token_mode.lock().unwrap().clone();
    if mode == "failure" {
        return Err(StatusCode::BAD_GATEWAY);
    }
    if mode == "missing-id-token" {
        return Ok(Json(
            json!({"access_token":"fixture-access","token_type":"Bearer"}),
        ));
    }
    let valid_auth = if p.post_auth {
        form.get("client_secret").map(String::as_str) == Some("test-secret")
    } else {
        headers.get("authorization").and_then(|v| v.to_str().ok())
            == Some("Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=")
    };
    let verifier = form.get("code_verifier").ok_or(StatusCode::BAD_REQUEST)?;
    let challenge =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier));
    if !valid_auth
        || challenge != *p.challenge.lock().unwrap()
        || form.get("code").map(String::as_str) != Some("valid-code")
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some("fixture".into());
    let mut jwt = jsonwebtoken::encode(
        &header,
        &*p.claims.lock().unwrap(),
        &jsonwebtoken::EncodingKey::from_rsa_pem(if mode == "rotate" {
            ROTATED_KEY.as_bytes()
        } else {
            KEY.as_bytes()
        })
        .unwrap(),
    )
    .unwrap();
    if p.bad_signature.load(std::sync::atomic::Ordering::Relaxed) {
        let start = jwt.rfind('.').unwrap() + 1;
        let replacement = if &jwt[start..start + 1] == "A" {
            "B"
        } else {
            "A"
        };
        jwt.replace_range(start..start + 1, replacement);
    }
    Ok(Json(
        json!({"access_token":"fixture-access", "token_type":"Bearer", "id_token":jwt}),
    ))
}
async fn userinfo(State(p): State<Arc<Provider>>) -> Json<Value> {
    Json(p.userinfo.lock().unwrap().clone())
}

#[tokio::test]
async fn validates_signed_identity_with_basic_and_post_client_authentication() {
    for post in [false, true] {
        let fixture = Fixture::new(post).await;
        let auth = fixture.authorize().await;
        let identity = finish(
            &fixture.config,
            &fixture.http,
            "valid-code",
            &auth.nonce,
            &auth.verifier,
        )
        .await
        .unwrap();
        assert_eq!(identity.subject, "subject-river");
        assert_eq!(identity.email.as_deref(), Some("river@example.test"));
        assert!(identity.email_verified);
        assert_eq!(identity.hosted_domain.as_deref(), Some("example.test"));
    }
}
#[tokio::test]
async fn rejects_invalid_issuer_audience_expiry_nonce_and_access_token_hash() {
    for (field, value) in [
        ("iss", json!("https://wrong.example")),
        ("aud", json!("another-client")),
        ("exp", json!(1)),
        ("nonce", json!("wrong-nonce")),
        ("at_hash", json!("substituted-access-token")),
    ] {
        let fixture = Fixture::new(false).await;
        let auth = fixture.authorize().await;
        fixture.provider.claims.lock().unwrap()[field] = value;
        assert!(
            finish(
                &fixture.config,
                &fixture.http,
                "valid-code",
                &auth.nonce,
                &auth.verifier
            )
            .await
            .is_err(),
            "{field}"
        );
    }
}
#[tokio::test]
async fn accepts_additional_audiences_authorized_for_the_client() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    {
        let mut claims = fixture.provider.claims.lock().unwrap();
        claims["aud"] = json!(["test-client", "project-123"]);
        claims["azp"] = json!("test-client");
    }
    let identity = finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier,
    )
    .await
    .unwrap();
    assert_eq!(identity.subject, "subject-river");
}
#[tokio::test]
async fn rejects_additional_audiences_without_matching_authorized_party() {
    for azp in [None, Some("other")] {
        let fixture = Fixture::new(false).await;
        let auth = fixture.authorize().await;
        {
            let mut claims = fixture.provider.claims.lock().unwrap();
            claims["aud"] = json!(["test-client", "other"]);
            if let Some(azp) = azp {
                claims["azp"] = azp.into();
            }
        }
        assert!(
            finish(
                &fixture.config,
                &fixture.http,
                "valid-code",
                &auth.nonce,
                &auth.verifier
            )
            .await
            .is_err(),
            "{azp:?}"
        );
    }
}
#[tokio::test]
async fn refuses_unverified_email_and_uses_verified_hosted_domain_for_google() {
    let mut fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    fixture.provider.claims.lock().unwrap()["email_verified"] = false.into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_err());
    fixture.provider.claims.lock().unwrap()["email_verified"] = true.into();
    fixture.config.workspace_domain = "other.test".into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_err());
    fixture.config.workspace_domain = "example.test".into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_ok());
}

#[tokio::test]
async fn only_google_workspace_authorization_includes_the_hosted_domain_hint() {
    let mut fixture = Fixture::new(false).await;
    let generic = begin(&fixture.config, &fixture.http).await.unwrap();
    let generic_url = reqwest::Url::parse(&generic.url).unwrap();
    assert!(generic_url.query_pairs().all(|(key, _)| key != "hd"));

    fixture.config.workspace_domain = "example.test".into();
    let workspace = begin(&fixture.config, &fixture.http).await.unwrap();
    let workspace_url = reqwest::Url::parse(&workspace.url).unwrap();
    assert_eq!(
        workspace_url
            .query_pairs()
            .find(|(key, _)| key == "hd")
            .map(|(_, value)| value.into_owned()),
        Some("example.test".into())
    );
}

#[tokio::test]
async fn userinfo_email_fallback_requires_matching_subject() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    fixture
        .provider
        .claims
        .lock()
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("email");
    let identity = finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier,
    )
    .await
    .unwrap();
    assert_eq!(identity.email.as_deref(), Some("river@example.test"));
    fixture.provider.userinfo.lock().unwrap()["sub"] = "another-subject".into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_err());
}
#[tokio::test]
async fn wrong_pkce_verifier_cannot_exchange_code() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        "different-verifier"
    )
    .await
    .is_err());
}

#[tokio::test]
async fn rejects_a_token_with_a_forged_signature() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    fixture
        .provider
        .bad_signature
        .store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_err());
}
#[tokio::test]
async fn validates_the_access_token_hash_when_present() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    let digest = Sha256::digest(b"fixture-access");
    fixture.provider.claims.lock().unwrap()["at_hash"] =
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(&digest[..16])
            .into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_ok());
}
#[tokio::test]
async fn oversized_provider_responses_are_rejected() {
    let fixture = Fixture::new(false).await;
    fixture
        .provider
        .oversized_metadata
        .store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(begin(&fixture.config, &fixture.http).await.is_err());
}

#[tokio::test]
async fn rejects_missing_id_token_and_token_endpoint_failure() {
    for mode in ["missing-id-token", "failure"] {
        let fixture = Fixture::new(false).await;
        let auth = fixture.authorize().await;
        *fixture.provider.token_mode.lock().unwrap() = mode.into();
        assert!(
            finish(
                &fixture.config,
                &fixture.http,
                "valid-code",
                &auth.nonce,
                &auth.verifier
            )
            .await
            .is_err(),
            "{mode}"
        );
    }
}
#[tokio::test]
async fn fetches_current_signing_keys_after_provider_rotation() {
    let fixture = Fixture::new(false).await;
    let auth = fixture.authorize().await;
    *fixture.provider.token_mode.lock().unwrap() = "rotate".into();
    assert!(finish(
        &fixture.config,
        &fixture.http,
        "valid-code",
        &auth.nonce,
        &auth.verifier
    )
    .await
    .is_ok());
}
#[tokio::test]
async fn rejects_a_different_discovered_issuer() {
    let fixture = Fixture::new(false).await;
    *fixture.provider.token_mode.lock().unwrap() = "discovery-mismatch".into();
    assert!(begin(&fixture.config, &fixture.http).await.is_err());
}
