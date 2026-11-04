//! The canonical MCP resource URL (RFC 8707) and the discovery documents
//! (RFC 9728, RFC 8414). Each hostname the server answers on is its own
//! resource and issuer, unless a primary URL is configured: then that one
//! origin is used whatever `Host` says, which is what a deployment behind a
//! `Host`-rewriting proxy needs. `X-Forwarded-Host` is never consulted, since a
//! client-settable header must not choose the issuer.

use axum::http::HeaderMap;
use serde_json::{json, Value};

use super::client_auth::SIGNING_ALG_NAMES;
use super::tokens::SCOPE;
use crate::auth::cookie::{is_secure_request, request_host};

/// Lowercase, without a trailing dot on the host and without the scheme's
/// default port, so `NOTES.example.test.:443` over https and
/// `notes.example.test` compare equal.
pub fn normalise_authority(authority: &str, scheme: &str) -> String {
    let authority = authority.trim().to_ascii_lowercase();
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port))
            if port.bytes().all(|b| b.is_ascii_digit())
                && (!host.contains(':') || host.ends_with(']')) =>
        {
            (host, port)
        }
        _ => (authority.as_str(), ""),
    };
    let host = host.strip_suffix('.').unwrap_or(host);
    let default_port = match scheme {
        "http" => "80",
        "https" => "443",
        _ => "",
    };
    if port.is_empty() || port == default_port {
        host.to_string()
    } else {
        format!("{host}:{port}")
    }
}

pub fn canonical_origin(headers: &HeaderMap, primary_url: Option<&str>) -> String {
    if let Some(origin) = primary_url.and_then(primary_origin) {
        return origin;
    }
    let scheme = if is_secure_request(headers) {
        "https"
    } else {
        "http"
    };
    format!(
        "{scheme}://{}",
        normalise_authority(&request_host(headers), scheme)
    )
}

fn primary_origin(primary_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(primary_url).ok()?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host = url.host_str()?;
    let authority = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    Some(format!(
        "{scheme}://{}",
        normalise_authority(&authority, scheme)
    ))
}

pub fn canonical_mcp_url(headers: &HeaderMap, primary_url: Option<&str>) -> String {
    format!("{}/.mcp", canonical_origin(headers, primary_url))
}

pub fn resource_metadata_url(headers: &HeaderMap, primary_url: Option<&str>) -> String {
    format!(
        "{}/.well-known/oauth-protected-resource/.mcp",
        canonical_origin(headers, primary_url)
    )
}

