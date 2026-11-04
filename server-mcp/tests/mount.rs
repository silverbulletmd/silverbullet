mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use support::Fixture;
use tower::ServiceExt;

async fn initialize(app: &axum::Router, host: &str, token: &str) -> (StatusCode, Value) {
    let request = Request::post("/.mcp")
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-11-25", "capabilities": {},
                "clientInfo": {"name": "probe", "version": "0"}
            }})
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn mcp_route_wins_over_root_prefix_space() {
    let fixture = Fixture::new();
    fixture.space("Root", "", "none", json!({"writer-one": {"role": "write"}}));
    let app = fixture.app(&fixture.oauth());
    let (token, _) = fixture.grant_caller_for("writer-one", &[], "http://localhost/.mcp");
    let (status, body) = initialize(&app, "localhost", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["result"]["serverInfo"]["name"].is_string(), "{body}");
    assert!(body["result"]["instructions"]
        .as_str()
        .unwrap()
        .contains("`help`"));
}

#[tokio::test]
async fn mcp_404_when_server_config_off() {
    let fixture = Fixture::new();
    fixture.space("Root", "", "none", json!({"writer-one": {"role": "write"}}));
    let app = fixture.app(&fixture.oauth());
    let (token, _) = fixture.grant_caller_for("writer-one", &[], "http://localhost/.mcp");
    fixture
        .manager
        .set_server_config(
            silverbullet_server::multi::server_config::ServerConfigPatch {
                mcp: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        initialize(&app, "localhost", &token).await.0,
        StatusCode::NOT_FOUND
    );
    fixture
        .manager
        .set_server_config(
            silverbullet_server::multi::server_config::ServerConfigPatch {
                mcp: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        initialize(&app, "localhost", &token).await.0,
        StatusCode::OK
    );
}
