//! OAuth client identifiers. Any well-formed id is accepted: the id only
//! partitions refresh credentials, is bound to each device attempt and
//! authorization code, and names the client on the consent page.

use super::oauth::OAuthError;

/// The desktop app. Its refresh tokens keep the legacy bare `"refresh"` use.
pub const APP: &str = "silverbullet-app";

/// Names shown on the consent page for SilverBullet's own clients
const KNOWN: &[(&str, &str)] = &[
    (APP, "SilverBullet Desktop"),
    ("silverbullet-cli", "SilverBullet CLI"),
];

/// A well-formed client id: 1-64 characters of `[A-Za-z0-9._-]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientId(String);

impl ClientId {
    pub fn parse(id: &str) -> Result<Self, OAuthError> {
        let valid = (1..=64).contains(&id.len())
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if valid {
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
    fn parse_accepts_simple_ids() {
        for id in ["silverbullet-share", "silverbullet-cli", "my.app_1"] {
            assert_eq!(ClientId::parse(id).unwrap().as_str(), id);
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
        assert_eq!(name("silverbullet-share"), None);
    }
}
