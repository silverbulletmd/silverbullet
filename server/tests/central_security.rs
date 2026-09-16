use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use serde_json::{json, Value};
use silverbullet_server::{
    auth::{
        oidc::{config::ProviderConfig, store::ProviderStore},
        Authenticator, BrowserSessions, LockoutTimer, LoginManager,
    },
    handlers::central_auth::{router, CentralAuth},
    multi::{
        access::AnyUserAuth,
        users::{Profile, UserStore},
    },
};
use silverbullet_server_common::SpacePrimitives;
use std::sync::Arc;
use tower::ServiceExt;

struct Fixture {
    _dir: tempfile::TempDir,
    app: Router,
    users: Arc<UserStore>,
    auth: Arc<Authenticator>,
}
impl Fixture {
    fn new() -> Self {
        Self::with_primary(None)
    }
    fn with_primary(primary: Option<String>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("river", "secret", true, Profile::default())
            .unwrap();
        let providers = Arc::new(ProviderStore::open(dir.path()).unwrap());
        let revision = providers.save_draft(config()).unwrap();
        providers.mark_tested(revision).unwrap();
        providers.activate(revision).unwrap();
        let auth = Arc::new(
            Authenticator::from_secret_bytes(vec![7; 32], "test".into())
                .with_browser_sessions(Arc::new(BrowserSessions::load(dir.path()).unwrap())),
        );
        let versions = users.clone();
        let login = Arc::new(
            LoginManager::new(
                auth.clone(),
                Arc::new(AnyUserAuth {
                    store: users.clone(),
                }),
                30 * 24,
                LockoutTimer::from_config(10, 10),
                String::new(),
            )
            .with_credential_version(Arc::new(move |u| {
                versions.credential_version(u).unwrap_or_default()
            })),
        );
        let bundle = silverbullet_server_common::space::memory::MemorySpacePrimitives::new();
        bundle
            .write_file(
                ".client/central.html",
                b"<!doctype html><title>Sign in</title>",
                None,
            )
            .unwrap();
        let app = router(Arc::new(
            CentralAuth::new(
                providers,
                auth.clone(),
                users.clone(),
                login,
                Box::new(bundle),
                Arc::new(|u| (u.host_str() == Some("notes.test")).then(|| "/".into())),
            )
            .unwrap()
            .with_primary_url(Arc::new(move || primary.clone())),
        ));
        Self {
            _dir: dir,
            app,
            users,
            auth,
        }
    }
    async fn login_handoff(&self, remember: bool) -> (String, String, String) {
        let started = self
            .app
            .clone()
            .oneshot(request(
                "GET",
                "notes.test",
                "/.auth/central/start?destination=https%3A%2F%2Fnotes.test%2FPage",
                "",
                None,
            ))
            .await
            .unwrap();
        assert_eq!(started.status(), StatusCode::SEE_OTHER);
        let cookie = cookies(&started);
        let url = reqwest::Url::parse(started.headers()["location"].to_str().unwrap()).unwrap();
        let attempt = url
            .query_pairs()
            .find(|(k, _)| k == "attempt")
            .unwrap()
            .1
            .to_string();
        let page = self
            .app
            .clone()
            .oneshot(request(
                "GET",
                "login.test",
                &format!("/.auth/central/login?attempt={attempt}"),
                "",
                None,
            ))
            .await
            .unwrap();
        let binding = cookies(&page);
        let ctx = json_body(
            self.app
                .clone()
                .oneshot(request(
                    "GET",
                    "login.test",
                    &format!("/.auth/central/context?attempt={attempt}"),
                    &binding,
                    None,
                ))
                .await
                .unwrap(),
        )
        .await;
        let signed=self.app.clone().oneshot(request("POST","login.test","/.auth/central/local",&binding,Some(json!({"attempt":attempt,"csrf":ctx["csrf"],"username":"river","password":"secret","rememberMe":remember})))).await.unwrap();
        assert_eq!(signed.status(), StatusCode::OK);
        let central = cookies(&signed);
        let body = json_body(signed).await;
        let url = reqwest::Url::parse(body["redirect"].as_str().unwrap()).unwrap();
        (
            format!("{}?{}", url.path(), url.query().unwrap()),
            cookie,
            central,
        )
    }
}
fn config() -> ProviderConfig {
    ProviderConfig {
        provider_id: String::new(),
        issuer: "https://identity.test".into(),
        central_origin: "https://login.test".into(),
        client_id: "client".into(),
        client_secret: "secret".into(),
        workspace_domain: String::new(),
        button_label: "Continue".into(),
    }
}
fn request(
    method: &str,
    host: &str,
    path: &str,
    cookie: &str,
    body: Option<Value>,
) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host)
        .header("x-forwarded-proto", "https")
        .header("cookie", cookie);
    if let Some(body) = body {
        builder
            .header("origin", format!("https://{host}"))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}
