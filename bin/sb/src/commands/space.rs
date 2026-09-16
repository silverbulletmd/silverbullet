use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use crate::{
    config::{self, AuthConfig, Config, SpaceConfig},
    conn::{self, Auth, SpaceConnection},
    crypto, device_auth,
};

pub fn is_valid_space_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Render the `ls` table (NAME/URL/AUTH).
///
/// Returns the full block (leading blank line, header, 70 dashes, rows,
/// trailing blank line), OR the "No spaces configured." line when empty.
pub fn render_space_table(cfg: &Config) -> String {
    if cfg.spaces.is_empty() {
        return "No spaces configured. Use 'space add' to add one.\n".to_string();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push(String::new());
    lines.push(format!("{:<20}{:<40}{}", "NAME", "URL", "AUTH"));
    lines.push("-".repeat(70));
    for s in &cfg.spaces {
        let loc = if s.url.is_empty() && !s.folder_path.is_empty() {
            s.folder_path.clone()
        } else {
            s.url.clone()
        };
        lines.push(format!("{:<20}{:<40}{}", s.name, loc, s.auth.method));
    }
    lines.push(String::new());

    lines.join("\n")
}

/// Remove a space by name.  Returns `Err` if not found.
pub fn remove_space(cfg: &mut Config, name: &str) -> Result<(), String> {
    let idx = cfg
        .spaces
        .iter()
        .position(|s| s.name == name)
        .ok_or_else(|| format!("space {name:?} not found"))?;
    cfg.spaces.remove(idx);
    Ok(())
}

/// `sb space ls` — print a table of configured spaces.
pub fn space_ls() -> Result<(), String> {
    let cfg = config::load()?;
    print!("{}", render_space_table(&cfg));
    Ok(())
}

pub fn space_rm(name: &str) -> Result<(), String> {
    let _lock = config::lock(&config::config_dir())?;
    let mut cfg = config::load()?;
    remove_space(&mut cfg, name)?;
    config::save(&cfg)?;
    println!("Space {name:?} removed.");
    Ok(())
}

pub fn space_add_interactive(preset_url: Option<&str>) -> Result<(), String> {
    space_add_with_options(preset_url, false)
}

pub fn space_add_with_options(preset_url: Option<&str>, no_browser: bool) -> Result<(), String> {
    let mut reader = BufReader::new(std::io::stdin());
    let name = prompt(&mut reader, "Space name: ", "")?;
    if !is_valid_space_name(&name) {
        return Err("name must be alphanumeric with hyphens only".into());
    }
    if config::load()?.spaces.iter().any(|s| s.name == name) {
        return Err(format!("space {name:?} already exists"));
    }
    let url = match preset_url {
        Some(url) => url.to_string(),
        None => prompt(&mut reader, "URL (e.g. https://notes.example.com): ", "")?,
    };
    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid URL format".to_string())?;
    if !parsed.has_host() || !matches!(parsed.scheme(), "http" | "https") {
        return Err("invalid URL format".into());
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
            let method = prompt(&mut reader, question, default)?;
            if method == "browser" {
                if !browser {
                    return Err("This server does not support device sign-in.".into());
                }
                break device_auth::sign_in(&url, no_browser)?;
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
                    let username = prompt(&mut reader, "Username: ", "")?;
                    let password = prompt(&mut reader, "Password: ", "")?;
                    let (name, value) =
                        match conn::login_for_jwt(&client, &url, &username, &password) {
                            Ok(pair) => pair,
                            Err(e) => {
                                eprintln!("Authentication failed: {e}. Try again.");
                                continue;
                            }
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
            eprintln!("Authentication failed. Try again.");
        }
    } else {
        eprintln!("Server is reachable (no authentication required).");
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
            "Browser sign-in is for remote URL spaces. Local folder spaces use App authentication."
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
        let out = render_space_table(&cfg);
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
        let out = render_space_table(&cfg);
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
        let out = render_space_table(&cfg);
        assert!(
            out.contains("/home/user/notes"),
            "folder path must appear in the URL column"
        );
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
        let out = render_space_table(&cfg);
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
        remove_space(&mut cfg, "alpha").unwrap();
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
        let err = remove_space(&mut cfg, "nonexistent").unwrap_err();
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
        remove_space(&mut cfg, "b").unwrap();
        assert_eq!(cfg.spaces.len(), 2);
        assert_eq!(cfg.spaces[0].name, "a");
        assert_eq!(cfg.spaces[1].name, "c");
    }
}
