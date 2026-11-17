//! A legacy single-space folder's `SB_*` environment, read for the migration
//! flow: the settings it carries over, the credentials it moves into
//! `users.json`, and who may run it.

use silverbullet_server::auth::config::AuthConfig;
use silverbullet_server::multi::migrate::api::{generate_setup_code, Gate};
use silverbullet_server::multi::migrate::{
    synthesize_space, LegacyEnv, MigrationSecrets, SingleSpaceSettings,
};
use silverbullet_server::multi::server_config::MAX_RUNTIME_IDLE_TIMEOUT;
use silverbullet_server::multi::validate::normalize_prefix;
use silverbullet_server::shell::ShellConfig;

use crate::config::Config;

/// Reads `SB_USER` and friends through `env`; everything else comes from
/// `config`. Fails on a malformed `SB_USER`, like single-space mode did.
pub fn legacy_env(
    config: &Config,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<(LegacyEnv, MigrationSecrets, Gate), String> {
    let set = |key: &str| env(key).filter(|value| !value.is_empty());
    let url_prefix = normalize_prefix(&config.host_url_prefix);
    let space = synthesize_space(
        &SingleSpaceSettings {
            name: config.space_name.clone(),
            url_prefix: url_prefix.clone(),
            read_only: config.read_only,
            index_page: config.index_page.clone(),
            description: config.space_description.clone(),
            theme_color: config.theme_color.clone(),
            head_html: config.additional_head_html.clone(),
            space_ignore: config.gitignore.clone(),
            log_push: config.log_push,
            revisions: config.revisions,
        },
        ShellConfig::from_env(config.read_only),
    );
    let auth = AuthConfig::try_parse(
        set("SB_USER").as_deref(),
        set("SB_AUTH_TOKEN").as_deref(),
        set("SB_LOCKOUT_LIMIT").as_deref(),
        set("SB_LOCKOUT_TIME").as_deref(),
        set("SB_REMEMBER_ME_HOURS").as_deref(),
    )
    .map_err(|e| e.0)?;
    let legacy = LegacyEnv {
        data_folder: config.data_folder.clone(),
        url_prefix,
        space,
        user: auth.as_ref().map(|a| (a.user.clone(), a.pass.clone())),
        auth_token: set("SB_AUTH_TOKEN"),
        search_model: config.search_model.clone(),
        runtime_api: !matches!(set("SB_RUNTIME_API").as_deref(), Some("0" | "false")),
        runtime_idle_timeout: runtime_idle_timeout(set("SB_RUNTIME_IDLE_TIMEOUT"))?,
        set_vars: crate::multi::IGNORED_IN_MULTI
            .iter()
            .filter(|var| set(var).is_some())
            .map(|var| var.to_string())
            .collect(),
    };
    let secrets = MigrationSecrets {
        password: legacy.user.as_ref().map(|(_, pass)| pass.clone()),
        auth_token: legacy.auth_token.clone(),
    };
    let gate = match auth {
        Some(auth) => Gate::Credentials(auth),
        None => Gate::SetupCode(generate_setup_code()),
    };
    Ok((legacy, secrets, gate))
}

/// `SB_RUNTIME_IDLE_TIMEOUT` in minutes, capped at what `server.json` allows.
/// Not a number is an error, like single-space mode made it.
fn runtime_idle_timeout(value: Option<String>) -> Result<Option<u64>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let minutes: u64 = value
        .trim()
        .parse()
        .map_err(|_| format!("SB_RUNTIME_IDLE_TIMEOUT is not a number of minutes: {value}"))?;
    Ok(Some(minutes.min(MAX_RUNTIME_IDLE_TIMEOUT)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    fn config() -> Config {
        Config::from_env(None, Some(3000), Some("./notes".into())).unwrap()
    }

    #[test]
    fn sb_user_gates_with_its_credentials() {
        let (legacy, secrets, gate) = legacy_env(
            &config(),
            &env(&[("SB_USER", "pat:se:cret"), ("SB_AUTH_TOKEN", "tok")]),
        )
        .unwrap();
        assert_eq!(legacy.user, Some(("pat".into(), "se:cret".into())));
        assert_eq!(legacy.auth_token.as_deref(), Some("tok"));
        assert_eq!(secrets.password.as_deref(), Some("se:cret"));
        assert_eq!(secrets.auth_token.as_deref(), Some("tok"));
        assert!(matches!(gate, Gate::Credentials(a) if a.authorize("pat", "se:cret")));
        assert_eq!(legacy.set_vars, ["SB_USER", "SB_AUTH_TOKEN"]);
        assert_eq!(legacy.data_folder, "./notes");
    }

    #[test]
    fn an_open_install_gates_with_a_setup_code() {
        let (legacy, secrets, gate) = legacy_env(&config(), &env(&[])).unwrap();
        assert!(legacy.user.is_none());
        assert!(secrets.password.is_none());
        assert!(matches!(gate, Gate::SetupCode(code) if code.len() == 8));
    }

    #[test]
    fn runtime_settings_are_read() {
        let (legacy, _, _) = legacy_env(&config(), &env(&[])).unwrap();
        assert!(legacy.runtime_api);
        assert_eq!(legacy.runtime_idle_timeout, None);
        for off in ["0", "false"] {
            let (legacy, _, _) = legacy_env(
                &config(),
                &env(&[("SB_RUNTIME_API", off), ("SB_RUNTIME_IDLE_TIMEOUT", " 5 ")]),
            )
            .unwrap();
            assert!(!legacy.runtime_api, "{off}");
            assert_eq!(legacy.runtime_idle_timeout, Some(5));
            assert_eq!(
                legacy.set_vars,
                ["SB_RUNTIME_IDLE_TIMEOUT", "SB_RUNTIME_API"]
            );
        }
        let (legacy, _, _) = legacy_env(&config(), &env(&[("SB_RUNTIME_API", "1")])).unwrap();
        assert!(legacy.runtime_api);
    }

    /// Single-space mode allowed any number of minutes; `server.json` holds
    /// at most a week.
    #[test]
    fn a_longer_idle_timeout_is_capped_at_a_week() {
        let (legacy, _, _) =
            legacy_env(&config(), &env(&[("SB_RUNTIME_IDLE_TIMEOUT", "100000")])).unwrap();
        assert_eq!(legacy.runtime_idle_timeout, Some(7 * 24 * 60));
    }

    #[test]
    fn a_malformed_idle_timeout_is_an_error() {
        let error = legacy_env(&config(), &env(&[("SB_RUNTIME_IDLE_TIMEOUT", "soon")]))
            .err()
            .unwrap();
        assert!(error.contains("SB_RUNTIME_IDLE_TIMEOUT"), "{error}");
    }

    #[test]
    fn a_malformed_sb_user_is_an_error() {
        assert!(legacy_env(&config(), &env(&[("SB_USER", "nocolon")])).is_err());
    }

    #[test]
    fn the_url_prefix_is_normalized() {
        let mut config = config();
        config.host_url_prefix = "wiki/".into();
        let (legacy, _, _) = legacy_env(&config, &env(&[])).unwrap();
        assert_eq!(legacy.url_prefix, "/wiki");
    }
}
