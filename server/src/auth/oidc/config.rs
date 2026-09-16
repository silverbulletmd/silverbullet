use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default)]
    pub provider_id: String,
    pub issuer: String,
    pub central_origin: String,
    pub client_id: String,
    pub client_secret: String,
    #[serde(default)]
    pub workspace_domain: String,
    pub button_label: String,
}

impl ProviderConfig {
    pub fn validate(&mut self) -> Result<(), String> {
        self.workspace_domain = self.workspace_domain.trim().to_ascii_lowercase();
        if !self.workspace_domain.is_empty() {
            self.issuer = "https://accounts.google.com".into();
            if self.workspace_domain.contains(['/', '@', ':', ' ']) {
                return Err("Enter your Google Workspace domain".into());
            }
        }
        let central = validated_url(&self.central_origin)?;
        if central.path() != "/" {
            return Err("Central login address must be an origin without a path".into());
        }
        self.central_origin = central.origin().ascii_serialization();
        validated_url(&self.issuer)?;
        if self.client_id.trim().is_empty() || self.client_secret.is_empty() {
            return Err("Client ID and client secret are required".into());
        }
        if self.button_label.trim().is_empty() || self.button_label.len() > 100 {
            return Err("Enter a login button label of at most 100 characters".into());
        }
        Ok(())
    }

    pub fn callback_url(&self) -> String {
        format!("{}/.auth/central/oidc/callback", self.central_origin)
    }

    pub fn public_json(&self) -> serde_json::Value {
        let mut value = serde_json::to_value(self).expect("provider configuration serializes");
        value.as_object_mut().unwrap().remove("clientSecret");
        value["hasClientSecret"] = (!self.client_secret.is_empty()).into();
        value
    }
}

pub fn validated_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Enter a valid HTTPS URL")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use HTTPS without credentials, query parameters, or fragments (HTTP is allowed only on localhost)".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ProviderConfig {
        ProviderConfig {
            provider_id: "pocket".into(),
            issuer: "https://identity.test".into(),
            central_origin: "https://login.sb.test".into(),
            client_id: "client".into(),
            client_secret: "secret".into(),
            workspace_domain: String::new(),
            button_label: "Continue with Pocket ID".into(),
        }
    }
    #[test]
    fn central_address_rejects_userinfo_paths_and_insecure_hosts() {
        for origin in [
            "http://login.sb.test",
            "https://user@login.sb.test",
            "https://login.sb.test/path",
            "https://login.sb.test?x=1",
            "https://login.sb.test/#fragment",
        ] {
            let mut c = config();
            c.central_origin = origin.into();
            assert!(c.validate().is_err(), "{origin}");
        }
    }
    #[test]
    fn workspace_policy_selects_google_and_normalizes_the_domain() {
        let mut c: ProviderConfig = serde_json::from_value(serde_json::json!({
            "issuer": "https://identity.test",
            "centralOrigin": "https://login.sb.test",
            "clientId": "client",
            "clientSecret": "secret",
            "workspaceDomain": "Example.COM",
            "buttonLabel": "Sign in with Google"
        }))
        .unwrap();
        c.validate().unwrap();
        assert_eq!(c.issuer, "https://accounts.google.com");
        assert_eq!(c.workspace_domain, "example.com");
    }
    #[test]
    fn missing_credentials_are_rejected() {
        let mut c = config();
        c.client_secret.clear();
        assert!(c.validate().is_err());
    }
}
