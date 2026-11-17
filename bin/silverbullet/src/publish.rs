//! `silverbullet publish`: the settings of a public, read-only, accountless
//! site served from one folder, and the in-memory stack configuration they
//! become. Nothing here touches the process environment or writes a file.

use std::path::PathBuf;

use silverbullet_server::multi::config::{MultiConfig, SpaceAccess, SpaceConfig};
use silverbullet_server::multi::server_config::ServerConfig;
use silverbullet_server::multi::validate::normalize_prefix;

use crate::multi::{InMemoryStack, IGNORED_IN_MULTI};

/// The id of the one published space.
const SPACE_ID: &str = "site";

/// The folder path the space reports to clients (`/.config`, `X-Space-Path`)
/// in place of the host path, which anonymous visitors must not learn. Fixed,
/// so what clients derive from it (their local database name, the capture
/// store's owner id) survives restarts and moves of the folder.
const CLIENT_IDENTITY_PATH: &str = "published";

/// Variables a published site refuses: it is always public.
const REFUSED: &[&str] = &["SB_USER", "SB_AUTH_TOKEN"];

/// Variables that set a published space's settings.
const HONORED: &[&str] = &[
    "SB_NAME",
    "SB_DESCRIPTION",
    "SB_INDEX_PAGE",
    "SB_THEME_COLOR",
    "SB_HEAD_HTML",
    "SB_SPACE_IGNORE",
    "SB_URL_PREFIX",
];

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PublishSettings {
    /// The canonical absolute path of the content folder.
    pub(crate) folder: PathBuf,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) index_page: String,
    pub(crate) theme_color: String,
    pub(crate) head_html: String,
    pub(crate) space_ignore: String,
    /// Normalized: no trailing `/`, and the root is the empty string.
    pub(crate) url_prefix: String,
}

/// The unset-value defaults of a space, the way a `spaces.json` entry gets them.
fn space_defaults() -> SpaceConfig {
    serde_json::from_value(serde_json::json!({
        "name": "SilverBullet",
        "binding": { "prefix": "" },
    }))
    .expect("a minimal space config is valid")
}

fn refusal(var: &str) -> String {
    format!(
        "{var} is not supported by `silverbullet publish`: a published site is always public. \
         Remove it, or run a normal server to require sign-in."
    )
}

/// Names set in `env` that `publish` ignores, in `IGNORED_IN_MULTI` order.
fn ignored_vars(env: &dyn Fn(&str) -> Option<String>) -> Vec<&'static str> {
    IGNORED_IN_MULTI
        .iter()
        .copied()
        .filter(|var| !HONORED.contains(var) && !REFUSED.contains(var) && is_set(env, var))
        .collect()
}

fn is_set(env: &dyn Fn(&str) -> Option<String>, var: &str) -> bool {
    env(var).is_some_and(|v| !v.is_empty())
}

/// A non-empty value of `var`, or `default`.
fn setting(env: &dyn Fn(&str) -> Option<String>, var: &str, default: String) -> String {
    env(var).filter(|v| !v.is_empty()).unwrap_or(default)
}

