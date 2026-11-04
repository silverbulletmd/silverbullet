//! The per-space OAuth flows accept only SilverBullet's own clients, and no
//! space surface accepts an audience-bound (MCP) bearer token.

use std::sync::{atomic::AtomicBool, Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use jsonwebtoken::{encode, Algorithm, Header};
use serde_json::json;
use silverbullet_server::{
    auth::Authenticator,
    multi::{
        admin_api::{build_admin_api_router, AdminState},
        config::SpaceConfig,
        instance::{AssetFactories, InstanceAuth, InstanceDeps},
        manager::MultiManager,
        users::{Profile, UserStore},
    },
};
use silverbullet_server_common::space::memory::MemorySpacePrimitives;
use tower::ServiceExt;

const SECRET: [u8; 32] = [19; 32];
const CB: &str = "http://127.0.0.1:51234/cb";

struct Fixture {
    main: Router,
    authenticator: Arc<Authenticator>,
    users: Arc<UserStore>,
    manager: Arc<MultiManager>,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("keeper", "fixture-password", true, Profile::default())
            .unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(
            SECRET.to_vec(),
            "fixture".into(),
        ));
        let deps = InstanceDeps {
            root: dir.path().into(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Arc::new(|_| None),
            runtime_enabled: Arc::new(AtomicBool::new(false)),
            runtime_availability: silverbullet_server::runtime::RuntimeAvailability::Available,
            runtime_idle_timeout: Default::default(),
            default_font: Default::default(),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users: users.clone(),
                authenticator: authenticator.clone(),
                session: Default::default(),
            },
            version: "fixture".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: true,
            index_template: "# Fixture\n".into(),
            shutdown: None,
            search: silverbullet_server::search::SpaceSearch::in_memory(),
        };
        let manager = MultiManager::boot(
            dir.path().into(),
            deps,
            users.usernames().into_iter().collect(),
        )
        .unwrap();
        let config: SpaceConfig = serde_json::from_value(json!({
            "name": "Team", "binding": {"prefix": "/team"},
            "access": "none", "revisions": "disabled",
            "members": {"keeper": {"role": "write"}}
        }))
        .unwrap();
        manager.create(config, false).unwrap();
        let main = silverbullet_server::multi::dispatch::build_main_router(
            manager.clone(),
            Some(Router::new()),
            "fixture".into(),
        );
        Self {
            main,
            authenticator,
            users,
            manager,
            _dir: dir,
        }
    }

    /// Shaped like an MCP access token, signed with the server secret, and
    /// carrying the `username` a space token would.
    fn mcp_bearer(&self) -> String {
        let encoding = jsonwebtoken::EncodingKey::from_secret(&SECRET);
        let exp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 600;
        let token = encode(
            &Header::new(Algorithm::HS256),
            &json!({
                "sub": "keeper",
                "username": "keeper",
                "aud": "https://notes.example.test/.mcp",
                "iss": "https://notes.example.test",
                "scope": "mcp",
                "token_use": "mcp_access",
                "exp": exp,
            }),
            &encoding,
        )
        .unwrap();
        format!("Bearer {token}")
    }
}

async fn send(router: &Router, uri: &str, bearer: Option<&str>) -> Response {
    let mut request = Request::builder().uri(uri).header("host", "localhost:3000");
    if let Some(bearer) = bearer {
        request = request.header("authorization", bearer);
    }
    router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

fn authorize(client_id: &str, redirect: &str) -> String {
    format!(
        "/team/.auth/authorize?client_id={}&response_type=code&redirect_uri={}&state=xyz\
         &code_challenge=abc&code_challenge_method=S256&device_name=Laptop",
        enc(client_id),
        enc(redirect)
    )
}

#[tokio::test]
async fn legacy_authorize_in_a_space_accepts_only_own_clients_and_loopback() {
    let f = Fixture::new();
    // Control: a valid request is not refused (it goes on to sign-in).
    let ok = send(&f.main, &authorize("silverbullet-app", CB), None).await;
    assert_eq!(ok.status(), StatusCode::FOUND);
    for uri in [
        authorize("https://client.example/meta.json", CB),
        authorize("sbdcr_00ff00ff00ff00ff00ff00ff00ff00ff", CB),
        authorize("silverbullet-app", "https://127.0.0.1:51234/cb"),
        authorize("silverbullet-app", "http://localhost:51234/cb"),
    ] {
        let resp = send(&f.main, &uri, None).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{uri}");
        assert!(resp.headers().get("location").is_none(), "{uri}");
    }
}

#[tokio::test]
async fn space_fs_rejects_audience_bound_bearer() {
    let f = Fixture::new();
    let resp = send(&f.main, "/team/.fs/index.md", Some(&f.mcp_bearer())).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_api_rejects_audience_bound_bearer() {
    let f = Fixture::new();
    let admin = build_admin_api_router(Arc::new(AdminState::new(
        f.manager.clone(),
        f.users.clone(),
        f.authenticator.clone(),
        silverbullet_server::runtime::RuntimeAvailability::Available,
    )));
    // Mounted the way the dashboard nests it: the router serves /server-config.
    let token = f.users.create_token("keeper", "fixture-token").unwrap();
    let control = send(&admin, "/server-config", Some(&format!("Bearer {token}"))).await;
    assert_eq!(control.status(), StatusCode::OK);
    let resp = send(&admin, "/server-config", Some(&f.mcp_bearer())).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