pub fn protected_resource_metadata(
    headers: &HeaderMap,
    primary_url: Option<&str>,
    server_name: &str,
) -> Value {
    let origin = canonical_origin(headers, primary_url);
    json!({
        "resource": format!("{origin}/.mcp"),
        "authorization_servers": [origin],
        "scopes_supported": [SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": server_name,
    })
}

pub fn authorization_server_metadata(headers: &HeaderMap, primary_url: Option<&str>) -> Value {
    let origin = canonical_origin(headers, primary_url);
    json!({
        "issuer": origin,
        "authorization_endpoint": format!("{origin}/.auth/mcp/authorize"),
        "token_endpoint": format!("{origin}/.auth/mcp/token"),
        "registration_endpoint": format!("{origin}/.auth/register"),
        "revocation_endpoint": format!("{origin}/.auth/revoke"),
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "private_key_jwt"],
        "token_endpoint_auth_signing_alg_values_supported": SIGNING_ALG_NAMES,
        "revocation_endpoint_auth_methods_supported": ["none"],
        "client_id_metadata_document_supported": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(host: &'static str, proto: Option<&'static str>) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("host", HeaderValue::from_static(host));
        if let Some(proto) = proto {
            h.insert("x-forwarded-proto", HeaderValue::from_static(proto));
        }
        h
    }

    #[test]
    fn normalise_authority_table() {
        for (authority, scheme, expected) in [
            ("NOTES.Example.test.", "http", "notes.example.test"),
            ("notes.example.test:443", "https", "notes.example.test"),
            ("notes.example.test:443", "http", "notes.example.test:443"),
            ("notes.example.test:80", "http", "notes.example.test"),
            ("notes.example.test.:443", "https", "notes.example.test"),
            ("localhost:3000", "http", "localhost:3000"),
            ("[::1]:80", "http", "[::1]"),
            ("[::1]:3000", "http", "[::1]:3000"),
        ] {
            assert_eq!(
                normalise_authority(authority, scheme),
                expected,
                "{authority} over {scheme}"
            );
        }
    }

    #[test]
    fn canonical_url_normalises_host() {
        for (host, proto, expected) in [
            (
                "NOTES.Example.test.",
                None,
                "http://notes.example.test/.mcp",
            ),
            (
                "notes.example.test:443",
                Some("https"),
                "https://notes.example.test/.mcp",
            ),
            ("localhost:3000", None, "http://localhost:3000/.mcp"),
            ("127.0.0.1:3000", None, "http://127.0.0.1:3000/.mcp"),
        ] {
            assert_eq!(
                canonical_mcp_url(&headers(host, proto), None),
                expected,
                "{host}"
            );
        }
    }

    #[test]
    fn canonical_url_ignores_forwarded_host() {
        let mut h = headers("internal:3000", None);
        h.insert(
            "x-forwarded-host",
            HeaderValue::from_static("notes.example.test"),
        );
        assert_eq!(canonical_origin(&h, None), "http://internal:3000");
    }

    #[test]
    fn canonical_url_prefers_primary_url() {
        let h = headers("internal:3000", None);
        for primary in [
            "https://Notes.Example.test",
            "https://notes.example.test/",
            "https://notes.example.test:443",
        ] {
            assert_eq!(
                canonical_mcp_url(&h, Some(primary)),
                "https://notes.example.test/.mcp",
                "{primary}"
            );
        }
        assert_eq!(
            canonical_origin(&h, Some("http://notes.example.test:8080")),
            "http://notes.example.test:8080"
        );
        assert_eq!(canonical_origin(&h, Some("")), "http://internal:3000");
        assert_eq!(
            canonical_origin(&h, Some("not a url")),
            "http://internal:3000"
        );
    }

    #[test]
    fn resource_metadata_names_resource_and_issuer() {
        let h = headers("notes.example.test", Some("https"));
        assert_eq!(
            resource_metadata_url(&h, None),
            "https://notes.example.test/.well-known/oauth-protected-resource/.mcp"
        );
        assert_eq!(
            protected_resource_metadata(&h, None, "Team Notes"),
            json!({
                "resource": "https://notes.example.test/.mcp",
                "authorization_servers": ["https://notes.example.test"],
                "scopes_supported": ["mcp"],
                "bearer_methods_supported": ["header"],
                "resource_name": "Team Notes",
            })
        );
    }

    #[test]
    fn as_metadata_lists_endpoints_and_flags() {
        let m = authorization_server_metadata(&headers("notes.example.test", None), None);
        let o = "http://notes.example.test";
        assert_eq!(m["issuer"], o);
        assert_eq!(
            m["authorization_endpoint"],
            format!("{o}/.auth/mcp/authorize")
        );
        assert_eq!(m["token_endpoint"], format!("{o}/.auth/mcp/token"));
        assert_eq!(m["registration_endpoint"], format!("{o}/.auth/register"));
        assert_eq!(m["revocation_endpoint"], format!("{o}/.auth/revoke"));
        assert_eq!(m["scopes_supported"], json!(["mcp"]));
        assert_eq!(m["response_types_supported"], json!(["code"]));
        assert_eq!(
            m["grant_types_supported"],
            json!(["authorization_code", "refresh_token"])
        );
        assert_eq!(m["code_challenge_methods_supported"], json!(["S256"]));
        assert_eq!(
            m["token_endpoint_auth_methods_supported"],
            json!(["none", "private_key_jwt"])
        );
        assert_eq!(
            m["token_endpoint_auth_signing_alg_values_supported"],
            json!(["RS256", "PS256", "ES256"])
        );
        assert_eq!(
            m["revocation_endpoint_auth_methods_supported"],
            json!(["none"])
        );
        assert_eq!(m["client_id_metadata_document_supported"], true);
        assert!(m
            .get("authorization_response_iss_parameter_supported")
            .is_none());
        assert!(!m.to_string().contains("device_code"));
    }
}
