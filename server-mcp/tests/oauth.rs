mod support;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Request, StatusCode};
use base64::Engine;
use serde_json::{json, Value};
use silverbullet_server::auth::mcp::clients::{resolve_client, McpClient};
use silverbullet_server::auth::mcp::{McpAccountHost, McpCodeGrant};
use silverbullet_server::auth::oauth::challenge_for;
use silverbullet_server_mcp::{Caller, McpHost};
use support::{mcp_client, post_form, send, Fixture, HOST, RESOURCE};

#[path = "oauth/consent.rs"]
mod consent;

fn caller(fixture: &Fixture, name: &str) -> Caller {
    fixture.caller(name)
}

fn claims(jwt: &str) -> Value {
    let payload = jwt.split('.').nth(1).unwrap();
    serde_json::from_slice(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(payload)
            .unwrap(),
    )
    .unwrap()
}

fn get(path: &str) -> Request<Body> {
    Request::get(path)
        .header("host", HOST)
        .body(Body::empty())
        .unwrap()
}

fn register_request(name: &str) -> Request<Body> {
    Request::post("/.auth/register")
        .header("host", HOST)
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"client_name": name, "redirect_uris": ["https://app.example.test/cb"]})
                .to_string(),
        ))
        .unwrap()
}

/// A space `writer-one` can write to.
fn team(fixture: &Fixture) -> String {
    fixture.space(
        "Team",
        "/team",
        "none",
        json!({"writer-one": {"role": "write"}}),
    )
}

#[tokio::test]
async fn writable_spaces_match_mcp_spaces() {
    let fixture = Fixture::new();
    let solo = team(&fixture);
    let open = fixture.space(
        "Open",
        "/open",
        "write",
        json!({"writer-one": {"role": "write"}}),
    );
    let pair = fixture.space(
        "Pair",
        "/pair",
        "none",
        json!({"writer-one": {"role": "write"}, "runtime-off": {"role": "write"}}),
    );
    let with_admin = fixture.space(
        "Admin",
        "/admin",
        "none",
        json!({"writer-one": {"role": "write"}, "keeper": {"role": "write"}}),
    );
    let readonly = fixture.space(
        "Reading",
        "/reading",
        "none",
        json!({"writer-one": {"role": "read"}, "reader": {"role": "read"}}),
    );
    for user in ["writer-one", "reader", "keeper"] {
        let granted: Vec<String> = fixture
            .host
            .writable_spaces(user)
            .into_iter()
            .map(|s| s.id)
            .collect();
        let listed: Vec<String> = fixture
            .host
            .spaces(&caller(&fixture, user))
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(granted, listed, "{user}");
    }
    let spaces = fixture.host.writable_spaces("writer-one");
    let shared = |id: &str| spaces.iter().find(|s| s.id == id).unwrap().shared;
    assert!(!shared(&solo));
    assert!(!shared(&with_admin));
    assert!(shared(&open));
    assert!(shared(&pair));
    assert!(!spaces.iter().any(|s| s.id == readonly));
    let names: Vec<&str> = spaces.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Admin", "Open", "Pair", "Team"]);
}

#[tokio::test]
async fn signed_in_user_reads_the_server_wide_cookie() {
    let fixture = Fixture::new();
    let mut headers = HeaderMap::new();
    headers.insert("host", HeaderValue::from_static(HOST));
    assert_eq!(fixture.host.signed_in_user(&headers), None);
    headers.insert(
        "cookie",
        HeaderValue::from_str(&fixture.browser_cookie("writer-one")).unwrap(),
    );
    assert_eq!(
        fixture.host.signed_in_user(&headers).as_deref(),
        Some("writer-one")
    );
    fixture.users.set_disabled("writer-one", true).unwrap();
    assert_eq!(fixture.host.signed_in_user(&headers), None);
}

