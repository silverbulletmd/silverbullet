mod support;

use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use serde_json::json;
use silverbullet_server_mcp::{
    AuthFailure, Authenticate, Caller, HostError, McpHost, SpaceRequest, SpaceResponse,
};
use support::Fixture;

fn caller(fixture: &Fixture, name: &str) -> Caller {
    fixture.caller(name)
}

fn get(path: &str) -> SpaceRequest {
    SpaceRequest {
        method: Method::GET,
        path_and_query: path.into(),
        body: Vec::new(),
        headers: Vec::new(),
    }
}

fn names(fixture: &Fixture, user: &str) -> Vec<String> {
    fixture
        .host
        .spaces(&caller(fixture, user))
        .into_iter()
        .map(|space| space.name)
        .collect()
}

fn bearer(value: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("authorization", HeaderValue::from_str(value).unwrap());
    headers
}

#[test]
fn authenticate_rejects_user_api_tokens() {
    let fixture = Fixture::new();
    let api_token = bearer(&format!("Bearer {}", fixture.tokens["writer-one"]));
    assert_eq!(
        fixture.host.authenticate(&api_token),
        Err(AuthFailure::InvalidToken)
    );

    assert_eq!(
        fixture.host.authenticate(&HeaderMap::new()),
        Err(AuthFailure::Missing)
    );
    assert_eq!(
        fixture.host.authenticate(&bearer("Bearer nope")),
        Err(AuthFailure::InvalidToken)
    );
    assert_eq!(
        fixture.host.authenticate(&bearer("Bearer ")),
        Err(AuthFailure::Missing)
    );
    assert!(fixture
        .host
        .authenticate(&bearer(&fixture.tokens["writer-one"]))
        .is_err());
}

#[tokio::test]
async fn spaces_lists_only_writable() {
    let fixture = Fixture::new();
    fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    fixture.space(
        "Beta",
        "/beta",
        "none",
        json!({"writer-one": {"role": "read"}}),
    );
    fixture.space("Gamma", "/gamma", "read", json!({}));
    assert_eq!(names(&fixture, "writer-one"), ["Alpha"]);
    assert_eq!(names(&fixture, "reader"), Vec::<String>::new());
    assert_eq!(names(&fixture, "keeper"), ["Alpha", "Beta", "Gamma"]);
}

#[tokio::test]
async fn request_forwards_with_bearer() {
    let fixture = Fixture::new();
    let id = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let response = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, get("/.fs/index.md"))
        .await
        .unwrap();
    assert_eq!(response.status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&response.body).contains("# Fixture"));
}

#[tokio::test]
async fn request_to_read_only_space_is_not_available() {
    let fixture = Fixture::new();
    let public = fixture.space("Gamma", "/gamma", "read", json!({}));
    let member = fixture.space(
        "Beta",
        "/beta",
        "none",
        json!({"writer-one": {"role": "read"}}),
    );
    for id in [public, member, "missing".into()] {
        let result = fixture
            .host
            .request(&caller(&fixture, "writer-one"), &id, get("/.fs/index.md"))
            .await;
        assert!(matches!(result, Err(HostError::NotAvailable(_))), "{id}");
    }
}

#[tokio::test]
async fn role_downgrade_takes_effect_next_call() {
    let fixture = Fixture::new();
    let id = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let user = caller(&fixture, "writer-one");
    assert!(fixture
        .host
        .request(&user, &id, get("/.fs/index.md"))
        .await
        .is_ok());

    let mut config = fixture.config(&id);
    config.members = serde_json::from_value(json!({"writer-one": {"role": "read"}})).unwrap();
    fixture.manager.update(&id, config).unwrap();
    let result = fixture.host.request(&user, &id, get("/.fs/index.md")).await;
    assert!(matches!(result, Err(HostError::NotAvailable(_))));
}

