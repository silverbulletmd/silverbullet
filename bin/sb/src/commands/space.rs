use std::io::{BufRead, BufReader, IsTerminal, Write};
use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::{
    config::{self, AuthConfig, Config, SpaceConfig, SpaceEnv},
    conn::{self, Auth, SpaceConnection},
    crypto, device_auth, local,
};

pub fn is_valid_space_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Render the `ls` table (NAME/URL/AUTH).
///
/// Returns the full block (leading blank line, header, 70 dashes, rows,
/// trailing blank line), OR the "No spaces configured." line when empty.
pub fn render_space_table(
    cfg: &Config,
    all: bool,
    running_port: &dyn Fn(&SpaceConfig) -> Option<u16>,
) -> String {
    if cfg.spaces.is_empty() {
        return "No spaces configured. Use 'space add' to add one.\n".to_string();
    }

    let location = |s: &SpaceConfig| {
        if s.url.is_empty() && !s.folder_path.is_empty() {
            s.folder_path.clone()
        } else {
            s.url.clone()
        }
    };
    let shown: Vec<&SpaceConfig> = cfg
        .spaces
        .iter()
        .filter(|s| all || !is_single_file(s))
        .collect();
    // Columns grow past their default width so long names and folder paths
    // never run into the next column.
    let width = |default: usize, longest: Option<usize>| default.max(longest.unwrap_or(0) + 2);
    let name_w = width(20, shown.iter().map(|s| s.name.chars().count()).max());
    let loc_w = width(40, shown.iter().map(|s| location(s).chars().count()).max());
    let mut lines: Vec<String> = Vec::new();
    lines.push(String::new());
    lines.push(format!("{:<name_w$}{:<loc_w$}{}", "NAME", "URL", "AUTH"));
    lines.push("-".repeat(70.max(name_w + loc_w + 10)));
    for s in shown {
        let status = running_port(s)
            .map(|port| format!("  [running on port {port}]"))
            .unwrap_or_default();
        lines.push(format!(
            "{:<name_w$}{:<loc_w$}{}{status}",
            s.name,
            location(s),
            s.auth.method
        ));
    }
    lines.push(String::new());

    lines.join("\n")
}

/// Folder spaces are served by SilverBullet Desktop. Without it, creating,
/// renaming or moving one only tends entries nothing can open, and `sb` cannot
/// tell whether the space is in use, so these operations refuse. Listing and
/// removing still work, so entries left by an uninstalled Desktop can be
/// cleaned up.
pub(crate) fn require_desktop() -> Result<(), String> {
    local::desktop_host(&config::config_dir())
        .map(|_| ())
        .map_err(|e| e.message)
}

fn is_folder_space(space: &SpaceConfig) -> bool {
    space.url.is_empty() && !space.folder_path.is_empty()
}

/// Single-file spaces that SilverBullet Desktop registers when a file is opened.
fn is_single_file(space: &SpaceConfig) -> bool {
    space.extra.get("ephemeral").is_some_and(|v| !v.is_null())
}

/// Index of the space named `name` (or registered at folder path `name`).
pub fn find_space_index(cfg: &Config, name: &str) -> Result<usize, String> {
    cfg.spaces
        .iter()
        .position(|s| s.name == name || (!s.folder_path.is_empty() && s.folder_path == name))
        .ok_or_else(|| format!("space {name:?} not found"))
}

/// Remove a space by name (or registered folder path). Returns `Err` if not
/// found or while SilverBullet Desktop is serving it.
pub fn remove_space(
    cfg: &mut Config,
    name: &str,
    is_running: &dyn Fn(&SpaceConfig) -> bool,
) -> Result<(), String> {
    let idx = find_space_index(cfg, name)?;
    if is_running(&cfg.spaces[idx]) {
        return Err("Space is running. Close it in SilverBullet Desktop first.".into());
    }
    cfg.spaces.remove(idx);
    Ok(())
}

/// Change a space's name. Its id, folder path, URL and settings are kept.
pub fn rename_space(cfg: &mut Config, old: &str, new: &str) -> Result<(), String> {
    let idx = find_space_index(cfg, old)?;
    let new = check_new_name(cfg, new)?;
    cfg.spaces[idx].name = new;
    Ok(())
}

/// Port of a folder space that SilverBullet Desktop is currently serving.
pub(crate) fn running_port(space: &SpaceConfig) -> Option<u16> {
    if space.folder_path.is_empty() {
        return None;
    }
    let host = local::desktop_host(&config::config_dir()).ok()?;
    let (origin, token) = local::runtime_connection(&host, &space.id).ok()?;
    let port = reqwest::Url::parse(&origin).ok()?.port()?;
    local::ping_port(port, &token).then_some(port)
}

