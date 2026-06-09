//! `space` subcommand implementations for the `sb` CLI.
//!
//! The interactive flow lives in [`space_add_interactive`], which is `pub`
//! so the App's CLI can call it with a pre-set URL (skipping the URL prompt).

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use crate::{
    config::{self, AuthConfig, Config, SpaceConfig},
    conn::{self, Auth, SpaceConnection},
    crypto,
};

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/// Space names must be alphanumeric + hyphens (`^[a-zA-Z0-9-]+$`).
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
    lines.push(String::new()); // leading blank line
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
    lines.push(String::new()); // trailing blank line

    // Join with newlines — each element is one line, trailing blank produces a
    // final "\n" after the join.
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

// ---------------------------------------------------------------------------
// Command functions
// ---------------------------------------------------------------------------

/// `sb space ls` — print a table of configured spaces.
pub fn space_ls() -> Result<(), String> {
    let cfg = config::load()?;
    print!("{}", render_space_table(&cfg));
    Ok(())
}

/// `sb space rm <name>` — remove a configured space.
pub fn space_rm(name: &str) -> Result<(), String> {
    let mut cfg = config::load()?;
    remove_space(&mut cfg, name)?;
    config::save(&cfg)?;
    println!("Space {name:?} removed.");
    Ok(())
}

