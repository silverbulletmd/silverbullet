//! The consent page (`/.auth/mcp/authorize`).

use super::*;
use silverbullet_server::auth::mcp::grants::MAX_GRANTS_PER_USER;
use support::REDIRECT;

const STATE: &str = "fixture-state-42";

struct Page {
    status: StatusCode,
    location: Option<String>,
    body: String,
}

async fn page(app: &axum::Router, request: Request<Body>) -> Page {
    use tower::ServiceExt;
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let location = response
        .headers()
        .get("location")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    Page {
        status,
        location,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

fn authorize_params(client_id: &str) -> Vec<(String, String)> {
    [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", REDIRECT),
        ("state", STATE),
        (
            "code_challenge",
            &challenge_for("fixture-verifier-0123456789-0123456789-0123456789"),
        ),
        ("code_challenge_method", "S256"),
        ("resource", RESOURCE),
        ("scope", "mcp"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn with(params: &[(String, String)], name: &str, value: Option<&str>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> =
        params.iter().filter(|(k, _)| k != name).cloned().collect();
    if let Some(value) = value {
        out.push((name.into(), value.into()));
    }
    out
}

fn encoded(params: &[(String, String)]) -> String {
    let pairs: Vec<(&str, &str)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    support::form(&pairs)
}

fn authorize_path(params: &[(String, String)]) -> String {
    format!("/.auth/mcp/authorize?{}", encoded(params))
}

async fn consent_get(app: &axum::Router, path: &str, cookie: Option<&str>) -> Page {
    let mut request = Request::get(path).header("host", HOST);
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    page(app, request.body(Body::empty()).unwrap()).await
}

async fn consent_post(
    app: &axum::Router,
    params: &[(String, String)],
    cookie: Option<&str>,
) -> Page {
    let mut request = Request::post("/.auth/mcp/authorize")
        .header("host", HOST)
        .header("content-type", "application/x-www-form-urlencoded");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    page(app, request.body(Body::from(encoded(params))).unwrap()).await
}

fn csrf_from(body: &str) -> String {
    let marker = "name=\"csrf_token\" value=\"";
    let start = body.find(marker).expect("csrf field") + marker.len();
    body[start..start + body[start..].find('"').unwrap()].to_string()
}

fn query_of(location: &str) -> std::collections::HashMap<String, String> {
    let query = location.split_once('?').map(|(_, q)| q).unwrap_or("");
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| {
            (
                k.to_string(),
                percent_encoding::percent_decode_str(v)
                    .decode_utf8()
                    .unwrap()
                    .into_owned(),
            )
        })
        .collect()
}

/// Opens the consent page as `user` and posts `decision` with `spaces`.
async fn decide(
    app: &axum::Router,
    fixture: &Fixture,
    params: &[(String, String)],
    user: &str,
    decision: &str,
    spaces: &[&str],
) -> Page {
    let cookie = fixture.browser_cookie(user);
    let shown = consent_get(app, &authorize_path(params), Some(&cookie)).await;
    assert_eq!(shown.status, StatusCode::OK, "{}", shown.body);
    let mut form = params.to_vec();
    form.push(("csrf_token".into(), csrf_from(&shown.body)));
    form.push(("decision".into(), decision.into()));
    for space in spaces {
        form.push(("space".into(), space.to_string()));
    }
    consent_post(app, &form, Some(&cookie)).await
}

fn set_role(fixture: &Fixture, space: &str, user: &str, role: &str) {
    let mut config = serde_json::to_value(fixture.config(space)).unwrap();
    config["members"][user] = json!({"role": role});
    fixture
        .manager
        .update(space, serde_json::from_value(config).unwrap())
        .unwrap();
}

#[tokio::test]
async fn consent_bad_client_shows_error_without_redirect() {
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let cookie = fixture.browser_cookie("writer-one");
    let client = mcp_client(&app).await;
    let cases = [
        (
            "unknown DCR id",
            authorize_params("sbdcr_00ff00ff00ff00ff00ff00ff00ff00ff"),
        ),
        (
            "metadata document that cannot be fetched",
            authorize_params("https://10.0.0.1/client.json"),
        ),
        ("legacy label", authorize_params("silverbullet-cli")),
        (
            "undeclared https redirect",
            with(
                &authorize_params(&client.client_id),
                "redirect_uri",
                Some("https://evil.example/cb"),
            ),
        ),
        (
            "undeclared loopback path",
            with(
                &authorize_params(&client.client_id),
                "redirect_uri",
                Some("http://localhost:53682/elsewhere"),
            ),
        ),
        (
            "missing redirect",
            with(&authorize_params(&client.client_id), "redirect_uri", None),
        ),
        (
            "missing client",
            with(&authorize_params(&client.client_id), "client_id", None),
        ),
    ];
    for (case, params) in cases {
        let shown = consent_get(&app, &authorize_path(&params), Some(&cookie)).await;
        assert_eq!(shown.status, StatusCode::BAD_REQUEST, "GET {case}");
        assert_eq!(shown.location, None, "GET {case}");
        let posted = consent_post(&app, &params, Some(&cookie)).await;
        assert_eq!(posted.status, StatusCode::BAD_REQUEST, "POST {case}");
        assert_eq!(posted.location, None, "POST {case}");
    }
}

#[tokio::test]
async fn consent_missing_resource_redirects_with_invalid_target() {
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let cookie = fixture.browser_cookie("writer-one");
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let cases = [
        (with(&params, "resource", None), "invalid_target"),
        (
            with(&params, "resource", Some("http://other.example.test/.mcp")),
            "invalid_target",
        ),
        (with(&params, "scope", Some("mcp admin")), "invalid_scope"),
        (
            with(&params, "response_type", Some("token")),
            "invalid_request",
        ),
        (
            with(&params, "code_challenge_method", Some("plain")),
            "invalid_request",
        ),
        (with(&params, "code_challenge", None), "invalid_request"),
    ];
    for (params, error) in cases {
        let shown = consent_get(&app, &authorize_path(&params), Some(&cookie)).await;
        assert_eq!(shown.status, StatusCode::FOUND, "{error}: {}", shown.body);
        let location = shown.location.unwrap();
        assert!(location.starts_with(&format!("{REDIRECT}?")), "{location}");
        let query = query_of(&location);
        assert_eq!(query["error"], error, "{location}");
        assert_eq!(query["state"], STATE);
        assert!(!query.contains_key("iss"));
        assert!(!query.contains_key("code"));
    }
    // Absent scope is the default, not an error.
    let shown = consent_get(
        &app,
        &authorize_path(&with(&params, "scope", None)),
        Some(&cookie),
    )
    .await;
    assert_eq!(shown.status, StatusCode::OK);
}

#[tokio::test]
async fn consent_signed_out_redirects_to_login_with_full_return_url() {
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let next_of = |location: &str| {
        assert!(
            location.starts_with("/.dashboard/login?next="),
            "{location}"
        );
        query_of(location)["next"].clone()
    };
    let path = authorize_path(&authorize_params(&client.client_id));
    let shown = consent_get(&app, &path, None).await;
    assert_eq!(shown.status, StatusCode::FOUND);
    assert_eq!(next_of(&shown.location.unwrap()), path);

    // A metadata-URL client is not fetched for a signed-out browser: this one
    // would fail, yet the user is sent to sign in first.
    let path = authorize_path(&authorize_params("https://10.0.0.1/client.json"));
    let shown = consent_get(&app, &path, None).await;
    assert_eq!(shown.status, StatusCode::FOUND);
    assert_eq!(next_of(&shown.location.unwrap()), path);

    // A session from before a password change no longer counts.
    let cookie = fixture.browser_cookie("writer-one");
    fixture
        .users
        .set_password("writer-one", "a-new-fixture-password")
        .unwrap();
    let path = authorize_path(&authorize_params(&client.client_id));
    let shown = consent_get(&app, &path, Some(&cookie)).await;
    assert_eq!(shown.status, StatusCode::FOUND);
    assert_eq!(next_of(&shown.location.unwrap()), path);
}

#[tokio::test]
async fn consent_lists_only_writable_spaces_marks_shared_and_shows_note() {
    let fixture = Fixture::new();
    let solo = team(&fixture);
    let open = fixture.space(
        "Pair",
        "/pair",
        "none",
        json!({"writer-one": {"role": "write"}, "runtime-off": {"role": "write"}}),
    );
    let readonly = fixture.space(
        "Reading",
        "/reading",
        "none",
        json!({"writer-one": {"role": "read"}, "reader": {"role": "read"}}),
    );
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let path = authorize_path(&authorize_params(&client.client_id));

    let shown = consent_get(&app, &path, Some(&fixture.browser_cookie("writer-one"))).await;
    assert_eq!(shown.status, StatusCode::OK, "{}", shown.body);
    let body = &shown.body;
    assert!(
        body.contains("Test Client wants to use SilverBullet as writer-one"),
        "{body}"
    );
    for space in [&solo, &open] {
        assert!(
            body.contains(&format!(
                "type=\"checkbox\" name=\"space\" value=\"{space}\" checked"
            )),
            "{body}"
        );
    }
    assert!(!body.contains(&readonly));
    assert!(!body.contains("Reading"));
    assert_eq!(body.matches("sb-consent-shared\"").count(), 1);
    let open_row = body.find(&format!("value=\"{open}\"")).unwrap();
    assert!(
        body[open_row..].find("sb-consent-shared").unwrap()
            < body[open_row..].find("</li>").unwrap()
    );
    assert!(body.contains("Pages in shared spaces can steer the app"));
    assert!(body.contains("<code>meta/skill</code>"));
    assert!(!body.contains("manual"));
    assert!(body.contains("/.auth/central/assets/app.css"));
    assert!(!body.contains("/.client/"));

    // Admins see every writable space, pre-ticked, like anyone else.
    let shown = consent_get(&app, &path, Some(&fixture.browser_cookie("keeper"))).await;
    for space in [&solo, &open, &readonly] {
        assert!(
            shown.body.contains(&format!(
                "type=\"checkbox\" name=\"space\" value=\"{space}\" checked"
            )),
            "{space}"
        );
    }

    let shown = consent_get(&app, &path, Some(&fixture.browser_cookie("reader"))).await;
    assert_eq!(shown.status, StatusCode::OK);
    assert!(!shown.body.contains("name=\"space\""));
    assert!(shown.body.contains(
        "You cannot change any space on this server, so the app will have no space to use."
    ));
    assert!(!shown.body.contains("manual"));
}

#[tokio::test]
async fn consent_dcr_shows_redirect_host() {
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let cookie = fixture.browser_cookie("writer-one");
    let client = mcp_client(&app).await;
    let shown = consent_get(
        &app,
        &authorize_path(&authorize_params(&client.client_id)),
        Some(&cookie),
    )
    .await;
    assert!(shown.body.contains("Self-registered app"), "{}", shown.body);
    assert!(shown
        .body
        .contains("It will return to <strong>this computer</strong>"));
    assert!(!shown.body.contains("Verified by"));

    let reply = send(&app, register_request("Hosted App")).await;
    let hosted = reply.body["client_id"].as_str().unwrap();
    let params = with(
        &authorize_params(hosted),
        "redirect_uri",
        Some("https://app.example.test/cb"),
    );
    let shown = consent_get(&app, &authorize_path(&params), Some(&cookie)).await;
    assert_eq!(shown.status, StatusCode::OK, "{}", shown.body);
    assert!(shown.body.contains("Hosted App wants to use SilverBullet"));
    assert!(shown
        .body
        .contains("It will return to <strong>app.example.test</strong>"));
}

#[tokio::test]
async fn consent_cimd_shows_verified_host() {
    use silverbullet_server::auth::mcp::cimd::{ClientAuth, ClientMetadata};
    use silverbullet_server::auth::mcp::consent::ConsentRequest;
    let fixture = Fixture::new();
    let env = fixture.oauth();
    let metadata = ClientMetadata {
        client_id: "https://client.example.test/oauth/client.json".into(),
        client_name: Some("Notes App".into()),
        logo_uri: Some("https://client.example.test/logo.png".into()),
        redirect_uris: vec![REDIRECT.into()],
        verified_host: "client.example.test".into(),
        auth: ClientAuth::None,
    };
    let mut headers = HeaderMap::new();
    headers.insert("host", HeaderValue::from_static(HOST));
    headers.insert(
        "cookie",
        HeaderValue::from_str(&fixture.browser_cookie("writer-one")).unwrap(),
    );
    let request = ConsentRequest {
        client: McpClient::Cimd(std::sync::Arc::new(metadata.clone())),
        redirect_uri: REDIRECT.into(),
        state: Some(STATE.into()),
        code_challenge: challenge_for("fixture-verifier-0123456789-0123456789-0123456789"),
        resource: RESOURCE.into(),
    };
    let response = env
        .state
        .consent
        .on_get(&env.state, &headers, "/.auth/mcp/authorize?x=1", request)
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&body);
    assert!(body.contains("Notes App wants to use SilverBullet as writer-one"));
    assert!(
        body.contains("Verified by <strong>client.example.test</strong>"),
        "{body}"
    );
    // Attribute values are HTML-escaped, `/` included.
    assert!(
        body.contains("<img src=\"https:&#x2f;&#x2f;client.example.test&#x2f;logo.png\""),
        "{body}"
    );
    assert!(!body.contains("Self-registered app"));
}

#[tokio::test]
async fn approve_with_unwritable_space_is_400() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let readonly = fixture.space(
        "Reading",
        "/reading",
        "none",
        json!({"writer-one": {"role": "read"}}),
    );
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    for spaces in [
        vec![readonly.as_str()],
        vec![space.as_str(), "no-such-space"],
    ] {
        let posted = decide(&app, &fixture, &params, "writer-one", "approve", &spaces).await;
        assert_eq!(posted.status, StatusCode::BAD_REQUEST, "{spaces:?}");
        assert_eq!(posted.location, None);
    }

    // The role drops to read between showing the page and approving it.
    let cookie = fixture.browser_cookie("writer-one");
    let shown = consent_get(&app, &authorize_path(&params), Some(&cookie)).await;
    assert!(shown.body.contains(&space));
    set_role(&fixture, &space, "writer-one", "read");
    let mut form = params.clone();
    form.push(("csrf_token".into(), csrf_from(&shown.body)));
    form.push(("decision".into(), "approve".into()));
    form.push(("space".into(), space.clone()));
    let posted = consent_post(&app, &form, Some(&cookie)).await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);
    assert!(fixture.grants.list_for_user("writer-one").is_empty());
}

#[tokio::test]
async fn approve_redirects_with_code_state_and_iss() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let other = fixture.space(
        "Other",
        "/other",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let posted = decide(&app, &fixture, &params, "writer-one", "approve", &[&space]).await;
    assert_eq!(posted.status, StatusCode::FOUND, "{}", posted.body);
    let location = posted.location.unwrap();
    assert!(
        location.starts_with(&format!("{REDIRECT}?code=")),
        "{location}"
    );
    let query = query_of(&location);
    assert_eq!(query["state"], STATE);
    assert!(!query.contains_key("iss"));
    assert!(!query.contains_key("error"));

    let reply = client.exchange(&app, &query["code"]).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let access = claims(reply.body["access_token"].as_str().unwrap());
    assert_eq!(access["spaces"], json!([space]));
    assert_eq!(access["sub"], "writer-one");
    assert!(!access["spaces"].to_string().contains(&other));

    // No state in the request, none in the answer.
    let params = with(&params, "state", None);
    let posted = decide(&app, &fixture, &params, "writer-one", "approve", &[]).await;
    let query = query_of(&posted.location.unwrap());
    assert!(query.contains_key("code"));
    assert!(!query.contains_key("state"));
}

#[tokio::test]
async fn deny_redirects_with_access_denied() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let posted = decide(&app, &fixture, &params, "writer-one", "deny", &[&space]).await;
    assert_eq!(posted.status, StatusCode::FOUND);
    let location = posted.location.unwrap();
    assert!(location.starts_with(&format!("{REDIRECT}?")), "{location}");
    let query = query_of(&location);
    assert_eq!(query["error"], "access_denied");
    assert_eq!(query["state"], STATE);
    assert!(!query.contains_key("iss"));
    assert!(!query.contains_key("code"));
}