/// `sb space ls` — print a table of configured spaces.
pub fn space_ls(all: bool, json: bool) -> Result<(), String> {
    let cfg = config::load()?;
    if json {
        let spaces: Vec<SpaceSummary> = cfg
            .spaces
            .iter()
            .filter(|s| all || !is_single_file(s))
            .map(|s| summarize(s, running_port(s)))
            .collect();
        return print_json(&spaces);
    }
    print!("{}", render_space_table(&cfg, all, &running_port));
    Ok(())
}

/// `sb space rename <old> <new>`.
pub fn space_rename(old: &str, new: &str, json: bool) -> Result<(), String> {
    let _lock = config::lock(&config::config_dir())?;
    let mut cfg = config::load()?;
    let idx = find_space_index(&cfg, old)?;
    if is_folder_space(&cfg.spaces[idx]) {
        require_desktop()?;
    }
    rename_space(&mut cfg, old, new)?;
    config::save(&cfg)?;
    let space = &cfg.spaces[idx];
    if json {
        print_json(&summarize(space, None))
    } else {
        println!("Space {old:?} renamed to {:?}.", space.name);
        Ok(())
    }
}

pub fn space_rm(name: &str, json: bool) -> Result<(), String> {
    let _lock = config::lock(&config::config_dir())?;
    let mut cfg = config::load()?;
    remove_space(&mut cfg, name, &|s| running_port(s).is_some())?;
    config::save(&cfg)?;
    if json {
        return print_json(&serde_json::json!({ "removed": name }));
    }
    println!("Space {name:?} removed.");
    Ok(())
}

/// Whether `register_folder` registers an existing folder (`space add`) or
/// sets up a new space in a missing or empty one (`space create`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FolderMode {
    Existing,
    New,
}

/// Env SilverBullet Desktop gives the spaces it creates; keep in sync with
/// `SpaceEnvConfig::for_new_space` in desktop-services. Without it Desktop
/// would read its defaults, which enable the local shell.
pub fn new_folder_space_env() -> SpaceEnv {
    let mut env = SpaceEnv {
        shell_backend: "off".into(),
        ..Default::default()
    };
    env.extra.insert("revisions".into(), Value::from("managed"));
    env
}

/// Validate a folder-space name the way SilverBullet Desktop's dashboard does
/// (trimmed, non-empty), plus no control characters and no duplicates so
/// `--space <name>` stays unambiguous. Returns the trimmed name.
pub fn check_new_name(cfg: &Config, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a space name is required".into());
    }
    if name.chars().any(char::is_control) {
        return Err("space names cannot contain control characters".into());
    }
    if cfg.spaces.iter().any(|s| s.name == name) {
        return Err(format!("space {name:?} already exists; pass --name"));
    }
    Ok(name.to_string())
}

/// Best-effort absolute form of `folder`, so `.`, `..` and trailing-slash
/// paths still have a final component: the canonical path when it exists, else
/// the canonical parent joined with the final component, else `folder` as given.
fn resolved_for_name(folder: &Path) -> std::path::PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(folder) {
        return canonical;
    }
    if let (Some(parent), Some(base)) = (folder.parent(), folder.file_name()) {
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        if let Ok(parent) = std::fs::canonicalize(parent) {
            return parent.join(base);
        }
    }
    folder.to_path_buf()
}

/// Default name for a folder space: its folder name, when free.
pub fn default_folder_name(folder: &Path, cfg: &Config) -> Option<String> {
    let resolved = resolved_for_name(folder);
    let base = resolved.file_name()?.to_string_lossy();
    check_new_name(cfg, &base).ok()
}

/// Register a folder space. `Existing` requires a directory; `New` requires a
/// missing or empty one and creates it. Nothing is created on disk unless every
/// check passes.
pub fn register_folder(
    cfg: &mut Config,
    folder: &Path,
    name: Option<&str>,
    mode: FolderMode,
) -> Result<SpaceConfig, String> {
    let name = match name {
        Some(name) => check_new_name(cfg, name)?,
        None => default_folder_name(folder, cfg).ok_or_else(|| {
            format!(
                "cannot derive a free space name from {}; pass --name",
                folder.display()
            )
        })?,
    };
    match (mode, std::fs::metadata(folder)) {
        (_, Ok(meta)) if !meta.is_dir() => {
            return Err(format!("{} is not a directory", folder.display()))
        }
        (FolderMode::New, Ok(_)) => {
            let mut entries = std::fs::read_dir(folder)
                .map_err(|e| format!("reading {}: {e}", folder.display()))?;
            if entries.next().is_some() {
                return Err(format!(
                    "{} is not empty; use 'sb space add' to register an existing space",
                    folder.display()
                ));
            }
        }
        (FolderMode::New, Err(_)) => {
            // Check registration against the would-be canonical path before creating.
            if let Some(parent) = folder.parent().filter(|p| !p.as_os_str().is_empty()) {
                if let Ok(parent) = std::fs::canonicalize(parent) {
                    let would_be = parent.join(folder.file_name().unwrap_or_default());
                    let would_be = config::strip_verbatim(&would_be.to_string_lossy()).to_string();
                    if cfg.spaces.iter().any(|s| s.folder_path == would_be) {
                        return Err(format!("already registered: {would_be}"));
                    }
                }
            }
            std::fs::create_dir_all(folder).map_err(|e| format!("creating directory: {e}"))?;
        }
        (FolderMode::Existing, Ok(_)) => {}
        (FolderMode::Existing, Err(_)) => {
            return Err(format!(
                "{} does not exist; use 'sb space create' to start a new space",
                folder.display()
            ))
        }
    }
    let canonical = std::fs::canonicalize(folder).map_err(|e| format!("resolving path: {e}"))?;
    let path = config::strip_verbatim(&canonical.to_string_lossy()).to_string();
    if cfg.spaces.iter().any(|s| s.folder_path == path) {
        return Err(format!("already registered: {path}"));
    }
    let mut space = SpaceConfig {
        id: config::new_uuid(),
        name,
        folder_path: path,
        env: Some(new_folder_space_env()),
        ..Default::default()
    };
    space.auth.method = "none".into();
    cfg.spaces.push(space.clone());
    Ok(space)
}