#[tokio::test]
async fn runtime_off_member_gets_403_from_runtime_route() {
    let fixture = Fixture::new();
    let id = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({
            "writer-one": {"role": "write"},
            "runtime-off": {"role": "write", "runtimeApi": false}
        }),
    );
    let post = || SpaceRequest {
        method: Method::POST,
        path_and_query: "/.runtime/lua".into(),
        body: b"1 + 1".to_vec(),
        headers: Vec::new(),
    };
    let denied: SpaceResponse = fixture
        .host
        .request(&caller(&fixture, "runtime-off"), &id, post())
        .await
        .unwrap();
    assert_eq!(denied.status, StatusCode::FORBIDDEN);
    let allowed = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, post())
        .await
        .unwrap();
    assert_eq!(allowed.status, StatusCode::OK);
    let info = fixture.host.spaces(&caller(&fixture, "runtime-off"));
    assert!(!info[0].runtime);
}

#[test]
fn authenticate_rejects_disabled_user_and_revoked_grant() {
    let fixture = Fixture::new();
    let header = |name: &str| {
        let (token, _) = fixture.grant_caller(name, &[]);
        let mut headers = bearer(&format!("Bearer {token}"));
        headers.insert("host", HeaderValue::from_static(support::HOST));
        headers
    };
    let reader = header("reader");
    let writer = header("writer-one");
    let keeper = header("keeper");
    fixture.users.set_disabled("reader", true).unwrap();
    assert!(fixture.host.authenticate(&reader).is_err());
    for grant in fixture.grants.list_for_user("writer-one") {
        fixture.grants.revoke(&grant.id).unwrap();
    }
    assert!(fixture.host.authenticate(&writer).is_err());
    assert!(fixture.host.authenticate(&keeper).is_ok());
}

#[tokio::test]
async fn cookie_and_forwarded_headers_do_not_change_identity() {
    let fixture = Fixture::new();
    let id = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let mut request = get("/.fs/index.md");
    request.headers = vec![
        (
            HeaderName::from_static("cookie"),
            "auth_localhost=forged".into(),
        ),
        (
            HeaderName::from_static("x-forwarded-host"),
            "evil.example".into(),
        ),
        (
            HeaderName::from_static("x-forwarded-for"),
            "203.0.113.9".into(),
        ),
    ];
    let response = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, request)
        .await
        .unwrap();
    assert_eq!(response.status, StatusCode::OK);
}

#[tokio::test]
async fn host_bound_space_is_reachable() {
    let fixture = Fixture::new();
    let config = serde_json::from_value(json!({
        "name": "Hosted", "binding": {"host": "hosted.example.test"},
        "access": "none", "revisions": "disabled",
        "members": {"writer-one": {"role": "write"}},
    }))
    .unwrap();
    let id = fixture.manager.create(config, true).unwrap();
    let response = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, get("/.fs/index.md"))
        .await
        .unwrap();
    assert_eq!(response.status, StatusCode::OK);
}

#[tokio::test]
async fn invalid_request_is_unavailable_not_not_available() {
    let fixture = Fixture::new();
    let id = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let mut bad_path = get("/.fs/a b\n");
    bad_path.path_and_query = "/.fs/a b\n".into();
    let result = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, bad_path)
        .await;
    assert!(matches!(result, Err(HostError::Unavailable(m)) if m.starts_with("invalid request")));
    let mut bad_header = get("/.fs/index.md");
    bad_header
        .headers
        .push((HeaderName::from_static("accept"), "a\nb".into()));
    let result = fixture
        .host
        .request(&caller(&fixture, "writer-one"), &id, bad_header)
        .await;
    assert!(matches!(result, Err(HostError::Unavailable(m)) if m.starts_with("invalid request")));
}

#[tokio::test]
async fn runtime_flag_reflects_member_opt_out() {
    let fixture = Fixture::new();
    fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({
            "writer-one": {"role": "write"},
            "runtime-off": {"role": "write", "runtimeApi": false}
        }),
    );
    assert!(fixture.host.spaces(&caller(&fixture, "writer-one"))[0].runtime);
    assert!(!fixture.host.spaces(&caller(&fixture, "runtime-off"))[0].runtime);
}
