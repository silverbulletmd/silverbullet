use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

#[test]
fn validate_cimd_url_cases() {
    let ok = validate_cimd_url("https://client.example/oauth/meta.json").unwrap();
    assert_eq!(ok.as_str(), "https://client.example/oauth/meta.json");
    for id in [
        "http://client.example/oauth/meta.json",
        "https://client.example",
        "https://client.example/",
        "https://u:p@client.example/m",
        "https://u@client.example/m",
        "https://client.example/m#f",
        "https://client.example/m?x=1",
        "https://client.example/a/../m",
        "https://client.example/a/./m",
        "https://client.example/a/%2e%2e/m",
        "https://10.0.0.5/m",
        "https://[::1]/m",
        "https://127.0.0.1/m",
        "https://CLIENT.example/m",
        "client.example/m",
        "",
    ] {
        let err = validate_cimd_url(id).expect_err(id);
        assert!(
            matches!(
                err,
                OAuthError::InvalidRequest(_) | OAuthError::UnauthorizedClient
            ),
            "{id}: {err:?}"
        );
    }
    assert!(validate_cimd_url("https://1.1.1.1/m").is_ok());
    assert!(validate_cimd_url("http://localhost:1234/m").is_err());
    assert!(validate("http://localhost:1234/m", true).is_ok());
    assert!(validate("http://client.example/m", true).is_err());
}

#[test]
fn max_age_rules() {
    let h = |v: &str| {
        let mut headers = HeaderMap::new();
        headers.insert(header::CACHE_CONTROL, v.parse().unwrap());
        cache_ttl(&headers)
    };
    assert_eq!(cache_ttl(&HeaderMap::new()), Some(DEFAULT_TTL));
    assert_eq!(h("max-age=600"), Some(Duration::from_secs(600)));
    assert_eq!(h("public, max-age=10"), Some(MIN_TTL));
    assert_eq!(h("max-age=999999"), Some(MAX_TTL));
    assert_eq!(h("no-store"), None);
    assert_eq!(h("max-age=600, no-store"), None);
    assert_eq!(h("max-age=bogus"), Some(DEFAULT_TTL));
}

#[test]
fn client_name_is_cleaned() {
    assert_eq!(
        clean_name("  Notes\u{7}  App\n "),
        Some("Notes  App".into())
    );
    assert_eq!(
        clean_name("\u{202E}ppA\u{202C} \u{2066}Notes\u{2069}\u{200B}\u{FEFF}\u{200F}"),
        Some("ppA Notes".into())
    );
    assert_eq!(clean_name(" \t"), None);
    assert_eq!(clean_name(&"x".repeat(150)).unwrap().chars().count(), 100);
}

struct TestServer {
    port: u16,
    hits: Arc<AtomicUsize>,
    m2_hits: Arc<AtomicUsize>,
}

impl TestServer {
    fn url(&self, scheme: &str) -> String {
        format!("{scheme}://localhost:{}/m", self.port)
    }

    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }

    fn m2_hits(&self) -> usize {
        self.m2_hits.load(Ordering::SeqCst)
    }
}

