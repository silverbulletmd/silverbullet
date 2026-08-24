use super::git;
use silverbullet_server_common::RevisionsMode;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const COMMITTER_NAME: &str = "SilverBullet";
const COMMITTER_EMAIL: &str = "silverbullet@silverbullet.local";

pub struct RevisionStore {
    root: PathBuf,
    repo: Mutex<Option<PathBuf>>,
    mode: RevisionsMode,
    auto_commit: bool,
}

/// The work-tree root of the repository containing `path`, if any.
/// A filesystem walk-up — never spawns git, so it works without the binary.
pub fn discover_repo_root(path: &Path) -> Option<PathBuf> {
    let mut cur = path.canonicalize().ok()?;
    loop {
        if cur.join(".git").exists() {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn managed_marker(repo: &Path) -> bool {
    marker_state(repo).unwrap_or(false)
}

/// `None` when the key has never been set; `Some` reflects its current value.
/// A user-cleared `false` must stay `false` on re-open, not be re-marked.
fn marker_state(repo: &Path) -> Option<bool> {
    git::run(
        repo,
        &["config", "--local", "--get", "silverbullet.managed"],
        &[],
    )
    .ok()
    .map(|v| v.trim() == "true")
}

impl RevisionStore {
    pub fn open(root: &Path, mode: RevisionsMode) -> Option<RevisionStore> {
        if mode == RevisionsMode::Disabled {
            return None;
        }
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let discovered = discover_repo_root(&root);
        let (repo, auto_commit) = match (mode, discovered) {
            (RevisionsMode::Managed, Some(repo_root)) => {
                if repo_root != root {
                    tracing::warn!(
                        "Managed revisions on a space nested in a larger repo at {repo_root:?}; \
                         treating as unmanaged"
                    );
                    (Some(repo_root), false)
                } else if !git::available() {
                    tracing::warn!("Managed revisions configured but git is not installed");
                    (Some(repo_root), false)
                } else {
                    let auto_commit = match marker_state(&repo_root) {
                        Some(v) => v,
                        None => match git::run(
                            &repo_root,
                            &["config", "--local", "silverbullet.managed", "true"],
                            &[],
                        ) {
                            Ok(_) => true,
                            Err(e) => {
                                tracing::warn!("Cannot mark repo as managed: {e}");
                                false
                            }
                        },
                    };
                    (Some(repo_root), auto_commit)
                }
            }
            (RevisionsMode::Managed, None) => {
                if !git::available() {
                    tracing::warn!("Managed revisions configured but git is not installed");
                    return None;
                }
                match git::run(&root, &["init", "-q"], &[]) {
                    Ok(_) => {
                        if let Err(e) = git::run(
                            &root,
                            &["config", "--local", "silverbullet.managed", "true"],
                            &[],
                        ) {
                            tracing::warn!("Cannot mark fresh repo as managed: {e}");
                        }
                        (Some(root.clone()), managed_marker(&root))
                    }
                    Err(e) => {
                        tracing::warn!("git init failed for {root:?}: {e}");
                        return None;
                    }
                }
            }
            (RevisionsMode::Unmanaged, repo_root) => (repo_root, false),
            (RevisionsMode::Disabled, _) => unreachable!(),
        };
        Some(RevisionStore {
            root,
            repo: Mutex::new(repo),
            mode,
            auto_commit,
        })
    }

    pub fn mode(&self) -> RevisionsMode {
        self.mode
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn auto_commit_allowed(&self) -> bool {
        self.auto_commit
    }

    /// Repo root; dormant Unmanaged stores re-discover on access.
    pub fn repo_root(&self) -> Option<PathBuf> {
        let mut guard = self.repo.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() && self.mode == RevisionsMode::Unmanaged {
            *guard = discover_repo_root(&self.root);
        }
        guard.clone()
    }

    /// Repo-root-relative path for a space-relative path.
    pub fn rel(&self, space_path: &str) -> String {
        let prefix = self
            .repo_root()
            .and_then(|repo| {
                self.root
                    .strip_prefix(&repo)
                    .ok()
                    .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            })
            .filter(|p| !p.is_empty());
        match prefix {
            Some(p) => format!("{p}/{space_path}"),
            None => space_path.to_string(),
        }
    }

    pub fn head_exists(&self) -> bool {
        self.repo_root()
            .map(|repo| {
                git::check(&repo, &["rev-parse", "--verify", "--quiet", "HEAD"], 1).unwrap_or(false)
            })
            .unwrap_or(false)
    }

    fn prepare_commit(&self) -> Result<PathBuf, String> {
        let repo = self.repo_root().ok_or("no repository")?;
        if !self.auto_commit {
            return Err("auto-commit not allowed for this repo".to_string());
        }
        if self.head_exists() && !git::check(&repo, &["symbolic-ref", "--quiet", "HEAD"], 1)? {
            return Err("HEAD is detached; auto-commit paused".to_string());
        }
        Ok(repo)
    }

    fn commit_staged(
        &self,
        repo: &Path,
        author_name: &str,
        author_email: &str,
        message: &str,
    ) -> Result<Option<String>, String> {
        if git::check(repo, &["diff", "--cached", "--quiet"], 1)? {
            return Ok(None);
        }
        git::run(
            repo,
            &[
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "--no-verify",
                "-m",
                message,
            ],
            &[
                ("GIT_AUTHOR_NAME", author_name),
                ("GIT_AUTHOR_EMAIL", author_email),
                ("GIT_COMMITTER_NAME", COMMITTER_NAME),
                ("GIT_COMMITTER_EMAIL", COMMITTER_EMAIL),
            ],
        )?;
        let id = git::run(repo, &["rev-parse", "HEAD"], &[])?;
        Ok(Some(id.trim().to_string()))
    }

    /// Commit the current on-disk state of `paths` (space-relative). Missing
    /// files become deletions. Returns Ok(None) when nothing changed.
    pub fn commit_batch(
        &self,
        author_name: &str,
        author_email: &str,
        message: &str,
        paths: &[String],
    ) -> Result<Option<String>, String> {
        if paths.is_empty() {
            return Ok(None);
        }
        let repo = self.prepare_commit()?;

        let mut add_args: Vec<&str> = vec!["add", "-A", "-f", "--"];
        let rels: Vec<String> = paths
            .iter()
            .map(|p| format!(":(literal){}", self.rel(p)))
            .collect();
        add_args.extend(rels.iter().map(|s| s.as_str()));
        git::run(&repo, &add_args, &[])?;

        self.commit_staged(&repo, author_name, author_email, message)
    }

    /// Commit everything under the space that differs from HEAD, whether or
    /// not the engine ever observed it changing. Unlike [`Self::commit_batch`],
    /// which names every path it stages, this one adds by directory, so it
    /// must not force past `.gitignore` -- a blanket `-f` would sweep in
    /// whatever else lives in the folder.
    pub fn commit_all(
        &self,
        author_name: &str,
        author_email: &str,
        message: &str,
    ) -> Result<Option<String>, String> {
        let repo = self.prepare_commit()?;

        let prefix = self.rel("");
        let pathspec = format!(":(literal){prefix}");
        let mut add_args: Vec<&str> = vec!["add", "-A", "--"];
        if !prefix.is_empty() {
            add_args.push(&pathspec);
        }
        git::run(&repo, &add_args, &[])?;

        self.commit_staged(&repo, author_name, author_email, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silverbullet_server_common::RevisionsMode;
    use std::path::Path;

    fn git_out(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn disabled_mode_yields_no_store() {
        let dir = tempfile::tempdir().unwrap();
        assert!(RevisionStore::open(dir.path(), RevisionsMode::Disabled).is_none());
    }

    #[test]
    fn managed_mode_inits_and_marks_repo() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        assert!(dir.path().join(".git").is_dir());
        assert!(store.auto_commit_allowed());
        assert_eq!(
            git_out(dir.path(), &["config", "--local", "silverbullet.managed"]),
            "true"
        );
    }

    #[test]
    fn unmanaged_mode_never_inits_and_never_allows_commits() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        assert!(!dir.path().join(".git").exists(), "unmanaged must not init");
        assert!(store.repo_root().is_none(), "no repo yet: dormant");
        assert!(!store.auto_commit_allowed());
    }

    #[test]
    fn unmanaged_dormant_picks_up_a_user_created_repo_without_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        assert!(store.repo_root().is_none());
        git_out(dir.path(), &["init", "-q"]);
        assert!(store.repo_root().is_some(), "re-discovery on access");
    }

    #[test]
    fn managed_marker_cleared_by_user_disables_auto_commit() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        assert!(
            store.auto_commit_allowed(),
            "managed mode marks an existing repo too"
        );
        git_out(
            dir.path(),
            &["config", "--local", "silverbullet.managed", "false"],
        );
        let store2 = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        assert!(
            !store2.auto_commit_allowed(),
            "cleared marker wins over mode"
        );
    }

    #[test]
    fn commit_batch_commits_writes_and_deletes_with_author() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("index.md"), b"# Hello\n").unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/note.md"), b"v1\n").unwrap();
        let id = store
            .commit_batch(
                "Alice",
                "alice@silverbullet.local",
                "Update 2 files",
                &["index.md".into(), "sub/note.md".into()],
            )
            .unwrap();
        assert!(id.is_some());

        std::fs::remove_file(dir.path().join("sub/note.md")).unwrap();
        let id2 = store
            .commit_batch(
                "Bob",
                "bob@silverbullet.local",
                "Delete sub/note.md",
                &["sub/note.md".into()],
            )
            .unwrap();
        assert!(id2.is_some());

        assert_eq!(
            git_out(dir.path(), &["log", "-1", "--format=%an <%ae>|%cn"]),
            "Bob <bob@silverbullet.local>|SilverBullet"
        );
        assert_eq!(git_out(dir.path(), &["log", "--format=%an"]), "Bob\nAlice");
        assert_eq!(
            git_out(dir.path(), &["status", "--porcelain"]),
            "",
            "clean tree after commit"
        );
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(!files.contains("sub/note.md"), "{files}");
    }

    #[test]
    fn commit_batch_with_no_effective_change_creates_no_commit() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("a.md"), b"x").unwrap();
        store
            .commit_batch("A", "a@x", "first", &["a.md".into()])
            .unwrap();
        let id = store
            .commit_batch("A", "a@x", "again", &["a.md".into()])
            .unwrap();
        assert!(
            id.is_none(),
            "identical content must not produce an empty commit"
        );
    }

    #[test]
    fn commit_batch_with_no_paths_is_a_noop() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join(".gitignore"), b"ignored.md\n").unwrap();
        std::fs::write(dir.path().join("ignored.md"), b"x").unwrap();
        std::fs::write(dir.path().join("tracked.md"), b"x").unwrap();

        let id = store.commit_batch("A", "a@x", "noop", &[]).unwrap();
        assert!(id.is_none());

        let status = git_out(dir.path(), &["status", "--porcelain", "--ignored"]);
        assert!(status.contains("?? tracked.md"), "{status}");
        assert!(status.contains("!! ignored.md"), "{status}");

        let head = std::process::Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["rev-parse", "--verify", "--quiet", "HEAD"])
            .output()
            .unwrap();
        assert!(!head.status.success(), "no commit should exist");
    }

    #[test]
    fn commit_batch_handles_pathspec_magic_characters() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join(":weird.md"), b"x").unwrap();
        let id = store
            .commit_batch("A", "a@x", "weird", &[":weird.md".into()])
            .unwrap();
        assert!(id.is_some());
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains(":weird.md"), "{files}");
    }

    #[test]
    fn commit_batch_stages_past_a_user_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join(".gitignore"), b"notes/\n").unwrap();
        std::fs::create_dir_all(dir.path().join("notes")).unwrap();
        std::fs::write(dir.path().join("notes/x.md"), b"x").unwrap();
        store
            .commit_batch("A", "a@x", "add", &["notes/x.md".into()])
            .unwrap();
        let files = git_out(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]);
        assert!(files.contains("notes/x.md"), "{files}");
    }

    #[test]
    fn detached_head_pauses_commits() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("a.md"), b"x").unwrap();
        store
            .commit_batch("A", "a@x", "first", &["a.md".into()])
            .unwrap();
        let head = git_out(dir.path(), &["rev-parse", "HEAD"]);
        git_out(dir.path(), &["checkout", "-q", "--detach", &head]);
        std::fs::write(dir.path().join("a.md"), b"y").unwrap();
        assert!(store
            .commit_batch("A", "a@x", "second", &["a.md".into()])
            .is_err());
    }

    #[test]
    fn space_as_subfolder_of_a_larger_repo_maps_paths_via_prefix() {
        let dir = tempfile::tempdir().unwrap();
        git_out(dir.path(), &["init", "-q"]);
        let sub = dir.path().join("docs");
        std::fs::create_dir_all(&sub).unwrap();
        let store = RevisionStore::open(&sub, RevisionsMode::Unmanaged).unwrap();
        assert_eq!(store.rel("index.md"), "docs/index.md");
    }

    #[test]
    fn discover_repo_root_walks_up_without_git() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover_repo_root(dir.path()).is_none());
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        let sub = dir.path().join("a/b");
        std::fs::create_dir_all(&sub).unwrap();
        assert_eq!(
            discover_repo_root(&sub).unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }
}