#[tokio::test]
async fn protected_resource_metadata_at_suffix_and_root() {
    let fixture = Fixture::new();
    let app = fixture.app(&fixture.oauth());
    for path in [
        "/.well-known/oauth-protected-resource/.mcp",
        "/.well-known/oauth-protected-resource",
    ] {
        let reply = send(&app, get(path)).await;
        assert_eq!(reply.status, StatusCode::OK, "{path}");
        assert_eq!(reply.body["resource"], RESOURCE);
        assert_eq!(
            reply.body["authorization_servers"],
            json!(["http://notes.example.test"])
        );
        assert_eq!(reply.headers["access-control-allow-origin"], "*");
    }
}

#[tokio::test]
async fn as_metadata_issuer_is_request_origin() {
    let fixture = Fixture::new();
    let app = fixture.app(&fixture.oauth());
    let reply = send(&app, get("/.well-known/oauth-authorization-server")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["issuer"], "http://notes.example.test");
    assert_eq!(
        reply.body["token_endpoint"],
        "http://notes.example.test/.auth/mcp/token"
    );
    assert_eq!(
        reply.body["token_endpoint_auth_methods_supported"],
        json!(["none", "private_key_jwt"])
    );
    assert_eq!(
        reply.body["token_endpoint_auth_signing_alg_values_supported"],
        json!(["RS256", "PS256", "ES256"])
    );
    assert_eq!(reply.headers["access-control-allow-origin"], "*");

    let reply = send(
        &app,
        Request::get("/.well-known/oauth-authorization-server")
            .header("host", "Other.Example.test:443")
            .header("x-forwarded-proto", "https")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(reply.body["issuer"], "https://other.example.test");

    fixture
        .manager
        .set_server_config(
            silverbullet_server::multi::server_config::ServerConfigPatch {
                primary_url: Some("https://public.example.test".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let reply = send(&app, get("/.well-known/oauth-authorization-server")).await;
    assert_eq!(reply.body["issuer"], "https://public.example.test");
}

#[tokio::test]
async fn well_known_and_auth_routes_404_when_mcp_disabled() {
    let fixture = Fixture::new();
    let app = fixture.app(&fixture.oauth());
    let set = |on: bool| {
        fixture
            .manager
            .set_server_config(
                silverbullet_server::multi::server_config::ServerConfigPatch {
                    mcp: Some(on),
                    ..Default::default()
                },
            )
            .unwrap()
    };
    set(false);
    for path in [
        "/.well-known/oauth-protected-resource/.mcp",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/.auth/mcp/authorize",
    ] {
        assert_eq!(
            send(&app, get(path)).await.status,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(
        send(&app, register_request("Off")).await.status,
        StatusCode::NOT_FOUND
    );
    let reply = post_form(&app, "/.auth/mcp/token", &[("grant_type", "refresh_token")]).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);

    set(true);
    assert_eq!(
        send(&app, get("/.well-known/oauth-protected-resource/.mcp"))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, register_request("On")).await.status,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn revoke_still_works_when_disabled() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let tokens = client.connect(&app, &env, "writer-one", &[&space]).await;
    let grant = claims(tokens["access_token"].as_str().unwrap())["grant"]
        .as_str()
        .unwrap()
        .to_string();
    fixture
        .manager
        .set_server_config(
            silverbullet_server::multi::server_config::ServerConfigPatch {
                mcp: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    let reply = post_form(
        &app,
        "/.auth/revoke",
        &[("token", tokens["refresh_token"].as_str().unwrap())],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.headers["access-control-allow-origin"], "*");
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());
}

#[tokio::test]
async fn register_returns_201_and_client_can_be_resolved() {
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let reply = send(&app, register_request("Example App")).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
    assert_eq!(reply.headers["cache-control"], "no-store");
    assert_eq!(reply.headers["access-control-allow-origin"], "*");
    assert_eq!(reply.body["token_endpoint_auth_method"], "none");
    let id = reply.body["client_id"].as_str().unwrap();
    assert!(id.starts_with("sbdcr_"), "{id}");
    let client = resolve_client(id, &env.state.clients, &env.state.cimd)
        .await
        .unwrap();
    assert!(matches!(client, McpClient::Dcr(_)));
    assert_eq!(client.display_name(), "Example App");
    assert_eq!(client.redirect_uris(), ["https://app.example.test/cb"]);

    let reply = send(
        &app,
        Request::post("/.auth/register")
            .header("host", HOST)
            .header("content-type", "application/json")
            .body(Body::from("not json"))
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_client_metadata");
}

#[tokio::test]
async fn register_over_rate_limit_is_429() {
    let fixture = Fixture::new();
    let app = fixture.app(&fixture.oauth());
    for i in 0..20 {
        let reply = send(&app, register_request(&format!("App {i}"))).await;
        assert_eq!(reply.status, StatusCode::CREATED, "{i}");
    }
    let reply = send(&app, register_request("One too many")).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reply.body["error"], "temporarily_unavailable");
}

#[tokio::test]
async fn token_code_exchange_issues_audience_bound_pair() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let unwritable = fixture.space("Other", "/other", "none", json!({}));
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let code = client.code(&env, "writer-one", &[&space, &unwritable, "no-such-space"]);
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.headers["cache-control"], "no-store");
    assert_eq!(reply.headers["access-control-allow-origin"], "*");
    assert_eq!(reply.body["token_type"], "Bearer");
    assert_eq!(reply.body["expires_in"], 3600);
    assert_eq!(reply.body["scope"], "mcp");

    let access_token = reply.body["access_token"].as_str().unwrap();
    let access = claims(access_token);
    assert_eq!(access["aud"], RESOURCE);
    assert_eq!(access["iss"], "http://notes.example.test");
    assert_eq!(access["sub"], "writer-one");
    assert_eq!(access["scope"], "mcp");
    assert_eq!(access["token_use"], "mcp_access");
    assert_eq!(access["client_id"], client.client_id.as_str());
    assert_eq!(access["spaces"], json!([space]));
    assert_eq!(
        access["exp"].as_u64().unwrap() - access["iat"].as_u64().unwrap(),
        3600
    );
    fixture
        .authenticator
        .verify_mcp_access(access_token, RESOURCE)
        .unwrap();
    assert!(fixture.authenticator.verify_jwt(access_token).is_err());

    let refresh = claims(reply.body["refresh_token"].as_str().unwrap());
    assert_eq!(refresh["token_use"], "mcp_refresh");
    assert_eq!(refresh["grant"], access["grant"]);

    let grant = fixture
        .grants
        .get_live(access["grant"].as_str().unwrap(), env.now())
        .unwrap();
    assert_eq!(grant.spaces, [space]);
    assert_eq!(grant.scope, "mcp");
    assert_eq!(grant.resource, RESOURCE);
    assert_eq!(grant.client_name, "Test Client");
    assert_eq!(grant.redirect_host, "localhost");
    assert_eq!(
        grant.credential_version,
        fixture.users.credential_version("writer-one")
    );
}

#[tokio::test]
async fn token_requires_matching_resource() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    for resource in [None, Some("http://other.example.test/.mcp")] {
        let code = client.code(&env, "writer-one", &[&space]);
        let mut pairs = vec![
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("code_verifier", client.verifier.as_str()),
            ("redirect_uri", support::REDIRECT),
            ("client_id", client.client_id.as_str()),
        ];
        if let Some(resource) = resource {
            pairs.push(("resource", resource));
        }
        let reply = post_form(&app, "/.auth/mcp/token", &pairs).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{resource:?}");
        assert_eq!(reply.body["error"], "invalid_target", "{resource:?}");
    }
}

#[tokio::test]
async fn token_rejects_legacy_label() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let code = client.code(&env, "writer-one", &[&space]);
    let pairs = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("code_verifier", client.verifier.as_str()),
        ("redirect_uri", support::REDIRECT),
        ("client_id", "silverbullet-cli"),
        ("resource", RESOURCE),
    ];
    let reply = post_form(&app, "/.auth/mcp/token", &pairs).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "unauthorized_client");

    let reply = send(
        &app,
        Request::post("/.auth/mcp/token")
            .header("host", HOST)
            .header("content-type", "application/x-www-form-urlencoded")
            .header("authorization", "Basic c2lsdmVyYnVsbGV0LWNsaTo=")
            .body(Body::from(support::form(&pairs)))
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.body["error"], "invalid_client");
    assert_eq!(reply.headers["www-authenticate"], "Basic");

    let reply = post_form(
        &app,
        "/.auth/mcp/token",
        &[("grant_type", "password"), ("client_id", &client.client_id)],
    )
    .await;
    assert_eq!(reply.body["error"], "unsupported_grant_type");
}