/// Serves `/m` with the response `respond` builds from the document's own
/// URL (so documents can name their `client_id`), and `/m2` with a valid
/// document for `/m`, as a redirect target.
async fn serve<F, R>(respond: F) -> TestServer
where
    F: Fn(String) -> R + Clone + Send + Sync + 'static,
    R: std::future::Future<Output = axum::response::Response> + Send + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let m2_hits = Arc::new(AtomicUsize::new(0));
    let m2_counter = m2_hits.clone();
    let url = format!("http://localhost:{port}/m");
    let m2_url = url.clone();
    let app = Router::new()
        .route(
            "/m",
            get(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                respond(url.clone())
            }),
        )
        .route(
            "/m2",
            get(move || {
                m2_counter.fetch_add(1, Ordering::SeqCst);
                json_ok(m2_url.clone())
            }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    TestServer {
        port,
        hits,
        m2_hits,
    }
}

fn document(url: &str) -> Value {
    serde_json::json!({
        "client_id": url,
        "client_name": "Notes App",
        "redirect_uris": ["http://localhost/callback", "https://client.example/cb"],
        "token_endpoint_auth_method": "none",
    })
}

async fn json_ok(url: String) -> axum::response::Response {
    axum::Json(document(&url)).into_response()
}

#[tokio::test]
async fn fetch_rejects_loopback_by_default() {
    let server = serve(json_ok).await;
    // http is allowed here so that only the resolver stands between the
    // fetch and the loopback server.
    let fetcher = CimdFetcher::build(PublicOnlyResolver::new(), true);
    assert!(fetcher.fetch(&server.url("http")).await.is_err());
    assert_eq!(server.hits(), 0);
    assert!(CimdFetcher::new()
        .fetch(&server.url("https"))
        .await
        .is_err());
    assert_eq!(server.hits(), 0);
}

#[tokio::test]
async fn fetch_parses_document() {
    let server = serve(json_ok).await;
    let url = server.url("http");
    let meta = CimdFetcher::for_tests(true).fetch(&url).await.unwrap();
    assert_eq!(
        *meta,
        ClientMetadata {
            client_id: url,
            client_name: Some("Notes App".into()),
            logo_uri: None,
            redirect_uris: vec![
                "http://localhost/callback".into(),
                "https://client.example/cb".into()
            ],
            verified_host: "localhost".into(),
            auth: ClientAuth::None,
        }
    );
}

#[tokio::test]
async fn fetch_rejects_mismatched_client_id() {
    let server =
        serve(|_| async { axum::Json(document("https://other.example/m")).into_response() }).await;
    assert!(CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .is_err());
    assert_eq!(server.hits(), 1);
}

#[tokio::test]
async fn fetch_rejects_invalid_documents() {
    type Doc = Box<dyn Fn(&str) -> Value + Send + Sync>;
    let cases: Vec<Doc> = vec![
        Box::new(|_| serde_json::json!(["not", "an", "object"])),
        Box::new(|url| serde_json::json!({ "client_id": url, "redirect_uris": [] })),
        Box::new(|url| serde_json::json!({ "client_id": url })),
        Box::new(|url| {
            serde_json::json!({
                "client_id": url,
                "redirect_uris": ["http://client.example/cb"],
            })
        }),
        Box::new(|url| {
            serde_json::json!({
                "client_id": url,
                "redirect_uris": ["https://client.example/cb"],
                "token_endpoint_auth_method": "client_secret_basic",
            })
        }),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        let case = Arc::new(case);
        let server = serve(move |url| {
            let body = case(&url);
            async move { axum::Json(body).into_response() }
        })
        .await;
        assert!(
            CimdFetcher::for_tests(true)
                .fetch(&server.url("http"))
                .await
                .is_err(),
            "case {i}"
        );
    }
}

#[tokio::test]
async fn fetch_keeps_logo_only_on_verified_host() {
    let server = serve(|url| async move {
        let mut doc = document(&url);
        doc["logo_uri"] = "https://localhost/logo.png".into();
        axum::Json(doc).into_response()
    })
    .await;
    let meta = CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .unwrap();
    assert_eq!(meta.logo_uri.as_deref(), Some("https://localhost/logo.png"));

    let server = serve(|url| async move {
        let mut doc = document(&url);
        doc["logo_uri"] = "https://elsewhere.example/logo.png".into();
        axum::Json(doc).into_response()
    })
    .await;
    let meta = CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .unwrap();
    assert_eq!(meta.logo_uri, None);
}

#[tokio::test]
async fn fetch_rejects_oversized_body() {
    let server = serve(|url| async move {
        let mut doc = document(&url);
        doc["padding"] = "x".repeat(70 * 1024).into();
        axum::Json(doc).into_response()
    })
    .await;
    assert!(CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .is_err());
}

#[tokio::test]
async fn fetch_rejects_oversized_chunked_body() {
    let server = serve(|url| async move {
        let head =
            format!(r#"{{"client_id":"{url}","redirect_uris":["http://localhost/cb"],"padding":""#);
        let chunks = std::iter::once(head.into_bytes())
            .chain((0..70).map(|_| vec![b'x'; 1024]))
            .chain(std::iter::once(b"\"}".to_vec()))
            .map(Ok::<_, std::io::Error>);
        axum::body::Body::from_stream(tokio_stream::iter(chunks)).into_response()
    })
    .await;
    let result = CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await;
    assert!(
        matches!(
            result,
            Err(OAuthError::InvalidClientMetadata(
                "client metadata document is too large"
            ))
        ),
        "{result:?}"
    );
}

#[tokio::test]
async fn fetch_does_not_follow_redirects() {
    let server = serve(|url| async move {
        (StatusCode::FOUND, [(header::LOCATION, format!("{url}2"))]).into_response()
    })
    .await;
    assert!(CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .is_err());
    assert_eq!(server.hits(), 1);
    assert_eq!(server.m2_hits(), 0);
}

#[tokio::test]
async fn fetch_times_out() {
    let server = serve(|url| async move {
        tokio::time::sleep(Duration::from_secs(6)).await;
        json_ok(url).await
    })
    .await;
    let started = Instant::now();
    assert!(CimdFetcher::for_tests(true)
        .fetch(&server.url("http"))
        .await
        .is_err());
    assert!(started.elapsed() < Duration::from_millis(5_900));
}

#[tokio::test]
async fn fetch_caches_by_max_age() {
    let server = serve(|url| async move {
        (
            [(header::CACHE_CONTROL, "max-age=600")],
            axum::Json(document(&url)),
        )
            .into_response()
    })
    .await;
    let fetcher = CimdFetcher::for_tests(true);
    fetcher.fetch(&server.url("http")).await.unwrap();
    fetcher.fetch(&server.url("http")).await.unwrap();
    assert_eq!(server.hits(), 1);
}

#[tokio::test]
async fn fetch_no_store_is_not_cached() {
    let server = serve(|url| async move {
        (
            [(header::CACHE_CONTROL, "no-store")],
            axum::Json(document(&url)),
        )
            .into_response()
    })
    .await;
    let fetcher = CimdFetcher::for_tests(true);
    fetcher.fetch(&server.url("http")).await.unwrap();
    fetcher.fetch(&server.url("http")).await.unwrap();
    assert_eq!(server.hits(), 2);
}

#[tokio::test]
async fn failure_is_negatively_cached() {
    let server = serve(|_| async { StatusCode::NOT_FOUND.into_response() }).await;
    let fetcher = CimdFetcher::for_tests(true);
    assert!(fetcher.fetch(&server.url("http")).await.is_err());
    assert!(fetcher.fetch(&server.url("http")).await.is_err());
    assert_eq!(server.hits(), 1);
}

const CHATGPT: &str = r#"{"client_id":"https://chatgpt.com/oauth/client.json","client_uri":"https://chatgpt.com/","redirect_uris":["https://chatgpt.com/connector_platform_oauth_redirect"],"token_endpoint_auth_method":"private_key_jwt","token_endpoint_auth_methods_supported":["none","private_key_jwt"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"client_name":"ChatGPT","logo_uri":"https://persistent.oaistatic.com/sonic/misc/openai-logo.png","token_endpoint_auth_signing_alg":"RS256","jwks_uri":"https://chatgpt.com/oauth/jwks.json"}"#;

#[test]
fn chatgpt_document_parses() {
    let url = Url::parse("https://chatgpt.com/oauth/client.json").unwrap();
    let meta = parse_document(&url, CHATGPT.as_bytes(), false).unwrap();
    assert_eq!(meta.client_name.as_deref(), Some("ChatGPT"));
    assert_eq!(meta.verified_host, "chatgpt.com");
    assert_eq!(
        meta.redirect_uris,
        ["https://chatgpt.com/connector_platform_oauth_redirect"]
    );
    assert_eq!(meta.logo_uri, None);
    assert_eq!(
        meta.auth,
        ClientAuth::PrivateKeyJwt {
            jwks: JwksSource::Uri("https://chatgpt.com/oauth/jwks.json".into()),
            alg: Some(Algorithm::RS256),
        }
    );
    // What the consent page shows.
    let client = super::super::clients::McpClient::Cimd(Arc::new(meta));
    assert_eq!(client.display_name(), "ChatGPT");
    assert_eq!(client.verified_host(), Some("chatgpt.com"));
    assert!(client.uses_private_key_jwt());
}

fn rsa_jwks() -> Value {
    serde_json::json!({"keys": [{
        "kty": "RSA",
        "kid": "k1",
        "n": "sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWp4Dy1WlUzewbgBHod5pcM9H95GQRV3JDXboIRROSBigeC5yjU1hGzHHyXss8UDprecbAYxknTcQkhslANGRUZmdTOQ5qTRsLAt6BTYuyvVRdhS8exSZEy_c4gs_7svlJJQ4H9_NxsiIoLwAEk7-Q3UXERGYw_75IDrGA84-lA_-Ct4eTlXHBIY2EaV7t7LjJaynVJCpkv4LKjTTAumiGUIuQhrNhZLuF_RJLqHpM2kgWFLU7-VTdL1VbC2tejvcI2BlMkEpk1BzBZI0KQB0GaDWFLN-aEAw3vRw",
        "e": "AQAB",
    }]})
}

#[test]
fn private_key_jwt_document_rules() {
    let url = Url::parse("https://client.example/m").unwrap();
    let doc = |extra: Value| {
        let mut doc = serde_json::json!({
            "client_id": "https://client.example/m",
            "redirect_uris": ["https://client.example/cb"],
            "token_endpoint_auth_method": "private_key_jwt",
        });
        for (k, v) in extra.as_object().unwrap() {
            doc[k] = v.clone();
        }
        serde_json::to_vec(&doc).unwrap()
    };
    let meta = parse_document(&url, &doc(serde_json::json!({"jwks": rsa_jwks()})), false).unwrap();
    let ClientAuth::PrivateKeyJwt {
        jwks: JwksSource::Inline(set),
        alg: None,
    } = meta.auth
    else {
        panic!("{:?}", meta.auth)
    };
    assert_eq!(set.keys.len(), 1);
    for alg in ["RS256", "PS256", "ES256"] {
        let body = doc(serde_json::json!({
            "jwks_uri": "https://keys.example/jwks.json",
            "token_endpoint_auth_signing_alg": alg,
        }));
        assert!(parse_document(&url, &body, false).is_ok(), "{alg}");
    }
    for extra in [
        serde_json::json!({}),
        serde_json::json!({"jwks_uri": "http://keys.example/jwks.json"}),
        serde_json::json!({"jwks_uri": "https://10.0.0.1/jwks.json"}),
        serde_json::json!({"jwks_uri": "https://[::1]/jwks.json"}),
        serde_json::json!({"jwks_uri": "https://u:p@keys.example/jwks.json"}),
        serde_json::json!({"jwks_uri": "not a url"}),
        serde_json::json!({"jwks_uri": 5}),
        serde_json::json!({"jwks": {"keys": []}}),
        serde_json::json!({"jwks": "nope"}),
        serde_json::json!({"jwks": rsa_jwks(), "jwks_uri": "https://keys.example/j"}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_signing_alg": "none"}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_signing_alg": "HS256"}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_signing_alg": "RS512"}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_signing_alg": 1}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_method": "client_secret_post"}),
        serde_json::json!({"jwks": rsa_jwks(), "token_endpoint_auth_method": 1}),
    ] {
        assert!(
            matches!(
                parse_document(&url, &doc(extra.clone()), false),
                Err(OAuthError::InvalidClientMetadata(_))
            ),
            "{extra}"
        );
    }
    let none = parse_document(
        &url,
        &doc(serde_json::json!({"token_endpoint_auth_method": "none"})),
        false,
    )
    .unwrap();
    assert_eq!(none.auth, ClientAuth::None);
}

#[tokio::test]
async fn jwks_is_fetched_cached_and_refetched_at_most_once_a_minute() {
    let server = serve(|_| async { axum::Json(rsa_jwks()).into_response() }).await;
    let uri = server.url("http");
    let fetcher = CimdFetcher::for_tests(true);
    let set = fetcher.jwks(&uri, false).await.unwrap();
    assert_eq!(set.keys.len(), 1);
    fetcher.jwks(&uri, false).await.unwrap();
    assert_eq!(server.hits(), 1);
    // An unknown kid asks for a refetch; one was just made, so the cached
    // set stands.
    fetcher.jwks(&uri, true).await.unwrap();
    assert_eq!(server.hits(), 1);
    fetcher.key_sets.backdate(&uri, JWKS_REFETCH_INTERVAL);
    fetcher.jwks(&uri, true).await.unwrap();
    assert_eq!(server.hits(), 2);
}

#[tokio::test]
async fn failed_refetch_keeps_the_last_good_keys() {
    use std::sync::atomic::AtomicBool;
    let down = Arc::new(AtomicBool::new(false));
    let flag = down.clone();
    let server = serve(move |_| {
        let down = flag.load(Ordering::SeqCst);
        async move {
            if down {
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            } else {
                axum::Json(rsa_jwks()).into_response()
            }
        }
    })
    .await;
    let uri = server.url("http");
    let fetcher = CimdFetcher::for_tests(true);
    fetcher.jwks(&uri, false).await.unwrap();
    down.store(true, Ordering::SeqCst);
    fetcher.key_sets.backdate(&uri, JWKS_REFETCH_INTERVAL);
    let kept = fetcher.jwks(&uri, true).await.unwrap();
    assert_eq!(kept.keys.len(), 1);
    assert_eq!(server.hits(), 2);
    // The failed attempt counts towards the refetch limit.
    fetcher.jwks(&uri, true).await.unwrap();
    fetcher.jwks(&uri, false).await.unwrap();
    assert_eq!(server.hits(), 2);
}

#[tokio::test]
async fn jwks_behind_the_ssrf_guard_is_refused() {
    let server = serve(|_| async { axum::Json(rsa_jwks()).into_response() }).await;
    let fetcher = CimdFetcher::build(PublicOnlyResolver::new(), true);
    assert!(fetcher.jwks(&server.url("http"), false).await.is_err());
    assert_eq!(server.hits(), 0);
    let fetcher = CimdFetcher::new();
    for uri in [
        server.url("https"),
        server.url("http"),
        "https://10.0.0.1/jwks.json".to_string(),
        "https://169.254.169.254/jwks.json".to_string(),
    ] {
        assert!(fetcher.jwks(&uri, false).await.is_err(), "{uri}");
    }
    assert_eq!(server.hits(), 0);
}

#[tokio::test]
async fn jwks_failures_and_bad_sets_are_errors() {
    let server = serve(|_| async { StatusCode::NOT_FOUND.into_response() }).await;
    let fetcher = CimdFetcher::for_tests(true);
    assert!(fetcher.jwks(&server.url("http"), false).await.is_err());
    let server =
        serve(|_| async { axum::Json(serde_json::json!({"keys": []})).into_response() }).await;
    assert!(fetcher.jwks(&server.url("http"), false).await.is_err());
    let server = serve(|_| async {
        let mut set = rsa_jwks();
        set["padding"] = "x".repeat(70 * 1024).into();
        axum::Json(set).into_response()
    })
    .await;
    assert!(fetcher.jwks(&server.url("http"), false).await.is_err());
}

#[test]
fn cache_is_capped() {
    let fetcher = CimdFetcher::new();
    let now = Instant::now();
    for i in 0..MAX_CACHE_ENTRIES + 10 {
        fetcher.documents.store(
            format!("https://client.example/{i}"),
            Err(OAuthError::UnauthorizedClient),
            now + Duration::from_secs(i as u64 + 1),
        );
    }
    let cache = fetcher.documents.entries.lock().unwrap();
    assert_eq!(cache.len(), MAX_CACHE_ENTRIES);
    assert!(!cache.contains_key("https://client.example/0"));
}
