use std::io::Read;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

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
    git_command()
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

pub(super) fn git_command() -> Command {
    let cmd = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd
    }
    #[cfg(not(windows))]
    cmd
}

fn command(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Command {
    let mut cmd = git_command();
    cmd.arg("-C").arg(repo);
    if envs
        .iter()
        .any(|(key, value)| *key == "SB_GIT_NO_HOOKS" && *value == "1")
    {
        cmd.arg("-c").arg(format!(
            "core.hooksPath={}",
            if cfg!(windows) { "NUL" } else { "/dev/null" }
        ));
    }
    cmd.args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    // Callers match on git's stderr text; keep it English on localized hosts.
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");
    if envs
        .iter()
        .any(|(key, value)| *key == "GIT_ALLOW_PROTOCOL" && *value == "ssh")
    {
        for name in [
            "GIT_CONFIG_PARAMETERS",
            "GIT_SSH",
            "GIT_PROXY_COMMAND",
            "SSH_ASKPASS",
            "GIT_ASKPASS",
            "GIT_COMMON_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            cmd.env_remove(name);
        }
    }
    for (k, v) in envs {
        if !k.starts_with("SB_MANAGED_") && *k != "SB_GIT_NO_HOOKS" {
            cmd.env(k, v);
        }
    }
    cmd
}

fn output(mut command: Command) -> Result<Output, String> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(60) {
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .args(["-KILL", "--", &format!("-{}", child.id())])
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err("git operation timed out".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    Ok(Output {
        status,
        stdout: out_thread
            .join()
            .map_err(|_| "git output reader failed")?
            .map_err(|e| e.to_string())?,
        stderr: err_thread
            .join()
            .map_err(|_| "git error reader failed")?
            .map_err(|e| e.to_string())?,
    })
}

struct ManagedTransport {
    directory: std::path::PathBuf,
    fetch_head: Option<std::path::PathBuf>,
    envs: Vec<(String, String)>,
}
impl Drop for ManagedTransport {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
impl ManagedTransport {
    fn prepare(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<Option<Self>, String> {
        use sha2::{Digest, Sha256};
        let value = |name: &str| {
            envs.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| *value)
        };
        let Some(destination) = value("SB_MANAGED_DESTINATION") else {
            return Ok(None);
        };
        let Some(operation) = args
            .first()
            .copied()
            .filter(|arg| matches!(*arg, "fetch" | "push" | "ls-remote"))
        else {
            return Ok(None);
        };
        if !args.contains(&destination) {
            return Err("managed network operation must name its checked destination".into());
        }
        let key_bytes = std::fs::read(value("SB_MANAGED_KEY").ok_or("missing managed key")?)
            .map_err(|_| "managed key is missing")?;
        if value("SB_MANAGED_KEY_HASH")
            != Some(format!("{:x}", Sha256::digest(&key_bytes)).as_str())
        {
            return Err("managed key changed after its credential check".into());
        }
        let directory =
            std::env::temp_dir().join(format!("silverbullet-git-{}", uuid::Uuid::new_v4()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(|e| e.to_string())?;
        let mut transport = Self {
            directory,
            fetch_head: None,
            envs: envs
                .iter()
                .filter(|(k, _)| !k.starts_with("SB_MANAGED_"))
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        };
        let objects = repo
            .join(run(repo, &["rev-parse", "--git-path", "objects"], &[])?.trim())
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let format = run(repo, &["rev-parse", "--show-object-format"], &[])?;
        let config = if format.trim() == "sha256" {
            "[core]\nrepositoryformatversion = 1\nbare = true\n[extensions]\nobjectformat = sha256\n"
        } else {
            "[core]\nrepositoryformatversion = 0\nbare = true\n"
        };
        std::fs::write(transport.directory.join("config"), config).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(transport.directory.join("refs/heads"))
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(transport.directory.join("objects")).map_err(|e| e.to_string())?;
        let branch = run(repo, &["symbolic-ref", "HEAD"], &[])?;
        let branch = branch.trim();
        if !branch.starts_with("refs/heads/") || branch.contains("..") {
            return Err("invalid local branch".into());
        }
        std::fs::write(transport.directory.join("HEAD"), format!("ref: {branch}\n"))
            .map_err(|e| e.to_string())?;
        if let Ok(head) = run(repo, &["rev-parse", "--verify", "HEAD"], &[]) {
            let reference = transport.directory.join(branch);
            std::fs::create_dir_all(reference.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(reference, head).map_err(|e| e.to_string())?;
        }
        let private = transport.directory.join("identity");
        std::fs::write(&private, key_bytes).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&private, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        transport.envs.retain(|(key, _)| key != "GIT_SSH_COMMAND");
        transport.envs.extend([
            (
                "GIT_DIR".into(),
                transport.directory.to_string_lossy().into_owned(),
            ),
            (
                "GIT_OBJECT_DIRECTORY".into(),
                objects.to_string_lossy().into_owned(),
            ),
            (
                "GIT_SSH_COMMAND".into(),
                crate::revisions::keys::ssh_command(
                    &private,
                    Path::new(value("SB_MANAGED_KNOWN_HOSTS").ok_or("missing host key store")?),
                ),
            ),
        ]);
        if operation == "fetch" {
            transport.fetch_head =
                Some(repo.join(run(repo, &["rev-parse", "--git-path", "FETCH_HEAD"], &[])?.trim()));
        }
        Ok(Some(transport))
    }
    fn finish(&self) -> Result<(), String> {
        if let Some(path) = &self.fetch_head {
            let bytes =
                std::fs::read(self.directory.join("FETCH_HEAD")).map_err(|e| e.to_string())?;
            let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
            std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
            std::fs::rename(temporary, path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

pub fn run(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String, String> {
    run_bytes(repo, args, envs).map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn run_bytes(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    if !available() {
        return Err("git is not installed".to_string());
    }
    let transport = ManagedTransport::prepare(repo, args, envs)?;
    let selected: Vec<_> = transport
        .as_ref()
        .map(|t| {
            t.envs
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect()
        })
        .unwrap_or_else(|| envs.to_vec());
    let out = output(command(repo, args, &selected))?;
    if out.status.success() {
        if let Some(transport) = &transport {
            transport.finish()?;
        }
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
    let out = output(command(repo, args, &[]))?;
    match out.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

pub fn check(repo: &Path, args: &[&str], false_code: i32) -> Result<bool, String> {
    if !available() {
        return Err("git is not installed".to_string());
    }
    let out = output(command(repo, args, &[]))?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(c) if c == false_code => Ok(false),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

#[cfg(all(test, unix))]
mod transport_tests {
    use super::*;
    use crate::{multi::config::GitSyncMode, revisions::keys};
    #[test]
    fn a_late_repository_rewrite_cannot_redirect_the_managed_key() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::TempDir::new().unwrap();
        let repo = tempfile::TempDir::new().unwrap();
        run(repo.path(), &["init", "-q"], &[]).unwrap();
        run(
            repo.path(),
            &[
                "remote",
                "add",
                "origin",
                "git@approved.example.test:notes.git",
            ],
            &[],
        )
        .unwrap();
        keys::generate(root.path(), "sample").unwrap();
        let mut envs =
            keys::checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path())
                .unwrap();
        run(
            repo.path(),
            &[
                "config",
                "url.git@other.example.test:.insteadOf",
                "git@approved.example.test:",
            ],
            &[],
        )
        .unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let ssh = bin.join("ssh");
        std::fs::write(
            &ssh,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$SB_TEST_SSH_LOG\"\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o700)).unwrap();
        let log = root.path().join("ssh-args");
        envs.push((
            "PATH".into(),
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        ));
        envs.push(("SB_TEST_SSH_LOG".into(), log.to_string_lossy().into_owned()));
        let refs: Vec<_> = envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        assert!(run(
            repo.path(),
            &["ls-remote", "--", "git@approved.example.test:notes.git"],
            &refs
        )
        .is_err());
        let args = std::fs::read_to_string(log).unwrap();
        assert!(args.contains("git@approved.example.test"), "{args}");
        assert!(!args.contains("other.example.test"), "{args}");
        assert!(
            !args.contains(
                &keys::key_path(root.path(), "sample")
                    .to_string_lossy()
                    .to_string()
            ),
            "the executor must pin a copied key"
        );
    }
    #[test]
    fn managed_fetch_and_push_use_shared_objects_without_live_config() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::TempDir::new().unwrap();
        let repo = tempfile::TempDir::new().unwrap();
        let remote = tempfile::TempDir::new().unwrap();
        run(repo.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        std::fs::write(repo.path().join("Note.md"), "A note\n").unwrap();
        run(repo.path(), &["add", "Note.md"], &[]).unwrap();
        run(
            repo.path(),
            &[
                "-c",
                "user.name=Sample",
                "-c",
                "user.email=sample@example.test",
                "commit",
                "-qm",
                "Create note",
            ],
            &[],
        )
        .unwrap();
        run(remote.path(), &["init", "-q", "--bare"], &[]).unwrap();
        let url = format!("git@approved.example.test:{}", remote.path().display());
        run(repo.path(), &["remote", "add", "origin", &url], &[]).unwrap();
        keys::generate(root.path(), "sample").unwrap();
        let mut envs =
            keys::checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path())
                .unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let ssh = bin.join("ssh");
        std::fs::write(&ssh,"#!/bin/sh\nfor last do :; done\nunset GIT_DIR GIT_OBJECT_DIRECTORY\nexec sh -c \"$last\"\n").unwrap();
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o700)).unwrap();
        envs.push((
            "PATH".into(),
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        ));
        let refs: Vec<_> = envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        run(
            repo.path(),
            &["push", "--", &url, "HEAD:refs/heads/main"],
            &refs,
        )
        .unwrap();
        run(repo.path(), &["fetch", "--", &url, "main"], &refs).unwrap();
        assert_eq!(
            run(repo.path(), &["rev-parse", "FETCH_HEAD"], &[]).unwrap(),
            run(remote.path(), &["rev-parse", "refs/heads/main"], &[]).unwrap()
        );
        assert_eq!(
            run(repo.path(), &["show", "FETCH_HEAD:Note.md"], &[]).unwrap(),
            "A note\n"
        );
    }
}