#[tokio::test]
async fn token_rejects_wrong_verifier_and_reused_code() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let mut client = mcp_client(&app).await;
    let code = client.code(&env, "writer-one", &[&space]);
    let verifier = std::mem::replace(&mut client.verifier, "wrong-verifier".into());
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.body["error"], "invalid_grant");
    client.verifier = verifier;
    let reply = client.exchange(&app, &code).await;
    assert_eq!(
        reply.body["error"], "invalid_grant",
        "a failed code is spent"
    );

    let code = client.code(&env, "writer-one", &[&space]);
    assert_eq!(client.exchange(&app, &code).await.status, StatusCode::OK);
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
}

#[tokio::test]
async fn refresh_rotates_and_reuse_revokes() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let first = client.connect(&app, &env, "writer-one", &[&space]).await;
    let r0 = first["refresh_token"].as_str().unwrap().to_string();
    let grant = claims(&r0)["grant"].as_str().unwrap().to_string();

    let second = client.refresh(&app, &r0).await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.body);
    let r1 = second.body["refresh_token"].as_str().unwrap().to_string();
    assert_ne!(r0, r1);
    assert_eq!(claims(&r1)["gen"], 1);
    let access = claims(second.body["access_token"].as_str().unwrap());
    assert_eq!(access["aud"], RESOURCE);
    assert_eq!(access["spaces"], json!([space]));

    let third = client.refresh(&app, &r1).await;
    assert_eq!(third.status, StatusCode::OK, "{}", third.body);
    let r2 = third.body["refresh_token"].as_str().unwrap().to_string();
    assert_eq!(claims(&r2)["gen"], 2);

    // A retry of the previous generation within the 30 s grace window gets a
    // pair for the current generation and leaves the grant in place.
    env.advance(30);
    let retry = client.refresh(&app, &r1).await;
    assert_eq!(retry.status, StatusCode::OK, "{}", retry.body);
    let retried = retry.body["refresh_token"].as_str().unwrap();
    assert_eq!(claims(retried)["gen"], 2);
    assert_eq!(
        fixture
            .grants
            .get_live(&grant, env.now())
            .unwrap()
            .refresh_gen,
        2
    );

    // Past the window the same replay counts as theft.
    env.advance(1);
    let reply = client.refresh(&app, &r1).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());
    assert_eq!(
        client.refresh(&app, &r2).await.body["error"],
        "invalid_grant"
    );
}

