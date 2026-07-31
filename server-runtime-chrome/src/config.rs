use std::path::Path;

/// Configuration for the single, server-wide headless browser. Resolved once at
/// startup and shared by every space's page.
#[derive(Debug, Clone)]
pub struct ChromeConfig {
    pub chrome_path: String,
    pub user_data_dir: String,
    pub show: bool,
    pub log_console: bool,
}

impl ChromeConfig {
    /// Build from the process environment. `server_root` is the server's root
    /// directory, used for the default profile location. Returns `None` when
    /// the runtime API is disabled or no Chrome can be found.
    pub fn from_env(server_root: &Path) -> Option<Self> {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let runtime_api_enabled =
            !matches!(env("SB_RUNTIME_API").as_deref(), Some("0") | Some("false"));
        Self::resolve(
            env("SB_CHROME_PATH"),
            env("CHROMIUM_PATH"),
            env("SB_CHROME_DATA_DIR"),
            server_root,
            env("SB_CHROME_SHOW").is_some(),
            // On by default; disabled only with SB_CHROME_LOG_CONSOLE=0/false
            // (matches the SB_RUNTIME_API opt-out convention).
            !matches!(
                env("SB_CHROME_LOG_CONSOLE").as_deref(),
                Some("0") | Some("false")
            ),
            runtime_api_enabled,
        )
    }

    /// Pure resolution (unit-tested). Seven parameters is exactly clippy's
    /// `too_many_arguments` threshold, so no `allow` is needed — do not add one.
    pub fn resolve(
        sb_chrome_path: Option<String>,
        chromium_path: Option<String>,
        chrome_data_dir: Option<String>,
        server_root: &Path,
        show: bool,
        log_console: bool,
        runtime_api_enabled: bool,
    ) -> Option<Self> {
        if !runtime_api_enabled {
            return None;
        }
        let chrome_path = sb_chrome_path.or(chromium_path).or_else(find_chrome)?;
        let user_data_dir = chrome_data_dir
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                server_root
                    .join(".chrome-data")
                    .to_string_lossy()
                    .into_owned()
            });
        Some(Self {
            chrome_path,
            user_data_dir,
            show,
            log_console,
        })
    }
}

/// Per-space page configuration: where this space's client lives and how its
/// headless page authenticates to it.
#[derive(Debug, Clone)]
pub struct SpacePage {
    /// Loopback base URL for this space (`http://127.0.0.1:<port><prefix>`).
    pub server_url: String,
    /// Headless auth token, seeded as an HTTP-only session cookie before the
    /// page navigates. Never appears in the URL.
    pub headless_token: String,
    /// This space's cookie name (`silverbullet_headless_<space_id>`).
    pub cookie_name: String,
}

impl SpacePage {
    /// The headless page URL: the space base URL with a trailing slash and
    /// `?headless=1`. Authentication rides in the cookie, not the query string.
    pub fn page_url(&self) -> String {
        let base = self.server_url.trim_end_matches('/');
        format!("{base}/?headless=1")
    }

    /// `Path` attribute for this space's auth cookie: the space prefix, or `/`
    /// for a root-bound space.
    pub fn cookie_path(&self) -> String {
        let path = self
            .server_url
            .split_once("://")
            .and_then(|(_, authority_and_path)| {
                authority_and_path
                    .find('/')
                    .map(|index| &authority_and_path[index..])
            })
            .unwrap_or("/");
        let path = path.trim_end_matches('/');
        if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        }
    }
}