fn cookies(response: &Response) -> String {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().split(';').next().unwrap())
        .collect::<Vec<_>>()
        .join("; ")
}
async fn json_body(response: Response) -> Value {
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn handoff_does_not_restore_an_account_revoked_after_login() {
    let f = Fixture::new();
    let (path, cookie, _) = f.login_handoff(false).await;
    f.users.bump_session_epoch("river").unwrap();
    let response = f
        .app
        .oneshot(request("GET", "notes.test", &path, &cookie, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(response.headers().get("set-cookie").is_none());
}
#[tokio::test]
async fn remembered_session_keeps_its_expiry_on_another_hostname() {
    let f = Fixture::new();
    let (path, cookie, central) = f.login_handoff(true).await;
    let original = f
        .auth
        .verify_browser_jwt(
            central
                .split(';')
                .next()
                .unwrap()
                .split_once('=')
                .unwrap()
                .1,
        )
        .unwrap();
    let response = f
        .app
        .oneshot(request("GET", "notes.test", &path, &cookie, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let cookie = cookies(&response);
    let returned = f
        .auth
        .verify_browser_jwt(cookie.split(';').next().unwrap().split_once('=').unwrap().1)
        .unwrap();
    assert_eq!(returned.exp, original.exp);
}

#[test]
fn provider_disable_serializes_with_session_issuance() {
    let dir = tempfile::tempdir().unwrap();
    let providers = Arc::new(ProviderStore::open(dir.path()).unwrap());
    let revision = providers.save_draft(config()).unwrap();
    providers.mark_tested(revision).unwrap();
    providers.activate(revision).unwrap();
    let active = providers.active().unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let signing = providers.clone();
    let issuing = std::thread::spawn(move || {
        signing
            .with_active_config(&active, || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .unwrap()
    });
    entered_rx.recv().unwrap();
    let disabling = providers.clone();
    let (disabled_tx, disabled_rx) = std::sync::mpsc::channel();
    let disable = std::thread::spawn(move || {
        disabling.disable_with_revocation(|_| Ok(())).unwrap();
        disabled_tx.send(()).unwrap();
    });
    let prematurely_disabled = disabled_rx
        .recv_timeout(std::time::Duration::from_millis(200))
        .is_ok();
    release_tx.send(()).unwrap();
    issuing.join().unwrap();
    disable.join().unwrap();
    assert!(
        !prematurely_disabled,
        "provider disable must wait for an in-flight session issuance"
    );
    assert!(providers.active().is_none());
}

#[tokio::test]
async fn a_stolen_test_url_cannot_start_provider_authentication_without_admin_proof() {
    let f = Fixture::new();
    let token = f
        .auth
        .issue_browser_jwt("river", f.users.credential_version("river"), None, 3600)
        .unwrap();
    let admin_cookie = format!("auth_login_test={token}");
    let created = f
        .app
        .clone()
        .oneshot(request(
            "POST",
            "login.test",
            "/.dashboard/api/admin/authentication/test",
            &admin_cookie,
            Some(json!({"revision":1})),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    let created = json_body(created).await;
    let attempt = created["id"].as_str().unwrap();
    let page = f
        .app
        .clone()
        .oneshot(request(
            "GET",
            "login.test",
            &format!("/.auth/central/login?attempt={attempt}"),
            "",
            None,
        ))
        .await
        .unwrap();
    let binding = cookies(&page);
    let context = json_body(
        f.app
            .clone()
            .oneshot(request(
                "GET",
                "login.test",
                &format!("/.auth/central/context?attempt={attempt}"),
                &binding,
                None,
            ))
            .await
            .unwrap(),
    )
    .await;
    let response = f
        .app
        .clone()
        .oneshot(request(
            "POST",
            "login.test",
            "/.auth/central/provider",
            &binding,
            Some(json!({"attempt":attempt,"csrf":context["csrf"]})),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let proof = created["proof"].as_str().unwrap();
    assert!(!created["url"].as_str().unwrap().contains(proof));
    assert!(!context.to_string().contains(proof));
}
#[tokio::test]
async fn central_management_destination_requires_a_path_segment_boundary() {
    let f = Fixture::new();
    let response = f
        .app
        .oneshot(request(
            "GET",
            "login.test",
            "/.auth/central/start?destination=https%3A%2F%2Flogin.test%2F.dashboard-unregistered",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn callback_failures_are_not_cached_and_do_not_leak_referrers() {
    let f = Fixture::new();
    let response = f
        .app
        .oneshot(request(
            "GET",
            "login.test",
            "/.auth/central/oidc/callback?state=invalid&code=one-use-code",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok()),
        Some("no-store")
    );
    assert_eq!(
        response
            .headers()
            .get("referrer-policy")
            .and_then(|v| v.to_str().ok()),
        Some("no-referrer")
    );
}

#[tokio::test]
async fn encrypted_local_login_requires_credentials_even_with_a_central_session() {
    let f = Fixture::new();
    let token = f
        .auth
        .issue_browser_jwt("river", f.users.credential_version("river"), None, 3600)
        .unwrap();
    let cookie = format!("auth_login_test={token}");
    for (encrypt, status) in [(false, StatusCode::SEE_OTHER), (true, StatusCode::OK)] {
        let started=f.app.clone().oneshot(request("GET","notes.test",&format!("/.auth/central/start?destination=https%3A%2F%2Fnotes.test%2FPage&encrypt={encrypt}"),"",None)).await.unwrap();
        let url = reqwest::Url::parse(started.headers()["location"].to_str().unwrap()).unwrap();
        let response = f
            .app
            .clone()
            .oneshot(request(
                "GET",
                "login.test",
                &format!("{}?{}", url.path(), url.query().unwrap()),
                &cookie,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status);
    }
}

#[tokio::test]
async fn callback_errors_show_a_retry_page_without_echoing_provider_input() {
    let f = Fixture::new();
    let response = f
        .app
        .oneshot(request(
            "GET",
            "login.test",
            "/.auth/central/oidc/callback?state=unknown&error=%3Cscript%3Eunsafe%3C%2Fscript%3E",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    let html = String::from_utf8(
        axum::body::to_bytes(response.into_body(), 32 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("Unknown or already completed sign-in"));
    assert!(html.contains("href=\"/.dashboard/login\""));
    assert!(!html.contains("unsafe"));
}

#[tokio::test]
async fn browser_error_escapes_message_html_and_preserves_its_status() {
    let response = silverbullet_server::handlers::central_auth::browser_error(
        StatusCode::FORBIDDEN,
        "<script>alert('unsafe')</script> & context",
    );
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    let html = String::from_utf8(
        axum::body::to_bytes(response.into_body(), 32 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("alert"));
    assert!(html.contains("&amp; context"));
    assert!(!html.contains("<script>"));
    assert!(html.contains("href=\"/.dashboard/login\""));
}

#[tokio::test]
async fn configuration_api_errors_remain_json() {
    let f = Fixture::new();
    let response = f
        .app
        .oneshot(request(
            "GET",
            "login.test",
            "/.dashboard/api/admin/authentication",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers()["content-type"], "application/json");
    assert!(json_body(response).await["error"].is_string());
}

#[tokio::test]
async fn expired_hostname_handoff_shows_the_browser_retry_page() {
    let f = Fixture::new();
    let response = f
        .app
        .oneshot(request(
            "GET",
            "notes.test",
            "/.auth/central/return?attempt=missing&code=expired",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    let html = String::from_utf8(
        axum::body::to_bytes(response.into_body(), 32 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("href=\"/.dashboard/login\""));
}

#[tokio::test]
async fn a_changed_primary_disables_old_provider_callbacks_until_reconfigured() {
    let f = Fixture::with_primary(Some("https://manager.test".into()));
    let response = f
        .app
        .clone()
        .oneshot(request(
            "GET",
            "notes.test",
            "/.auth/central/public",
            "",
            None,
        ))
        .await
        .unwrap();
    let value = json_body(response).await;
    assert_eq!(value["configured"]["centralOrigin"], "https://manager.test");
    assert!(value["provider"].is_null());
    let response = f
        .app
        .oneshot(request(
            "GET",
            "login.test",
            "/.auth/central/oidc/callback?state=old",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn destination_profile_and_logout_reject_cross_origin_requests_and_revoke_session() {
    let f = Fixture::new();
    let (path, cookie, _) = f.login_handoff(false).await;
    let response = f
        .app
        .clone()
        .oneshot(request("GET", "notes.test", &path, &cookie, None))
        .await
        .unwrap();
    let cookie = cookies(&response);
    let response = f
        .app
        .clone()
        .oneshot(request(
            "GET",
            "notes.test",
            "/.auth/central/profile",
            &cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(json_body(response).await["username"], "river");
    for site in ["same-site", "cross-site"] {
        for (method, path) in [
            ("GET", "/.auth/central/profile"),
            ("POST", "/.auth/central/logout"),
        ] {
            let mut req = request(method, "notes.test", path, &cookie, None);
            req.headers_mut()
                .insert("sec-fetch-site", site.parse().unwrap());
            let response = f.app.clone().oneshot(req).await.unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }
    let response = f
        .app
        .clone()
        .oneshot(request(
            "POST",
            "notes.test",
            "/.auth/central/logout",
            &cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    let response = f
        .app
        .oneshot(request(
            "GET",
            "notes.test",
            "/.auth/central/profile",
            &cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
