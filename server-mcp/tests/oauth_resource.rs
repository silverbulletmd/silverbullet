mod support;

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use silverbullet_server::auth::mcp::grants::{ClientKind, NewGrant};
use silverbullet_server::auth::mcp::McpAccessClaims;
use silverbullet_server::handlers::mcp_oauth;
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server_mcp::{
    mcp_router_gated, Caller, HostError, McpHost, MultiHost, SpaceRequest, Tools,
};
use support::{send, Fixture, Reply, HOST, RESOURCE};

const CHALLENGE: &str = "Bearer resource_metadata=\"http://notes.example.test/.well-known/oauth-protected-resource/.mcp\", scope=\"mcp\"";
const RUNTIME_OFF: &str = "The runtime API is not available for you in this space";

struct Env {
    fixture: Fixture,
    host: Arc<MultiHost>,
    app: Router,
}

/// The main router with `/.mcp` served by the OAuth-aware host.
fn env() -> Env {
    let fixture = Fixture::new();
    let host = Arc::new(
        MultiHost::new(fixture.manager.clone(), fixture.users.clone())
            .with_oauth(fixture.authenticator.clone(), fixture.grants.clone()),
    );
    let oauth = fixture.oauth();
    let tools = Arc::new(Tools::new(host.clone(), "2.12.1"));
    let gate = fixture.manager.clone();
    let enabled: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || gate.mcp_enabled());
    let app = build_main_router(fixture.manager.clone(), None, "fixture".into())
        .merge(mcp_router_gated(tools, host.clone(), enabled.clone()))
        .merge(mcp_oauth::router(oauth.state.clone(), enabled));
    Env { fixture, host, app }
}

fn writable(fixture: &Fixture, name: &str, prefix: &str) -> String {
    fixture.space(
        name,
        prefix,
        "none",
        json!({
            "writer-one": {"role": "write"},
            "runtime-off": {"role": "write", "runtimeApi": false},
        }),
    )
}

impl Env {
    async fn call_on(&self, host: &str, token: &str, tool: &str, args: Value) -> Reply {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        });
        let mut request = Request::post("/.mcp")
            .header("host", host)
            .header("content-type", "application/json");
        if !token.is_empty() {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        send(
            &self.app,
            request.body(Body::from(body.to_string())).unwrap(),
        )
        .await
    }

    async fn call(&self, token: &str, tool: &str, args: Value) -> Reply {
        self.call_on(HOST, token, tool, args).await
    }

    /// The tool's text, after checking the call itself was authorized.
    async fn text(&self, token: &str, tool: &str, args: Value) -> String {
        let reply = self.call(token, tool, args).await;
        assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.headers);
        reply.body["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    /// Space names in `help`'s table.
    async fn help_rows(&self, token: &str) -> Vec<String> {
        let text = self.text(token, "help", json!({})).await;
        table_rows(&text)
    }
}

fn table_rows(text: &str) -> Vec<String> {
    text.lines()
        .filter(|line| {
            line.starts_with("| ") && !line.starts_with("| Space") && !line.starts_with("| ---")
        })
        .map(|line| line.split('|').nth(1).unwrap().trim().to_owned())
        .collect()
}

fn challenge(reply: &Reply) -> &str {
    reply.headers["www-authenticate"].to_str().unwrap()
}

fn assert_invalid_token(reply: &Reply) {
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        challenge(reply),
        format!("{CHALLENGE}, error=\"invalid_token\"")
    );
}

#[tokio::test]
async fn unauthenticated_mcp_gets_resource_metadata_challenge() {
    let env = env();
    let reply = env.call("", "help", json!({})).await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(challenge(&reply), CHALLENGE);
}

#[tokio::test]
async fn api_token_is_rejected_at_mcp() {
    let env = env();
    writable(&env.fixture, "Alpha", "/alpha");
    let token = env.fixture.tokens["writer-one"].clone();
    assert_invalid_token(&env.call(&token, "help", json!({})).await);
}

