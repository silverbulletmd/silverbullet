//! Server configuration assembled from `SB_*` environment variables and the
//! `-L/--hostname` / `-p/--port` CLI flags.
use std::env;

pub struct Config {
    pub bind_host: String,
    pub port: u16,
    pub unix_socket: Option<String>,
    pub metrics_port: Option<u16>,
    pub space_folder: String,
    pub gitignore: String,
    pub read_only: bool,
    pub index_page: String,
    pub space_name: String,
    pub disable_service_worker: bool,
    pub log_push: bool,
    pub additional_head_html: String,
    pub theme_color: String,
    pub space_description: String,
    pub host_url_prefix: String,
    pub http_logging: bool,
}

/// An env var read as a non-empty string.
fn env_nonempty(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.is_empty())
}

/// Normalize a URL prefix: ensure a single leading `/`, strip trailing `/`.
/// Empty stays empty.
fn normalize_prefix(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let with_lead = if raw.starts_with('/') {
        raw.to_string()
    } else {
        format!("/{raw}")
    };
    with_lead.trim_end_matches('/').to_string()
}

impl Config {
    /// Build from the environment plus the (already-parsed) CLI flags. `folder`
    /// is the positional space-folder argument. Returns `Err` with a
    /// user-facing message when required config is missing or malformed.
    pub fn from_env(
        hostname: Option<String>,
        port: Option<u16>,
        folder: Option<String>,
    ) -> Result<Self, String> {
        let bind_host = hostname
            .or_else(|| env_nonempty("SB_HOSTNAME"))
            .unwrap_or_else(|| "127.0.0.1".to_string());

        let port = match port {
            Some(p) => p,
            None => match env_nonempty("SB_PORT") {
                Some(s) => s
                    .parse::<u16>()
                    .map_err(|_| format!("SB_PORT is not a valid port: {s}"))?,
                None => 3000,
            },
        };

        let metrics_port = match env_nonempty("SB_METRICS_PORT") {
            Some(s) => Some(
                s.parse::<u16>()
                    .map_err(|_| format!("SB_METRICS_PORT is not a valid port: {s}"))?,
            ),
            None => None,
        };

        let space_folder = folder
            .or_else(|| env_nonempty("SB_FOLDER"))
            .ok_or_else(|| {
                "No folder specified. Pass a folder argument or set SB_FOLDER.".to_string()
            })?;

        Ok(Config {
            bind_host,
            port,
            unix_socket: env_nonempty("SB_UNIX_SOCKET"),
            metrics_port,
            space_folder,
            gitignore: env::var("SB_SPACE_IGNORE").unwrap_or_default(),
            read_only: env_nonempty("SB_READ_ONLY").is_some(),
            index_page: env_nonempty("SB_INDEX_PAGE").unwrap_or_else(|| "index".to_string()),
            space_name: env_nonempty("SB_NAME").unwrap_or_else(|| "SilverBullet".to_string()),
            disable_service_worker: env_nonempty("SB_DISABLE_SERVICE_WORKER").is_some(),
            log_push: env_nonempty("SB_LOG_PUSH").is_some(),
            additional_head_html: env::var("SB_HEAD_HTML").unwrap_or_default(),
            theme_color: env_nonempty("SB_THEME_COLOR").unwrap_or_else(|| "#e1e1e1".to_string()),
            space_description: env_nonempty("SB_DESCRIPTION")
                .unwrap_or_else(|| "Powerful and programmable note taking app".to_string()),
            host_url_prefix: normalize_prefix(&env::var("SB_URL_PREFIX").unwrap_or_default()),
            http_logging: env_nonempty("SB_HTTP_LOGGING").is_some(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_normalization() {
        assert_eq!(normalize_prefix(""), "");
        assert_eq!(normalize_prefix("wiki"), "/wiki");
        assert_eq!(normalize_prefix("/wiki/"), "/wiki");
        assert_eq!(normalize_prefix("/a/b/"), "/a/b");
    }

    #[test]
    fn folder_from_arg_takes_precedence_and_defaults_apply() {
        // Pass the folder explicitly so the test doesn't depend on the ambient
        // environment; defaults for the rest.
        let c = Config::from_env(None, Some(8080), Some("/tmp/space".into())).unwrap();
        assert_eq!(c.space_folder, "/tmp/space");
        assert_eq!(c.port, 8080);
        assert_eq!(c.bind_host, "127.0.0.1");
        assert_eq!(c.index_page, "index");
        assert_eq!(c.space_name, "SilverBullet");
    }

    #[test]
    fn missing_folder_is_an_error() {
        // No arg; rely on SB_FOLDER being unset in the test environment. If your
        // runner sets SB_FOLDER, this assertion is environment-dependent — the
        // logic (arg/env/none) is the contract under test.
        if std::env::var("SB_FOLDER").is_err() {
            assert!(Config::from_env(None, None, None).is_err());
        }
    }
}