/// `sb space add` — interactive space-add flow.
///
/// If `preset_url` is `Some`, the URL prompt is skipped (used by the App's
/// CLI for folder-path-aware or pre-filled URL flows).
pub fn space_add_interactive(preset_url: Option<&str>) -> Result<(), String> {
    let mut cfg = config::load()?;
    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin);

    // --- Name ---
    print!("Space name: ");
    std::io::stdout()
        .flush()
        .map_err(|e| format!("flushing stdout: {e}"))?;
    let mut name = String::new();
    reader
        .read_line(&mut name)
        .map_err(|e| format!("reading stdin: {e}"))?;
    let name = name.trim().to_string();
    if !is_valid_space_name(&name) {
        return Err("name must be alphanumeric with hyphens only".to_string());
    }
    for s in &cfg.spaces {
        if s.name == name {
            return Err(format!("space {name:?} already exists"));
        }
    }

    // --- URL ---
    let space_url: String = if let Some(u) = preset_url {
        u.to_string()
    } else {
        print!("URL (e.g. http://localhost:3000): ");
        std::io::stdout()
            .flush()
            .map_err(|e| format!("flushing stdout: {e}"))?;
        let mut raw = String::new();
        reader
            .read_line(&mut raw)
            .map_err(|e| format!("reading stdin: {e}"))?;
        raw.trim().to_string()
    };

    // Validate with reqwest::Url — require a host.
    let parsed = reqwest::Url::parse(&space_url).map_err(|_| "invalid URL format".to_string())?;
    if !parsed.has_host() {
        return Err("invalid URL format".to_string());
    }
    let space_url = space_url.trim_end_matches('/').to_string();

    // --- Probe ---
    let probe_timeout = Duration::from_secs(30);
    let probe_conn = SpaceConnection {
        client: conn::new_client(probe_timeout)?,
        base_url: space_url.clone(),
        auth: Auth::None,
        timeout: probe_timeout,
    };

    let mut auth_type = String::from("none");
    let (reachable, needs_auth) = probe_conn.probe();
    if !reachable {
        eprintln!("Warning: could not reach server at that URL (saving anyway)");
        print!("Auth type (token / password / none) [none]: ");
        std::io::stdout()
            .flush()
            .map_err(|e| format!("flushing stdout: {e}"))?;
        let mut input = String::new();
        reader
            .read_line(&mut input)
            .map_err(|e| format!("reading stdin: {e}"))?;
        let trimmed = input.trim().to_string();
        if !trimmed.is_empty() {
            auth_type = trimmed;
        }
        // auth_type stays "none" if empty
    } else if needs_auth {
        println!("Server requires authentication.");
        print!("Auth type (password / token) [password]:");
        std::io::stdout()
            .flush()
            .map_err(|e| format!("flushing stdout: {e}"))?;
        let mut input = String::new();
        reader
            .read_line(&mut input)
            .map_err(|e| format!("reading stdin: {e}"))?;
        let trimmed = input.trim().to_string();
        auth_type = if trimmed.is_empty() {
            "password".to_string()
        } else {
            trimmed
        };
    } else {
        println!("Server is reachable (no authentication required).");
    }

    if auth_type != "token" && auth_type != "password" && auth_type != "none" {
        return Err("auth type must be token, password, or none".to_string());
    }

    // --- Build the space config skeleton ---
    let mut space = SpaceConfig {
        id: config::new_uuid(),
        name: name.clone(),
        url: space_url.clone(),
        auth: AuthConfig {
            method: auth_type.clone(),
            ..Default::default()
        },
        ..Default::default()
    };

    // --- Credential loop ---
    while auth_type != "none" {
        if auth_type == "token" {
            print!("Token: ");
            std::io::stdout()
                .flush()
                .map_err(|e| format!("flushing stdout: {e}"))?;
            let mut token_line = String::new();
            reader
                .read_line(&mut token_line)
                .map_err(|e| format!("reading stdin: {e}"))?;
            let plain_token = token_line.trim().to_string();

            let key = crypto::load_or_create_key(&config::config_dir())
                .map_err(|e| format!("loading encryption key: {e}"))?;
            let enc = crypto::encrypt_with_key(&key, &plain_token)
                .map_err(|e| format!("encrypting token: {e}"))?;
            space.auth.encrypted_token = enc;
            space.auth.encrypted_password = String::new();
            space.auth.username = String::new();
            space.auth.method = auth_type.clone();

            // Verify auth
            let verify_conn = SpaceConnection {
                client: conn::new_client(probe_timeout)?,
                base_url: space_url.clone(),
                auth: Auth::Bearer(plain_token),
                timeout: probe_timeout,
            };
            if verify_conn.auth_check() {
                println!("Authentication verified.");
                break;
            }
        } else if auth_type == "password" {
            print!("Username: ");
            std::io::stdout()
                .flush()
                .map_err(|e| format!("flushing stdout: {e}"))?;
            let mut user_line = String::new();
            reader
                .read_line(&mut user_line)
                .map_err(|e| format!("reading stdin: {e}"))?;
            let username = user_line.trim().to_string();

            print!("Password: ");
            std::io::stdout()
                .flush()
                .map_err(|e| format!("flushing stdout: {e}"))?;
            let mut pass_line = String::new();
            reader
                .read_line(&mut pass_line)
                .map_err(|e| format!("reading stdin: {e}"))?;
            let plain_password = pass_line.trim().to_string();

            let key = crypto::load_or_create_key(&config::config_dir())
                .map_err(|e| format!("loading encryption key: {e}"))?;
            let enc = crypto::encrypt_with_key(&key, &plain_password)
                .map_err(|e| format!("encrypting password: {e}"))?;
            space.auth.username = username.clone();
            space.auth.encrypted_password = enc;
            space.auth.encrypted_token = String::new();
            space.auth.method = auth_type.clone();

            // Verify auth via JWT login
            let verify_client = conn::new_client(probe_timeout)?;
            let verify_auth =
                match conn::login_for_jwt(&verify_client, &space_url, &username, &plain_password) {
                    Ok((cookie_name, jwt)) => Auth::Cookie {
                        name: cookie_name,
                        value: jwt,
                    },
                    Err(e) => {
                        // Surface the login error as an auth failure message
                        println!("Authentication failed: {e}. Try again.");
                        print!("Auth type (password / token) [password]:");
                        std::io::stdout()
                            .flush()
                            .map_err(|e2| format!("flushing stdout: {e2}"))?;
                        let mut input = String::new();
                        reader
                            .read_line(&mut input)
                            .map_err(|e2| format!("reading stdin: {e2}"))?;
                        let trimmed = input.trim().to_string();
                        auth_type = if trimmed.is_empty() {
                            "password".to_string()
                        } else {
                            trimmed
                        };
                        if auth_type != "token" && auth_type != "password" {
                            return Err("auth type must be token or password".to_string());
                        }
                        continue;
                    }
                };

            let verify_conn = SpaceConnection {
                client: conn::new_client(probe_timeout)?,
                base_url: space_url.clone(),
                auth: verify_auth,
                timeout: probe_timeout,
            };
            if verify_conn.auth_check() {
                println!("Authentication verified.");
                break;
            }
        }

        // auth check failed
        println!("Authentication failed. Try again.");
        print!("Auth type (password / token) [password]:");
        std::io::stdout()
            .flush()
            .map_err(|e| format!("flushing stdout: {e}"))?;
        let mut input = String::new();
        reader
            .read_line(&mut input)
            .map_err(|e| format!("reading stdin: {e}"))?;
        let trimmed = input.trim().to_string();
        auth_type = if trimmed.is_empty() {
            "password".to_string()
        } else {
            trimmed
        };
        if auth_type != "token" && auth_type != "password" {
            return Err("auth type must be token or password".to_string());
        }
        space.auth.method = auth_type.clone();
    }

    cfg.spaces.push(space);
    config::save(&cfg)?;
    println!("Space {name:?} added.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, Config, SpaceConfig};

    // -----------------------------------------------------------------------
    // is_valid_space_name
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // render_space_table
    // -----------------------------------------------------------------------

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
        // Must contain NAME header, 70 dashes, and the space row
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
        // Leading and trailing blank lines
        assert!(out.starts_with('\n'), "must start with blank line");
        assert!(out.ends_with('\n'), "must end with newline");
    }

    #[test]
    fn render_folder_space_shows_folder_path_as_url() {
        let cfg = Config {
            spaces: vec![SpaceConfig {
                id: "id2".into(),
                name: "local".into(),
                url: String::new(), // empty URL
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

    // -----------------------------------------------------------------------
    // remove_space
    // -----------------------------------------------------------------------

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
