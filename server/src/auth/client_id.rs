//! OAuth client identifiers for the per-space flows (`/.auth/authorize`,
//! `/.auth/token`, device). Only SilverBullet's own clients are accepted: the
//! id partitions refresh credentials, is bound to each device attempt and
//! authorization code, and names the client on the consent page. Third-party
//! clients (URL or registered ids) belong to the separate MCP authorization
//! surface and are refused here.

use super::oauth::OAuthError;

/// The desktop app. Its refresh tokens keep the legacy bare `"refresh"` use.
pub const APP: &str = "silverbullet-app";

/// The only client ids the legacy flows accept.
pub const LEGACY_CLIENTS: &[&str] = &["silverbullet-app", "silverbullet-cli", "silverbullet-share"];

/// Names shown on the consent page for SilverBullet's own clients
const KNOWN: &[(&str, &str)] = &[
    (APP, "SilverBullet Desktop"),
    ("silverbullet-cli", "SilverBullet CLI"),
    ("silverbullet-share", "SilverBullet Share"),
];

/// One of `LEGACY_CLIENTS`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientId(String);

impl ClientId {
    pub fn parse(id: &str) -> Result<Self, OAuthError> {
        if LEGACY_CLIENTS.contains(&id) {
            Ok(Self(id.to_string()))
        } else {
            Err(OAuthError::UnauthorizedClient)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The `token_use` claim of this client's refresh tokens: each client has
    /// its own namespace, except the app (see `APP`).
    pub fn refresh_token_use(&self) -> String {
        if self.0 == APP {
            "refresh".to_string()
        } else {
            format!("refresh:{}", self.0)
        }
    }

    /// The display name of one of SilverBullet's own clients
    pub fn display_name(&self) -> Option<&'static str> {
        KNOWN
            .iter()
            .find(|(id, _)| *id == self.0)
            .map(|(_, name)| *name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_only_own_labels() {
        for id in LEGACY_CLIENTS {
            assert_eq!(ClientId::parse(id).unwrap().as_str(), *id);
        }
        for id in ["my.app_1", "https://client.example/meta.json", "sbdcr_00ff"] {
            assert!(
                matches!(ClientId::parse(id), Err(OAuthError::UnauthorizedClient)),
                "{id}"
            );
        }
    }

    #[test]
    fn parse_rejects_junk_as_an_unauthorized_client() {
        for id in ["", &"a".repeat(65), "a b", "a<b"] {
            assert!(
                matches!(ClientId::parse(id), Err(OAuthError::UnauthorizedClient)),
                "{id}"
            );
        }
    }

    #[test]
    fn refresh_token_use_is_namespaced_per_client() {
        let token_use = |id| ClientId::parse(id).unwrap().refresh_token_use();
        assert_eq!(token_use("silverbullet-app"), "refresh");
        assert_eq!(token_use("silverbullet-cli"), "refresh:silverbullet-cli");
        assert_eq!(
            token_use("silverbullet-share"),
            "refresh:silverbullet-share"
        );
    }

    #[test]
    fn only_own_clients_have_a_display_name() {
        let name = |id| ClientId::parse(id).unwrap().display_name();
        assert_eq!(name("silverbullet-cli"), Some("SilverBullet CLI"));
        assert_eq!(name("silverbullet-app"), Some("SilverBullet Desktop"));
        assert_eq!(name("silverbullet-share"), Some("SilverBullet Share"));
    }
}
