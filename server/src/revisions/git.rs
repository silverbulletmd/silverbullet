use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

pub fn available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(probe)
}

fn probe() -> bool {
    #[cfg(target_os = "macos")]
    {
        let clt = Command::new("/usr/bin/xcode-select")
            .arg("-p")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !clt {
            let non_stub = which_git().map(|p| p != Path::new("/usr/bin/git").to_path_buf());
            if non_stub != Some(true) {
                return false;
            }
        }
    }
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn which_git() -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join("git"))
        .find(|c| c.is_file())
}

fn command(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    // Callers match on git's stderr text; keep it English on localized hosts.
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd
}

pub fn run(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String, String> {
    run_bytes(repo, args, envs).map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn run_bytes(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    if !available() {
        return Err("git is not installed".to_string());
    }
    let out = command(repo, args, envs)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Exit-code query: Ok(true) on status 0, Ok(false) on the given "false" code.
/// `git diff` signals "differences found" with exit code 1, the way `diff(1)`
/// does, so [`run`] would read a perfectly good diff as a failure.
pub fn run_diff(repo: &Path, args: &[&str]) -> Result<String, String> {
    if !available() {
        return Err("git is not installed".to_string());
    }
    let out = command(repo, args, &[])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    match out.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

pub fn check(repo: &Path, args: &[&str], false_code: i32) -> Result<bool, String> {
    if !available() {
        return Err("git is not installed".to_string());
    }
    let out = command(repo, args, &[])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(c) if c == false_code => Ok(false),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}
