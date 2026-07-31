use std::path::Path;

/// Why the headless-Chrome runtime could not be configured. The two causes are
/// kept apart because the Space Manager shows the administrator which one it
/// hit — "install a browser" and "you turned this off" need different answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeUnavailable {
    /// `SB_RUNTIME_API` is `0`/`false`.
    DisabledByEnv,
    /// No browser configured, and none found by the platform scan.
    NoChrome,
}

/// Precedence for the browser binary: `SB_CHROME_PATH`, then `CHROMIUM_PATH`,
/// then a platform scan. Split out with the scan injected so the "nothing
/// found" branch is testable without depending on what is installed on the
/// machine running the tests.
fn chrome_path_from(
    sb_chrome_path: Option<String>,
    chromium_path: Option<String>,
    scan: impl FnOnce() -> Option<String>,
) -> Result<String, RuntimeUnavailable> {
    sb_chrome_path
        .or(chromium_path)
        .or_else(scan)
        .ok_or(RuntimeUnavailable::NoChrome)
}

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
    /// directory, used for the default profile location. The error says which
    /// of the two ways this can fail actually happened.
    pub fn from_env(server_root: &Path) -> Result<Self, RuntimeUnavailable> {
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
    ) -> Result<Self, RuntimeUnavailable> {
        if !runtime_api_enabled {
            return Err(RuntimeUnavailable::DisabledByEnv);
        }
        let chrome_path = chrome_path_from(sb_chrome_path, chromium_path, find_chrome)?;
        let user_data_dir = chrome_data_dir
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                server_root
                    .join(".chrome-data")
                    .to_string_lossy()
                    .into_owned()
            });
        Ok(Self {
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

    fn resolve(
        root: &str,
        chrome_data_dir: Option<&str>,
    ) -> Result<ChromeConfig, RuntimeUnavailable> {
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

    // `unwrap_err`, not `assert_eq!` on the whole `Result`: `ChromeConfig`
    // derives `Debug` but not `PartialEq`, so the Ok side is not comparable.
    #[test]
    fn disabled_runtime_api_reports_the_env_opt_out() {
        let err = ChromeConfig::resolve(
            Some("/bin/chrome".into()),
            None,
            None,
            Path::new("/srv/sb"),
            false,
            true,
            false,
        )
        .unwrap_err();
        assert_eq!(err, RuntimeUnavailable::DisabledByEnv);
    }

    // Driven through `chrome_path_from` with an injected scan rather than
    // `resolve`, so the result does not depend on whether the machine running
    // the tests happens to have Chrome installed.
    #[test]
    fn no_browser_anywhere_reports_no_chrome() {
        assert_eq!(
            chrome_path_from(None, None, || None),
            Err(RuntimeUnavailable::NoChrome),
        );
    }

    #[test]
    fn explicit_path_beats_chromium_path_and_the_scan() {
        assert_eq!(
            chrome_path_from(Some("/a".into()), Some("/b".into()), || Some("/c".into())),
            Ok("/a".to_string()),
        );
        assert_eq!(
            chrome_path_from(None, Some("/b".into()), || Some("/c".into())),
            Ok("/b".to_string()),
        );
        assert_eq!(
            chrome_path_from(None, None, || Some("/c".into())),
            Ok("/c".to_string()),
        );
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
