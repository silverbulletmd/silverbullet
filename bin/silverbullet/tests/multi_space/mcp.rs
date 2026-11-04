//! The MCP endpoint and its OAuth routes in multi-space mode: off by default, switched by the admin toggle and the `SB_MCP` kill switch.

use super::*;

fn mcp_status(base: &str) -> u16 {
    reqwest::blocking::Client::new()
        .post(format!("{base}/.mcp"))
        .json(&serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "ping"}))
        .send()
        .unwrap()
        .status()
        .as_u16()
}

/// Statuses of the MCP OAuth discovery documents, token and registration
/// endpoints, then of revocation.
fn oauth_statuses(base: &str) -> (Vec<u16>, u16) {
    let client = reqwest::blocking::Client::new();
    let mut statuses = Vec::new();
    for path in [
        "/.well-known/oauth-protected-resource/.mcp",
        "/.well-known/oauth-authorization-server",
    ] {
        statuses.push(
            client
                .get(format!("{base}{path}"))
                .send()
                .unwrap()
                .status()
                .as_u16(),
        );
    }
    statuses.push(
        client
            .post(format!("{base}/.auth/mcp/token"))
            .form(&[("grant_type", "refresh_token")])
            .send()
            .unwrap()
            .status()
            .as_u16(),
    );
    statuses.push(
        client
            .post(format!("{base}/.auth/register"))
            .json(&serde_json::json!({}))
            .send()
            .unwrap()
            .status()
            .as_u16(),
    );
    let revoke = client
        .post(format!("{base}/.auth/revoke"))
        .form(&[("token", "unknown")])
        .send()
        .unwrap()
        .status()
        .as_u16();
    (statuses, revoke)
}

#[test]
fn mcp_is_off_by_default_and_follows_the_admin_toggle_without_restart() {
    let (_srv, _root, base) = start_multi(&[]);
    assert_eq!(mcp_status(&base), 404);
    assert_eq!(oauth_statuses(&base), (vec![404, 404, 404, 404], 200));
    let admin = admin_client(&base);
    let set = |enabled: bool| {
        let resp = admin
            .put(format!("{base}/.dashboard/api/admin/server-config"))
            .json(&serde_json::json!({ "mcp": enabled }))
            .send()
            .unwrap();
        assert!(resp.status().is_success());
        assert_eq!(resp.json::<serde_json::Value>().unwrap()["mcp"], enabled);
    };
    set(true);
    assert_eq!(mcp_status(&base), 401);
    assert_eq!(oauth_statuses(&base), (vec![200, 200, 400, 400], 200));
    set(false);
    assert_eq!(mcp_status(&base), 404);
    assert_eq!(oauth_statuses(&base), (vec![404, 404, 404, 404], 200));
}

#[test]
fn sb_mcp_env_off_wins_over_server_json() {
    let (_srv, _root, base) = start_multi(&[("SB_MCP", "0")]);
    let admin = admin_client(&base);
    let resp = admin
        .put(format!("{base}/.dashboard/api/admin/server-config"))
        .json(&serde_json::json!({ "mcp": true }))
        .send()
        .unwrap();
    assert!(resp.status().is_success());
    assert_eq!(mcp_status(&base), 404);
    assert_eq!(oauth_statuses(&base), (vec![404, 404, 404, 404], 200));
}