#[tokio::test]
async fn approve_requires_csrf() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let cookie = fixture.browser_cookie("writer-one");
    let approve = |csrf: Option<String>| {
        let mut form = params.clone();
        if let Some(csrf) = csrf {
            form.push(("csrf_token".into(), csrf));
        }
        form.push(("decision".into(), "approve".into()));
        form.push(("space".into(), space.clone()));
        form
    };
    let posted = consent_post(&app, &approve(None), Some(&cookie)).await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);

    // A token for another session is not this session's.
    let elsewhere = consent_get(
        &app,
        &authorize_path(&params),
        Some(&fixture.browser_cookie("keeper")),
    )
    .await;
    let posted = consent_post(
        &app,
        &approve(Some(csrf_from(&elsewhere.body))),
        Some(&cookie),
    )
    .await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);

    let shown = consent_get(&app, &authorize_path(&params), Some(&cookie)).await;
    let posted = consent_post(&app, &approve(Some(csrf_from(&shown.body))), None).await;
    assert_eq!(posted.status, StatusCode::UNAUTHORIZED);
    assert_eq!(posted.location, None);

    let mut unknown = approve(Some(csrf_from(&shown.body)));
    unknown.retain(|(k, _)| k != "decision");
    unknown.push(("decision".into(), "maybe".into()));
    let posted = consent_post(&app, &unknown, Some(&cookie)).await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);
    assert!(fixture.grants.list_for_user("writer-one").is_empty());
}

