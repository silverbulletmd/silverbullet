use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::config::MultiConfig;
use super::validate::FieldError;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub primary_url: Option<String>,
    #[serde(default = "default_server_name")]
    pub server_name: String,
    #[serde(default = "default_runtime_api")]
    pub runtime_api: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn default_runtime_api() -> bool {
    true
}

pub fn default_server_name() -> String {
    "SilverBullet".into()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            primary_url: None,
            server_name: default_server_name(),
            runtime_api: true,
            extra: BTreeMap::new(),
        }
    }
}

impl ServerConfig {
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(value) => serde_json::from_str(&value)
                .map_err(|error| format!("invalid server.json: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(format!("could not read {}: {error}", path.display())),
        }
    }

    pub fn validate(&mut self, _spaces: &MultiConfig) -> Result<(), Vec<FieldError>> {
        self.server_name = self.server_name.trim().to_owned();
        if self.server_name.is_empty() || self.server_name.chars().count() > 100 {
            return Err(vec![FieldError {
                field: "serverName".into(),
                message: "server name must contain between 1 and 100 characters".into(),
            }]);
        }
        let Some(value) = &self.primary_url else {
            return Ok(());
        };
        let origin = canonical_origin(value).map_err(|message| {
            vec![FieldError {
                field: "primaryUrl".into(),
                message,
            }]
        })?;
        self.primary_url = Some(origin);
        Ok(())
    }

    pub fn validate_paths(&self, root: &Path, spaces: &MultiConfig) -> Result<(), Vec<FieldError>> {
        if self.primary_url.is_none() {
            return Ok(());
        }
        let root = super::setup::canonicalize_best_effort(root);
        for (id, space) in &spaces.spaces {
            let folder = super::setup::canonicalize_best_effort(&super::instance::resolve_folder(
                &root,
                id,
                &space.folder,
            ));
            if folder != root && root.starts_with(&folder) {
                return Err(vec![FieldError { field: format!("{id}.folder"), message: "a space cannot contain the server data directory; choose a separate space folder".into() }]);
            }
        }
        Ok(())
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        use std::io::Write;
        let tmp = path.with_extension("json.tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(|error| error.to_string())?;
        file.write_all(&json)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        std::fs::rename(&tmp, path).map_err(|error| error.to_string())
    }
}

pub fn canonical_origin(value: &str) -> Result<String, String> {
    let authority = value
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or(rest))
        .unwrap_or("");
    if value.trim() != value || value.chars().any(char::is_control) || authority.contains('@') {
        return Err("the primary URL must be an origin without credentials".into());
    }
    let url =
        reqwest::Url::parse(value).map_err(|_| "enter a valid HTTP or HTTPS origin".to_string())?;
    if url.host_str().is_none() {
        return Err("the primary URL requires a hostname".into());
    }
    if !matches!(url.scheme(), "https" | "http") {
        return Err("use an HTTP or HTTPS origin".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || value
            .split_once("://")
            .and_then(|(_, rest)| rest.split_once('/'))
            .is_some_and(|(_, path)| !path.is_empty())
        || value.contains('\\')
    {
        return Err(
            "the primary URL must be an origin without credentials, path, query, or fragment"
                .into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_defaults_enabled_and_preserves_opt_out() {
        let config: ServerConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(serde_json::to_value(config).unwrap()["runtimeApi"], true);
        let config: ServerConfig = serde_json::from_str(r#"{"runtimeApi":false}"#).unwrap();
        assert_eq!(serde_json::to_value(config).unwrap()["runtimeApi"], false);
    }

    #[test]
    fn validates_canonical_origins() {
        assert_eq!(
            canonical_origin("https://Manager.Example.test:443/").unwrap(),
            "https://manager.example.test"
        );
        for value in [
            "http://localhost:3000",
            "http://manager.localhost:3000",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
            "http://192.168.1.20:3000",
            "http://notes.home:3000",
        ] {
            assert!(canonical_origin(value).is_ok(), "{value}");
        }
        for value in [
            "ftp://example.test",
            "https://user@example.test",
            "https://example.test/path",
            "https://example.test/?query",
            "https://example.test/#fragment",
            "https://example.test\\path",
        ] {
            assert!(canonical_origin(value).is_err(), "{value}");
        }
    }

    #[test]
    fn preserves_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.json");
        std::fs::write(
            &path,
            r#"{"future":{"setting":true},"primaryUrl":"https://manager.example.test"}"#,
        )
        .unwrap();
        let mut config = ServerConfig::load(&path).unwrap();
        config.primary_url = Some("https://other.example.test".into());
        config.save(&path).unwrap();
        assert_eq!(
            ServerConfig::load(&path).unwrap().extra["future"]["setting"],
            true
        );
    }
    #[test]
    fn primary_rejects_spaces_above_server_data_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("server");
        std::fs::create_dir(&root).unwrap();
        let mut spaces = MultiConfig::default();
        spaces.spaces.insert(
            "space".into(),
            serde_json::from_value(serde_json::json!({
                "name":"Notes", "binding":{"host":"notes.example.test"}, "folder":".."
            }))
            .unwrap(),
        );
        let config = ServerConfig {
            primary_url: Some("https://manager.example.test".into()),
            ..Default::default()
        };
        assert!(config.validate_paths(&root, &spaces).is_err());
    }
}