/// Stable, agent-facing view of a registry entry (`--json`).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub url: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub folder_path: String,
    pub auth: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running_port: Option<u16>,
    pub sync_enabled: bool,
    pub hidden: bool,
}

pub fn summarize(space: &SpaceConfig, running_port: Option<u16>) -> SpaceSummary {
    SpaceSummary {
        id: space.id.clone(),
        name: space.name.clone(),
        url: space.url.clone(),
        folder_path: space.folder_path.clone(),
        auth: space.auth.method.clone(),
        running_port,
        sync_enabled: space.sync_enabled(),
        hidden: config::is_hidden(space),
    }
}

pub(crate) fn print_json(value: &impl serde::Serialize) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

/// `sb space add <folder>` / `sb space create <folder>`.
pub fn space_add_folder(
    folder: &str,
    name: Option<&str>,
    mode: FolderMode,
    json: bool,
) -> Result<(), String> {
    require_desktop()?;
    let _lock = config::lock(&config::config_dir())?;
    let mut cfg = config::load()?;
    let space = register_folder(&mut cfg, Path::new(folder), name, mode)?;
    config::save(&cfg)?;
    if json {
        print_json(&summarize(&space, None))
    } else {
        let verb = if mode == FolderMode::New {
            "Created"
        } else {
            "Added"
        };
        println!("{verb} space {:?} at {}", space.name, space.folder_path);
        Ok(())
    }
}

/// Options for `sb space add <url>`; unset fields are prompted for on a
/// terminal and defaulted (or rejected) otherwise.
#[derive(Default)]
pub struct AddOptions {
    pub url: Option<String>,
    pub name: Option<String>,
    pub auth: Option<String>,
    pub username: Option<String>,
    pub no_browser: bool,
}

/// Default connection name: the URL's last path segment
/// (`sb.example.com/hermes` → `hermes`), else the host's first label
/// (`hermes.example.com` → `hermes`), or the dashed address for IPv4 hosts.
/// `None` when that is not a valid name (IPv6 hosts) or is already taken.
pub fn default_space_name(url: &reqwest::Url, cfg: &Config) -> Option<String> {
    let segment = url
        .path_segments()
        .and_then(|mut segments| segments.rfind(|s| !s.is_empty()))
        .map(str::to_string);
    let name = match (segment, url.domain()) {
        (Some(segment), _) => segment,
        (None, Some(domain)) => domain.split('.').next()?.to_string(),
        (None, None) => url.host_str()?.replace('.', "-"),
    };
    (is_valid_space_name(&name) && !cfg.spaces.iter().any(|s| s.name == name)).then_some(name)
}