async fn mcp_status(app: &axum::Router, access_token: &str) -> StatusCode {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "help", "arguments": {}},
    });
    send(
        app,
        Request::post("/.mcp")
            .header("host", HOST)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {access_token}"))
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .status
}

#[tokio::test]
async fn reconsent_replaces_the_grant_and_refuses_its_tokens() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let first = client.connect(&app, &env, "writer-one", &[&space]).await;
    let old_access = first["access_token"].as_str().unwrap();
    let old_refresh = first["refresh_token"].as_str().unwrap();
    assert_eq!(mcp_status(&app, old_access).await, StatusCode::OK);

    let params = authorize_params(&client.client_id);
    let posted = decide(&app, &fixture, &params, "writer-one", "approve", &[&space]).await;
    assert_eq!(posted.status, StatusCode::FOUND, "{}", posted.body);
    let query = query_of(&posted.location.unwrap());
    let second = client.exchange(&app, &query["code"]).await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.body);

    let grants = fixture.grants.list_for_user("writer-one");
    assert_eq!(grants.len(), 1);
    let new_access = second.body["access_token"].as_str().unwrap();
    assert_eq!(grants[0].id, claims(new_access)["grant"].as_str().unwrap());
    assert_eq!(mcp_status(&app, old_access).await, StatusCode::UNAUTHORIZED);
    assert_eq!(mcp_status(&app, new_access).await, StatusCode::OK);
    let reply = client.refresh(&app, old_refresh).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
    let new_refresh = second.body["refresh_token"].as_str().unwrap();
    assert_eq!(
        client.refresh(&app, new_refresh).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn consent_past_the_per_user_cap_is_refused() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let existing: Vec<String> = (0..MAX_GRANTS_PER_USER)
        .map(|_| {
            let (token, _) = fixture.grant_caller("writer-one", &[&space]);
            claims(&token)["grant"].as_str().unwrap().to_string()
        })
        .collect();
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let posted = decide(&app, &fixture, &params, "writer-one", "approve", &[&space]).await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);
    assert!(
        posted.body.contains("too many connected apps"),
        "{}",
        posted.body
    );

    // A code that got past consent is refused at the token endpoint too.
    let code = client.code(&env, "writer-one", &[&space]);
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");

    let mut live: Vec<String> = fixture
        .grants
        .list_for_user("writer-one")
        .into_iter()
        .map(|grant| grant.id)
        .collect();
    live.sort();
    let mut expected = existing;
    expected.sort();
    assert_eq!(live, expected);

    // Other users are not affected.
    let posted = decide(&app, &fixture, &params, "keeper", "approve", &[]).await;
    assert_eq!(posted.status, StatusCode::FOUND, "{}", posted.body);
}

#[tokio::test]
async fn approve_refuses_csrf_bound_to_an_empty_session() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    // A consent whose CSRF cookie is not the one sign-in sets binds every
    // user's token to the empty string.
    let env = fixture.oauth_with_session_prefix("/elsewhere");
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let params = authorize_params(&client.client_id);
    let posted = decide(&app, &fixture, &params, "writer-one", "approve", &[&space]).await;
    assert_eq!(posted.status, StatusCode::BAD_REQUEST);
    assert_eq!(posted.location, None);
    assert!(fixture.grants.list_for_user("writer-one").is_empty());
}

#[tokio::test]
async fn code_from_before_a_sign_in_change_is_refused() {
    let fixture = Fixture::new();
    let space = team(&fixture);
    let env = fixture.oauth();
    let app = fixture.app(&env);
    let client = mcp_client(&app).await;
    let code = client.code(&env, "writer-one", &[&space]);
    fixture
        .users
        .set_password("writer-one", "a-new-fixture-password")
        .unwrap();
    let reply = client.exchange(&app, &code).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"], "invalid_grant");
    assert!(fixture.grants.list_for_user("writer-one").is_empty());
}
