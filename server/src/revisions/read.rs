use super::git;
use super::store::RevisionStore;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionEntry {
    pub rev: String,
    pub timestamp: i64,
    pub author: String,
    pub message: String,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRevisions {
    pub mode: String,
    pub uncommitted: bool,
    pub revisions: Vec<RevisionEntry>,
    pub more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    pub rev: String,
    pub timestamp: i64,
    pub author: String,
    pub message: String,
    pub files: Vec<String>,
    pub added: u64,
    pub removed: u64,
}

impl From<RevisionEntry> for LogCommit {
    fn from(entry: RevisionEntry) -> Self {
        LogCommit {
            rev: entry.rev,
            timestamp: entry.timestamp,
            author: entry.author,
            message: entry.message,
            files: Vec::new(),
            added: entry.added,
            removed: entry.removed,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceLog {
    pub mode: String,
    pub commits: Vec<LogCommit>,
    pub more: bool,
    /// Space-relative paths that differ from HEAD right now, newest state on
    /// disk -- what a snapshot would capture.
    pub uncommitted: Vec<String>,
}

const FORMAT: &str = "%H%x1f%ct%x1f%an%x1f%s%x1e";

fn is_hex40(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_entry(record: &str) -> Option<RevisionEntry> {
    let mut fields = record.trim_matches(['\n', '\r']).split('\u{1f}');
    let rev = fields.next()?.trim().to_string();
    if !is_hex40(&rev) {
        return None;
    }
    let timestamp = fields.next()?.trim().parse::<i64>().ok()? * 1000;
    let author = fields.next()?.to_string();
    let message = fields.next().unwrap_or_default().to_string();
    Some(RevisionEntry {
        rev,
        timestamp,
        author,
        message,
        added: 0,
        removed: 0,
    })
}

fn parse_count(field: &str) -> u64 {
    field.parse().unwrap_or(0)
}

/// Parses one `--numstat -z` line (its leading blank-separator `\n`, if any,
/// already stripped): `<added>\t<removed>\t<path>`. Binary files report
/// `-\t-`, which parses as 0/0. A rename reports an empty `<path>` here — the
/// old and new paths follow as their own NUL-terminated chunks instead.
fn parse_numstat(line: &str) -> (u64, u64, &str) {
    let mut fields = line.splitn(3, '\t');
    let added = parse_count(fields.next().unwrap_or(""));
    let removed = parse_count(fields.next().unwrap_or(""));
    let path = fields.next().unwrap_or("");
    (added, removed, path)
}

/// A `-z`-delimited chunk is a commit header iff it's wrapped in the format's
/// leading/trailing `%x1e`; every other chunk is numstat/path data.
fn header_of(chunk: &str) -> Option<&str> {
    chunk
        .strip_prefix('\u{1e}')
        .and_then(|h| h.strip_suffix('\u{1e}'))
}

/// A rename's empty-path numstat line is followed by its old and new path as
/// their own chunks; only the new one is kept. Each consume is guarded by a
/// peek so a malformed stream that puts the next commit's header where a
/// rename's path chunk should be can't be swallowed into this commit.
fn rename_new_path<'a>(chunks: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> &'a str {
    if chunks.peek().is_some_and(|c| header_of(c).is_some()) {
        return "";
    }
    chunks.next();
    if chunks.peek().is_some_and(|c| header_of(c).is_some()) {
        return "";
    }
    chunks.next().unwrap_or("")
}

/// Git normalizes pathspecs, so an unvalidated `..` segment would let a
/// request reach files outside a nested space's own directory. Backslashes
/// count as separators too: Git for Windows normalizes them the same way.
pub fn validate_space_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("invalid path: empty".to_string());
    }
    if path.starts_with('/') {
        return Err("invalid path: leading slash".to_string());
    }
    if path
        .split(['/', '\\'])
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("invalid path: bad segment".to_string());
    }
    Ok(())
}

fn log_start(before: Option<&str>) -> Result<String, String> {
    match before {
        Some(b) if is_hex40(b) => Ok(format!("{b}^")),
        Some(_) => Err("invalid before revision".to_string()),
        None => Ok("HEAD".to_string()),
    }
}

/// `<root>^` doesn't exist; git reports it as a missing revision, treated as an empty page.
fn is_missing_start(err: &str) -> bool {
    err.contains("unknown revision")
        || err.contains("bad revision")
        || err.contains("does not have any commits yet")
}

/// Fetches per-file history: `%x1e`-wrapped headers plus `--numstat` lines.
/// `-z` NUL-delimits chunks so a `\x1e` embedded in a commit subject can't
/// desync a header from the next one. Only the first numstat chunk after
/// each header is kept — the file pathspec yields exactly one line per
/// commit, so any extras (e.g. a rename's old/new path chunks) are ignored.
fn log_records(
    repo: &Path,
    before: Option<&str>,
    limit: usize,
    pathspec: Option<&str>,
) -> Result<(Vec<RevisionEntry>, bool), String> {
    let count = format!("-n{}", limit + 1);
    let format = format!("--format=%x1e{FORMAT}");
    let start = log_start(before)?;
    let mut args: Vec<&str> = vec!["log", &count, &format, "--numstat", "-z", &start, "--"];
    if let Some(p) = pathspec {
        args.push(p);
    }
    let out = match git::run(repo, &args, &[]) {
        Ok(out) => out,
        Err(e) if is_missing_start(&e) => return Ok((Vec::new(), false)),
        Err(e) => return Err(e),
    };

    let mut revisions: Vec<RevisionEntry> = Vec::new();
    let mut numstat_seen = false;
    for chunk in out.split('\0') {
        if let Some(header) = header_of(chunk) {
            if let Some(entry) = parse_entry(header) {
                revisions.push(entry);
            }
            numstat_seen = false;
            continue;
        }
        if numstat_seen {
            continue;
        }
        let line = chunk.strip_prefix('\n').unwrap_or(chunk);
        if line.is_empty() {
            continue;
        }
        if let Some(entry) = revisions.last_mut() {
            let (added, removed, _path) = parse_numstat(line);
            entry.added = added;
            entry.removed = removed;
            numstat_seen = true;
        }
    }
    let more = revisions.len() > limit;
    revisions.truncate(limit);
    Ok((revisions, more))
}

pub fn file_history(
    store: &RevisionStore,
    space_path: &str,
    before: Option<&str>,
    limit: usize,
) -> Result<FileRevisions, String> {
    validate_space_path(space_path)?;
    let repo = store.repo_root().ok_or("no repository")?;
    let pathspec = format!(":(literal){}", store.rel(space_path));
    let (revisions, more) = log_records(&repo, before, limit, Some(&pathspec))?;
    let status = git::run(
        &repo,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            &pathspec,
        ],
        &[],
    )?;
    let uncommitted = !status.trim().is_empty();
    Ok(FileRevisions {
        mode: store.mode().as_str().to_string(),
        uncommitted,
        revisions,
        more,
    })
}

pub fn file_at(
    store: &RevisionStore,
    space_path: &str,
    rev: &str,
) -> Result<Option<Vec<u8>>, String> {
    validate_space_path(space_path)?;
    if !is_hex40(rev) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let spec = format!("{rev}:{}", store.rel(space_path));
    match git::run_bytes(&repo, &["show", &spec], &[]) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e)
            if e.contains("does not exist")
                || e.contains("exists on disk, but not in")
                || e.contains("bad revision")
                || e.contains("invalid object name") =>
        {
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

pub fn file_diff(
    store: &RevisionStore,
    space_path: &str,
    rev: &str,
) -> Result<Option<String>, String> {
    validate_space_path(space_path)?;
    if !is_hex40(rev) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let pathspec = format!(":(literal){}", store.rel(space_path));
    match git::run(
        &repo,
        &[
            "show",
            "--format=",
            "--no-color",
            "--unified=3",
            "--no-ext-diff",
            "--no-textconv",
            rev,
            "--",
            &pathspec,
        ],
        &[],
    ) {
        Ok(diff) if diff.trim().is_empty() => Ok(None),
        Ok(diff) => Ok(Some(diff)),
        Err(e)
            if e.contains("does not exist")
                || e.contains("exists on disk, but not in")
                || e.contains("bad revision")
                || e.contains("bad object")
                || e.contains("invalid object name") =>
        {
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

fn space_prefix(store: &RevisionStore) -> Option<String> {
    let full = store.rel("");
    if full.is_empty() {
        None
    } else {
        Some(full)
    }
}

pub fn uncommitted_paths(store: &RevisionStore) -> Result<Vec<String>, String> {
    let repo = store.repo_root().ok_or("no repository")?;
    let prefix = space_prefix(store);
    let pathspec = prefix.as_ref().map(|p| format!(":(literal){p}"));
    let mut args: Vec<&str> = vec!["status", "--porcelain", "-z", "--untracked-files=all", "--"];
    if let Some(p) = &pathspec {
        args.push(p);
    }
    let out = git::run(&repo, &args, &[])?;

    // `-z` records are `XY <path>\0`, unquoted. A rename or copy adds the
    // source path as its own following chunk, which is not a changed path of
    // its own -- skip it rather than listing a file that no longer exists.
    let mut paths = Vec::new();
    let mut chunks = out.split('\0');
    while let Some(chunk) = chunks.next() {
        if chunk.len() < 4 {
            continue;
        }
        let (status, path) = chunk.split_at(3);
        if status.starts_with('R') || status.starts_with('C') {
            chunks.next();
        }
        let relative = match &prefix {
            Some(p) => path.strip_prefix(p.as_str()).unwrap_or(path),
            None => path,
        };
        if !relative.is_empty() {
            paths.push(relative.to_string());
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn working_diff(store: &RevisionStore, space_path: &str) -> Result<Option<String>, String> {
    validate_space_path(space_path)?;
    let repo = store.repo_root().ok_or("no repository")?;
    let rel = store.rel(space_path);
    let pathspec = format!(":(literal){rel}");
    if store.head_exists() {
        let tracked = git::run_diff(
            &repo,
            &[
                "diff",
                "HEAD",
                "--no-color",
                "--unified=3",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                &pathspec,
            ],
        )?;
        if !tracked.trim().is_empty() {
            return Ok(Some(tracked));
        }
    }
    // Tracked and no diff against HEAD: genuinely unchanged.
    if !git::run(&repo, &["ls-files", "--", &pathspec], &[])?
        .trim()
        .is_empty()
    {
        return Ok(None);
    }
    // Untracked (a page that has never been committed): `git diff HEAD` says
    // nothing about it, so diff it against nothing to show it whole. Best
    // effort -- a platform where this spelling doesn't work just gets no diff.
    if !repo.join(&rel).is_file() {
        return Ok(None);
    }
    let Ok(untracked) = git::run_diff(
        &repo,
        &[
            "diff",
            "--no-index",
            "--no-color",
            "--unified=3",
            "--",
            "/dev/null",
            &rel,
        ],
    ) else {
        return Ok(None);
    };
    Ok((!untracked.trim().is_empty()).then_some(untracked))
}

pub fn space_log(
    store: &RevisionStore,
    before: Option<&str>,
    limit: usize,
) -> Result<SpaceLog, String> {
    let repo = store.repo_root().ok_or("no repository")?;
    let mode = store.mode().as_str().to_string();
    let prefix = space_prefix(store);
    let count = format!("-n{}", limit + 1);
    let format = format!("--format=%x1e{FORMAT}");
    let start = log_start(before)?;
    let pathspec = prefix.as_ref().map(|p| format!(":(literal){p}"));
    let mut args: Vec<&str> = vec!["log", &count, &format, "--numstat", "-z", &start, "--"];
    if let Some(p) = &pathspec {
        args.push(p);
    }
    let out = match git::run(&repo, &args, &[]) {
        Ok(out) => out,
        Err(e) if is_missing_start(&e) => {
            return Ok(SpaceLog {
                mode,
                commits: Vec::new(),
                more: false,
                uncommitted: Vec::new(),
            });
        }
        Err(e) => return Err(e),
    };

    // Each commit's `%x1e...%x1e` header is one whole `-z` (NUL terminated)
    // chunk; every other chunk is a `--numstat` line for a file the commit
    // touched (binary files report `-\t-`, parsed as 0/0). A detected rename
    // emits an empty path here, followed by the old and new paths as their
    // own chunks; the new one is kept. `-z` disables path quoting, so
    // non-ASCII/quote/newline names round-trip verbatim, and since header/
    // file boundaries are the NULs rather than the `\x1e`s, an `\x1e`
    // embedded in a commit subject can't desync this.
    let mut commits: Vec<LogCommit> = Vec::new();
    let mut chunks = out.split('\0').peekable();
    while let Some(chunk) = chunks.next() {
        if let Some(header) = header_of(chunk) {
            if let Some(entry) = parse_entry(header) {
                commits.push(entry.into());
            }
            continue;
        }
        let Some(commit) = commits.last_mut() else {
            continue;
        };
        let line = chunk.strip_prefix('\n').unwrap_or(chunk);
        if line.is_empty() {
            continue;
        }
        let (added, removed, path) = parse_numstat(line);
        commit.added += added;
        commit.removed += removed;
        let name = if path.is_empty() {
            rename_new_path(&mut chunks)
        } else {
            path
        };
        if !name.is_empty() {
            let relative = match &prefix {
                Some(p) => name.strip_prefix(p.as_str()).unwrap_or(name),
                None => name,
            };
            commit.files.push(relative.to_string());
        }
    }
    let more = commits.len() > limit;
    commits.truncate(limit);
    Ok(SpaceLog {
        mode,
        commits,
        more,
        // Best effort: a log that lists commits is still useful if this fails.
        uncommitted: uncommitted_paths(store).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::revisions::RevisionStore;
    use silverbullet_server_common::RevisionsMode;

    fn fixture() -> (tempfile::TempDir, RevisionStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("a.md"), b"v1").unwrap();
        std::fs::write(dir.path().join("b.md"), b"b1").unwrap();
        store
            .commit_batch(
                "Alice",
                "alice@x",
                "add a+b",
                &["a.md".into(), "b.md".into()],
            )
            .unwrap();
        std::fs::write(dir.path().join("a.md"), b"v2").unwrap();
        store
            .commit_batch("Bob", "bob@x", "edit a", &["a.md".into()])
            .unwrap();
        (dir, store)
    }

    #[test]
    fn file_history_lists_only_commits_touching_the_file_newest_first() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert_eq!(h.mode, "managed");
        assert_eq!(h.revisions.len(), 2);
        assert_eq!(h.revisions[0].author, "Bob");
        assert_eq!(h.revisions[0].message, "edit a");
        assert_eq!(h.revisions[0].added, 1);
        assert_eq!(h.revisions[0].removed, 1);
        assert!(
            h.revisions[0].timestamp > 1_500_000_000_000,
            "milliseconds expected"
        );
        assert_eq!(h.revisions[1].author, "Alice");
        assert_eq!(h.revisions[1].added, 1);
        assert_eq!(h.revisions[1].removed, 0);
        assert!(!h.more);
        let hb = file_history(&store, "b.md", None, 50).unwrap();
        assert_eq!(hb.revisions.len(), 1);
        assert_eq!(hb.revisions[0].added, 1);
        assert_eq!(hb.revisions[0].removed, 0);
    }

    #[test]
    fn uncommitted_flag_reflects_live_file_vs_head() {
        let (dir, store) = fixture();
        assert!(!file_history(&store, "a.md", None, 50).unwrap().uncommitted);
        std::fs::write(dir.path().join("a.md"), b"dirty").unwrap();
        assert!(file_history(&store, "a.md", None, 50).unwrap().uncommitted);
    }

    #[test]
    fn file_at_returns_old_bytes_and_none_for_unknown() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        let old = file_at(&store, "a.md", &h.revisions[1].rev)
            .unwrap()
            .unwrap();
        assert_eq!(old, b"v1");
        assert!(file_at(&store, "nope.md", &h.revisions[0].rev)
            .unwrap()
            .is_none());
    }

    #[test]
    fn file_diff_shows_unified_diff_for_a_modification() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        let diff = file_diff(&store, "a.md", &h.revisions[0].rev)
            .unwrap()
            .unwrap();
        assert!(diff.contains("@@"), "{diff}");
        assert!(diff.contains("-v1"), "{diff}");
        assert!(diff.contains("+v2"), "{diff}");
    }

    #[test]
    fn file_diff_shows_the_root_commit_as_a_full_addition() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        let root_rev = &h.revisions[1].rev;
        let diff = file_diff(&store, "a.md", root_rev).unwrap().unwrap();
        assert!(diff.contains("new file mode"), "{diff}");
        assert!(diff.contains("+v1"), "{diff}");
    }

    #[test]
    fn file_diff_returns_none_for_an_unknown_path_at_a_revision() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert!(file_diff(&store, "nope.md", &h.revisions[0].rev)
            .unwrap()
            .is_none());
    }

    #[test]
    fn file_diff_rejects_invalid_paths_and_revisions() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert!(file_diff(&store, "../secret.md", &h.revisions[0].rev)
            .unwrap_err()
            .starts_with("invalid path"));
        assert!(file_diff(&store, "a.md", "nothex").is_err());
    }

    #[test]
    fn uncommitted_paths_lists_changed_and_untracked_files() {
        let (dir, store) = fixture();
        assert_eq!(uncommitted_paths(&store).unwrap(), Vec::<String>::new());

        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();
        std::fs::write(dir.path().join("new.md"), b"brand new").unwrap();
        std::fs::remove_file(dir.path().join("b.md")).unwrap();

        assert_eq!(
            uncommitted_paths(&store).unwrap(),
            vec!["a.md".to_string(), "b.md".to_string(), "new.md".to_string()],
        );
    }

    #[test]
    fn space_log_carries_what_is_not_committed_yet() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();

        let log = space_log(&store, None, 50).unwrap();

        assert_eq!(log.uncommitted, vec!["a.md".to_string()]);
    }

    #[test]
    fn working_diff_shows_the_change_against_head() {
        let (dir, store) = fixture();
        assert_eq!(working_diff(&store, "a.md").unwrap(), None);

        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();
        let diff = working_diff(&store, "a.md").unwrap().unwrap();

        assert!(diff.contains("@@"), "{diff}");
        assert!(diff.contains("-v2"), "{diff}");
        assert!(diff.contains("+v3"), "{diff}");
    }

    #[test]
    fn working_diff_shows_an_untracked_file_whole() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("new.md"), b"brand new\n").unwrap();

        let diff = working_diff(&store, "new.md").unwrap().unwrap();

        assert!(diff.contains("+brand new"), "{diff}");
    }

    #[test]
    fn working_diff_of_an_unchanged_file_is_none() {
        let (_dir, store) = fixture();
        assert_eq!(working_diff(&store, "b.md").unwrap(), None);
    }

    #[test]
    fn space_log_lists_commits_with_touched_files() {
        let (_dir, store) = fixture();
        let log = space_log(&store, None, 50).unwrap();
        assert_eq!(log.commits.len(), 2);
        assert_eq!(log.commits[0].files, vec!["a.md".to_string()]);
        assert_eq!(log.commits[0].added, 1);
        assert_eq!(log.commits[0].removed, 1);
        let mut first = log.commits[1].files.clone();
        first.sort();
        assert_eq!(first, vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(log.commits[1].added, 2);
        assert_eq!(log.commits[1].removed, 0);
    }

    #[test]
    fn binary_file_numstat_counts_as_zero() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("bin.dat"), [0u8, 1, 2, 3, b'x', b'y', b'z']).unwrap();
        store
            .commit_batch("A", "a@x", "add binary", &["bin.dat".into()])
            .unwrap();
        let h = file_history(&store, "bin.dat", None, 50).unwrap();
        assert_eq!(h.revisions[0].added, 0);
        assert_eq!(h.revisions[0].removed, 0);
        let log = space_log(&store, None, 50).unwrap();
        assert_eq!(log.commits[0].files, vec!["bin.dat".to_string()]);
        assert_eq!(log.commits[0].added, 0);
        assert_eq!(log.commits[0].removed, 0);
    }

    #[test]
    fn pagination_via_before_and_limit() {
        let (dir, store) = fixture();
        for i in 0..5 {
            std::fs::write(dir.path().join("a.md"), format!("v{i}")).unwrap();
            store
                .commit_batch("A", "a@x", "e", &["a.md".into()])
                .unwrap();
        }
        let page1 = file_history(&store, "a.md", None, 3).unwrap();
        assert_eq!(page1.revisions.len(), 3);
        assert!(page1.more);
        let page2 = file_history(&store, "a.md", Some(&page1.revisions[2].rev), 10).unwrap();
        assert!(!page2
            .revisions
            .iter()
            .any(|r| page1.revisions.iter().any(|p| p.rev == r.rev)));
        assert!(!page2.revisions.is_empty());
    }

    #[test]
    fn before_the_root_commit_yields_an_empty_page() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        let root_rev = &h.revisions[1].rev;
        let page = file_history(&store, "a.md", Some(root_rev), 10).unwrap();
        assert!(page.revisions.is_empty());
        assert!(!page.more);
    }

    #[test]
    fn dormant_store_reports_no_repository() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        assert!(file_history(&store, "a.md", None, 50).is_err());
    }

    #[test]
    fn space_log_preserves_non_ascii_filenames() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("café.md"), b"c1").unwrap();
        store
            .commit_batch("A", "a@x", "add cafe", &["café.md".into()])
            .unwrap();
        let log = space_log(&store, None, 50).unwrap();
        assert!(
            log.commits[0].files.contains(&"café.md".to_string()),
            "{:?}",
            log.commits[0].files
        );
    }

    #[test]
    fn space_log_handles_a_rename_without_desyncing_the_next_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("a.md"), b"v1").unwrap();
        std::fs::write(dir.path().join("other.md"), b"o1").unwrap();
        store
            .commit_batch("A", "a@x", "seed", &["a.md".into(), "other.md".into()])
            .unwrap();

        std::fs::rename(dir.path().join("a.md"), dir.path().join("c.md")).unwrap();
        std::fs::write(dir.path().join("other.md"), b"o2").unwrap();
        store
            .commit_batch(
                "A",
                "a@x",
                "rename",
                &["a.md".into(), "c.md".into(), "other.md".into()],
            )
            .unwrap();

        let log = space_log(&store, None, 50).unwrap();
        let renamed = &log.commits[0];
        assert_eq!(renamed.message, "rename");
        let mut files = renamed.files.clone();
        files.sort();
        assert_eq!(files, vec!["c.md".to_string(), "other.md".to_string()]);
        // The rename itself is a pure 0/0 in git's numstat (unchanged content);
        // other.md's own 1/1 edit is the only contribution, and it must still
        // land on this commit rather than being lost by the rename's chunk skip.
        assert_eq!(renamed.added, 1);
        assert_eq!(renamed.removed, 1);
    }

    #[test]
    fn space_log_scopes_to_nested_space_and_relativizes_file_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root_store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("root.md"), b"root").unwrap();
        root_store
            .commit_batch("A", "a@x", "root only", &["root.md".into()])
            .unwrap();
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/a.md"), b"a1").unwrap();
        root_store
            .commit_batch("A", "a@x", "docs a", &["docs/a.md".into()])
            .unwrap();

        let sub = dir.path().join("docs");
        let store = RevisionStore::open(&sub, RevisionsMode::Unmanaged).unwrap();
        let log = space_log(&store, None, 50).unwrap();
        assert_eq!(log.commits.len(), 1);
        assert_eq!(log.commits[0].message, "docs a");
        assert_eq!(log.commits[0].files, vec!["a.md".to_string()]);
    }

    #[test]
    fn validate_space_path_rejects_traversal_and_malformed_paths() {
        assert!(validate_space_path("a.md").is_ok());
        assert!(validate_space_path("docs/a.md").is_ok());
        assert!(validate_space_path("café.md").is_ok());
        for bad in [
            "",
            "/a.md",
            "..",
            ".",
            "docs/../secret.md",
            "../secret.md",
            "docs/./a.md",
            "a//b.md",
            "docs/",
            "docs\\..\\secret.md",
            "..\\x",
        ] {
            let err = validate_space_path(bad).unwrap_err();
            assert!(err.starts_with("invalid path"), "{bad:?} -> {err}");
        }
    }

    #[test]
    fn traversal_paths_are_refused_before_git_sees_them() {
        let dir = tempfile::tempdir().unwrap();
        let root_store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("secret.md"), b"s").unwrap();
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/a.md"), b"a").unwrap();
        root_store
            .commit_batch(
                "A",
                "a@x",
                "seed",
                &["secret.md".into(), "docs/a.md".into()],
            )
            .unwrap();

        let sub = RevisionStore::open(&dir.path().join("docs"), RevisionsMode::Unmanaged).unwrap();
        assert!(file_history(&sub, "../secret.md", None, 50)
            .unwrap_err()
            .starts_with("invalid path"));
        let rev = file_history(&sub, "a.md", None, 50).unwrap().revisions[0]
            .rev
            .clone();
        assert!(file_at(&sub, "../secret.md", &rev)
            .unwrap_err()
            .starts_with("invalid path"));
    }

    #[test]
    fn commit_message_containing_record_separator_does_not_desync_history() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();
        let weird_message = "line1\u{1e}line2";
        store
            .commit_batch("A", "a@x", weird_message, &["a.md".into()])
            .unwrap();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert_eq!(h.revisions.len(), 3);
        assert_eq!(h.revisions[0].message, weird_message);
    }
}
