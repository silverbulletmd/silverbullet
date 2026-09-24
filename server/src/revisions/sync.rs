use std::path::Path;

use crate::revisions::git;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    GitMissing,
    MissingManagedKey,
    UnsafeTransport,
    NoRemote,
    NoUpstream,
    DetachedHead,
    AuthFailed,
    HostUnreachable,
    UnrelatedHistories,
    ConsentStale,
    PushRejected,
    MergeInProgress,
    RemoteBranchMissing,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    pub remote: String,
    pub branch: String,
    pub remote_branch: String,
}

/// git's stderr is the only signal for most failures, so it is matched here
/// once rather than at each call site. `git.rs` pins LC_ALL=C, which is what
/// makes matching English text safe.
pub fn classify(stderr: &str) -> SyncError {
    let s = stderr.to_ascii_lowercase();
    // Checked before everything else, and on its own exact phrase: a missing
    // *repository* must never reach the benign first-push path.
    if s.contains("couldn't find remote ref") {
        SyncError::RemoteBranchMissing
    } else if s.contains("permission denied") || s.contains("authentication failed") {
        SyncError::AuthFailed
    } else if s.contains("could not resolve hostname")
        || s.contains("connection timed out")
        || s.contains("connection refused")
        || s.contains("could not read from remote repository")
    {
        SyncError::HostUnreachable
    } else if s.contains("unrelated histories") {
        SyncError::UnrelatedHistories
    } else if s.contains("non-fast-forward") || s.contains("[rejected]") {
        SyncError::PushRejected
    } else {
        SyncError::Other(stderr.trim().to_string())
    }
}