pub fn space_add_remote(opts: AddOptions) -> Result<(), String> {
    let interactive = std::io::stdin().is_terminal();
    let mut reader = BufReader::new(std::io::stdin());
    let url = match (opts.url, interactive) {
        (Some(url), _) => url,
        (None, true) => prompt(&mut reader, "URL (e.g. https://notes.example.com): ", "")?,
        (None, false) => return Err("a URL is required when stdin is not a terminal".into()),
    };
    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid URL format".to_string())?;
    if !parsed.has_host() || !matches!(parsed.scheme(), "http" | "https") {
        return Err("invalid URL format".into());
    }
    let existing = config::load()?;
    let default_name = default_space_name(&parsed, &existing).unwrap_or_default();
    let name = match opts.name {
        Some(name) => name,
        None if interactive => {
            let question = if default_name.is_empty() {
                "Space name: ".to_string()
            } else {
                format!("Space name [{default_name}]: ")
            };
            prompt(&mut reader, &question, &default_name)?
        }
        None if default_name.is_empty() => {
            return Err("cannot derive a free space name from the URL; pass --name".into())
        }
        None => default_name,
    };
    if !is_valid_space_name(&name) {
        return Err("name must be alphanumeric with hyphens only".into());
    }
    if existing.spaces.iter().any(|s| s.name == name) {
        return Err(format!("space {name:?} already exists"));
    }
    let url = url.trim_end_matches('/').to_string();
    let timeout = Duration::from_secs(30);
    let client = conn::new_client(timeout)?;
    let probe = client
        .get(format!("{url}/.config"))
        .send()
        .map_err(|e| format!("Cannot reach server: {e}"))?;
    let needs_auth = match probe.status().as_u16() {
        200..=299 => false,
        300..=399 | 401 | 403 => true,
        404 => {
            let multi = client
                .get(format!("{url}/.instance"))
                .send()
                .is_ok_and(|r| r.status().is_success());
            return Err(if multi {
                format!(
                    "This is a multi-space server. Use a specific space URL; see {url}/.dashboard"
                )
            } else {
                "No SilverBullet space at this URL. Check the space URL.".into()
            });
        }
        status => {
            return Err(format!(
                "Cannot check space authentication: server returned {status}"
            ))
        }
    };
    let auth = if needs_auth {
        eprintln!("Server requires authentication.");
        let browser = device_auth::supported(&url)?;
        let default = if browser { "browser" } else { "password" };
        if !browser {
            eprintln!("This server does not support device sign-in. Use a password or token.");
        }
        let question = if browser {
            "Auth type (browser / token / password) [browser]: "
        } else {
            "Auth type (password / token) [password]: "
        };
        loop {
            let method = match &opts.auth {
                Some(method) => method.clone(),
                None if interactive => prompt(&mut reader, question, default)?,
                None if browser => "browser".into(),
                None => {
                    return Err(
                        "This server does not support device sign-in; pass --auth token or --auth password"
                            .into(),
                    )
                }
            };
            if method == "browser" {
                if !browser {
                    return Err("This server does not support device sign-in.".into());
                }
                break device_auth::sign_in(&url, opts.no_browser)?;
            }
            let (auth, verify_auth) = match method.as_str() {
                "token" => {
                    let token = prompt(&mut reader, "Token: ", "")?;
                    let key = encryption_key()?;
                    (
                        AuthConfig {
                            method,
                            encrypted_token: crypto::encrypt_with_key(&key, &token)
                                .map_err(|e| e.to_string())?,
                            ..Default::default()
                        },
                        Auth::Bearer(token),
                    )
                }
                "password" => {
                    let username = match &opts.username {
                        Some(username) => username.clone(),
                        None => prompt(&mut reader, "Username: ", "")?,
                    };
                    let password = prompt(&mut reader, "Password: ", "")?;
                    let (name, value) =
                        match conn::login_for_jwt(&client, &url, &username, &password) {
                            Ok(pair) => pair,
                            Err(e) if interactive => {
                                eprintln!("Authentication failed: {e}. Try again.");
                                continue;
                            }
                            Err(e) => return Err(format!("Authentication failed: {e}")),
                        };
                    let key = encryption_key()?;
                    (
                        AuthConfig {
                            method,
                            username,
                            encrypted_password: crypto::encrypt_with_key(&key, &password)
                                .map_err(|e| e.to_string())?,
                            ..Default::default()
                        },
                        Auth::Cookie { name, value },
                    )
                }
                _ => return Err("auth type must be browser, token, or password".into()),
            };
            let verify = SpaceConnection {
                client: client.clone(),
                base_url: url.clone(),
                auth: verify_auth,
                timeout,
            };
            if verify.auth_check() {
                break auth;
            }
            if !interactive {
                return Err("Authentication failed.".into());
            }
            eprintln!("Authentication failed. Try again.");
        }
    } else {
        eprintln!("Server is reachable (no authentication required).");
        if opts.auth.is_some() {
            eprintln!("Ignoring --auth.");
        }
        AuthConfig {
            method: "none".into(),
            ..Default::default()
        }
    };
    let space = SpaceConfig {
        id: config::new_uuid(),
        name: name.clone(),
        url,
        auth,
        ..Default::default()
    };
    let dir = config::config_dir();
    let _lock = config::lock(&dir)?;
    let mut cfg = config::load()?;
    insert_space(&mut cfg, space)?;
    config::save(&cfg)?;
    eprintln!("Space {name:?} added.");
    Ok(())
}

fn insert_space(cfg: &mut Config, space: SpaceConfig) -> Result<(), String> {
    if cfg.spaces.iter().any(|s| s.name == space.name) {
        return Err(format!("space {:?} already exists", space.name));
    }
    cfg.spaces.push(space);
    Ok(())
}