#[tokio::test]
async fn oauth_token_lists_only_granted_writable_spaces() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    writable(&env.fixture, "Beta", "/beta");
    let gamma = writable(&env.fixture, "Gamma", "/gamma");
    let read_only = env.fixture.space(
        "Delta",
        "/delta",
        "none",
        json!({"writer-one": {"role": "read"}}),
    );
    let (token, _) = env
        .fixture
        .grant_caller("writer-one", &[&alpha, &gamma, &read_only]);
    assert_eq!(env.help_rows(&token).await, ["Alpha", "Gamma"]);
}

#[tokio::test]
async fn name_lookup_ignores_ungranted_spaces() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let beta = writable(&env.fixture, "Beta", "/beta");
    let (narrow, _) = env.fixture.grant_caller("writer-one", &[&alpha]);
    let text = env
        .text(&narrow, "read", json!({"space": "Beta", "page": "index"}))
        .await;
    assert!(text.contains("space \"Beta\" is not available"), "{text}");
    let available = text.split("Available:").nth(1).unwrap();
    assert!(available.contains("Alpha"), "{text}");
    assert!(!available.contains("Beta"), "{text}");
    assert!(!available.contains(&beta), "{text}");

    let (wide, _) = env.fixture.grant_caller("writer-one", &[&alpha, &beta]);
    let text = env
        .text(&wide, "read", json!({"space": "Beta", "page": "index"}))
        .await;
    assert!(text.contains("# Fixture"), "{text}");
}

#[tokio::test]
async fn help_and_pages_refuse_ungranted_space() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let beta = writable(&env.fixture, "Beta", "/beta");
    let (token, caller) = env.fixture.grant_caller("writer-one", &[&alpha]);
    let text = env.text(&token, "help", json!({"space": beta})).await;
    assert!(text.contains("is not available"), "{text}");
    let help = || SpaceRequest {
        method: Method::GET,
        path_and_query: "/.help".into(),
        body: Vec::new(),
        headers: Vec::new(),
    };
    assert!(matches!(
        env.host.request(&caller, &beta, help()).await,
        Err(HostError::NotAvailable(_))
    ));
    let reply = env.host.request(&caller, &alpha, help()).await.unwrap();
    assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn revoked_grant_is_401_on_next_call() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, caller) = env.fixture.grant_caller("writer-one", &[&alpha]);
    assert_eq!(
        env.call(&token, "help", json!({})).await.status,
        StatusCode::OK
    );
    let silverbullet_server_mcp::CallerCredential::Grant { grant_id, .. } = caller.credential
    else {
        unreachable!()
    };
    assert!(env.fixture.grants.revoke(&grant_id).unwrap());
    assert_invalid_token(&env.call(&token, "help", json!({})).await);
}

#[tokio::test]
async fn deleted_user_is_401() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&alpha]);
    assert_eq!(
        env.call(&token, "help", json!({})).await.status,
        StatusCode::OK
    );
    env.fixture.users.delete_user("writer-one").unwrap();
    // Revocation may fail after the user is gone; the stored grant alone must not let the token in.
    assert_eq!(env.fixture.grants.list_all().len(), 1);
    assert_invalid_token(&env.call(&token, "help", json!({})).await);
    env.fixture
        .users
        .create_user("writer-one", "fixture-password", false, Default::default())
        .unwrap();
    assert_invalid_token(&env.call(&token, "help", json!({})).await);
}

#[tokio::test]
async fn password_change_is_401() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&alpha]);
    env.fixture
        .users
        .set_password("writer-one", "another-fixture-password")
        .unwrap();
    assert_invalid_token(&env.call(&token, "help", json!({})).await);
}