pub fn resolve_target(repo: &Path) -> Result<RemoteTarget, SyncError> {
    if !git::available() {
        return Err(SyncError::GitMissing);
    }
    let branch = git::run(repo, &["symbolic-ref", "--short", "HEAD"], &[])
        .map_err(|_| SyncError::DetachedHead)?
        .trim()
        .to_string();
    if branch.is_empty() {
        return Err(SyncError::DetachedHead);
    }
    let configured = git::run(
        repo,
        &["config", "--get", &format!("branch.{branch}.remote")],
        &[],
    )
    .map(|s| s.trim().to_string())
    .unwrap_or_default();
    let remote = if configured.is_empty() {
        "origin".to_string()
    } else {
        configured
    };
    git::run(
        repo,
        &["config", "--get", &format!("remote.{remote}.url")],
        &[],
    )
    .map_err(|_| SyncError::NoRemote)?;
    let mapping = git::run(
        repo,
        &["config", "--get", &format!("branch.{branch}.merge")],
        &[],
    )
    .unwrap_or_default();
    let remote_branch = if mapping.trim().is_empty() {
        branch.clone()
    } else {
        mapping
            .trim()
            .strip_prefix("refs/heads/")
            .filter(|s| !s.is_empty())
            .ok_or(SyncError::NoUpstream)?
            .to_string()
    };
    git::run(
        repo,
        &["check-ref-format", &format!("refs/heads/{remote_branch}")],
        &[],
    )
    .map_err(|_| SyncError::NoUpstream)?;
    Ok(RemoteTarget {
        remote,
        branch,
        remote_branch,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickOutcome {
    Idle,
    Merged,
    Pushed,
    MergedAndPushed,
    Conflicted(Vec<String>),
}

/// The unmerged paths, keeping a failed `git diff` distinguishable from "none
/// are unmerged". `try_complete_merge` is the one path that bypasses
/// `prepare_commit`'s `MERGE_HEAD` guard, and all that stands between it and
/// committing conflict markers is this list actually being complete.
pub fn unmerged_paths_checked(repo: &Path) -> Result<Vec<String>, SyncError> {
    super::conflicts::unmerged_paths(repo)
}

pub fn unmerged_paths(repo: &Path) -> Vec<String> {
    unmerged_paths_checked(repo).unwrap_or_default()
}

fn env_refs(envs: &[(String, String)]) -> Vec<(&str, &str)> {
    envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}

/// `left` is commits we have that the remote does not; `right` the reverse.
pub fn ahead_behind(repo: &Path, branch: &str) -> Result<(usize, usize), SyncError> {
    let out = git::run(
        repo,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{branch}...FETCH_HEAD"),
        ],
        &[],
    )
    .map_err(|e| classify(&e))?;
    let mut parts = out.split_whitespace();
    let ahead = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let behind = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Ok((ahead, behind))
}

/// Whether the branch has an upstream configured -- `branch.<name>.merge` is
/// the half `push` sets and `branch.<name>.remote` alone does not imply.
fn has_upstream(repo: &Path, branch: &str) -> bool {
    git::run(
        repo,
        &["config", "--get", &format!("branch.{branch}.merge")],
        &[],
    )
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false)
}

fn local_commit_count(repo: &Path) -> usize {
    git::run(repo, &["rev-list", "--count", "HEAD"], &[])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn consent_matches(repo: &Path, consent: &serde_json::Value) -> bool {
    [("localHead", "HEAD"), ("remoteHead", "FETCH_HEAD")]
        .into_iter()
        .all(|(key, current)| {
            consent[key].as_str().is_some_and(|checked| {
                git::check(repo, &["merge-base", "--is-ancestor", checked, current], 1)
                    .unwrap_or(false)
            })
        })
}

pub fn tick(
    repo: &Path,
    envs: &[(String, String)],
    allow_unrelated: bool,
) -> Result<TickOutcome, SyncError> {
    tick_guarded(repo, envs, allow_unrelated, None, None)
}

pub fn tick_guarded(
    repo: &Path,
    envs: &[(String, String)],
    allow_unrelated: bool,
    guard: Option<&crate::fs_guard::FsGuard>,
    settings: Option<&super::engine::SyncSettings>,
) -> Result<TickOutcome, SyncError> {
    match tick_once(repo, envs, allow_unrelated, guard, settings) {
        // Someone else pushed between our fetch and our push. A second whole
        // tick fetches and merges their commits first, so the retry can
        // succeed; anything past that is left to the caller's backoff.
        Err(SyncError::PushRejected) => tick_once(repo, envs, allow_unrelated, guard, settings),
        other => other,
    }
}

fn tick_once(
    repo: &Path,
    envs: &[(String, String)],
    allow_unrelated: bool,
    guard: Option<&crate::fs_guard::FsGuard>,
    settings: Option<&super::engine::SyncSettings>,
) -> Result<TickOutcome, SyncError> {
    if crate::revisions::store::merge_in_progress(repo) {
        return Err(SyncError::MergeInProgress);
    }
    let target = resolve_target(repo)?;
    let e = env_refs(envs);
    let destination = match settings {
        Some(settings) => super::keys::checked_destination(repo, settings.mode)?,
        None => target.remote.clone(),
    };

    let fetched = match git::run(
        repo,
        &["fetch", "-q", &destination, &target.remote_branch],
        &e,
    ) {
        Ok(_) => true,
        Err(err) => match classify(&err) {
            SyncError::RemoteBranchMissing => false,
            other => return Err(other),
        },
    };

    let (ahead, behind) = if fetched {
        ahead_behind(repo, &target.branch)?
    } else {
        // Nothing on the remote to compare against, so everything local is
        // unpushed and the push below is what creates the branch.
        (local_commit_count(repo), 0)
    };

    let merged = if behind > 0 {
        let _mutation = guard.map(|g| g.mutation.write().unwrap_or_else(|e| e.into_inner()));
        let mut args = vec!["merge", "--no-edit", "-q"];
        let consent_path = settings.map(|s| {
            s.server_root
                .join("git-connections")
                .join(format!("{}.consent", s.space_id))
        });
        let consent = consent_path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
        let approved = consent
            .as_ref()
            .is_some_and(|consent| consent_matches(repo, consent));
        if consent.is_some() && !approved {
            return Err(SyncError::ConsentStale);
        }
        if (settings.is_none() && allow_unrelated) || approved {
            args.push("--allow-unrelated-histories");
        }
        if let Some(path) = consent_path {
            let _ = std::fs::remove_file(path);
        }
        super::conflicts::begin_merge(repo)?;
        args.push("FETCH_HEAD");
        match git::run(repo, &args, &super::store::commit_env(None)) {
            Ok(_) => true,
            Err(err) => {
                let conflicts = unmerged_paths(repo);
                if !conflicts.is_empty() {
                    super::conflicts::capture(repo)?;
                    return Ok(TickOutcome::Conflicted(conflicts));
                }
                return Err(classify(&err));
            }
        }
    } else {
        false
    };

    let ahead = if merged {
        ahead_behind(repo, &target.branch)?.0
    } else {
        ahead
    };
    let pushed = if ahead > 0 {
        let refspec = format!("HEAD:{}", target.remote_branch);
        let mut args = vec!["push", "-q"];
        if !has_upstream(repo, &target.branch) {
            args.push("-u");
        }
        args.push(&destination);
        args.push(&refspec);
        if let Some(settings) = settings {
            super::keys::checked_envs_for_mode(
                settings.mode,
                &settings.server_root,
                &settings.space_id,
                repo,
            )?;
        }
        match git::run(repo, &args, &e) {
            Ok(_) => {
                if settings.is_some() {
                    git::run(
                        repo,
                        &[
                            "config",
                            &format!("branch.{}.remote", target.branch),
                            &target.remote,
                        ],
                        &[],
                    )
                    .map_err(|e| classify(&e))?;
                }
                let head = git::run(repo, &["rev-parse", "HEAD"], &[]).map_err(|e| classify(&e))?;
                git::run(
                    repo,
                    &[
                        "update-ref",
                        &format!("refs/remotes/{}/{}", target.remote, target.remote_branch),
                        head.trim(),
                    ],
                    &[],
                )
                .map_err(|e| classify(&e))?;
                let fetch_head = git::run(repo, &["rev-parse", "--git-path", "FETCH_HEAD"], &[])
                    .map_err(|e| classify(&e))?;
                std::fs::write(
                    repo.join(fetch_head.trim()),
                    format!("{}\t\tSilverBullet sync\n", head.trim()),
                )
                .map_err(|e| SyncError::Other(e.to_string()))?;
                true
            }
            Err(err) => return Err(classify(&err)),
        }
    } else {
        false
    };

    Ok(match (merged, pushed) {
        (true, true) => TickOutcome::MergedAndPushed,
        (true, false) => TickOutcome::Merged,
        (false, true) => TickOutcome::Pushed,
        (false, false) => TickOutcome::Idle,
    })
}

/// A complete `<<<<<<<` / `=======` / `>>>>>>>` triple, in order. Requiring
/// all three keeps a page that merely quotes a marker line from reading as
/// conflicted. A false positive only leaves the space paused, which is the
/// safe direction; a false negative would commit markers.
pub fn has_conflict_markers(body: &str) -> bool {
    let mut seen_start = false;
    let mut seen_sep = false;
    for line in body.lines() {
        if line.starts_with("<<<<<<< ") {
            seen_start = true;
            seen_sep = false;
        } else if seen_start && line.trim_end() == "=======" {
            seen_sep = true;
        } else if seen_start && seen_sep && line.starts_with(">>>>>>> ") {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeCompletion {
    /// No merge outstanding, or it was closed by this call.
    Completed,
    /// Still conflicted; a later tick tries again.
    Pending,
    /// Conflicted on a path the editor cannot render markers for, so no
    /// amount of waiting will resolve it and the space must say so.
    Unresolvable { path: String },
}

pub fn try_complete_merge(repo: &Path) -> Result<MergeCompletion, SyncError> {
    super::conflicts::try_complete_merge(repo)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{multi::config::GitSyncMode, revisions::git};

    fn repo_with_remote(remote_name: &str) -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        git::run(dir.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        git::run(dir.path(), &["config", "user.email", "t@x.test"], &[]).unwrap();
        git::run(dir.path(), &["config", "user.name", "T"], &[]).unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        git::run(dir.path(), &["add", "-A"], &[]).unwrap();
        git::run(dir.path(), &["commit", "-qm", "init"], &[]).unwrap();
        git::run(
            dir.path(),
            &["remote", "add", remote_name, "/nonexistent.git"],
            &[],
        )
        .unwrap();
        dir
    }

    pub(crate) fn conflict_fixture(
        path: &str,
        base: Option<&[u8]>,
        local: &[u8],
        incoming: &[u8],
    ) -> (tempfile::TempDir, tempfile::TempDir, tempfile::TempDir) {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        if let Some(base) = base {
            std::fs::write(seed.path().join(path), base).unwrap();
            git::run(seed.path(), &["add", "-A"], &[]).unwrap();
            git::run(seed.path(), &["commit", "-qm", "base file"], &[]).unwrap();
            git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        }
        let work = plain_clone(remote.path());
        for (repo, bytes) in [(seed.path(), incoming), (work.path(), local)] {
            std::fs::write(repo.join(path), bytes).unwrap();
            git::run(repo, &["add", "-A"], &[]).unwrap();
            git::run(repo, &["commit", "-qm", "change"], &[]).unwrap();
        }
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        assert!(matches!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::Conflicted(_)
        ));
        (remote, seed, work)
    }

    #[test]
    fn recovery_does_not_accept_utf8_binary_without_markers() {
        let (_remote, _seed, work) = conflict_fixture(
            "Sample.md",
            Some(b"base\0data"),
            b"local\0data",
            b"remote\0data",
        );
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Unresolvable {
                path: "Sample.md".into()
            }
        );
        assert!(crate::revisions::store::merge_in_progress(work.path()));
    }

    #[test]
    fn recovery_completes_add_add_text_without_staging_unrelated_files() {
        let (_remote, _seed, work) = conflict_fixture("Added.md", None, b"local\n", b"remote\n");
        std::fs::write(work.path().join("Added.md"), b"combined\n").unwrap();
        std::fs::write(work.path().join("Unrelated.md"), b"still editing\n").unwrap();
        git::run(work.path(), &["config", "user.name", ""], &[]).unwrap();
        git::run(work.path(), &["config", "user.email", ""], &[]).unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
        assert!(git::run(work.path(), &["show", "HEAD:Unrelated.md"], &[]).is_err());
    }

    #[test]
    fn recovery_preserves_unicode_and_whitespace_paths() {
        let (_remote, _seed, work) = conflict_fixture(" Café\t.md", None, b"local\n", b"remote\n");
        assert_eq!(
            unmerged_paths_checked(work.path()).unwrap(),
            vec![" Café\t.md"]
        );
    }

    #[test]
    fn recovery_rejects_partial_marker_removal() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        std::fs::write(
            work.path().join("Sample.md"),
            b"local\n=======\nremote\n>>>>>>> FETCH_HEAD\n",
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
    }

    #[test]
    fn falls_back_to_origin_when_no_upstream_is_set() {
        let dir = repo_with_remote("origin");
        let target = resolve_target(dir.path()).unwrap();
        assert_eq!(target.remote, "origin");
        assert_eq!(target.branch, "main");
    }

    #[test]
    fn prefers_the_branch_upstream_over_origin() {
        let dir = repo_with_remote("origin");
        git::run(dir.path(), &["remote", "add", "fork", "/other.git"], &[]).unwrap();
        git::run(dir.path(), &["config", "branch.main.remote", "fork"], &[]).unwrap();

        let target = resolve_target(dir.path()).unwrap();
        assert_eq!(target.remote, "fork");
    }

    #[test]
    fn detached_head_is_rejected() {
        let dir = repo_with_remote("origin");
        let head = git::run(dir.path(), &["rev-parse", "HEAD"], &[]).unwrap();
        git::run(dir.path(), &["checkout", "-q", head.trim()], &[]).unwrap();
        assert!(matches!(
            resolve_target(dir.path()),
            Err(SyncError::DetachedHead)
        ));
    }

    #[test]
    fn a_repo_with_no_remote_at_all_is_rejected() {
        let dir = tempfile::TempDir::new().unwrap();
        git::run(dir.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        assert!(matches!(
            resolve_target(dir.path()),
            Err(SyncError::NoRemote)
        ));
    }

    #[test]
    fn stderr_is_classified_into_actionable_kinds() {
        assert!(matches!(
            classify("Permission denied (publickey)."),
            SyncError::AuthFailed
        ));
        assert!(matches!(
            classify("ssh: Could not resolve hostname git.example.test"),
            SyncError::HostUnreachable
        ));
        assert!(matches!(
            classify("fatal: refusing to merge unrelated histories"),
            SyncError::UnrelatedHistories
        ));
        assert!(matches!(
            classify("! [rejected] main -> main (non-fast-forward)"),
            SyncError::PushRejected
        ));
    }

    pub(crate) fn bare_remote() -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        git::run(dir.path(), &["init", "-q", "--bare", "-b", "main"], &[]).unwrap();
        dir
    }

    pub(crate) fn plain_clone(remote: &Path) -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        git::run(
            Path::new("."),
            &[
                "clone",
                "-q",
                remote.to_str().unwrap(),
                dir.path().to_str().unwrap(),
            ],
            &[],
        )
        .unwrap();
        git::run(dir.path(), &["config", "user.email", "t@x.test"], &[]).unwrap();
        git::run(dir.path(), &["config", "user.name", "T"], &[]).unwrap();
        dir
    }

    fn commit_file(repo: &Path, name: &str, body: &str, msg: &str) {
        std::fs::write(repo.join(name), body).unwrap();
        git::run(repo, &["add", "-A"], &[]).unwrap();
        git::run(repo, &["commit", "-qm", msg], &[]).unwrap();
    }

    pub(crate) fn seeded_clone(remote: &Path) -> tempfile::TempDir {
        let seed = plain_clone(remote);
        commit_file(seed.path(), "note.md", "base\n", "base");
        git::run(seed.path(), &["push", "-q", "-u", "origin", "main"], &[]).unwrap();
        seed
    }

    #[test]
    fn local_commits_are_pushed() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());
        commit_file(work.path(), "note.md", "mine\n", "mine");

        let outcome = tick(work.path(), &[], false).unwrap();
        assert_eq!(outcome, TickOutcome::Pushed);

        let other = plain_clone(remote.path());
        assert_eq!(
            std::fs::read_to_string(other.path().join("note.md")).unwrap(),
            "mine\n"
        );
    }

    #[test]
    fn remote_commits_are_merged_fast_forward() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        commit_file(seed.path(), "note.md", "theirs\n", "theirs");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();

        let outcome = tick(work.path(), &[], false).unwrap();
        assert_eq!(outcome, TickOutcome::Merged);
        assert_eq!(
            std::fs::read_to_string(work.path().join("note.md")).unwrap(),
            "theirs\n"
        );
    }

    #[test]
    fn incoming_only_changes_push_a_merge_commit_when_fast_forward_is_disabled() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());
        git::run(work.path(), &["config", "merge.ff", "false"], &[]).unwrap();
        commit_file(seed.path(), "note.md", "remote update\n", "remote update");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();

        assert_eq!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::MergedAndPushed
        );
        assert_eq!(
            git::run(work.path(), &["rev-parse", "HEAD"], &[]).unwrap(),
            git::run(remote.path(), &["rev-parse", "refs/heads/main"], &[]).unwrap()
        );
        assert_eq!(ahead_behind(work.path(), "HEAD").unwrap(), (0, 0));
    }

    #[test]
    fn divergent_but_compatible_changes_merge_and_push() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        commit_file(seed.path(), "theirs.md", "t\n", "theirs");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        commit_file(work.path(), "mine.md", "m\n", "mine");

        git::run(work.path(), &["config", "user.name", ""], &[]).unwrap();
        git::run(work.path(), &["config", "user.email", ""], &[]).unwrap();

        let outcome = tick(work.path(), &[], false).unwrap();
        assert_eq!(outcome, TickOutcome::MergedAndPushed);
        assert_eq!(
            git::run(work.path(), &["show", "-s", "--format=%an <%ae>|%cn <%ce>"], &[])
                .unwrap()
                .trim(),
            "SilverBullet <silverbullet@silverbullet.local>|SilverBullet <silverbullet@silverbullet.local>"
        );
        assert!(work.path().join("theirs.md").exists());

        let other = plain_clone(remote.path());
        assert!(other.path().join("mine.md").exists());
    }

    #[test]
    fn conflicting_changes_leave_markers_and_report_the_paths() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        commit_file(seed.path(), "note.md", "theirs\n", "theirs");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        commit_file(work.path(), "note.md", "mine\n", "mine");

        git::run(work.path(), &["config", "user.name", ""], &[]).unwrap();
        git::run(work.path(), &["config", "user.email", ""], &[]).unwrap();

        let outcome = tick(work.path(), &[], false).unwrap();
        assert_eq!(
            outcome,
            TickOutcome::Conflicted(vec!["note.md".to_string()])
        );

        let body = std::fs::read_to_string(work.path().join("note.md")).unwrap();
        assert!(body.contains("<<<<<<<"), "got: {body}");
        assert!(body.contains("mine"));
        assert!(body.contains("theirs"));
        assert!(crate::revisions::store::merge_in_progress(work.path()));
    }

    #[test]
    fn nothing_to_do_is_idle() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());
        assert_eq!(tick(work.path(), &[], false).unwrap(), TickOutcome::Idle);
    }

    #[test]
    fn marker_detection_needs_a_complete_triple() {
        assert!(has_conflict_markers(
            "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\nb\n"
        ));
        assert!(!has_conflict_markers("just some prose\n"));
        assert!(!has_conflict_markers("<<<<<<< HEAD\nmine\n"));
        assert!(!has_conflict_markers(">>>>>>> x\n=======\n<<<<<<< y\n"));
        assert!(has_conflict_markers(
            "<<<<<<< HEAD\nmine\n======= \ntheirs\n>>>>>>> origin/main\n"
        ));
    }

    #[test]
    fn merge_completes_once_the_markers_are_gone() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        commit_file(seed.path(), "note.md", "theirs\n", "theirs");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        commit_file(work.path(), "note.md", "mine\n", "mine");

        assert!(matches!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::Conflicted(_)
        ));

        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );

        std::fs::write(work.path().join("note.md"), "mine and theirs\n").unwrap();

        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
        assert!(!crate::revisions::store::merge_in_progress(work.path()));
        assert!(unmerged_paths(work.path()).is_empty());

        assert_eq!(tick(work.path(), &[], false).unwrap(), TickOutcome::Pushed);
    }

    #[test]
    fn try_complete_merge_refuses_a_delete_modify_conflict() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        git::run(seed.path(), &["rm", "-q", "note.md"], &[]).unwrap();
        git::run(seed.path(), &["commit", "-qm", "delete"], &[]).unwrap();
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        commit_file(work.path(), "note.md", "mine\n", "mine");

        assert!(matches!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::Conflicted(_)
        ));

        let head_before = git::run(work.path(), &["rev-parse", "HEAD"], &[]).unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
        assert!(crate::revisions::store::merge_in_progress(work.path()));
        assert_eq!(
            git::run(work.path(), &["rev-parse", "HEAD"], &[]).unwrap(),
            head_before
        );
    }

    /// A repo with a remote but no clone behind it: no upstream, and the
    /// remote may be empty.
    fn unpushed_repo(remote: &Path) -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        git::run(dir.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        git::run(dir.path(), &["config", "user.email", "t@x.test"], &[]).unwrap();
        git::run(dir.path(), &["config", "user.name", "T"], &[]).unwrap();
        commit_file(dir.path(), "own.md", "own\n", "own");
        git::run(
            dir.path(),
            &["remote", "add", "origin", remote.to_str().unwrap()],
            &[],
        )
        .unwrap();
        dir
    }

    #[test]
    fn a_brand_new_empty_remote_is_pushed_to_on_the_first_tick() {
        let remote = bare_remote();
        let work = unpushed_repo(remote.path());

        // `git fetch origin main` fails outright against a repo with no refs
        // at all -- the state every "create an empty repository" setup starts
        // in, and the one the first push is what fixes.
        assert_eq!(tick(work.path(), &[], false).unwrap(), TickOutcome::Pushed);

        let other = plain_clone(remote.path());
        assert!(other.path().join("own.md").exists());
    }

    #[test]
    fn a_missing_repository_is_still_an_error_not_a_first_push() {
        let missing = tempfile::TempDir::new().unwrap();
        let work = unpushed_repo(&missing.path().join("does-not-exist.git"));
        assert!(
            !matches!(
                tick(work.path(), &[], false),
                Ok(_) | Err(SyncError::RemoteBranchMissing)
            ),
            "a wrong URL must not reach the benign first-push path"
        );
    }

    #[test]
    fn the_first_push_sets_the_branch_upstream() {
        let remote = bare_remote();
        let work = unpushed_repo(remote.path());
        assert!(!has_upstream(work.path(), "main"));

        assert_eq!(tick(work.path(), &[], false).unwrap(), TickOutcome::Pushed);

        assert_eq!(
            git::run(work.path(), &["config", "--get", "branch.main.merge"], &[])
                .unwrap()
                .trim(),
            "refs/heads/main"
        );
        assert_eq!(
            git::run(work.path(), &["config", "--get", "branch.main.remote"], &[])
                .unwrap()
                .trim(),
            "origin"
        );
    }

    /// Declines the first `n` pushes, then accepts. The counter lives in the
    /// bare repo, so the hook can count across separate `git push` processes.
    fn decline_pushes(remote: &Path, times: u32) {
        let hook = remote.join("hooks").join("update");
        std::fs::write(
            &hook,
            format!(
                "#!/bin/sh\n                 n=$(cat \"$GIT_DIR/declined\" 2>/dev/null || echo 0)\n                 n=$((n+1))\n                 echo \"$n\" > \"$GIT_DIR/declined\"\n                 if [ \"$n\" -le {times} ]; then echo non-fast-forward >&2; exit 1; fi\n                 exit 0\n"
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn declined_count(remote: &Path) -> u32 {
        std::fs::read_to_string(remote.join("declined"))
            .map(|s| s.trim().parse().unwrap_or(0))
            .unwrap_or(0)
    }

    #[test]
    fn a_rejected_push_is_retried_exactly_once() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());
        commit_file(work.path(), "note.md", "mine\n", "mine");
        decline_pushes(remote.path(), 1);

        assert_eq!(tick(work.path(), &[], false).unwrap(), TickOutcome::Pushed);
        assert_eq!(declined_count(remote.path()), 2, "the tick must retry once");
    }

    #[test]
    fn a_push_rejected_twice_gives_up_rather_than_looping() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());
        commit_file(work.path(), "note.md", "mine\n", "mine");
        decline_pushes(remote.path(), 99);

        assert_eq!(tick(work.path(), &[], false), Err(SyncError::PushRejected));
        assert_eq!(declined_count(remote.path()), 2, "exactly one retry");
    }

    #[test]
    fn a_failed_diff_is_not_reported_as_nothing_unmerged() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = plain_clone(remote.path());

        commit_file(seed.path(), "note.md", "theirs\n", "theirs");
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        commit_file(work.path(), "note.md", "mine\n", "mine");
        assert!(matches!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::Conflicted(_)
        ));

        std::fs::write(work.path().join(".git").join("index"), b"garbage").unwrap();

        assert!(
            unmerged_paths_checked(work.path()).is_err(),
            "a broken index must not read as a clean tree"
        );
        assert!(unmerged_paths(work.path()).is_empty());
        // With the list unavailable, the merge must stay open rather than be
        // closed over files whose state is unknown.
        assert_ne!(
            try_complete_merge(work.path()).ok(),
            Some(MergeCompletion::Completed)
        );
        assert!(crate::revisions::store::merge_in_progress(work.path()));
    }

    #[test]
    fn a_binary_conflict_is_reported_as_unresolvable_not_pending() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        // A base version on both sides, so the conflict has all three stages
        // -- an add/add would be a delete/modify-shaped one instead.
        std::fs::write(seed.path().join("logo.png"), [0xff, 0xd8, 0x00]).unwrap();
        git::run(seed.path(), &["add", "-A"], &[]).unwrap();
        git::run(seed.path(), &["commit", "-qm", "base"], &[]).unwrap();
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        let work = plain_clone(remote.path());

        std::fs::write(seed.path().join("logo.png"), [0xff, 0xd8, 0x01]).unwrap();
        git::run(seed.path(), &["add", "-A"], &[]).unwrap();
        git::run(seed.path(), &["commit", "-qm", "theirs"], &[]).unwrap();
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();

        std::fs::write(work.path().join("logo.png"), [0xff, 0xd8, 0x02]).unwrap();
        git::run(work.path(), &["add", "-A"], &[]).unwrap();
        git::run(work.path(), &["commit", "-qm", "mine"], &[]).unwrap();

        assert!(matches!(
            tick(work.path(), &[], false).unwrap(),
            TickOutcome::Conflicted(_)
        ));
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Unresolvable {
                path: "logo.png".to_string()
            }
        );
    }

    #[test]
    fn unrelated_histories_are_refused_unless_allowed() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());

        let work = tempfile::TempDir::new().unwrap();
        git::run(work.path(), &["init", "-q", "-b", "main"], &[]).unwrap();
        git::run(work.path(), &["config", "user.email", "t@x.test"], &[]).unwrap();
        git::run(work.path(), &["config", "user.name", "T"], &[]).unwrap();
        commit_file(work.path(), "own.md", "own\n", "own");
        git::run(
            work.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
            &[],
        )
        .unwrap();

        assert!(matches!(
            tick(work.path(), &[], false),
            Err(SyncError::UnrelatedHistories)
        ));

        let outcome = tick(work.path(), &[], true).unwrap();
        assert_eq!(outcome, TickOutcome::MergedAndPushed);
        assert!(work.path().join("note.md").exists());
        assert!(work.path().join("own.md").exists());
    }

    #[test]
    fn unrelated_consent_accepts_descendants_of_both_checked_heads() {
        let remote = bare_remote();
        let seed = seeded_clone(remote.path());
        let work = unpushed_repo(remote.path());
        git::run(work.path(), &["fetch", "origin", "main"], &[]).unwrap();
        let local = git::run(work.path(), &["rev-parse", "HEAD"], &[]).unwrap();
        let incoming = git::run(work.path(), &["rev-parse", "FETCH_HEAD"], &[]).unwrap();
        let consent = serde_json::json!({"localHead": local.trim(), "remoteHead": incoming.trim()});

        commit_file(work.path(), "later.md", "local\n", "later local");
        commit_file(seed.path(), "remote.md", "remote\n", "later remote");
        git::run(seed.path(), &["push", "origin", "main"], &[]).unwrap();
        git::run(work.path(), &["fetch", "origin", "main"], &[]).unwrap();

        assert!(consent_matches(work.path(), &consent));
        assert!(!consent_matches(
            work.path(),
            &serde_json::json!({
                "localHead": incoming.trim(), "remoteHead": local.trim()
            })
        ));

        let server_root = tempfile::TempDir::new().unwrap();
        let connection_dir = server_root.path().join("git-connections");
        std::fs::create_dir(&connection_dir).unwrap();
        std::fs::write(connection_dir.join("sample.consent"), consent.to_string()).unwrap();
        let settings = super::super::engine::SyncSettings {
            server_root: server_root.path().to_path_buf(),
            space_id: "sample".into(),
            mode: GitSyncMode::Manual,
            pull_interval: None,
            paused: false,
        };
        assert_eq!(
            tick_guarded(work.path(), &[], false, None, Some(&settings)).unwrap(),
            TickOutcome::MergedAndPushed
        );
        assert!(!connection_dir.join("sample.consent").exists());
    }

    #[test]
    fn changed_unrelated_history_requires_a_new_connection_check() {
        let remote = bare_remote();
        let _seed = seeded_clone(remote.path());
        let work = unpushed_repo(remote.path());
        let server_root = tempfile::TempDir::new().unwrap();
        let connection_dir = server_root.path().join("git-connections");
        std::fs::create_dir(&connection_dir).unwrap();
        let consent = connection_dir.join("sample.consent");
        std::fs::write(&consent, r#"{"localHead":"old","remoteHead":"old"}"#).unwrap();
        let settings = super::super::engine::SyncSettings {
            server_root: server_root.path().to_path_buf(),
            space_id: "sample".into(),
            mode: GitSyncMode::Manual,
            pull_interval: None,
            paused: false,
        };

        assert_eq!(
            tick_guarded(work.path(), &[], false, None, Some(&settings)),
            Err(SyncError::ConsentStale)
        );
        assert!(consent.exists());
    }
}