pub fn space_login(name: &str, no_browser: bool) -> Result<(), String> {
    let cfg = config::load()?;
    let space = config::resolve_space(&cfg, Some(name))?;
    if space.url.is_empty() || !space.folder_path.is_empty() {
        return Err(
            "Browser sign-in is for remote URL spaces. Local folder spaces use Desktop authentication."
                .into(),
        );
    }
    let auth = device_auth::sign_in(&space.url, no_browser)?;
    let _lock = config::lock(&config::config_dir())?;
    let mut latest = config::load()?;
    replace_auth(&mut latest, space, auth)?;
    config::save(&latest)?;
    eprintln!("Signed in to space {name:?}.");
    Ok(())
}

fn replace_auth(
    cfg: &mut Config,
    original: &SpaceConfig,
    mut auth: AuthConfig,
) -> Result<(), String> {
    let current = cfg
        .spaces
        .iter_mut()
        .find(|s| s.id == original.id)
        .ok_or_else(|| {
            "Space was removed while signing in; credentials were not saved".to_string()
        })?;
    if current.url != original.url
        || current.folder_path != original.folder_path
        || current.auth != original.auth
    {
        return Err(
            "Space changed while signing in; credentials were not saved. Run the command again."
                .into(),
        );
    }
    auth.extra = current.auth.extra.clone();
    current.auth = auth;
    Ok(())
}

fn encryption_key() -> Result<[u8; crypto::KEY_LEN], String> {
    let dir = config::config_dir();
    let _lock = config::lock(&dir)?;
    crypto::load_or_create_key(&dir).map_err(|e| format!("loading encryption key: {e}"))
}

