//! MCP authorization codes and tokens. Access tokens are bound to one
//! resource (`aud`, the canonical `/.mcp` URL) and to a grant; both kinds
//! carry `token_use` so neither can stand in for the other, and `verify_jwt`
//! (space endpoints, admin API) refuses them. They are decoded here with the
//! same server-wide key instead.

use jsonwebtoken::errors::{Error, ErrorKind};
use jsonwebtoken::{decode, encode, Algorithm, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::auth::Authenticator;

pub const ACCESS_TTL_SECS: u64 = 3600;
pub const REFRESH_TTL_SECS: u64 = 90 * 24 * 3600;
pub const SCOPE: &str = "mcp";

const ACCESS_USE: &str = "mcp_access";
const REFRESH_USE: &str = "mcp_refresh";
const FORWARD_TTL_SECS: u64 = 60;

/// What an MCP authorization code stands for, until it is redeemed at the
/// token endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpCodeGrant {
    pub username: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub resource: String,
    pub spaces: Vec<String>,
    /// The user's credential version at consent; the code is refused once
    /// it changes (password, sign out everywhere, disabling).
    pub credential_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpAccessClaims {
    pub sub: String,
    pub aud: String,
    pub iss: String,
    pub iat: u64,
    pub exp: u64,
    pub grant: String,
    pub client_id: String,
    pub scope: String,
    pub spaces: Vec<String>,
    pub token_use: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpRefreshClaims {
    pub sub: String,
    pub grant: String,
    pub gen: u64,
    pub client_id: String,
    pub exp: u64,
    pub token_use: String,
    /// Issued to a `private_key_jwt` client, so refreshing it takes a client
    /// assertion; a public client's refresh never fetches its document.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub private_key_jwt: bool,
}

impl Authenticator {
    pub fn issue_mcp_access(&self, c: &McpAccessClaims) -> Result<String, Error> {
        let claims = McpAccessClaims {
            token_use: ACCESS_USE.into(),
            ..c.clone()
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &self.hs256_keys().0,
        )
    }

    pub fn verify_mcp_access(&self, token: &str, audience: &str) -> Result<McpAccessClaims, Error> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[audience]);
        validation.set_required_spec_claims(&["exp", "aud", "sub"]);
        let claims = decode::<McpAccessClaims>(token, &self.hs256_keys().1, &validation)?.claims;
        if claims.token_use != ACCESS_USE || !claims.scope.split(' ').any(|s| s == SCOPE) {
            return Err(ErrorKind::InvalidToken.into());
        }
        Ok(claims)
    }

    pub fn issue_mcp_refresh(&self, c: &McpRefreshClaims) -> Result<String, Error> {
        let claims = McpRefreshClaims {
            token_use: REFRESH_USE.into(),
            ..c.clone()
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &self.hs256_keys().0,
        )
    }

    pub fn verify_mcp_refresh(&self, token: &str) -> Result<McpRefreshClaims, Error> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_aud = false;
        validation.set_required_spec_claims(&["exp", "sub"]);
        let claims = decode::<McpRefreshClaims>(token, &self.hs256_keys().1, &validation)?.claims;
        if claims.token_use != REFRESH_USE {
            return Err(ErrorKind::InvalidToken.into());
        }
        Ok(claims)
    }

    /// What an MCP request carries on to a space router: a legacy-shaped token
    /// that `JwtAuthorizer` accepts only for this one space, briefly.
    pub fn issue_space_forward_token(
        &self,
        username: &str,
        credential_version: Option<String>,
        space: &str,
    ) -> Result<String, Error> {
        self.issue_token(
            username,
            credential_version,
            None,
            Some(space),
            FORWARD_TTL_SECS,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::oauth::{CodeStore, CODE_TTL_SECS};
    use crate::auth::OAuthError;
    use std::time::{SystemTime, UNIX_EPOCH};

    const AUD: &str = "http://notes.example.test/.mcp";

    fn auth() -> Authenticator {
        Authenticator::from_secret_bytes(vec![7; 32], String::new())
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn access() -> McpAccessClaims {
        McpAccessClaims {
            sub: "alice".into(),
            aud: AUD.into(),
            iss: "http://notes.example.test".into(),
            iat: now(),
            exp: now() + ACCESS_TTL_SECS,
            grant: "g1".into(),
            client_id: "https://client.example/meta.json".into(),
            scope: SCOPE.into(),
            spaces: vec!["s1".into()],
            token_use: "mcp_access".into(),
        }
    }

    fn refresh() -> McpRefreshClaims {
        McpRefreshClaims {
            sub: "alice".into(),
            grant: "g1".into(),
            gen: 3,
            client_id: "https://client.example/meta.json".into(),
            exp: now() + REFRESH_TTL_SECS,
            token_use: "mcp_refresh".into(),
            private_key_jwt: false,
        }
    }

    fn code_grant() -> McpCodeGrant {
        McpCodeGrant {
            username: "alice".into(),
            client_id: "sbdcr_00112233445566778899aabbccddeeff".into(),
            redirect_uri: "http://localhost:53682/callback".into(),
            code_challenge: crate::auth::oauth::challenge_for("verifier"),
            resource: AUD.into(),
            spaces: vec!["s1".into()],
            credential_version: Some("v1".into()),
        }
    }

    #[test]
    fn code_store_single_use_and_ttl() {
        let store = CodeStore::<McpCodeGrant>::new();
        let code = store.issue_at(code_grant(), 1_000);
        assert_eq!(store.take_at(&code, 1_010).unwrap(), code_grant());
        assert!(store.take_at(&code, 1_010).is_err());

        let code = store.issue_at(code_grant(), 1_000);
        assert_eq!(
            store.take_at(&code, 1_000 + CODE_TTL_SECS + 1),
            Err(OAuthError::InvalidGrant("code expired"))
        );
        assert!(store.take_at(&code, 1_000).is_err());
        assert!(store.take_at("unknown", 1_000).is_err());
    }

    #[test]
    fn mcp_access_round_trip_and_audience_check() {
        let a = auth();
        let token = a.issue_mcp_access(&access()).unwrap();
        assert_eq!(a.verify_mcp_access(&token, AUD).unwrap(), access());
        assert!(a
            .verify_mcp_access(&token, "http://other.example.test/.mcp")
            .is_err());
        assert!(Authenticator::from_secret_bytes(vec![8; 32], String::new())
            .verify_mcp_access(&token, AUD)
            .is_err());

        let legacy = a.issue_token("alice", None, None, None, 3600).unwrap();
        assert!(a.verify_mcp_access(&legacy, AUD).is_err());
        let refresh = a.issue_mcp_refresh(&refresh()).unwrap();
        assert!(a.verify_mcp_access(&refresh, AUD).is_err());

        let expired = a
            .issue_mcp_access(&McpAccessClaims {
                exp: now() - 3600,
                ..access()
            })
            .unwrap();
        assert!(a.verify_mcp_access(&expired, AUD).is_err());
        let other_scope = a
            .issue_mcp_access(&McpAccessClaims {
                scope: "profile".into(),
                ..access()
            })
            .unwrap();
        assert!(a.verify_mcp_access(&other_scope, AUD).is_err());
    }

    #[test]
    fn mcp_token_use_is_set_by_the_issuer() {
        let a = auth();
        let token = a
            .issue_mcp_access(&McpAccessClaims {
                token_use: "mcp_refresh".into(),
                ..access()
            })
            .unwrap();
        assert_eq!(
            a.verify_mcp_access(&token, AUD).unwrap().token_use,
            "mcp_access"
        );
    }

    #[test]
    fn mcp_refresh_round_trip_and_kind_check() {
        let a = auth();
        let token = a.issue_mcp_refresh(&refresh()).unwrap();
        assert_eq!(a.verify_mcp_refresh(&token).unwrap(), refresh());
        let access = a.issue_mcp_access(&access()).unwrap();
        assert!(a.verify_mcp_refresh(&access).is_err());
        let legacy = a.issue_token("alice", None, None, None, 3600).unwrap();
        assert!(a.verify_mcp_refresh(&legacy).is_err());
        let expired = a
            .issue_mcp_refresh(&McpRefreshClaims {
                exp: now() - 3600,
                ..refresh()
            })
            .unwrap();
        assert!(a.verify_mcp_refresh(&expired).is_err());
    }

    #[test]
    fn refresh_records_private_key_jwt_and_defaults_to_public() {
        let a = auth();
        let bound = McpRefreshClaims {
            private_key_jwt: true,
            ..refresh()
        };
        let token = a.issue_mcp_refresh(&bound).unwrap();
        assert!(a.verify_mcp_refresh(&token).unwrap().private_key_jwt);
        let public = a.issue_mcp_refresh(&refresh()).unwrap();
        let payload = public.split('.').nth(1).unwrap();
        assert!(!String::from_utf8(
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload)
                .unwrap()
        )
        .unwrap()
        .contains("private_key_jwt"));
        assert!(!a.verify_mcp_refresh(&public).unwrap().private_key_jwt);
    }

    #[test]
    fn forward_token_is_space_scoped_and_short() {
        let a = auth();
        let token = a
            .issue_space_forward_token("alice", Some("v1".into()), "space-1")
            .unwrap();
        let claims = a.verify_jwt(&token).unwrap();
        assert_eq!(claims.username, "alice");
        assert_eq!(claims.credential_version.as_deref(), Some("v1"));
        assert_eq!(claims.space.as_deref(), Some("space-1"));
        assert!(claims.token_use.is_none());
        assert!(claims.exp as u64 - now() <= 60);
    }
}