#[tokio::test]
async fn refresh_with_an_older_generation_revokes_at_once() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let first = client.connect(&app, &env, "writer-one", &[&space]).await;
    let r0 = first["refresh_token"].as_str().unwrap().to_string();
    let grant = claims(&r0)["grant"].as_str().unwrap().to_string();
    let r1 = client.refresh(&app, &r0).await.body["refresh_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(client.refresh(&app, &r1).await.status, StatusCode::OK);
    let reply = client.refresh(&app, &r0).await;
    assert_eq!(reply.body["error"], "invalid_grant");
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());
}

#[tokio::test]
async fn refresh_checks_client_and_resource() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let tokens = client.connect(&app, &env, "writer-one", &[&space]).await;
    let refresh = tokens["refresh_token"].as_str().unwrap();
    let other = mcp_client(&app).await;
    let reply = other.refresh(&app, refresh).await;
    assert_eq!(reply.body["error"], "invalid_grant");
    let reply = post_form(
        &app,
        "/.auth/mcp/token",
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
            ("client_id", &client.client_id),
            ("resource", "http://other.example.test/.mcp"),
        ],
    )
    .await;
    assert_eq!(reply.body["error"], "invalid_target");
    // Neither failure used the token up.
    assert_eq!(client.refresh(&app, refresh).await.status, StatusCode::OK);
}