fn prompt(reader: &mut impl BufRead, message: &str, default: &str) -> Result<String, String> {
    eprint!("{message}");
    std::io::stderr().flush().map_err(|e| e.to_string())?;
    let mut line = String::new();
    if reader
        .read_line(&mut line)
        .map_err(|e| format!("reading stdin: {e}"))?
        == 0
    {
        return Err("Input ended; space configuration cancelled.".into());
    }
    let value = line.trim();
    Ok(if value.is_empty() { default } else { value }.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, Config, SpaceConfig};

    #[test]
    fn cancelled_prompt_does_not_accept_a_default() {
        assert!(prompt(&mut std::io::Cursor::new(b""), "", "browser").is_err());
    }

    #[test]
    fn registration_preserves_existing_spaces_and_rejects_duplicates() {
        let mut cfg = Config::default();
        insert_space(
            &mut cfg,
            SpaceConfig {
                name: "notes".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(insert_space(
            &mut cfg,
            SpaceConfig {
                name: "notes".into(),
                ..Default::default()
            }
        )
        .is_err());
        insert_space(
            &mut cfg,
            SpaceConfig {
                name: "archive".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(cfg.spaces.len(), 2);
    }

    #[test]
    fn reauthentication_preserves_renames_and_rejects_changed_target() {
        let original = SpaceConfig {
            id: "space-id".into(),
            name: "notes".into(),
            url: "https://notes.example.com".into(),
            ..Default::default()
        };
        let mut renamed = original.clone();
        renamed.name = "renamed".into();
        renamed
            .extra
            .insert("appField".into(), serde_json::json!(42));
        let mut cfg = Config {
            spaces: vec![renamed],
        };
        replace_auth(
            &mut cfg,
            &original,
            AuthConfig {
                method: "browser".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(cfg.spaces[0].name, "renamed");
        assert_eq!(cfg.spaces[0].extra["appField"], 42);
        cfg.spaces[0].url = "https://different.example.com".into();
        assert!(replace_auth(&mut cfg, &original, AuthConfig::default()).is_err());
        assert_eq!(cfg.spaces[0].auth.method, "browser");
    }

    #[test]
    fn default_name_comes_from_the_url_host() {
        let name =
            |url: &str, cfg: &Config| default_space_name(&reqwest::Url::parse(url).unwrap(), cfg);
        let empty = Config::default();
        assert_eq!(
            name("https://hermes.example.com", &empty).as_deref(),
            Some("hermes")
        );
        assert_eq!(
            name("http://localhost:3000/", &empty).as_deref(),
            Some("localhost")
        );
        assert_eq!(
            name("http://127.0.0.1:3000", &empty).as_deref(),
            Some("127-0-0-1")
        );
        assert_eq!(name("http://[::1]:3000", &empty), None);
        assert_eq!(name("https://my_host.example.com", &empty), None);
        assert_eq!(
            name("https://sb.zef.pub/hermes", &empty).as_deref(),
            Some("hermes")
        );
        assert_eq!(
            name("https://sb.zef.pub/team/hermes/", &empty).as_deref(),
            Some("hermes")
        );
        assert_eq!(
            name("http://127.0.0.1:3000/hermes", &empty).as_deref(),
            Some("hermes")
        );
        let taken = Config {
            spaces: vec![SpaceConfig {
                name: "hermes".into(),
                ..Default::default()
            }],
        };
        assert_eq!(name("https://hermes.example.com", &taken), None);
    }

    #[test]
    fn valid_space_names() {
        assert!(is_valid_space_name("work"));
        assert!(is_valid_space_name("my-space"));
        assert!(is_valid_space_name("a1-b2"));
        assert!(is_valid_space_name("ABC123"));
        assert!(is_valid_space_name("a"));
    }

    #[test]
    fn invalid_space_names() {
        assert!(!is_valid_space_name(""));
        assert!(!is_valid_space_name("has space"));
        assert!(!is_valid_space_name("under_score"));
        assert!(!is_valid_space_name("emoji\u{1F600}"));
        assert!(!is_valid_space_name("has.dot"));
        assert!(!is_valid_space_name("has/slash"));
    }

    #[test]
    fn render_empty_cfg() {
        let cfg = Config { spaces: vec![] };
        let out = render_space_table(&cfg, false, &|_| None);
        assert_eq!(out, "No spaces configured. Use 'space add' to add one.\n");
    }

    #[test]
    fn render_single_url_space() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                id: "id1".into(),
                name: "work".into(),
                url: "http://localhost:3000".into(),
                auth: AuthConfig {
                    method: "token".into(),
                    ..Default::default()
                },
                ..Default::default()
            }],
        };
        let out = render_space_table(&cfg, false, &|_| None);
        assert!(out.contains("NAME"), "must contain NAME header");
        assert!(out.contains("URL"), "must contain URL header");
        assert!(out.contains("AUTH"), "must contain AUTH header");
        assert!(out.contains(&"-".repeat(70)), "must contain 70 dashes");
        assert!(out.contains("work"), "must contain space name");
        assert!(
            out.contains("http://localhost:3000"),
            "must contain space URL"
        );
        assert!(out.contains("token"), "must contain auth method");
        assert!(out.starts_with('\n'), "must start with blank line");
        assert!(out.ends_with('\n'), "must end with newline");
    }

    #[test]
    fn render_folder_space_shows_folder_path_as_url() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                id: "id2".into(),
                name: "local".into(),
                url: String::new(),
                folder_path: "/home/user/notes".into(),
                auth: AuthConfig {
                    method: "none".into(),
                    ..Default::default()
                },
                ..Default::default()
            }],
        };
        let out = render_space_table(&cfg, false, &|_| None);
        assert!(
            out.contains("/home/user/notes"),
            "folder path must appear in the URL column"
        );
    }

    #[test]
    fn render_widens_columns_for_long_values() {
        let long = format!("/synthetic/{}", "deep/".repeat(10));
        let mut space = SpaceConfig {
            name: "harbor".into(),
            folder_path: long.clone(),
            ..Default::default()
        };
        space.auth.method = "none".into();
        let cfg = Config {
            spaces: vec![space],
        };
        let out = render_space_table(&cfg, false, &|_| None);
        assert!(out.contains(&format!("{long}  none")), "{out}");
    }

    #[test]
    fn render_two_spaces() {
        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    id: "id1".into(),
                    name: "url-space".into(),
                    url: "http://example.com".into(),
                    auth: AuthConfig {
                        method: "token".into(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                SpaceConfig {
                    id: "id2".into(),
                    name: "folder-space".into(),
                    url: String::new(),
                    folder_path: "/notes".into(),
                    auth: AuthConfig {
                        method: "none".into(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ],
        };
        let out = render_space_table(&cfg, false, &|_| None);
        assert!(out.contains("url-space"));
        assert!(out.contains("http://example.com"));
        assert!(out.contains("token"));
        assert!(out.contains("folder-space"));
        assert!(out.contains("/notes"));
        assert!(out.contains("none"));
    }

    #[test]
    fn remove_space_existing() {
        let mut cfg = Config {
            spaces: vec![
                SpaceConfig {
                    name: "alpha".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    name: "beta".into(),
                    ..Default::default()
                },
            ],
        };
        remove_space(&mut cfg, "alpha", &|_| false).unwrap();
        assert_eq!(cfg.spaces.len(), 1);
        assert_eq!(cfg.spaces[0].name, "beta");
    }

    #[test]
    fn remove_space_missing() {
        let mut cfg = Config {
            spaces: vec![SpaceConfig {
                name: "alpha".into(),
                ..Default::default()
            }],
        };
        let err = remove_space(&mut cfg, "nonexistent", &|_| false).unwrap_err();
        assert!(err.contains("not found"), "error was: {err}");
    }

    #[test]
    fn remove_space_leaves_others_intact() {
        let mut cfg = Config {
            spaces: vec![
                SpaceConfig {
                    name: "a".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    name: "b".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    name: "c".into(),
                    ..Default::default()
                },
            ],
        };
        remove_space(&mut cfg, "b", &|_| false).unwrap();
        assert_eq!(cfg.spaces.len(), 2);
        assert_eq!(cfg.spaces[0].name, "a");
        assert_eq!(cfg.spaces[1].name, "c");
    }

    fn ephemeral(name: &str) -> SpaceConfig {
        let mut s = SpaceConfig {
            id: name.into(),
            name: name.into(),
            folder_path: format!("/tmp/{name}"),
            ..Default::default()
        };
        s.extra.insert(
            "ephemeral".into(),
            serde_json::json!({"entryFile": "Harbor.md"}),
        );
        s
    }

    #[test]
    fn ls_hides_single_file_spaces_unless_all() {
        let cfg = Config {
            spaces: vec![
                SpaceConfig {
                    id: "n".into(),
                    name: "notes".into(),
                    folder_path: "/tmp/notes".into(),
                    ..Default::default()
                },
                ephemeral("harbor"),
            ],
        };
        let hidden = render_space_table(&cfg, false, &|_| None);
        assert!(
            hidden.contains("notes") && !hidden.contains("harbor"),
            "{hidden}"
        );
        let all = render_space_table(&cfg, true, &|_| None);
        assert!(all.contains("harbor"), "{all}");
    }

    #[test]
    fn ls_marks_running_folder_spaces() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                id: "n".into(),
                name: "notes".into(),
                folder_path: "/tmp/notes".into(),
                ..Default::default()
            }],
        };
        let out = render_space_table(&cfg, false, &|_| Some(43123));
        assert!(out.contains("[running on port 43123]"), "{out}");
    }

    #[test]
    fn folder_spaces_register_by_canonical_path_and_basename() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("notes");
        std::fs::create_dir(&folder).unwrap();
        let mut cfg = Config::default();
        let added = register_folder(&mut cfg, &folder, None, FolderMode::Existing).unwrap();
        let canonical = std::fs::canonicalize(&folder).unwrap();
        assert_eq!(added.name, "notes");
        assert_eq!(added.folder_path, canonical.to_string_lossy());
        assert_eq!(added.auth.method, "none");
        assert_eq!(added.id.len(), 36);
        assert_eq!(cfg.spaces.len(), 1);
        let err =
            register_folder(&mut cfg, &folder, Some("other"), FolderMode::Existing).unwrap_err();
        assert!(err.contains("already registered"), "{err}");
    }

    #[test]
    fn add_requires_an_existing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let mut cfg = Config::default();
        let err = register_folder(
            &mut cfg,
            &tmp.path().join("missing"),
            None,
            FolderMode::Existing,
        )
        .unwrap_err();
        assert!(err.contains("sb space create"), "{err}");
        assert!(!tmp.path().join("missing").exists());
        let file = tmp.path().join("file.md");
        std::fs::write(&file, "x").unwrap();
        assert!(
            register_folder(&mut cfg, &file, Some("f"), FolderMode::Existing)
                .unwrap_err()
                .contains("not a directory")
        );
        assert!(cfg.spaces.is_empty());
    }

    #[test]
    fn create_accepts_missing_or_empty_and_refuses_non_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let mut cfg = Config::default();
        let missing = tmp.path().join("harbor/deep");
        register_folder(&mut cfg, &missing, None, FolderMode::New).unwrap();
        assert!(missing.is_dir());
        let empty = tmp.path().join("atlas");
        std::fs::create_dir(&empty).unwrap();
        register_folder(&mut cfg, &empty, None, FolderMode::New).unwrap();
        let full = tmp.path().join("ledger");
        std::fs::create_dir(&full).unwrap();
        std::fs::write(full.join("index.md"), "x").unwrap();
        let err = register_folder(&mut cfg, &full, None, FolderMode::New).unwrap_err();
        assert!(
            err.contains("not empty") && err.contains("sb space add"),
            "{err}"
        );
        assert_eq!(cfg.spaces.len(), 2);
    }

    #[test]
    fn folder_spaces_get_desktop_new_space_env() {
        let tmp = tempfile::tempdir().unwrap();
        let mut cfg = Config::default();
        let added =
            register_folder(&mut cfg, &tmp.path().join("harbor"), None, FolderMode::New).unwrap();
        let json = serde_json::to_value(&added).unwrap();
        assert_eq!(json["env"]["shellBackend"], "off");
        assert_eq!(json["env"]["revisions"], "managed");
        assert!(json["env"].get("readOnly").is_none());
    }

    #[test]
    fn names_must_be_valid_and_unique() {
        let tmp = tempfile::tempdir().unwrap();
        let mut cfg = Config::default();
        register_folder(
            &mut cfg,
            &tmp.path().join("a"),
            Some("Harbor Notes"),
            FolderMode::New,
        )
        .unwrap();
        assert_eq!(cfg.spaces[0].name, "Harbor Notes");
        let dup = register_folder(
            &mut cfg,
            &tmp.path().join("b"),
            Some("Harbor Notes"),
            FolderMode::New,
        )
        .unwrap_err();
        assert!(dup.contains("already exists"), "{dup}");
        let blank = register_folder(
            &mut cfg,
            &tmp.path().join("c"),
            Some("   "),
            FolderMode::New,
        )
        .unwrap_err();
        assert!(blank.contains("required"), "{blank}");
        let ctrl = register_folder(
            &mut cfg,
            &tmp.path().join("d"),
            Some("a\nb"),
            FolderMode::New,
        )
        .unwrap_err();
        assert!(ctrl.contains("control"), "{ctrl}");
        for rejected in ["b", "c", "d"] {
            assert!(
                !tmp.path().join(rejected).exists(),
                "nothing created on a rejected name"
            );
        }
        let trimmed = register_folder(
            &mut cfg,
            &tmp.path().join("e"),
            Some("  atlas "),
            FolderMode::New,
        )
        .unwrap();
        assert_eq!(trimmed.name, "atlas");
    }

    #[test]
    fn default_folder_name_is_the_basename() {
        let cfg = Config::default();
        let n = |p: &str| default_folder_name(Path::new(p), &cfg);
        assert_eq!(n("/x/My Notes").as_deref(), Some("My Notes"));
        assert_eq!(n("/x/notes.v2").as_deref(), Some("notes.v2"));
        assert_eq!(n("/x/Ünïcode").as_deref(), Some("Ünïcode"));
        let taken = Config {
            spaces: vec![SpaceConfig {
                name: "harbor".into(),
                ..Default::default()
            }],
        };
        assert_eq!(default_folder_name(Path::new("/x/harbor"), &taken), None);
    }

    #[test]
    fn dot_and_dotdot_paths_default_to_the_folder_basename() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("notes");
        std::fs::create_dir(&folder).unwrap();
        let mut cfg = Config::default();
        let added =
            register_folder(&mut cfg, &folder.join("."), None, FolderMode::Existing).unwrap();
        assert_eq!(added.name, "notes");
        let sub = folder.join("inner");
        std::fs::create_dir(&sub).unwrap();
        let up = register_folder(&mut cfg, &sub.join(".."), None, FolderMode::Existing);
        assert!(
            up.unwrap_err().contains("pass --name"),
            "name taken, so no default"
        );
        let other = tmp.path().join("other");
        std::fs::create_dir_all(other.join("deep")).unwrap();
        let added =
            register_folder(&mut cfg, &other.join("deep/.."), None, FolderMode::Existing).unwrap();
        assert_eq!(added.name, "other");
    }

    #[test]
    fn summary_reports_sync_and_location() {
        let mut space = SpaceConfig {
            id: "id-1".into(),
            name: "harbor".into(),
            folder_path: "/synthetic/harbor".into(),
            ..Default::default()
        };
        space.auth.method = "none".into();
        space.extra.insert(
            "sync".into(),
            serde_json::json!({"enabled": true, "remoteUrl": "https://x.example.com"}),
        );
        let json = serde_json::to_value(summarize(&space, Some(4100))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "id-1", "name": "harbor", "folderPath": "/synthetic/harbor",
                "auth": "none", "runningPort": 4100, "syncEnabled": true, "hidden": false
            })
        );
    }

    #[test]
    fn running_spaces_cannot_be_removed() {
        let mut cfg = Config {
            spaces: vec![ephemeral("harbor")],
        };
        let err = remove_space(&mut cfg, "harbor", &|_| true).unwrap_err();
        assert_eq!(
            err,
            "Space is running. Close it in SilverBullet Desktop first."
        );
        assert_eq!(cfg.spaces.len(), 1);
    }

    #[test]
    fn rename_validates_and_keeps_identity() {
        let mut cfg = Config {
            spaces: vec![
                SpaceConfig {
                    id: "1".into(),
                    name: "harbor".into(),
                    ..Default::default()
                },
                SpaceConfig {
                    id: "2".into(),
                    name: "atlas".into(),
                    ..Default::default()
                },
            ],
        };
        assert!(rename_space(&mut cfg, "harbor", "atlas")
            .unwrap_err()
            .contains("already exists"));
        assert!(rename_space(&mut cfg, "harbor", "  ").is_err());
        assert!(rename_space(&mut cfg, "nope", "x")
            .unwrap_err()
            .contains("not found"));
        rename_space(&mut cfg, "harbor", "harbor-old").unwrap();
        assert_eq!(cfg.spaces[0].id, "1");
        assert_eq!(cfg.spaces[0].name, "harbor-old");
    }
}