/// Build the settings from the folder argument (else `SB_FOLDER`, else the
/// current directory) and the honored environment variables.
pub(crate) fn publish_settings(
    folder: Option<String>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<PublishSettings, String> {
    for var in REFUSED {
        if is_set(env, var) {
            return Err(refusal(var));
        }
    }
    for var in ignored_vars(env) {
        tracing::warn!("{var} is ignored by `silverbullet publish`");
    }

    let requested = folder
        .filter(|f| !f.is_empty())
        .or_else(|| env("SB_FOLDER").filter(|f| !f.is_empty()))
        .unwrap_or_else(|| ".".into());
    let folder = std::fs::canonicalize(&requested)
        .map_err(|e| format!("cannot publish {requested}: {e}"))?;
    if !folder.is_dir() {
        return Err(format!("cannot publish {requested}: not a folder"));
    }

    let defaults = space_defaults();
    Ok(PublishSettings {
        folder,
        name: setting(env, "SB_NAME", defaults.name),
        description: setting(env, "SB_DESCRIPTION", defaults.description),
        index_page: setting(env, "SB_INDEX_PAGE", defaults.index_page),
        theme_color: setting(env, "SB_THEME_COLOR", defaults.theme_color),
        head_html: setting(env, "SB_HEAD_HTML", defaults.head_html),
        space_ignore: setting(env, "SB_SPACE_IGNORE", defaults.space_ignore),
        url_prefix: normalize_prefix(&setting(env, "SB_URL_PREFIX", String::new())),
    })
}

/// A published site is public by design, so unlike a normal server it listens
/// on every interface unless `-L` or `SB_HOSTNAME` says otherwise.
pub(crate) const PUBLISH_DEFAULT_HOST: &str = "0.0.0.0";

/// The address to listen on: the `-L` flag, else `SB_HOSTNAME`, else all interfaces.
pub(crate) fn publish_bind_host(
    flag: Option<String>,
    env: &dyn Fn(&str) -> Option<String>,
) -> String {
    flag.filter(|h| !h.is_empty())
        .or_else(|| env("SB_HOSTNAME").filter(|h| !h.is_empty()))
        .unwrap_or_else(|| PUBLISH_DEFAULT_HOST.into())
}

/// The in-memory stack configuration: one public, read-only space `site`.
pub(crate) fn publish_source(settings: &PublishSettings) -> InMemoryStack {
    let mut space = space_defaults();
    space.name = settings.name.clone();
    space.folder = settings.folder.to_string_lossy().into_owned();
    space.binding = silverbullet_server::multi::config::Binding::Prefix {
        prefix: settings.url_prefix.clone(),
    };
    space.access = Some(SpaceAccess::Read);
    space.read_only = true;
    space.members.clear();
    space.index_page = settings.index_page.clone();
    space.description = settings.description.clone();
    space.theme_color = settings.theme_color.clone();
    space.head_html = settings.head_html.clone();
    space.space_ignore = settings.space_ignore.clone();
    space.log_push = false;
    space.shell = Default::default();
    space.revisions = Default::default();
    space.git_sync = None;
    space.client_identity_path = Some(CLIENT_IDENTITY_PATH.into());

    let mut spaces = MultiConfig::default();
    spaces.spaces.insert(SPACE_ID.into(), space);
    let server = ServerConfig {
        runtime_api: false,
        mcp: false,
        ..ServerConfig::default()
    };
    InMemoryStack { spaces, server }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server_common::RevisionsMode;

    #[test]
    fn listens_on_all_interfaces_unless_told_otherwise() {
        let none = |_: &str| None;
        assert_eq!(publish_bind_host(None, &none), "0.0.0.0");
        let env = |k: &str| (k == "SB_HOSTNAME").then(|| "127.0.0.1".to_string());
        assert_eq!(publish_bind_host(None, &env), "127.0.0.1");
        assert_eq!(publish_bind_host(Some("10.0.0.5".into()), &env), "10.0.0.5");
        let empty = |k: &str| (k == "SB_HOSTNAME").then(String::new);
        assert_eq!(publish_bind_host(None, &empty), "0.0.0.0");
    }

    fn env_of<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    }

    fn folder() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn dir_arg(dir: &tempfile::TempDir) -> Option<String> {
        Some(dir.path().to_string_lossy().into_owned())
    }

    #[test]
    fn defaults_apply() {
        let dir = folder();
        let s = publish_settings(dir_arg(&dir), &env_of(&[])).unwrap();
        let d = space_defaults();
        assert_eq!(s.name, "SilverBullet");
        assert_eq!(s.url_prefix, "", "the root prefix `/` normalizes to empty");
        assert_eq!(s.description, d.description);
        assert_eq!(s.index_page, d.index_page);
        assert_eq!(s.theme_color, d.theme_color);
        assert_eq!(s.head_html, "");
        assert_eq!(s.space_ignore, "");
        assert_eq!(s.folder, std::fs::canonicalize(dir.path()).unwrap());
    }

    #[test]
    fn env_overrides_each_setting() {
        let dir = folder();
        let s = publish_settings(
            dir_arg(&dir),
            &env_of(&[
                ("SB_NAME", "My Site"),
                ("SB_DESCRIPTION", "About it"),
                ("SB_INDEX_PAGE", "Home"),
                ("SB_THEME_COLOR", "#123456"),
                ("SB_HEAD_HTML", "<meta name=x>"),
                ("SB_SPACE_IGNORE", "private/*"),
                ("SB_URL_PREFIX", "/docs"),
            ]),
        )
        .unwrap();
        assert_eq!(s.name, "My Site");
        assert_eq!(s.description, "About it");
        assert_eq!(s.index_page, "Home");
        assert_eq!(s.theme_color, "#123456");
        assert_eq!(s.head_html, "<meta name=x>");
        assert_eq!(s.space_ignore, "private/*");
        assert_eq!(s.url_prefix, "/docs");
        let space = &publish_source(&s).spaces.spaces[SPACE_ID];
        assert_eq!(space.name, "My Site");
        assert_eq!(space.binding.prefix(), "/docs");
        assert_eq!(space.head_html, "<meta name=x>");
    }

    #[test]
    fn prefix_is_normalized() {
        let dir = folder();
        for raw in ["docs/", "/docs/", "docs"] {
            let s = publish_settings(dir_arg(&dir), &env_of(&[("SB_URL_PREFIX", raw)])).unwrap();
            assert_eq!(s.url_prefix, "/docs", "{raw}");
        }
    }

    #[test]
    fn sb_user_is_refused() {
        let dir = folder();
        let err = publish_settings(dir_arg(&dir), &env_of(&[("SB_USER", "a:b")])).unwrap_err();
        assert_eq!(
            err,
            "SB_USER is not supported by `silverbullet publish`: a published site is always \
             public. Remove it, or run a normal server to require sign-in."
        );
    }

    #[test]
    fn sb_auth_token_is_refused() {
        let dir = folder();
        let err = publish_settings(dir_arg(&dir), &env_of(&[("SB_AUTH_TOKEN", "t")])).unwrap_err();
        assert_eq!(
            err,
            "SB_AUTH_TOKEN is not supported by `silverbullet publish`: a published site is \
             always public. Remove it, or run a normal server to require sign-in."
        );
    }

    #[test]
    fn missing_folder_is_an_error() {
        let dir = folder();
        let missing = dir.path().join("nope").to_string_lossy().into_owned();
        let err = publish_settings(Some(missing), &env_of(&[])).unwrap_err();
        assert!(err.contains("nope"), "{err}");
        let file = dir.path().join("f.md");
        std::fs::write(&file, "x").unwrap();
        let err =
            publish_settings(Some(file.to_string_lossy().into_owned()), &env_of(&[])).unwrap_err();
        assert!(err.contains("not a folder"), "{err}");
    }

    #[test]
    fn folder_falls_back_to_sb_folder() {
        let dir = folder();
        let path = dir.path().to_string_lossy().into_owned();
        let s = publish_settings(None, &env_of(&[("SB_FOLDER", &path)])).unwrap();
        assert_eq!(s.folder, std::fs::canonicalize(dir.path()).unwrap());
    }

    #[test]
    fn only_unhonored_names_are_ignored() {
        let ignored = ignored_vars(&env_of(&[
            ("SB_NAME", "x"),
            ("SB_READ_ONLY", "false"),
            ("SB_REVISIONS", "managed"),
            ("SB_LOG_PUSH", ""),
        ]));
        assert_eq!(ignored, vec!["SB_READ_ONLY", "SB_REVISIONS"]);
    }

    #[test]
    fn source_has_the_fixed_settings() {
        let dir = folder();
        // Env that tries to loosen things is ignored.
        let s = publish_settings(
            dir_arg(&dir),
            &env_of(&[
                ("SB_READ_ONLY", "false"),
                ("SB_REVISIONS", "managed"),
                ("SB_RUNTIME_API", "true"),
            ]),
        )
        .unwrap();
        let stack = publish_source(&s);
        assert_eq!(stack.spaces.spaces.len(), 1);
        let space = &stack.spaces.spaces[SPACE_ID];
        assert_eq!(space.access, Some(SpaceAccess::Read));
        assert!(space.read_only);
        assert!(space.members.is_empty());
        assert!(!space.shell.enabled);
        assert_eq!(space.revisions, RevisionsMode::Disabled);
        assert!(space.git_sync.is_none());
        assert!(!space.log_push);
        assert!(!stack.server.runtime_api);
        assert!(!stack.server.mcp);
        assert_eq!(space.client_identity_path.as_deref(), Some("published"));
        assert!(std::path::Path::new(&space.folder).is_absolute());
        assert_eq!(space.folder, s.folder.to_string_lossy());
    }
}