#[tokio::test]
async fn grant_without_mcp_scope_is_403() {
    let env = env();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let grant = env
        .fixture
        .grants
        .create(
            NewGrant {
                username: "writer-one".into(),
                client_id: "sbdcr_11111111111111111111111111111111".into(),
                client_name: "Narrow Client".into(),
                client_kind: ClientKind::Dcr,
                verified_host: None,
                redirect_host: "localhost".into(),
                resource: RESOURCE.into(),
                spaces: Vec::new(),
                scope: "profile".into(),
                access: "write".into(),
                credential_version: env.fixture.users.credential_version("writer-one"),
            },
            now,
        )
        .unwrap();
    let token = env
        .fixture
        .authenticator
        .issue_mcp_access(&McpAccessClaims {
            sub: "writer-one".into(),
            aud: RESOURCE.into(),
            iss: "http://notes.example.test".into(),
            iat: now,
            exp: now + 600,
            grant: grant.id,
            client_id: grant.client_id,
            scope: "mcp".into(),
            spaces: Vec::new(),
            token_use: String::new(),
        })
        .unwrap();
    let reply = env.call(&token, "help", json!({})).await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(
        challenge(&reply),
        format!("{CHALLENGE}, error=\"insufficient_scope\"")
    );
}

#[tokio::test]
async fn role_downgrade_drops_space_from_grant() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let beta = writable(&env.fixture, "Beta", "/beta");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&alpha, &beta]);
    assert_eq!(env.help_rows(&token).await, ["Alpha", "Beta"]);

    let mut config = env.fixture.config(&beta);
    config.members = serde_json::from_value(json!({"writer-one": {"role": "read"}})).unwrap();
    env.fixture.manager.update(&beta, config).unwrap();

    assert_eq!(env.help_rows(&token).await, ["Alpha"]);
    let text = env
        .text(&token, "read", json!({"space": beta, "page": "index"}))
        .await;
    assert!(text.contains("is not available"), "{text}");
}

#[tokio::test]
async fn deleted_space_drops_silently() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&alpha]);
    env.fixture.manager.delete(&alpha).unwrap();
    assert!(env.help_rows(&token).await.is_empty());
    let text = env
        .text(&token, "read", json!({"space": alpha, "page": "index"}))
        .await;
    assert!(text.contains("is not available"), "{text}");
}

#[tokio::test]
async fn token_for_other_host_is_401_with_this_hosts_metadata() {
    let env = env();
    let mut ids = Vec::new();
    for (name, host) in [("A", "a.example.test"), ("B", "b.example.test")] {
        let config = serde_json::from_value(json!({
            "name": name, "binding": {"host": host},
            "access": "none", "revisions": "disabled",
            "members": {"writer-one": {"role": "write"}},
        }))
        .unwrap();
        ids.push(env.fixture.manager.create(config, true).unwrap());
    }
    let spaces: Vec<&str> = ids.iter().map(String::as_str).collect();
    let (token, _) =
        env.fixture
            .grant_caller_for("writer-one", &spaces, "http://a.example.test/.mcp");

    let reply = env
        .call_on("a.example.test", &token, "help", json!({}))
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    let reply = env
        .call_on("b.example.test", &token, "help", json!({}))
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        challenge(&reply),
        "Bearer resource_metadata=\"http://b.example.test/.well-known/oauth-protected-resource/.mcp\", scope=\"mcp\", error=\"invalid_token\""
    );
}

#[tokio::test]
async fn legacy_space_jwt_is_rejected_at_mcp() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let legacy = env
        .fixture
        .authenticator
        .issue_token(
            "writer-one",
            env.fixture.users.credential_version("writer-one"),
            None,
            Some(&alpha),
            3600,
        )
        .unwrap();
    assert_invalid_token(&env.call(&legacy, "help", json!({})).await);
}

async fn space_status(env: &Env, method: &str, path: &str, token: &str) -> StatusCode {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", HOST)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from("1 + 1"))
        .unwrap();
    send(&env.app, request).await.status
}

