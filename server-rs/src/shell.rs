/// Shell-execution policy. `enabled` reflects whether command running is on at
/// all; an empty `whitelist` means any command is allowed, otherwise only the
/// listed command names may run.
#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub enabled: bool,
    pub whitelist: Vec<String>,
}

impl ShellConfig {
    /// Build from the environment. Shell running is enabled only when
    /// `SB_SHELL_BACKEND` is unset AND the space is not read-only;
    /// `SB_SHELL_WHITELIST` is a space-separated allow-list.
    pub fn from_env(read_only: bool) -> Self {
        let backend = std::env::var("SB_SHELL_BACKEND")
            .ok()
            .filter(|v| !v.is_empty());
        let whitelist = std::env::var("SB_SHELL_WHITELIST").ok();
        Self::parse(backend.as_deref(), whitelist.as_deref(), read_only)
    }

    /// Pure parser used by `from_env` and tests.
    pub fn parse(backend: Option<&str>, whitelist: Option<&str>, read_only: bool) -> Self {
        let enabled = backend.is_none() && !read_only;
        let whitelist = whitelist
            .map(|w| w.split_whitespace().map(|s| s.to_string()).collect())
            .unwrap_or_default();
        Self { enabled, whitelist }
    }

    /// A fully-disabled policy (used as a safe default).
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            whitelist: vec![],
        }
    }

    pub fn is_allowed(&self, cmd: &str) -> bool {
        self.whitelist.is_empty() || self.whitelist.iter().any(|c| c == cmd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_whitelist_allows_all() {
        let c = ShellConfig {
            enabled: true,
            whitelist: vec![],
        };
        assert!(c.is_allowed("git"));
        assert!(c.is_allowed("anything"));
    }

    #[test]
    fn whitelist_restricts() {
        let c = ShellConfig {
            enabled: true,
            whitelist: vec!["git".into(), "npm".into()],
        };
        assert!(c.is_allowed("git"));
        assert!(c.is_allowed("npm"));
        assert!(!c.is_allowed("rm"));
    }

    #[test]
    fn from_env_parse_disabled_when_backend_set() {
        // SB_SHELL_BACKEND set (to anything) ⇒ disabled.
        let c = ShellConfig::parse(Some("off"), Some("git npm"), false);
        assert!(!c.enabled);
    }

    #[test]
    fn from_env_parse_disabled_in_read_only() {
        let c = ShellConfig::parse(None, None, true);
        assert!(!c.enabled);
    }

    #[test]
    fn from_env_parse_enabled_with_whitelist() {
        // Unset backend + not read-only ⇒ enabled; whitelist is space-separated.
        let c = ShellConfig::parse(None, Some("git  npm python"), false);
        assert!(c.enabled);
        assert_eq!(c.whitelist, vec!["git", "npm", "python"]);
    }
}