#[tokio::test]
async fn refresh_fails_after_password_change() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let tokens = client.connect(&app, &env, "writer-one", &[&space]).await;
    let refresh = tokens["refresh_token"].as_str().unwrap();
    let grant = claims(refresh)["grant"].as_str().unwrap().to_string();
    fixture
        .users
        .set_password("writer-one", "a-new-fixture-password")
        .unwrap();
    let reply = client.refresh(&app, refresh).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());
}

#[tokio::test]
async fn revoke_kills_refresh_and_access() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;

    let tokens = client.connect(&app, &env, "writer-one", &[&space]).await;
    let access = tokens["access_token"].as_str().unwrap();
    let grant = claims(access)["grant"].as_str().unwrap().to_string();
    let reply = post_form(
        &app,
        "/.auth/revoke",
        &[("token", access), ("token_type_hint", "access_token")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());
    let refresh = tokens["refresh_token"].as_str().unwrap();
    assert_eq!(
        client.refresh(&app, refresh).await.body["error"],
        "invalid_grant"
    );

    let tokens = client.connect(&app, &env, "writer-one", &[&space]).await;
    let refresh = tokens["refresh_token"].as_str().unwrap();
    let grant = claims(refresh)["grant"].as_str().unwrap().to_string();
    let reply = post_form(
        &app,
        "/.auth/revoke",
        &[
            ("token", refresh),
            ("client_id", "sbdcr_00000000000000000000000000000000"),
        ],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(fixture.grants.get_live(&grant, env.now()).is_some());
    let reply = post_form(
        &app,
        "/.auth/revoke",
        &[("token", refresh), ("client_id", &client.client_id)],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(fixture.grants.get_live(&grant, env.now()).is_none());

    let reply = post_form(&app, "/.auth/revoke", &[("token", "garbage")]).await;
    assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn options_preflight_on_token_and_register() {
    let fixture = Fixture::new();
    let app = fixture.app(&fixture.oauth());
    for path in [
        "/.auth/mcp/token",
        "/.auth/register",
        "/.auth/revoke",
        "/.well-known/oauth-authorization-server",
    ] {
        let reply = send(
            &app,
            Request::options(path)
                .header("host", HOST)
                .header("origin", "http://localhost:6274")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert!(reply.status.is_success(), "{path}: {}", reply.status);
        assert_eq!(reply.headers["access-control-allow-origin"], "*", "{path}");
        let methods = reply.headers["access-control-allow-methods"]
            .to_str()
            .unwrap();
        assert!(methods.contains("POST"), "{path}");
    }
}

#[tokio::test]
async fn token_resource_must_match_both_code_and_host() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;

    let code = env.state.codes.issue_at(
        McpCodeGrant {
            username: "writer-one".into(),
            client_id: client.client_id.clone(),
            redirect_uri: support::REDIRECT.into(),
            code_challenge: challenge_for(&client.verifier),
            resource: "http://other.example.test/.mcp".into(),
            spaces: vec![space.clone()],
            credential_version: fixture.users.credential_version("writer-one"),
        },
        env.now(),
    );
    let reply = client.exchange(&app, &code).await;
    assert_eq!(
        reply.body["error"], "invalid_target",
        "code for another resource"
    );

    let code = client.code(&env, "writer-one", &[&space]);
    let pairs = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("code_verifier", client.verifier.as_str()),
        ("redirect_uri", support::REDIRECT),
        ("client_id", client.client_id.as_str()),
        ("resource", RESOURCE),
    ];
    let reply = send(
        &app,
        Request::post("/.auth/mcp/token")
            .header("host", "other.example.test")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from(support::form(&pairs)))
            .unwrap(),
    )
    .await;
    assert_eq!(
        reply.body["error"], "invalid_target",
        "right resource, wrong host"
    );
}

#[tokio::test]
async fn token_refuses_a_code_whose_spaces_all_became_unwritable() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let code = client.code(&env, "reader", &[&space]);
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
    assert!(fixture.grants.list_for_user("reader").is_empty());

    let code = client.code(&env, "reader", &[]);
    assert_eq!(client.exchange(&app, &code).await.status, StatusCode::OK);
}
