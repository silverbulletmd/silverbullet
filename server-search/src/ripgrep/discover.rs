use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.is_file() && meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        meta.is_file()
    }
}

const NAMES: &[&str] = if cfg!(windows) { &["rg.exe"] } else { &["rg"] };

pub fn discover_from(env: Option<OsString>, path: Option<OsString>) -> Option<PathBuf> {
    if let Some(explicit) = env.filter(|v| !v.is_empty()) {
        let explicit = PathBuf::from(explicit);
        return is_executable(&explicit).then(|| explicit.canonicalize().unwrap_or(explicit));
    }
    let path = path?;
    std::env::split_paths(&path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .flat_map(|dir| NAMES.iter().map(move |n| dir.join(n)))
        .find(|candidate| is_executable(candidate))
        .map(|p| p.canonicalize().unwrap_or(p))
}

pub fn ripgrep_required() -> bool {
    std::env::var("SB_REQUIRE_RIPGREP").is_ok_and(|v| v == "1")
}

pub fn binary() -> Option<&'static Path> {
    static BINARY: OnceLock<Option<PathBuf>> = OnceLock::new();
    BINARY
        .get_or_init(|| {
            discover_from(
                std::env::var_os("SB_RIPGREP_PATH"),
                std::env::var_os("PATH"),
            )
        })
        .as_deref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_prefers_the_environment_override() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join(if cfg!(windows) { "rg.exe" } else { "rg" });
        std::fs::write(&fake, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let fake = fake.canonicalize().unwrap();
        assert_eq!(
            discover_from(Some(fake.clone().into_os_string()), None).as_deref(),
            Some(fake.as_path())
        );
        assert_eq!(
            discover_from(None, Some(dir.path().as_os_str().to_owned())).as_deref(),
            Some(fake.as_path())
        );
        assert_eq!(discover_from(None, Some("".into())), None);
    }
}