/// Find a Chrome/Chromium executable from platform-specific candidates.
pub fn find_chrome() -> Option<String> {
    if cfg!(target_os = "macos") {
        let candidates: &[&str] = &[
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        return resolve_candidates(candidates);
    }

    if cfg!(target_os = "windows") {
        let mut candidates: Vec<String> = vec![
            "chrome".to_string(),
            "chrome.exe".to_string(),
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
        ];
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = Path::new(&profile);
            candidates.push(
                profile
                    .join(r"AppData\Local\Google\Chrome\Application\chrome.exe")
                    .to_string_lossy()
                    .into_owned(),
            );
            candidates.push(
                profile
                    .join(r"AppData\Local\Chromium\Application\chrome.exe")
                    .to_string_lossy()
                    .into_owned(),
            );
        }
        let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
        return resolve_candidates(&refs);
    }

    let candidates: &[&str] = &[
        "headless_shell",
        "headless-shell",
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "/usr/bin/google-chrome",
        "/snap/bin/chromium",
    ];
    resolve_candidates(candidates)
}

/// Resolve the first candidate that exists: absolute paths are checked
/// directly, bare names are looked up on `PATH`.
fn resolve_candidates(candidates: &[&str]) -> Option<String> {
    for c in candidates {
        if Path::new(c).is_absolute() {
            if Path::new(c).exists() {
                return Some((*c).to_string());
            }
        } else if let Some(found) = which_on_path(c) {
            return Some(found);
        }
    }
    None
}

fn which_on_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let full = dir.join(name);
        if full.is_file() {
            return Some(full.to_string_lossy().into_owned());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(root: &str, chrome_data_dir: Option<&str>) -> Option<ChromeConfig> {
        ChromeConfig::resolve(
            Some("/bin/chrome".into()),
            None,
            chrome_data_dir.map(str::to_string),
            Path::new(root),
            false,
            true,
            true,
        )
    }

    #[test]
    fn profile_defaults_to_the_server_root() {
        let cfg = resolve("/srv/sb", None).expect("resolves");
        assert_eq!(cfg.chrome_path, "/bin/chrome");
        assert_eq!(cfg.user_data_dir, "/srv/sb/.chrome-data");
    }

    #[test]
    fn explicit_data_dir_wins() {
        let cfg = resolve("/srv/sb", Some("/var/cache/sb-chrome")).expect("resolves");
        assert_eq!(cfg.user_data_dir, "/var/cache/sb-chrome");
    }

    #[test]
    fn empty_data_dir_is_ignored() {
        let cfg = ChromeConfig::resolve(
            Some("/bin/chrome".into()),
            None,
            Some(String::new()),
            Path::new("/srv/sb"),
            false,
            true,
            true,
        )
        .expect("resolves");
        assert_eq!(cfg.user_data_dir, "/srv/sb/.chrome-data");
    }

    #[test]
    fn chromium_path_is_the_fallback() {
        let cfg = ChromeConfig::resolve(
            None,
            Some("/bin/chromium".into()),
            None,
            Path::new("/srv/sb"),
            false,
            true,
            true,
        )
        .expect("resolves");
        assert_eq!(cfg.chrome_path, "/bin/chromium");
    }

    #[test]
    fn disabled_runtime_api_resolves_to_nothing() {
        assert!(ChromeConfig::resolve(
            Some("/bin/chrome".into()),
            None,
            None,
            Path::new("/srv/sb"),
            false,
            true,
            false,
        )
        .is_none());
    }

    #[test]
    fn page_url_carries_no_token() {
        let page = SpacePage {
            server_url: "http://127.0.0.1:3000/notes".into(),
            headless_token: "secret".into(),
            cookie_name: "silverbullet_headless_a".into(),
        };
        assert_eq!(page.page_url(), "http://127.0.0.1:3000/notes/?headless=1");
        assert!(!page.page_url().contains("secret"));
    }

    #[test]
    fn cookie_path_is_the_space_prefix() {
        let page = |url: &str| SpacePage {
            server_url: url.into(),
            headless_token: "secret".into(),
            cookie_name: "silverbullet_headless_a".into(),
        };
        assert_eq!(page("http://127.0.0.1:3000/notes").cookie_path(), "/notes");
        assert_eq!(page("http://127.0.0.1:3000").cookie_path(), "/");
        assert_eq!(page("http://127.0.0.1:3000/").cookie_path(), "/");
        assert_eq!(page("http://127.0.0.1:3000/a/b").cookie_path(), "/a/b");
    }
}
