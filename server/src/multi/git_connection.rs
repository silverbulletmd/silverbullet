use super::config::{GitSyncConfig, GitSyncMode};
use crate::revisions::{git, keys};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const CONNECTION_CHECK_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub version: u64,
    pub url: String,
    pub mode: GitSyncMode,
    pub pull_interval_secs: u64,
    pub public_key: Option<String>,
    pub fingerprint: Option<String>,
    pub test: Option<serde_json::Value>,
    pub branch: String,
    pub remote_branch: String,
    pub remote_name: String,
    expires_at: u64,
    base_generation: String,
    #[serde(default)]
    base_connection_revision: String,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn directory(root: &Path, id: &str) -> PathBuf {
    root.join("git-drafts").join(id)
}
fn draft_dir(root: &Path, id: &str, draft: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(draft).map_err(|_| "no such draft".to_string())?;
    Ok(directory(root, id).join(draft))
}
fn generation(root: &Path, id: &str) -> String {
    std::fs::read_to_string(
        root.join("git-connections")
            .join(format!("{id}.generation")),
    )
    .unwrap_or_default()
}
fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(path.parent().ok_or("invalid storage path")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(path.parent().unwrap())
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn live_connection_revision(
    root: &Path,
    id: &str,
    repo: &Path,
    remote: &str,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let branch = git::run(repo, &["symbolic-ref", "--short", "HEAD"], &[])?;
    let config = git::run_bytes(repo, &["config", "--null", "--list"], &[])?;
    let remote_prefix = format!("remote.{remote}.");
    let branch_prefix = format!("branch.{}.", branch.trim());
    let mut hash = Sha256::new();
    hash.update(branch.as_bytes());
    for entry in config.split(|byte| *byte == 0) {
        let name = entry
            .split(|byte| *byte == b'\n')
            .next()
            .unwrap_or_default();
        if name.starts_with(remote_prefix.as_bytes())
            || name.starts_with(branch_prefix.as_bytes())
            || name.starts_with(b"url.")
            || name.starts_with(b"credential.")
            || name.starts_with(b"http.")
            || matches!(name, b"core.sshcommand" | b"core.gitproxy")
        {
            hash.update((entry.len() as u64).to_le_bytes());
            hash.update(entry);
        }
    }
    for path in [
        keys::key_path(root, id),
        keys::key_path(root, &format!("{id}.pub")),
    ] {
        match std::fs::read(path) {
            Ok(bytes) => {
                hash.update([1]);
                hash.update((bytes.len() as u64).to_le_bytes());
                hash.update(bytes);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => hash.update([0]),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn create_draft(
    root: &Path,
    id: &str,
    repo: &Path,
    policy: GitSyncConfig,
) -> Result<Draft, String> {
    if let Ok(entries) = std::fs::read_dir(directory(root, id)) {
        for entry in entries.flatten() {
            if let Ok(bytes) = std::fs::read(entry.path().join("draft.json")) {
                if serde_json::from_slice::<Draft>(&bytes).is_ok_and(|d| d.expires_at < now()) {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    let branch = git::run(repo, &["symbolic-ref", "--short", "HEAD"], &[])?
        .trim()
        .to_string();
    let target = crate::revisions::sync::resolve_target(repo).ok();
    let remote_name = target.map(|t| t.remote).unwrap_or_else(|| "origin".into());
    let url = git::run(
        repo,
        &["config", "--get", &format!("remote.{remote_name}.url")],
        &[],
    )
    .unwrap_or_default()
    .trim()
    .to_string();
    let remote_branch = git::run(
        repo,
        &["config", "--get", &format!("branch.{branch}.merge")],
        &[],
    )
    .ok()
    .and_then(|s| s.trim().strip_prefix("refs/heads/").map(String::from))
    .unwrap_or_else(|| branch.clone());
    let mut draft = Draft {
        id: uuid::Uuid::new_v4().to_string(),
        version: 1,
        url,
        mode: if policy.mode.is_off() {
            GitSyncMode::Key
        } else {
            policy.mode
        },
        pull_interval_secs: policy.pull_interval_secs,
        public_key: None,
        fingerprint: None,
        test: None,
        branch,
        remote_branch,
        remote_name: remote_name.clone(),
        expires_at: now() + 86_400_000,
        base_generation: generation(root, id),
        base_connection_revision: live_connection_revision(root, id, repo, &remote_name)?,
    };
    let folder = draft_dir(root, id, &draft.id)?;
    if let Ok(private) = std::fs::read(keys::key_path(root, id)) {
        atomic_write(&keys::key_path(&folder, "key"), &private)?;
        if let Some(public) = keys::public_key(root, id) {
            atomic_write(&keys::key_path(&folder, "key.pub"), public.as_bytes())?;
        }
        draft.public_key = keys::public_key(&folder, "key");
        draft.fingerprint = keys::fingerprint(&folder, "key");
    }
    save_draft(root, id, &draft)?;
    Ok(draft)
}
fn save_draft(root: &Path, id: &str, draft: &Draft) -> Result<(), String> {
    atomic_write(
        &draft_dir(root, id, &draft.id)?.join("draft.json"),
        &serde_json::to_vec(draft).map_err(|e| e.to_string())?,
    )
}
fn load_draft(root: &Path, id: &str, draft: &str, version: u64) -> Result<Draft, String> {
    let bytes = std::fs::read(draft_dir(root, id, draft)?.join("draft.json"))
        .map_err(|_| "no such draft")?;
    let draft: Draft = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if draft.version != version
        || draft.expires_at < now()
        || draft.base_generation != generation(root, id)
    {
        return Err("staleDraft".into());
    }
    Ok(draft)
}
fn configure(repo: &Path, draft: &Draft) -> Result<(), String> {
    let name = &draft.remote_name;
    let _ = git::run(
        repo,
        &["config", "--unset-all", &format!("remote.{name}.url")],
        &[],
    );
    let _ = git::run(
        repo,
        &["config", "--unset-all", &format!("remote.{name}.pushurl")],
        &[],
    );
    git::run(
        repo,
        &["config", &format!("remote.{name}.url"), &draft.url],
        &[],
    )?;
    git::run(
        repo,
        &[
            "config",
            &format!("remote.{name}.fetch"),
            &format!("+refs/heads/*:refs/remotes/{name}/*"),
        ],
        &[],
    )?;
    git::run(
        repo,
        &["config", &format!("branch.{}.remote", draft.branch), name],
        &[],
    )?;
    git::run(
        repo,
        &[
            "config",
            &format!("branch.{}.merge", draft.branch),
            &format!("refs/heads/{}", draft.remote_branch),
        ],
        &[],
    )?;
    Ok(())
}
struct Inspection(PathBuf);
impl Drop for Inspection {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn check_draft(root: &Path, id: &str, repo: &Path, draft: &mut Draft) -> Result<(), String> {
    use serde_json::json;
    let folder = draft_dir(root, id, &draft.id)?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    let repo = repo.canonicalize().map_err(|e| e.to_string())?;
    let inspection = Inspection(folder.join(format!("inspect-{}", uuid::Uuid::new_v4())));
    git::run_with_timeout(
        &repo,
        &[
            "clone",
            "--bare",
            "--no-hardlinks",
            "--",
            &repo.to_string_lossy(),
            &inspection.0.to_string_lossy(),
        ],
        &[("SB_GIT_NO_HOOKS", "1")],
        CONNECTION_CHECK_TIMEOUT,
    )?;
    let config_path = git::run(
        &repo,
        &["rev-parse", "--git-path", "config"],
        &[("SB_GIT_NO_HOOKS", "1")],
    )?;
    let config_path = repo.join(config_path.trim());
    std::fs::copy(config_path, inspection.0.join("config")).map_err(|e| e.to_string())?;
    git::run(
        &inspection.0,
        &["config", "core.bare", "true"],
        &[("SB_GIT_NO_HOOKS", "1")],
    )?;
    let _ = git::run(
        &inspection.0,
        &["config", "--unset", "core.worktree"],
        &[("SB_GIT_NO_HOOKS", "1")],
    );
    configure(&inspection.0, draft)?;
    let mut envs = match keys::checked_envs_for_mode(draft.mode, &folder, "key", &inspection.0) {
        Ok(envs) => envs,
        Err(error) => {
            let (kind, message) = crate::revisions::describe_sync_error(&error);
            draft.test = Some(
                json!({"reachable":false,"writable":false,"kind":kind,"message":message,"checkedUrl":draft.url,"checkedAt":now()}),
            );
            return Ok(());
        }
    };
    if draft.mode == GitSyncMode::Key {
        if let Some((_, path)) = envs
            .iter_mut()
            .find(|(name, _)| name == "SB_MANAGED_KNOWN_HOSTS")
        {
            *path = keys::known_hosts_path(root).to_string_lossy().into_owned();
        }
    }
    envs.push(("SB_GIT_NO_HOOKS".into(), "1".into()));
    let envs: Vec<_> = envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    if git::run(
        &repo,
        &["config", "--get", &format!("branch.{}.merge", draft.branch)],
        &[],
    )
    .is_err()
    {
        if let Ok(refs) = git::run_with_timeout(
            &inspection.0,
            &["ls-remote", "--symref", "--", &draft.url, "HEAD"],
            &envs,
            CONNECTION_CHECK_TIMEOUT,
        ) {
            if let Some(branch) = refs.lines().find_map(|line| {
                line.strip_prefix("ref: refs/heads/")
                    .and_then(|s| s.strip_suffix("\tHEAD"))
            }) {
                if git::run(
                    &inspection.0,
                    &["check-ref-format", &format!("refs/heads/{branch}")],
                    &[],
                )
                .is_ok()
                {
                    draft.remote_branch = branch.to_string();
                }
            }
        }
    }
    let local_head = git::run(
        &inspection.0,
        &["rev-parse", "--verify", "HEAD"],
        &[("SB_GIT_NO_HOOKS", "1")],
    )
    .ok()
    .map(|s| s.trim().to_string());
    let mut result = json!({"reachable":false,"writable":false,"kind":"other","message":"Connection check failed", "checkedUrl":draft.url,"checkedAt":now(),"branch":draft.branch,"remoteBranch":draft.remote_branch,"localHead":local_head,"remoteHead":null,"ahead":null,"behind":null,"unrelated":false,"credentialIdentity":keys::connection_identity(&inspection.0,&folder,"key",draft.mode).ok()});
    match git::run_with_timeout(
        &inspection.0,
        &[
            "ls-remote",
            "--heads",
            "--",
            &draft.url,
            &format!("refs/heads/{}", draft.remote_branch),
        ],
        &envs,
        CONNECTION_CHECK_TIMEOUT,
    ) {
        Err(error) => {
            let (kind, message) = super::admin_api::classify_git_test_error(&error);
            result["kind"] = json!(kind);
            result["message"] = json!(message);
        }
        Ok(refs) => {
            result["reachable"] = json!(true);
            let remote_head = refs.split_whitespace().next().map(String::from);
            result["remoteHead"] = json!(remote_head);
            if remote_head.is_some() {
                match git::run_with_timeout(
                    &inspection.0,
                    &["fetch", "--no-tags", "--", &draft.url, &draft.remote_branch],
                    &envs,
                    CONNECTION_CHECK_TIMEOUT,
                ) {
                    Ok(_) => {
                        if local_head.is_some() {
                            if let Ok((ahead, behind)) =
                                crate::revisions::sync::ahead_behind(&inspection.0, "HEAD")
                            {
                                result["ahead"] = json!(ahead);
                                result["behind"] = json!(behind);
                            }
                            result["unrelated"] = json!(git::run(
                                &inspection.0,
                                &["merge-base", "HEAD", "FETCH_HEAD"],
                                &[("SB_GIT_NO_HOOKS", "1")]
                            )
                            .is_err());
                        }
                    }
                    Err(error) => {
                        let (kind, message) = super::admin_api::classify_git_test_error(&error);
                        result["kind"] = json!(kind);
                        result["message"] = json!(message);
                        result["checkedAt"] = json!(now());
                        draft.test = Some(result);
                        return Ok(());
                    }
                }
            } else {
                result["behind"] = json!(0);
                result["ahead"] = json!(git::run(
                    &inspection.0,
                    &["rev-list", "--count", "HEAD"],
                    &[("SB_GIT_NO_HOOKS", "1")]
                )
                .ok()
                .and_then(|s| s.trim().parse::<usize>().ok()));
            }
            if local_head.is_none() {
                result["kind"] = json!("emptyRepo");
                result["message"] = json!("Repository reachable. Push preflight is inconclusive until this space has a commit.");
            } else {
                match git::run_with_timeout(
                    &inspection.0,
                    &[
                        "push",
                        "--dry-run",
                        "-q",
                        "--",
                        &draft.url,
                        &format!("HEAD:refs/heads/{}", draft.remote_branch),
                    ],
                    &envs,
                    CONNECTION_CHECK_TIMEOUT,
                ) {
                    Ok(_) => {
                        result["writable"] = json!(true);
                        result["kind"] = json!("ok");
                        result["message"] = json!("Repository reachable. Push preflight passed; server hooks and branch protection may still reject a real push.");
                    }
                    Err(error) => {
                        let (kind, message) = super::admin_api::classify_git_test_error(&error);
                        result["kind"] = json!(kind);
                        result["message"] = json!(message);
                    }
                }
            }
        }
    }
    result["checkedAt"] = json!(now());
    draft.test = Some(result);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repo() -> tempfile::TempDir {
        let repo = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q"], &[]).unwrap();
        repo
    }
    #[test]
    #[cfg(unix)]
    fn manual_connection_check_does_not_run_live_hooks() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::TempDir::new().unwrap();
        let repo = repo();
        let remote = tempfile::TempDir::new().unwrap();
        git::run(remote.path(), &["init", "-q", "--bare"], &[]).unwrap();
        std::fs::write(repo.path().join("Note.md"), "A note\n").unwrap();
        git::run(repo.path(), &["add", "Note.md"], &[]).unwrap();
        git::run(
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
        let hooks = root.path().join("hooks");
        std::fs::create_dir(&hooks).unwrap();
        let sentinel = repo.path().join("Hook.md");
        let hook = hooks.join("pre-push");
        std::fs::write(
            &hook,
            format!("#!/bin/sh\nprintf changed > '{}'\n", sentinel.display()),
        )
        .unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
        git::run(
            repo.path(),
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
            &[],
        )
        .unwrap();
        let mut draft =
            create_draft(root.path(), "sample", repo.path(), GitSyncConfig::default()).unwrap();
        draft.mode = GitSyncMode::Manual;
        draft.url = remote.path().to_string_lossy().into_owned();
        check_draft(root.path(), "sample", repo.path(), &mut draft).unwrap();
        assert_eq!(draft.test.as_ref().unwrap()["kind"], "ok");
        assert!(
            !sentinel.exists(),
            "checking a draft ran the active pre-push hook"
        );
    }

    #[test]
    fn draft_checks_candidate_without_changing_live_origin() {
        let root = tempfile::TempDir::new().unwrap();
        let repo = repo();
        let remote = tempfile::TempDir::new().unwrap();
        git::run(remote.path(), &["init", "-q", "--bare"], &[]).unwrap();
        git::run(
            repo.path(),
            &["remote", "add", "origin", "git@example.test:original.git"],
            &[],
        )
        .unwrap();
        let mut draft =
            create_draft(root.path(), "sample", repo.path(), GitSyncConfig::default()).unwrap();
        draft.mode = GitSyncMode::Manual;
        draft.url = remote.path().to_string_lossy().into_owned();
        check_draft(root.path(), "sample", repo.path(), &mut draft).unwrap();
        assert_eq!(draft.test.as_ref().unwrap()["reachable"], true);
        assert_eq!(
            git::run(repo.path(), &["remote", "get-url", "origin"], &[])
                .unwrap()
                .trim(),
            "git@example.test:original.git"
        );
    }
    #[test]
    fn new_connection_uses_remote_default_branch() {
        let root = tempfile::TempDir::new().unwrap();
        let repo = tempfile::TempDir::new().unwrap();
        let remote = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q", "-b", "master"], &[]).unwrap();
        git::run(remote.path(), &["init", "-q", "--bare", "-b", "main"], &[]).unwrap();
        std::fs::write(repo.path().join("Local.md"), "local\n").unwrap();
        git::run(repo.path(), &["add", "Local.md"], &[]).unwrap();
        git::run(
            repo.path(),
            &[
                "-c",
                "user.name=Sample",
                "-c",
                "user.email=sample@example.test",
                "commit",
                "-qm",
                "Local",
            ],
            &[],
        )
        .unwrap();
        let seed = tempfile::TempDir::new().unwrap();
        git::run(seed.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        std::fs::write(seed.path().join("Remote.md"), "remote\n").unwrap();
        git::run(seed.path(), &["add", "Remote.md"], &[]).unwrap();
        git::run(
            seed.path(),
            &[
                "-c",
                "user.name=Sample",
                "-c",
                "user.email=sample@example.test",
                "commit",
                "-qm",
                "Remote",
            ],
            &[],
        )
        .unwrap();
        git::run(
            seed.path(),
            &["push", "-q", &remote.path().to_string_lossy(), "main"],
            &[],
        )
        .unwrap();
        let mut draft =
            create_draft(root.path(), "sample", repo.path(), GitSyncConfig::default()).unwrap();
        draft.mode = GitSyncMode::Manual;
        draft.url = remote.path().to_string_lossy().into_owned();
        check_draft(root.path(), "sample", repo.path(), &mut draft).unwrap();
        assert_eq!(draft.branch, "master");
        assert_eq!(draft.remote_branch, "main");
        assert_eq!(draft.test.as_ref().unwrap()["remoteBranch"], "main");
    }
    #[test]
    fn draft_check_accepts_relative_space_folder() {
        let cwd = std::env::current_dir().unwrap();
        let root = tempfile::TempDir::new_in(&cwd).unwrap();
        let relative_root = root.path().strip_prefix(&cwd).unwrap();
        let repo = relative_root.join("space");
        let remote = root.path().join("remote");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&remote).unwrap();
        git::run(&repo, &["init", "-q"], &[]).unwrap();
        git::run(&remote, &["init", "-q", "--bare"], &[]).unwrap();
        std::fs::write(repo.join("Note.md"), "A note\n").unwrap();
        git::run(&repo, &["add", "Note.md"], &[]).unwrap();
        git::run(
            &repo,
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
        let mut draft =
            create_draft(relative_root, "sample", &repo, GitSyncConfig::default()).unwrap();
        draft.mode = GitSyncMode::Manual;
        draft.url = remote.to_string_lossy().into_owned();

        check_draft(relative_root, "sample", &repo, &mut draft).unwrap();

        assert_eq!(draft.test.as_ref().unwrap()["kind"], "ok");
    }
    #[test]
    fn stale_draft_version_cannot_read_current_approval() {
        let root = tempfile::TempDir::new().unwrap();
        let repo = repo();
        let mut draft =
            create_draft(root.path(), "sample", repo.path(), GitSyncConfig::default()).unwrap();
        let version = draft.version;
        draft.version += 1;
        save_draft(root.path(), "sample", &draft).unwrap();
        assert!(load_draft(root.path(), "sample", &draft.id, version).is_err());
        assert_eq!(
            load_draft(root.path(), "sample", &draft.id, draft.version)
                .unwrap()
                .version,
            draft.version
        );
    }
    #[test]
    fn interrupted_activation_restores_policy_remote_and_key_at_each_phase() {
        for phase in 0..=4 {
            let root = tempfile::TempDir::new().unwrap();
            let repo = repo();
            let mut config = super::super::config::MultiConfig::from_json(
                r#"{"sample":{"name":"Original","binding":{"prefix":"/sample"}}}"#,
            )
            .unwrap();
            config.save(&root.path().join("spaces.json")).unwrap();
            git::run(
                repo.path(),
                &["remote", "add", "origin", "git@example.test:old.git"],
                &[],
            )
            .unwrap();
            let original_key = keys::generate(root.path(), "sample").unwrap();
            begin_change(root.path(), "sample", repo.path(), None).unwrap();
            if phase >= 1 {
                git::run(
                    repo.path(),
                    &["remote", "set-url", "origin", "git@example.test:new.git"],
                    &[],
                )
                .unwrap();
            }
            if phase >= 2 {
                keys::generate(root.path(), "sample").unwrap();
            }
            if phase >= 3 {
                config.spaces.get_mut("sample").unwrap().git_sync = Some(GitSyncConfig {
                    mode: GitSyncMode::Key,
                    paused: false,
                    pull_interval_secs: 0,
                });
                config.save(&root.path().join("spaces.json")).unwrap();
            }
            if phase >= 4 {
                atomic_write(&root.path().join("git-connections/sample.identity"), b"new").unwrap();
            }
            config.spaces.get_mut("sample").unwrap().name = "Unrelated edit".into();
            recover(root.path(), &mut config).unwrap();
            assert!(config.spaces["sample"].git_sync.is_none(), "phase {phase}");
            assert_eq!(config.spaces["sample"].name, "Unrelated edit");
            assert_eq!(
                git::run(repo.path(), &["remote", "get-url", "origin"], &[])
                    .unwrap()
                    .trim(),
                "git@example.test:old.git"
            );
            assert_eq!(
                keys::public_key(root.path(), "sample").unwrap(),
                original_key
            );
            assert!(!root.path().join("git-connections/sample.identity").exists());
            assert!(!journal_path(root.path(), "sample").exists());
        }
    }
    #[test]
    fn draft_check_distinguishes_unrelated_history_and_missing_remote() {
        fn commit(repo: &Path, name: &str) {
            std::fs::write(repo.join(name), name).unwrap();
            git::run(repo, &["add", "--", name], &[]).unwrap();
            git::run(
                repo,
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
        }
        let root = tempfile::TempDir::new().unwrap();
        let local = repo();
        let remote = repo();
        commit(local.path(), "Local.md");
        commit(remote.path(), "Remote.md");
        let mut draft = create_draft(
            root.path(),
            "sample",
            local.path(),
            GitSyncConfig::default(),
        )
        .unwrap();
        draft.mode = GitSyncMode::Manual;
        draft.url = remote.path().to_string_lossy().into_owned();
        check_draft(root.path(), "sample", local.path(), &mut draft).unwrap();
        let check = draft.test.as_ref().unwrap();
        assert_eq!(check["reachable"], true);
        assert_eq!(check["unrelated"], true);
        assert_eq!(check["ahead"], 1);
        assert_eq!(check["behind"], 1);
        assert_eq!(check["kind"], "behind");
        draft.url = root.path().join("missing").to_string_lossy().into_owned();
        check_draft(root.path(), "sample", local.path(), &mut draft).unwrap();
        assert_eq!(draft.test.as_ref().unwrap()["reachable"], false);
        assert_eq!(draft.test.as_ref().unwrap()["kind"], "notFound");
    }
}

#[derive(Serialize, Deserialize)]
struct Backup {
    path: PathBuf,
    content: Option<Vec<u8>>,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    id: String,
    policy: Option<GitSyncConfig>,
    backups: Vec<Backup>,
}
fn journal_path(root: &Path, id: &str) -> PathBuf {
    root.join("git-connections").join(format!("{id}.journal"))
}
pub(super) fn begin_change(
    root: &Path,
    id: &str,
    repo: &Path,
    policy: Option<GitSyncConfig>,
) -> Result<(), String> {
    let config = git::run(repo, &["rev-parse", "--git-path", "config"], &[])?;
    let paths = [
        repo.join(config.trim()),
        keys::key_path(root, id),
        keys::key_path(root, &format!("{id}.pub")),
        root.join("git-connections").join(format!("{id}.identity")),
        root.join("git-connections")
            .join(format!("{id}.generation")),
        root.join("git-connections").join(format!("{id}.consent")),
    ];
    let backups = paths
        .into_iter()
        .map(|path| {
            let content = match std::fs::read(&path) {
                Ok(v) => Some(v),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(e.to_string()),
            };
            Ok(Backup { path, content })
        })
        .collect::<Result<Vec<_>, String>>()?;
    atomic_write(
        &journal_path(root, id),
        &serde_json::to_vec(&Journal {
            id: id.into(),
            policy,
            backups,
        })
        .map_err(|e| e.to_string())?,
    )
}
pub(super) fn sync_git_config(repo: &Path) -> Result<(), String> {
    let path = repo.join(git::run(repo, &["rev-parse", "--git-path", "config"], &[])?.trim());
    std::fs::File::open(&path)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(path.parent().ok_or("missing Git directory")?)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn finish_change(root: &Path, id: &str) -> Result<(), String> {
    let path = journal_path(root, id);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    #[cfg(unix)]
    std::fs::File::open(path.parent().unwrap())
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub(super) fn recover(root: &Path, config: &mut super::config::MultiConfig) -> Result<(), String> {
    let entries = match std::fs::read_dir(root.join("git-connections")) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_none_or(|e| e != "journal") {
            continue;
        }
        let journal: Journal =
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("invalid Git activation journal: {e}"))?;
        for backup in journal.backups {
            if let Some(content) = backup.content {
                atomic_write(&backup.path, &content)?;
            } else if backup.path.exists() {
                std::fs::remove_file(backup.path).map_err(|e| e.to_string())?;
            }
        }
        if let Some(space) = config.spaces.get_mut(&journal.id) {
            space.git_sync = journal.policy;
        }
        config.save(&root.join("spaces.json"))?;
        finish_change(root, &journal.id)?;
    }
    Ok(())
}

use super::admin_api::{syncable_repo, AdminState};
use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, post, put},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Update {
    version: u64,
    url: String,
    mode: GitSyncMode,
    pull_interval_secs: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    version: u64,
    #[serde(default)]
    allow_unrelated: bool,
}

async fn operation(
    state: Arc<AdminState>,
    id: String,
    op: impl FnOnce(&super::manager::MultiManager, &str) -> Result<Value, String> + Send + 'static,
) -> Response {
    match crate::router::run_blocking(move || {
        let _guard = state.manager.git_connections.lock().unwrap();
        Ok(op(&state.manager, &id))
    })
    .await
    {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(message)) => {
            let status = if message == "staleDraft" {
                StatusCode::CONFLICT
            } else if message == "no such draft" || message == "no such space" {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({"kind": if message == "staleDraft" { "staleDraft" } else { "connectionError" }, "errors":[{"field":"gitSync","message":crate::revisions::redact_credentials(&message)}]}))).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
fn instance(
    manager: &super::manager::MultiManager,
    id: &str,
) -> Result<(Arc<super::instance::SpaceInstance>, PathBuf), String> {
    let instance = manager.instance(id).ok_or("no such space")?;
    if instance.config.read_only {
        return Err("this space is read only".into());
    }
    let repo =
        syncable_repo(&instance).ok_or("this space has no managed Git repository of its own")?;
    if manager
        .root()
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(repo.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("a Git connection cannot include the data folder".into());
    }
    Ok((instance, repo))
}
async fn create(State(state): State<Arc<AdminState>>, AxumPath(id): AxumPath<String>) -> Response {
    operation(state, id, |manager, id| {
        let (instance, repo) = instance(manager, id)?;
        serde_json::to_value(create_draft(
            manager.root(),
            id,
            &repo,
            instance.config.git_sync(),
        )?)
        .map_err(|e| e.to_string())
    })
    .await
}
async fn update(
    State(state): State<Arc<AdminState>>,
    AxumPath((id, draft_id)): AxumPath<(String, String)>,
    Json(body): Json<Update>,
) -> Response {
    operation(state, id, move |manager, id| {
        instance(manager, id)?;
        let mut draft = load_draft(manager.root(), id, &draft_id, body.version)?;
        if body.mode.is_off() || body.url.trim().is_empty() || keys::is_unsafe_url(&body.url) {
            return Err("choose a repository and authentication method".into());
        }
        draft.url = body.url;
        draft.mode = body.mode;
        draft.pull_interval_secs = body.pull_interval_secs;
        draft.test = None;
        draft.version += 1;
        save_draft(manager.root(), id, &draft)?;
        serde_json::to_value(draft).map_err(|e| e.to_string())
    })
    .await
}
async fn cancel(
    State(state): State<Arc<AdminState>>,
    AxumPath((id, draft_id)): AxumPath<(String, String)>,
) -> Response {
    operation(state, id, move |manager, id| {
        instance(manager, id)?;
        let folder = draft_dir(manager.root(), id, &draft_id)?;
        if folder.exists() {
            std::fs::remove_dir_all(folder).map_err(|e| e.to_string())?;
        }
        Ok(json!({"status":"ok"}))
    })
    .await
}
async fn generate_key(
    State(state): State<Arc<AdminState>>,
    AxumPath((id, draft_id)): AxumPath<(String, String)>,
    Json(body): Json<Version>,
) -> Response {
    operation(state, id, move |manager, id| {
        instance(manager, id)?;
        let mut draft = load_draft(manager.root(), id, &draft_id, body.version)?;
        let folder = draft_dir(manager.root(), id, &draft_id)?;
        draft.public_key = Some(keys::generate(&folder, "key")?);
        draft.fingerprint = keys::fingerprint(&folder, "key");
        draft.version += 1;
        draft.test = None;
        save_draft(manager.root(), id, &draft)?;
        serde_json::to_value(draft).map_err(|e| e.to_string())
    })
    .await
}
async fn test(
    State(state): State<Arc<AdminState>>,
    AxumPath((id, draft_id)): AxumPath<(String, String)>,
    Json(body): Json<Version>,
) -> Response {
    operation(state, id, move |manager, id| {
        let (_, repo) = instance(manager, id)?;
        let mut draft = load_draft(manager.root(), id, &draft_id, body.version)?;
        check_draft(manager.root(), id, &repo, &mut draft)?;
        draft.version += 1;
        save_draft(manager.root(), id, &draft)?;
        serde_json::to_value(draft).map_err(|e| e.to_string())
    })
    .await
}
fn manager_error(error: super::manager::ApiError) -> String {
    match error {
        super::manager::ApiError::Internal(message) => message,
        super::manager::ApiError::NotFound => "no such space".into(),
        super::manager::ApiError::Validation(errors) => errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; "),
    }
}
async fn apply(
    State(state): State<Arc<AdminState>>,
    AxumPath((id, draft_id)): AxumPath<(String, String)>,
    Json(body): Json<Version>,
) -> Response {
    operation(state,id,move |manager,id| {
        let (_,repo) = instance(manager,id)?;
        let draft = load_draft(manager.root(),id,&draft_id,body.version)?;
        if draft.base_connection_revision != live_connection_revision(manager.root(),id,&repo,&draft.remote_name)? { return Err("staleDraft".into()); }
        let checked = draft.test.as_ref().ok_or("check this connection before enabling sync")?;
        if checked["reachable"] != true || !matches!(checked["kind"].as_str(),Some("ok"|"behind"|"emptyRepo")) { return Err("the connection check must succeed before enabling sync".into()); }
        if checked["checkedAt"].as_u64().is_none_or(|time| now().saturating_sub(time) > 600_000) { return Err("staleDraft".into()); }
        if checked["unrelated"] == true && !body.allow_unrelated { return Err("review and confirm combining these unrelated histories".into()); }
        let head = git::run(&repo,&["rev-parse","--verify","HEAD"],&[]).ok().map(|s|s.trim().to_string());
        if checked["localHead"] != json!(head) { return Err("staleDraft".into()); }
        let root = manager.root();
        manager.change_git(id,false,|instance,config| {
            let repo = syncable_repo(instance).ok_or("this space cannot sync")?;
            if git::run(&repo,&["symbolic-ref","--short","HEAD"],&[])?.trim() != draft.branch { return Err("staleDraft".into()); }
            let head = git::run(&repo,&["rev-parse","--verify","HEAD"],&[]).ok().map(|s|s.trim().to_string());
            if checked["localHead"] != json!(head) { return Err("staleDraft".into()); }
            if draft.base_connection_revision != live_connection_revision(root,id,&repo,&draft.remote_name)? { return Err("staleDraft".into()); }
            configure(&repo,&draft)?;
            let folder = draft_dir(root,id,&draft.id)?;
            if checked["credentialIdentity"] != json!(keys::connection_identity(&repo,&folder,"key",draft.mode).ok()) { return Err("staleDraft".into()); }
            if draft.mode == GitSyncMode::Key {
                let key = std::fs::read(keys::key_path(&folder,"key")).map_err(|_|"generate a deploy key before enabling sync")?;
                atomic_write(&keys::key_path(root,id),&key)?;
                atomic_write(&keys::key_path(root,&format!("{id}.pub")),draft.public_key.as_deref().ok_or("missing public key")?.as_bytes())?;
            }
            let identity = keys::connection_identity(&repo,root,id,draft.mode).map_err(|e|format!("{e:?}"))?;
            atomic_write(&root.join("git-connections").join(format!("{id}.identity")),identity.as_bytes())?;
            if checked["unrelated"] == true { atomic_write(&root.join("git-connections").join(format!("{id}.consent")), &serde_json::to_vec(&json!({"localHead":checked["localHead"],"remoteHead":checked["remoteHead"]})).map_err(|e|e.to_string())?)?; }
            atomic_write(&root.join("git-connections").join(format!("{id}.generation")),uuid::Uuid::new_v4().to_string().as_bytes())?;
            config.git_sync = Some(GitSyncConfig { mode:draft.mode,paused:false,pull_interval_secs:draft.pull_interval_secs }); Ok(())
        }).map_err(manager_error)?;
        let _ = std::fs::remove_dir_all(draft_dir(root,id,&draft.id)?);
        Ok(json!({"status":"ok"}))
    }).await
}
async fn policy(state: Arc<AdminState>, id: String, paused: Option<bool>) -> Response {
    operation(state, id, move |manager, id| {
        instance(manager, id)?;
        manager
            .change_git(id, true, |instance, config| {
                let mut policy = instance.config.git_sync();
                if let Some(paused) = paused {
                    if policy.mode.is_off() {
                        return Err("connect a repository first".into());
                    }
                    policy.paused = paused;
                    config.git_sync = Some(policy);
                } else {
                    config.git_sync = None;
                    let identity = manager
                        .root()
                        .join("git-connections")
                        .join(format!("{id}.identity"));
                    if identity.exists() {
                        std::fs::remove_file(identity).map_err(|e| e.to_string())?;
                    }
                }
                atomic_write(
                    &manager
                        .root()
                        .join("git-connections")
                        .join(format!("{id}.generation")),
                    uuid::Uuid::new_v4().to_string().as_bytes(),
                )?;
                Ok(())
            })
            .map_err(manager_error)?;
        Ok(json!({"status":"ok"}))
    })
    .await
}
async fn pause(State(state): State<Arc<AdminState>>, AxumPath(id): AxumPath<String>) -> Response {
    policy(state, id, Some(true)).await
}
async fn resume(State(state): State<Arc<AdminState>>, AxumPath(id): AxumPath<String>) -> Response {
    policy(state, id, Some(false)).await
}
async fn disconnect(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    policy(state, id, None).await
}
pub(super) fn routes() -> Router<Arc<AdminState>> {
    Router::new()
        .route("/spaces/{id}/git/draft", post(create))
        .route(
            "/spaces/{id}/git/draft/{draftId}",
            put(update).delete(cancel),
        )
        .route("/spaces/{id}/git/draft/{draftId}/key", post(generate_key))
        .route("/spaces/{id}/git/draft/{draftId}/test", post(test))
        .route("/spaces/{id}/git/draft/{draftId}/apply", post(apply))
        .route("/spaces/{id}/git/pause", post(pause))
        .route("/spaces/{id}/git/resume", post(resume))
        .route("/spaces/{id}/git/connection", delete(disconnect))
}
