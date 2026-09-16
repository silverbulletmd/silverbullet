use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use silverbullet_server::{
    auth::oidc::store::ProviderStore,
    auth::{Authenticator, LockoutTimer, LoginManager},
    handlers::central_auth::{router, CentralAuth},
    multi::{
        access::AnyUserAuth,
        users::{Profile, UserStore},
    },
};
use std::sync::Arc;
use tower::ServiceExt;
#[tokio::test]
async fn provider_configuration_is_admin_only() {
    let dir = tempfile::tempdir().unwrap();
    let users = UserStore::create_empty(dir.path()).unwrap();
    users
        .create_user("owner", "password", true, Profile::default())
        .unwrap();
    let auth = Arc::new(Authenticator::from_secret_bytes(vec![7; 32], "test".into()));
    let login = Arc::new(LoginManager::new(
        auth.clone(),
        Arc::new(AnyUserAuth {
            store: users.clone(),
        }),
        168,
        LockoutTimer::from_config(10, 10),
        String::new(),
    ));
    let app = router(Arc::new(
        CentralAuth::new(
            Arc::new(ProviderStore::open(dir.path()).unwrap()),
            auth,
            users,
            login,
            Box::new(silverbullet_server_common::space::memory::MemorySpacePrimitives::new()),
            Arc::new(|_| None),
        )
        .unwrap(),
    ));
    let config = app
        .clone()
        .oneshot(request(
            "GET",
            "manager.example.com",
            "/.auth/central/public",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(body(config).await["serverName"], "SilverBullet");
    let insecure = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/.auth/central/start?destination=http://192.168.1.20/notes")
                .header("host", "192.168.1.20")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(insecure.status(), StatusCode::FORBIDDEN);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/.dashboard/api/admin/authentication")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

async fn body(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
fn request(
    method: &str,
    host: &str,
    url: &str,
    cookie: &str,
    data: Option<serde_json::Value>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(url)
        .header("host", host)
        .header("x-forwarded-proto", "https")
        .header("cookie", cookie);
    if let Some(data) = data {
        builder = builder
            .header("content-type", "application/json")
            .header("origin", format!("https://{host}"));
        builder.body(Body::from(data.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}
fn cookie_from(response: &axum::response::Response) -> String {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().split(';').next().unwrap())
        .collect::<Vec<_>>()
        .join("; ")
}
#[tokio::test]
async fn local_login_handoff_requires_the_originating_browser_and_revokes_globally() {
    local_handoff(false, "https://notes.test/Page?x=1").await;
    local_handoff(true, "https://notes.test/Page?x=1").await;
}

#[tokio::test]
async fn device_verification_survives_central_login() {
    local_handoff(
        true,
        "https://notes.test/notes/.auth/device?user_code=ABCD-EFGH",
    )
    .await;
}

async fn local_handoff(primary_without_sso: bool, destination: &str) {
    use silverbullet_server::auth::{oidc::config::ProviderConfig, BrowserSessions};
    let dir = tempfile::tempdir().unwrap();
    let users = UserStore::create_empty(dir.path()).unwrap();
    users
        .create_user("morgan", "password", true, Profile::default())
        .unwrap();
    let providers = Arc::new(ProviderStore::open(dir.path()).unwrap());
    if !primary_without_sso {
        let revision = providers
            .save_draft(ProviderConfig {
                provider_id: String::new(),
                issuer: "https://identity.test".into(),
                central_origin: "https://login.sb.test".into(),
                client_id: "client".into(),
                client_secret: "secret".into(),
                workspace_domain: String::new(),
                button_label: "Continue with Pocket ID".into(),
            })
            .unwrap();
        providers.mark_tested(revision).unwrap();
        providers.activate(revision).unwrap();
    }
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
            168,
            LockoutTimer::from_config(10, 10),
            String::new(),
        )
        .with_credential_version(Arc::new(move |u| versions.credential_version(u).unwrap())),
    );
    let app = router(Arc::new(
        CentralAuth::new(
            providers,
            auth.clone(),
            users,
            login,
            Box::new(silverbullet_server_common::space::memory::MemorySpacePrimitives::new()),
            Arc::new(|u| (u.host_str() == Some("notes.test")).then(|| "/".into())),
        )
        .unwrap()
        .with_primary_url(Arc::new(move || {
            primary_without_sso.then(|| "https://login.sb.test".into())
        })),
    ));
    let started = app
        .clone()
        .oneshot(request(
            "GET",
            "notes.test",
            &format!(
                "/.auth/central/start?destination={}",
                percent_encoding::utf8_percent_encode(
                    destination,
                    percent_encoding::NON_ALPHANUMERIC
                )
            ),
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(started.status(), StatusCode::SEE_OTHER);
    let destination_cookie = cookie_from(&started);
    let login_url = started.headers()["location"].to_str().unwrap().to_string();
    let login_url = reqwest::Url::parse(&login_url).unwrap();
    let attempt = login_url
        .query_pairs()
        .find(|(k, _)| k == "attempt")
        .unwrap()
        .1
        .to_string();
    let page = app
        .clone()
        .oneshot(request(
            "GET",
            "login.sb.test",
            &format!("/.auth/central/login?attempt={attempt}"),
            "",
            None,
        ))
        .await
        .unwrap();
    let central_cookie = cookie_from(&page);
    let context = body(
        app.clone()
            .oneshot(request(
                "GET",
                "login.sb.test",
                &format!("/.auth/central/context?attempt={attempt}"),
                &central_cookie,
                None,
            ))
            .await
            .unwrap(),
    )
    .await;
    let signed=app.clone().oneshot(request("POST","login.sb.test","/.auth/central/local",&central_cookie,Some(serde_json::json!({"attempt":attempt,"csrf":context["csrf"],"username":"morgan","password":"password"})))).await.unwrap();
    assert_eq!(signed.status(), StatusCode::OK);
    let central_session = cookie_from(&signed);
    let signed = body(signed).await;
    let return_url = reqwest::Url::parse(signed["redirect"].as_str().unwrap()).unwrap();
    let return_path = format!("{}?{}", return_url.path(), return_url.query().unwrap());
    let returned = app
        .clone()
        .oneshot(request(
            "GET",
            "notes.test",
            &return_path,
            &destination_cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(returned.status(), StatusCode::SEE_OTHER);
    let host_cookie = cookie_from(&returned);
    let resume = returned.headers()["location"]
        .to_str()
        .unwrap()
        .replace("/.auth/central/unlock", "/.auth/central/resume");
    let resumed = body(
        app.clone()
            .oneshot(request("GET", "notes.test", &resume, &host_cookie, None))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(resumed["destination"], destination);
    let duplicate = app
        .clone()
        .oneshot(request(
            "GET",
            "notes.test",
            &return_path,
            &destination_cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::BAD_REQUEST);
    let central_token = central_session
        .split(';')
        .next()
        .unwrap()
        .split_once('=')
        .unwrap()
        .1;
    let host_token = host_cookie
        .split(';')
        .next()
        .unwrap()
        .split_once('=')
        .unwrap()
        .1;
    assert_eq!(
        auth.verify_browser_jwt(central_token).unwrap().session_id,
        auth.verify_browser_jwt(host_token).unwrap().session_id
    );
    auth.revoke_browser_jwt(central_token).unwrap();
    assert!(auth.verify_browser_jwt(host_token).is_err());
}

#[tokio::test]
async fn primary_origin_enables_local_central_login_and_restricts_central_routes() {
    let dir = tempfile::tempdir().unwrap();
    let users = UserStore::create_empty(dir.path()).unwrap();
    let auth = Arc::new(Authenticator::from_secret_bytes(vec![7; 32], "test".into()));
    let login = Arc::new(LoginManager::new(
        auth.clone(),
        Arc::new(AnyUserAuth {
            store: users.clone(),
        }),
        168,
        LockoutTimer::from_config(10, 10),
        String::new(),
    ));
    let app = router(Arc::new(
        CentralAuth::new(
            Arc::new(ProviderStore::open(dir.path()).unwrap()),
            auth,
            users,
            login,
            Box::new(silverbullet_server_common::space::memory::MemorySpacePrimitives::new()),
            Arc::new(|url| (url.host_str() == Some("space.example.com")).then(|| "/".into())),
        )
        .unwrap()
        .with_primary_url(Arc::new(|| Some("https://manager.example.com".into())))
        .with_server_name(Arc::new(|| "Notebook Server".into())),
    ));
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "space.example.com",
            "/.auth/central/public",
            "",
            None,
        ))
        .await
        .unwrap();
    let config = body(response).await;
    assert_eq!(config["primaryUrl"], "https://manager.example.com");
    assert_eq!(config["serverName"], "Notebook Server");
    assert_eq!(
        config["configured"]["centralOrigin"],
        "https://manager.example.com"
    );
    assert!(config["provider"].is_null());
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "space.example.com",
            "/.auth/central/start?destination=https%3A%2F%2Fspace.example.com%2F",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert!(response.headers()["location"]
        .to_str()
        .unwrap()
        .starts_with("https://manager.example.com/.auth/central/login?attempt="));
    for path in [
        "/.auth/central/context",
        "/.auth/central/login",
        "/.dashboard/api/admin/authentication",
    ] {
        let response = app
            .clone()
            .oneshot(request("GET", "space.example.com", path, "", None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
    }
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "manager.example.com",
            "/.auth/central/start?destination=https%3A%2F%2Fmanager.example.com%2Fsecret",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let response = app
        .oneshot(request(
            "GET",
            "manager.example.com",
            "/.auth/central/start?destination=https%3A%2F%2Fmanager.example.com%2F.dashboard",
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
}