#[tokio::test]
async fn mcp_access_token_is_rejected_at_space_fs_and_runtime() {
    let env = env();
    let team = writable(&env.fixture, "Team", "/team");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&team]);
    assert_eq!(
        space_status(&env, "GET", "/team/.fs/index.md", &token).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        space_status(&env, "POST", "/team/.runtime/lua", &token).await,
        StatusCode::UNAUTHORIZED
    );
}

fn claims(jwt: &str) -> Value {
    use base64::Engine;
    let payload = jwt.split('.').nth(1).unwrap();
    serde_json::from_slice(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(payload)
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn forwarded_request_uses_space_scoped_token() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    writable(&env.fixture, "Beta", "/beta");
    let (token, caller) = env.fixture.grant_caller("writer-one", &[&alpha]);
    let text = env
        .text(&token, "read", json!({"space": alpha, "page": "index"}))
        .await;
    assert!(text.contains("# Fixture"), "{text}");

    // The bearer `request` puts on the forwarded request.
    let forward = env.host.forward_bearer(&caller, &alpha).unwrap();
    assert_eq!(claims(&forward)["space"], alpha.as_str());
    assert_eq!(
        space_status(&env, "GET", "/alpha/.fs/index.md", &forward).await,
        StatusCode::OK
    );
    assert_eq!(
        space_status(&env, "GET", "/beta/.fs/index.md", &forward).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn request_refuses_a_space_the_grant_does_not_cover() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let beta = writable(&env.fixture, "Beta", "/beta");
    let (_, caller) = env.fixture.grant_caller("writer-one", &[&alpha]);
    let get = || SpaceRequest {
        method: Method::GET,
        path_and_query: "/.fs/index.md".into(),
        body: Vec::new(),
        headers: Vec::new(),
    };
    let granted = env.host.request(&caller, &alpha, get()).await.unwrap();
    assert_eq!(granted.status, StatusCode::OK);
    match env.host.request(&caller, &beta, get()).await {
        Err(HostError::NotAvailable(_)) => {}
        Err(other) => panic!("expected NotAvailable, got {other}"),
        Ok(response) => panic!("ungranted space answered {}", response.status),
    }
}

#[tokio::test]
async fn local_caller_gets_no_spaces() {
    let env = env();
    writable(&env.fixture, "Alpha", "/alpha");
    let caller = Caller::local("writer-one");
    assert!(env.host.spaces(&caller).is_empty());
    assert!(!env
        .host
        .spaces(&env.fixture.caller("writer-one"))
        .is_empty());
}

#[tokio::test]
async fn runtime_off_member_with_grant_gets_runtime_error() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, _) = env.fixture.grant_caller("runtime-off", &[&alpha]);
    let text = env
        .text(&token, "lua", json!({"space": alpha, "code": "1"}))
        .await;
    assert!(text.contains(RUNTIME_OFF), "{text}");
}

#[tokio::test]
async fn prefix_bound_space_reachable_through_grant() {
    let env = env();
    let alpha = writable(&env.fixture, "Alpha", "/alpha");
    let (token, _) = env.fixture.grant_caller("writer-one", &[&alpha]);
    let text = env
        .text(&token, "read", json!({"space": "Alpha", "page": "index"}))
        .await;
    assert!(text.contains("# Fixture"), "{text}");
}

#[tokio::test]
async fn root_prefix_space_does_not_swallow_well_known() {
    let env = env();
    let root = writable(&env.fixture, "Root", "");
    let reply = send(
        &env.app,
        Request::get("/.well-known/oauth-protected-resource/.mcp")
            .header("host", HOST)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["resource"], RESOURCE);
    let (token, _) = env.fixture.grant_caller("writer-one", &[&root]);
    let text = env
        .text(&token, "read", json!({"space": "Root", "page": "index"}))
        .await;
    assert!(text.contains("# Fixture"), "{text}");
}
