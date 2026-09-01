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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub path: String,
    /// `added` | `modified` | `deleted` | `renamed`.
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    pub rev: String,
    pub timestamp: i64,
    pub author: String,
    pub message: String,
    pub files: Vec<LogFile>,
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
    /// What differs from HEAD right now, newest state on disk -- what a
    /// snapshot would capture.
    pub uncommitted: Vec<LogFile>,
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

/// Consumes one path chunk, guarded by a peek so a malformed stream that
/// puts the next commit's header where a path should be can't be swallowed
/// into this commit.
fn next_path<'a>(chunks: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> &'a str {
    if chunks.peek().is_some_and(|c| header_of(c).is_some()) {
        return "";
    }
    chunks.next().unwrap_or("")
}

/// A rename's empty-path numstat line is followed by its old and new path as
/// their own chunks; only the new one is kept.
fn rename_new_path<'a>(chunks: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> &'a str {
    next_path(chunks);
    next_path(chunks)
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
/// commit. `boundary`, when set, is the nested space's own directory prefix:
/// the walk stops at the first commit where `--follow` has left it.
fn log_records(
    repo: &Path,
    before: Option<&str>,
    limit: usize,
    pathspec: Option<&str>,
    follow: bool,
    boundary: Option<&str>,
) -> Result<(Vec<RevisionEntry>, bool), String> {
    let count = format!("-n{}", limit + 1);
    let format = format!("--format=%x1e{FORMAT}");
    let start = log_start(before)?;
    let mut args: Vec<&str> = vec!["log", &count, &format, "--numstat", "-z"];
    if follow && pathspec.is_some() {
        args.push("--follow");
    }
    args.push(&start);
    args.push("--");
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
    let mut chunks = out.split('\0').peekable();
    while let Some(chunk) = chunks.next() {
        if let Some(header) = header_of(chunk) {
            if let Some(entry) = parse_entry(header) {
                revisions.push(entry);
            }
            numstat_seen = false;
            continue;
        }
        if numstat_seen || revisions.is_empty() {
            continue;
        }
        let line = chunk.strip_prefix('\n').unwrap_or(chunk);
        if line.is_empty() {
            continue;
        }
        let (added, removed, path) = parse_numstat(line);
        let name = if path.is_empty() {
            rename_new_path(&mut chunks)
        } else {
            path
        };
        // `--follow` will walk a rename right out of a nested space's own
        // directory, and a revision from before the file entered the space
        // is one this API must refuse to serve. Ending the history where the
        // file arrived keeps the list and the read path agreeing, instead of
        // offering rows that can only 404.
        if boundary.is_some_and(|b| !name.is_empty() && !name.starts_with(b)) {
            revisions.pop();
            break;
        }
        let entry = revisions.last_mut().expect("checked above");
        entry.added = added;
        entry.removed = removed;
        numstat_seen = true;
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
    let prefix = space_prefix(store);
    let (revisions, more) = log_records(
        &repo,
        before,
        limit,
        Some(&pathspec),
        true,
        prefix.as_deref(),
    )?;
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

/// The parent commit of `rev`, or `None` when it is a root commit. A `check`
/// first, separate from the `run` that reads the sha, keeps "no parent"
/// (exit 1) from being conflated with a real git failure -- both would
/// otherwise land on the same `.ok()` and read as "not found".
fn parent_of(repo: &Path, rev: &str) -> Result<Option<String>, String> {
    let spec = format!("{rev}^");
    let args = ["rev-parse", "--verify", "--quiet", spec.as_str()];
    if !git::check(repo, &args, 1)? {
        return Ok(None);
    }
    let sha = git::run(repo, &args, &[])?.trim().to_string();
    Ok(is_hex40(&sha).then_some(sha))
}

/// `rev` as given, or its parent. `Ok(None)` means the caller asked for a
/// parent that does not exist, which reads as "not found" rather than an
/// error; a genuine git failure still propagates as `Err`.
fn effective_rev(repo: &Path, rev: &str, parent: bool) -> Result<Option<String>, String> {
    if parent {
        parent_of(repo, rev)
    } else {
        Ok(Some(rev.to_string()))
    }
}

/// The name this file went by at `rev`, when a rename has moved it since.
/// `file_history` follows renames, so it lists commits from before the last
/// rename -- at which point `<rev>:<current path>` names nothing and every
/// read of those rows would 404. `--follow` over `<rev>..HEAD` replays the
/// same rename chain the history was built from; walking it oldest-last,
/// the final rename source is the name `rev` knew. `None` means no rename
/// stands between `rev` and HEAD, so there is nothing else to try -- as does
/// a chain that leaves `boundary`, a nested space's own directory prefix.
fn path_at_rev(
    repo: &Path,
    rev: &str,
    rel: &str,
    boundary: Option<&str>,
) -> Result<Option<String>, String> {
    let range = format!("{rev}..HEAD");
    let pathspec = format!(":(literal){rel}");
    let out = match git::run(
        repo,
        &[
            "log",
            "--follow",
            "--name-status",
            "-z",
            "--format=%x1e%H%x1e",
            &range,
            "--",
            &pathspec,
        ],
        &[],
    ) {
        Ok(out) => out,
        // A rev that resolves to nothing has no rename chain to walk, and
        // the caller already reads `None` as "not found" -- only a genuine
        // git failure is worth propagating as an error.
        Err(e) if is_missing_start(&e) || e.contains("Invalid revision range") => return Ok(None),
        Err(e) => return Err(e),
    };

    let mut source = None;
    let mut chunks = out.split('\0').peekable();
    while let Some(chunk) = chunks.next() {
        if header_of(chunk).is_some() {
            continue;
        }
        let status = chunk.strip_prefix('\n').unwrap_or(chunk);
        if status.is_empty() {
            continue;
        }
        if status.starts_with('R') || status.starts_with('C') {
            let old = next_path(&mut chunks);
            next_path(&mut chunks);
            if !old.is_empty() {
                source = Some(old.to_string());
            }
        } else {
            next_path(&mut chunks);
        }
    }
    let Some(source) = source.filter(|p| p != rel) else {
        return Ok(None);
    };
    // A file moved in from outside a nested space's directory is not this
    // API's to hand over: `/.revisions` serves the space, and its pre-move
    // bytes lived somewhere the caller was never granted. `file_history`
    // stops at the same boundary, so nothing is listed that this refuses.
    if boundary.is_some_and(|b| !source.starts_with(b)) {
        return Ok(None);
    }
    Ok(Some(source))
}

fn show_blob(repo: &Path, rev: &str, rel: &str) -> Result<Option<Vec<u8>>, String> {
    let spec = format!("{rev}:{rel}");
    match git::run_bytes(repo, &["show", &spec], &[]) {
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

pub fn file_at(
    store: &RevisionStore,
    space_path: &str,
    rev: &str,
    parent: bool,
) -> Result<Option<Vec<u8>>, String> {
    validate_space_path(space_path)?;
    if !is_hex40(rev) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let Some(rev) = effective_rev(&repo, rev, parent)? else {
        return Ok(None);
    };
    let rel = store.rel(space_path);
    if let Some(bytes) = show_blob(&repo, &rev, &rel)? {
        return Ok(Some(bytes));
    }
    match path_at_rev(&repo, &rev, &rel, space_prefix(store).as_deref())? {
        Some(historical) => show_blob(&repo, &rev, &historical),
        None => Ok(None),
    }
}

fn show_diff(repo: &Path, rev: &str, rel: &str) -> Result<Option<String>, String> {
    let pathspec = format!(":(literal){rel}");
    match git::run(
        repo,
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

pub fn file_diff(
    store: &RevisionStore,
    space_path: &str,
    rev: &str,
    parent: bool,
) -> Result<Option<String>, String> {
    validate_space_path(space_path)?;
    if !is_hex40(rev) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let Some(rev) = effective_rev(&repo, rev, parent)? else {
        return Ok(None);
    };
    let rel = store.rel(space_path);
    if let Some(diff) = show_diff(&repo, &rev, &rel)? {
        return Ok(Some(diff));
    }
    match path_at_rev(&repo, &rev, &rel, space_prefix(store).as_deref())? {
        Some(historical) => show_diff(&repo, &rev, &historical),
        None => Ok(None),
    }
}

pub enum RangeEnd {
    Rev(String),
    Head,
    Working,
}

impl RangeEnd {
    pub fn parse(s: &str) -> Option<RangeEnd> {
        match s {
            "HEAD" => Some(RangeEnd::Head),
            "WORKING" => Some(RangeEnd::Working),
            _ if is_hex40(s) => Some(RangeEnd::Rev(s.to_string())),
            _ => None,
        }
    }

    fn label(&self) -> String {
        match self {
            RangeEnd::Rev(r) => r.clone(),
            RangeEnd::Head => "HEAD".to_string(),
            RangeEnd::Working => "WORKING".to_string(),
        }
    }
}

/// `git diff` takes the working tree as its second side by *omitting* it, so
/// a working-tree range is one argument shorter rather than differently named.
fn range_args(from: &str, to: &RangeEnd) -> Vec<String> {
    match to {
        RangeEnd::Working => vec![from.to_string()],
        RangeEnd::Head => vec![format!("{from}..HEAD")],
        RangeEnd::Rev(r) => vec![format!("{from}..{r}")],
    }
}

pub fn range_file_diff(
    store: &RevisionStore,
    space_path: &str,
    from: &str,
    to: &RangeEnd,
) -> Result<Option<String>, String> {
    validate_space_path(space_path)?;
    if !is_hex40(from) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let pathspec = format!(":(literal){}", store.rel(space_path));
    let range = range_args(from, to);
    let mut args: Vec<&str> = vec![
        "diff",
        "--no-color",
        "--unified=3",
        "--no-ext-diff",
        "--no-textconv",
    ];
    args.extend(range.iter().map(String::as_str));
    args.push("--");
    args.push(&pathspec);
    let diff = git::run_diff(&repo, &args)?;
    Ok(if diff.trim().is_empty() {
        None
    } else {
        Some(diff)
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeFile {
    pub path: String,
    pub status: String,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeSummary {
    pub from: String,
    pub to: String,
    pub files: Vec<RangeFile>,
    pub authors: Vec<String>,
}

/// `--name-status -z` records are `<status>\0<path>`, except a rename/copy
/// (`R*`/`C*`) which carries the source path as a separate preceding chunk --
/// only the destination path is kept.
fn name_status_records(
    repo: &Path,
    range: &[String],
    pathspec: Option<&str>,
) -> Result<Vec<(String, String)>, String> {
    let mut args: Vec<&str> = vec!["diff", "--name-status", "-z"];
    args.extend(range.iter().map(String::as_str));
    args.push("--");
    if let Some(p) = pathspec {
        args.push(p);
    }
    let out = git::run_diff(repo, &args)?;
    let mut records = Vec::new();
    let mut chunks = out.split('\0');
    while let Some(status) = chunks.next() {
        if status.is_empty() {
            continue;
        }
        let path = chunks.next().unwrap_or("");
        if status.starts_with('R') || status.starts_with('C') {
            let dest = chunks.next().unwrap_or("");
            records.push((status.to_string(), dest.to_string()));
        } else if !path.is_empty() {
            records.push((status.to_string(), path.to_string()));
        }
    }
    Ok(records)
}

fn numstat_records(
    repo: &Path,
    range: &[String],
    pathspec: Option<&str>,
) -> Result<Vec<(u64, u64, String)>, String> {
    let mut args: Vec<&str> = vec!["diff", "--numstat", "-z"];
    args.extend(range.iter().map(String::as_str));
    args.push("--");
    if let Some(p) = pathspec {
        args.push(p);
    }
    let out = git::run_diff(repo, &args)?;
    let mut records = Vec::new();
    let mut chunks = out.split('\0').peekable();
    while let Some(chunk) = chunks.next() {
        if chunk.is_empty() {
            continue;
        }
        let (added, removed, path) = parse_numstat(chunk);
        let name = if path.is_empty() {
            rename_new_path(&mut chunks)
        } else {
            path
        };
        if !name.is_empty() {
            records.push((added, removed, name.to_string()));
        }
    }
    Ok(records)
}

pub fn range_summary(
    store: &RevisionStore,
    from: &str,
    to: &RangeEnd,
) -> Result<RangeSummary, String> {
    if !is_hex40(from) {
        return Err("invalid revision".to_string());
    }
    let repo = store.repo_root().ok_or("no repository")?;
    let prefix = space_prefix(store);
    let pathspec = prefix.as_ref().map(|p| format!(":(literal){p}"));
    let range = range_args(from, to);

    let statuses = name_status_records(&repo, &range, pathspec.as_deref())?;
    let counts = numstat_records(&repo, &range, pathspec.as_deref())?;

    let mut files: Vec<RangeFile> = Vec::new();
    for (status, path) in statuses {
        let relative = match &prefix {
            Some(p) => path.strip_prefix(p.as_str()).unwrap_or(&path).to_string(),
            None => path,
        };
        files.push(RangeFile {
            path: relative,
            status,
            added: 0,
            removed: 0,
        });
    }
    for (added, removed, path) in counts {
        let relative = match &prefix {
            Some(p) => path.strip_prefix(p.as_str()).unwrap_or(&path).to_string(),
            None => path,
        };
        if let Some(file) = files.iter_mut().find(|f| f.path == relative) {
            file.added = added;
            file.removed = removed;
        }
    }

    let authors = if matches!(to, RangeEnd::Working) {
        Vec::new()
    } else {
        let mut args: Vec<&str> = vec!["log", "--format=%an"];
        args.extend(range.iter().map(String::as_str));
        args.push("--");
        if let Some(p) = &pathspec {
            args.push(p);
        }
        let out = git::run(&repo, &args, &[])?;
        let mut seen = std::collections::HashSet::new();
        out.lines()
            .filter(|a| !a.is_empty())
            .filter(|a| seen.insert(a.to_string()))
            .map(str::to_string)
            .collect()
    };

    Ok(RangeSummary {
        from: from.to_string(),
        to: to.label(),
        files,
        authors,
    })
}

/// Git's status letter as the four states the history panel distinguishes.
/// A copy reads as an addition: a new path appears where there was none.
fn status_name(code: &str) -> &'static str {
    match code.as_bytes().first() {
        Some(b'A') | Some(b'C') => "added",
        Some(b'D') => "deleted",
        Some(b'R') => "renamed",
        _ => "modified",
    }
}

/// The status letter of a `--raw` record, which numstat lines never match
/// because they start with a digit or `-` rather than a colon.
fn raw_status(line: &str) -> Option<&str> {
    line.strip_prefix(':')?.split_whitespace().last()
}

fn space_prefix(store: &RevisionStore) -> Option<String> {
    let full = store.rel("");
    if full.is_empty() {
        None
    } else {
        Some(full)
    }
}

pub fn uncommitted_files(store: &RevisionStore) -> Result<Vec<LogFile>, String> {
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
            paths.push(LogFile {
                path: relative.to_string(),
                // Porcelain codes are `XY`: staged then unstaged. `??` is an
                // untracked file, which is an addition as far as a snapshot
                // is concerned. Otherwise take whichever side is not a space.
                status: status_name(if status.starts_with('?') {
                    "A"
                } else {
                    status.trim_start().trim_end()
                })
                .to_string(),
            });
        }
    }
    paths.sort_by(|a, b| a.path.cmp(&b.path));
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

/// Fetches and parses one `space_log` invocation: `%x1e`-wrapped headers
/// plus `--numstat` file lines, optionally narrowed by a `--grep`/`--author`
/// matcher. Returns `None` when `before`'s start ref doesn't exist -- an
/// empty repository, or paging past the root commit -- which the caller
/// treats as "nothing here" rather than an error.
fn space_log_records(
    repo: &Path,
    before: Option<&str>,
    limit: usize,
    prefix: Option<&str>,
    matcher: Option<(&str, &str)>,
) -> Result<Option<(Vec<LogCommit>, bool)>, String> {
    let count = format!("-n{}", limit + 1);
    let format = format!("--format=%x1e{FORMAT}");
    let start = log_start(before)?;
    let pathspec = prefix.map(|p| format!(":(literal){p}"));
    let mut args: Vec<&str> = vec!["log", &count, &format, "--raw", "--numstat", "-z"];
    let matcher_arg = matcher.map(|(flag, value)| format!("{flag}={value}"));
    if let Some(arg) = matcher_arg.as_deref() {
        args.push("--fixed-strings");
        args.push("--regexp-ignore-case");
        args.push(arg);
    }
    args.push(&start);
    args.push("--");
    if let Some(p) = &pathspec {
        args.push(p);
    }
    let out = match git::run(repo, &args, &[]) {
        Ok(out) => out,
        Err(e) if is_missing_start(&e) => return Ok(None),
        Err(e) => return Err(e),
    };

    // Each commit's `%x1e...%x1e` header is one whole `-z` (NUL terminated)
    // chunk. `--raw` then names every touched path with its status letter,
    // and `--numstat` repeats the same paths with line counts -- git emits
    // both blocks, raw first, in the same order. The file list is built from
    // the raw block (only it carries status); numstat is read for the +/-
    // totals alone. Either block spells a rename as a record whose own path
    // field is empty followed by the old and new paths as separate chunks,
    // and both must consume that pair to stay in step. Binary files report
    // `-\t-`, parsed as 0/0. `-z` disables path quoting, so non-ASCII/quote/
    // newline names round-trip verbatim, and since header/file boundaries
    // are the NULs rather than the `\x1e`s, an `\x1e` embedded in a commit
    // subject can't desync this.
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
        if let Some(code) = raw_status(line) {
            let name = if code.starts_with('R') || code.starts_with('C') {
                rename_new_path(&mut chunks)
            } else {
                next_path(&mut chunks)
            };
            if !name.is_empty() {
                let relative = match prefix {
                    Some(p) => name.strip_prefix(p).unwrap_or(name),
                    None => name,
                };
                commit.files.push(LogFile {
                    path: relative.to_string(),
                    status: status_name(code).to_string(),
                });
            }
            continue;
        }
        let (added, removed, path) = parse_numstat(line);
        commit.added += added;
        commit.removed += removed;
        if path.is_empty() {
            rename_new_path(&mut chunks);
        }
    }
    let more = commits.len() > limit;
    commits.truncate(limit);
    Ok(Some((commits, more)))
}

pub fn space_log(
    store: &RevisionStore,
    before: Option<&str>,
    limit: usize,
    q: Option<&str>,
) -> Result<SpaceLog, String> {
    let repo = store.repo_root().ok_or("no repository")?;
    let mode = store.mode().as_str().to_string();
    let prefix = space_prefix(store);

    // Git has no OR between `--grep` and `--author`, so a phrase runs the
    // log twice and the results are unioned by rev. Both invocations share
    // the same start ref, so if the first reports "no start" the second
    // would too -- no need to run it.
    let matched = match q {
        None => space_log_records(&repo, before, limit, prefix.as_deref(), None)?,
        Some(phrase) => {
            match space_log_records(
                &repo,
                before,
                limit,
                prefix.as_deref(),
                Some(("--grep", phrase)),
            )? {
                None => None,
                Some((grep, grep_more)) => {
                    let (author, author_more) = space_log_records(
                        &repo,
                        before,
                        limit,
                        prefix.as_deref(),
                        Some(("--author", phrase)),
                    )?
                    .unwrap_or_default();
                    let mut seen = std::collections::HashSet::new();
                    let mut merged: Vec<LogCommit> = grep
                        .into_iter()
                        .chain(author)
                        .filter(|c| seen.insert(c.rev.clone()))
                        .collect();
                    merged.sort_by_key(|c| std::cmp::Reverse(c.timestamp));
                    let more = grep_more || author_more || merged.len() > limit;
                    merged.truncate(limit);
                    Some((merged, more))
                }
            }
        }
    };

    let Some((commits, more)) = matched else {
        return Ok(SpaceLog {
            mode,
            commits: Vec::new(),
            more: false,
            uncommitted: Vec::new(),
        });
    };

    Ok(SpaceLog {
        mode,
        commits,
        more,
        // Best effort: a log that lists commits is still useful if this fails.
        uncommitted: uncommitted_files(store).unwrap_or_default(),
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

    /// `old.md` committed, then renamed to `new.md` with its bytes left
    /// untouched so git's rename detection fires reliably.
    fn renamed_fixture() -> (tempfile::TempDir, RevisionStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("old.md"), b"contents\n").unwrap();
        store
            .commit_batch("alice", "alice@x", "add old", &["old.md".into()])
            .unwrap();
        std::fs::rename(dir.path().join("old.md"), dir.path().join("new.md")).unwrap();
        store
            .commit_batch(
                "alice",
                "alice@x",
                "rename",
                &["old.md".into(), "new.md".into()],
            )
            .unwrap();
        (dir, store)
    }

    #[test]
    fn file_history_follows_a_rename() {
        let (_dir, store) = renamed_fixture();

        let history = file_history(&store, "new.md", None, 50).unwrap();
        assert_eq!(
            history.revisions.len(),
            2,
            "the pre-rename commit is missing"
        );
    }

    #[test]
    fn file_at_reads_a_revision_from_before_a_rename() {
        let (_dir, store) = renamed_fixture();
        let history = file_history(&store, "new.md", None, 50).unwrap();
        let pre_rename = &history.revisions[1].rev;

        let bytes = file_at(&store, "new.md", pre_rename, false)
            .unwrap()
            .expect("a row the history lists must be readable");
        assert_eq!(bytes, b"contents\n");
    }

    #[test]
    fn file_diff_reads_a_revision_from_before_a_rename() {
        let (_dir, store) = renamed_fixture();
        let history = file_history(&store, "new.md", None, 50).unwrap();
        let pre_rename = &history.revisions[1].rev;

        let diff = file_diff(&store, "new.md", pre_rename, false)
            .unwrap()
            .expect("a row the history lists must have a diff");
        assert!(diff.contains("new file mode"), "{diff}");
        assert!(diff.contains("+contents"), "{diff}");
        assert!(diff.contains("old.md"), "{diff}");
    }

    #[test]
    fn file_at_with_parent_crosses_a_rename() {
        let (_dir, store) = renamed_fixture();
        let history = file_history(&store, "new.md", None, 50).unwrap();
        let rename_rev = &history.revisions[0].rev;

        let bytes = file_at(&store, "new.md", rename_rev, true)
            .unwrap()
            .expect("the version before the rename must be readable");
        assert_eq!(bytes, b"contents\n");
    }

    #[test]
    fn file_at_follows_a_chain_of_two_renames() {
        let (dir, store) = renamed_fixture();
        std::fs::rename(dir.path().join("new.md"), dir.path().join("newer.md")).unwrap();
        store
            .commit_batch(
                "alice",
                "alice@x",
                "rename again",
                &["new.md".into(), "newer.md".into()],
            )
            .unwrap();
        let history = file_history(&store, "newer.md", None, 50).unwrap();
        let root = &history.revisions.last().unwrap().rev;

        let bytes = file_at(&store, "newer.md", root, false).unwrap();
        assert_eq!(bytes.as_deref(), Some(&b"contents\n"[..]));
    }

    /// A repo holding a nested space beside a directory the space does not
    /// cover, with a commit that moved a file across that line.
    fn moved_into_space_fixture() -> (tempfile::TempDir, RevisionStore, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::create_dir_all(dir.path().join("secrets")).unwrap();
        std::fs::create_dir_all(dir.path().join("space")).unwrap();
        std::fs::write(dir.path().join("secrets/creds.env"), SECRET).unwrap();
        std::fs::write(dir.path().join("space/other.md"), b"hello\n").unwrap();
        root.commit_batch(
            "A",
            "a@x",
            "add secrets and space",
            &["secrets/creds.env".into(), "space/other.md".into()],
        )
        .unwrap();
        std::fs::write(dir.path().join("secrets/creds.env"), SECRET).unwrap();
        root.commit_batch("A", "a@x", "touch secrets", &["secrets/creds.env".into()])
            .unwrap();
        std::fs::rename(
            dir.path().join("secrets/creds.env"),
            dir.path().join("space/notes.md"),
        )
        .unwrap();
        root.commit_batch(
            "A",
            "a@x",
            "move into space",
            &["secrets/creds.env".into(), "space/notes.md".into()],
        )
        .unwrap();

        let pre_move = space_log(&root, None, 50, None)
            .unwrap()
            .commits
            .into_iter()
            .find(|c| c.message == "add secrets and space")
            .expect("the pre-move commit")
            .rev;
        let space = RevisionStore::open(&dir.path().join("space"), RevisionsMode::Unmanaged)
            .expect("nested space store");
        (dir, space, pre_move)
    }

    const SECRET: &[u8] = b"API_KEY=hunter2\nDB_PASS=swordfish\n";

    #[test]
    fn history_of_a_file_moved_in_starts_where_it_entered_the_space() {
        let (_dir, space, _pre_move) = moved_into_space_fixture();

        let history = file_history(&space, "notes.md", None, 50).unwrap();
        assert_eq!(
            history
                .revisions
                .iter()
                .map(|r| r.message.as_str())
                .collect::<Vec<_>>(),
            vec!["move into space"],
            "revisions from before the file entered the space must not be listed"
        );
        assert!(!history.more);
    }

    #[test]
    fn a_revision_from_outside_the_space_is_not_readable_through_it() {
        let (_dir, space, pre_move) = moved_into_space_fixture();

        assert_eq!(file_at(&space, "notes.md", &pre_move, false).unwrap(), None);
        assert_eq!(
            file_diff(&space, "notes.md", &pre_move, false).unwrap(),
            None
        );
    }

    #[test]
    fn the_move_commit_itself_stays_readable_through_the_space() {
        let (_dir, space, _pre_move) = moved_into_space_fixture();
        let history = file_history(&space, "notes.md", None, 50).unwrap();
        let move_rev = &history.revisions[0].rev;

        assert_eq!(
            file_at(&space, "notes.md", move_rev, false)
                .unwrap()
                .as_deref(),
            Some(SECRET)
        );
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
        let old = file_at(&store, "a.md", &h.revisions[1].rev, false)
            .unwrap()
            .unwrap();
        assert_eq!(old, b"v1");
        assert!(file_at(&store, "nope.md", &h.revisions[0].rev, false)
            .unwrap()
            .is_none());
    }

    #[test]
    fn file_diff_shows_unified_diff_for_a_modification() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        let diff = file_diff(&store, "a.md", &h.revisions[0].rev, false)
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
        let diff = file_diff(&store, "a.md", root_rev, false).unwrap().unwrap();
        assert!(diff.contains("new file mode"), "{diff}");
        assert!(diff.contains("+v1"), "{diff}");
    }

    #[test]
    fn file_diff_returns_none_for_an_unknown_path_at_a_revision() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert!(file_diff(&store, "nope.md", &h.revisions[0].rev, false)
            .unwrap()
            .is_none());
    }

    #[test]
    fn file_diff_rejects_invalid_paths_and_revisions() {
        let (_dir, store) = fixture();
        let h = file_history(&store, "a.md", None, 50).unwrap();
        assert!(
            file_diff(&store, "../secret.md", &h.revisions[0].rev, false)
                .unwrap_err()
                .starts_with("invalid path")
        );
        assert!(file_diff(&store, "a.md", "nothex", false).is_err());
    }

    #[test]
    fn uncommitted_files_lists_changed_and_untracked_files() {
        let (dir, store) = fixture();
        assert!(uncommitted_files(&store).unwrap().is_empty());

        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();
        std::fs::write(dir.path().join("new.md"), b"brand new").unwrap();
        std::fs::remove_file(dir.path().join("b.md")).unwrap();

        assert_eq!(
            paths(&uncommitted_files(&store).unwrap()),
            vec!["a.md".to_string(), "b.md".to_string(), "new.md".to_string()],
        );
    }

    #[test]
    fn space_log_carries_what_is_not_committed_yet() {
        let (dir, store) = fixture();
        std::fs::write(dir.path().join("a.md"), b"v3").unwrap();

        let log = space_log(&store, None, 50, None).unwrap();

        assert_eq!(paths(&log.uncommitted), vec!["a.md".to_string()]);
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
        let log = space_log(&store, None, 50, None).unwrap();
        assert_eq!(log.commits.len(), 2);
        assert_eq!(paths(&log.commits[0].files), vec!["a.md".to_string()]);
        assert_eq!(log.commits[0].added, 1);
        assert_eq!(log.commits[0].removed, 1);
        let mut first = paths(&log.commits[1].files);
        first.sort();
        assert_eq!(first, vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(log.commits[1].added, 2);
        assert_eq!(log.commits[1].removed, 0);
    }

    fn paths(files: &[LogFile]) -> Vec<String> {
        files.iter().map(|f| f.path.clone()).collect()
    }

    /// Paths paired with their status, sorted, for readable assertions.
    fn statuses(files: &[LogFile]) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = files
            .iter()
            .map(|f| (f.path.clone(), f.status.clone()))
            .collect();
        out.sort();
        out
    }

    #[test]
    fn space_log_reports_a_status_for_every_touched_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("keep.md"), b"a\nb\n").unwrap();
        std::fs::write(dir.path().join("gone.md"), b"x\n").unwrap();
        // Identical content before and after the move, so rename detection
        // fires at 100% similarity rather than at git's default threshold.
        std::fs::write(dir.path().join("old.md"), b"unchanged\n").unwrap();
        store
            .commit_batch(
                "A",
                "a@x",
                "first",
                &["keep.md".into(), "gone.md".into(), "old.md".into()],
            )
            .unwrap();

        std::fs::write(dir.path().join("keep.md"), b"a\nb\nc\n").unwrap();
        std::fs::remove_file(dir.path().join("gone.md")).unwrap();
        std::fs::rename(dir.path().join("old.md"), dir.path().join("new.md")).unwrap();
        std::fs::write(dir.path().join("fresh.md"), b"n\n").unwrap();
        store
            .commit_batch(
                "A",
                "a@x",
                "second",
                &[
                    "keep.md".into(),
                    "gone.md".into(),
                    "old.md".into(),
                    "new.md".into(),
                    "fresh.md".into(),
                ],
            )
            .unwrap();

        let log = space_log(&store, None, 50, None).unwrap();
        assert_eq!(
            statuses(&log.commits[0].files),
            vec![
                ("fresh.md".to_string(), "added".to_string()),
                ("gone.md".to_string(), "deleted".to_string()),
                ("keep.md".to_string(), "modified".to_string()),
                ("new.md".to_string(), "renamed".to_string()),
            ]
        );
        // The `+n -n` totals come from the numstat half of the same
        // invocation and must survive adding `--raw`.
        assert_eq!(log.commits[0].added, 2);
        assert_eq!(log.commits[0].removed, 1);
    }

    #[test]
    fn uncommitted_files_carry_a_status_too() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("keep.md"), b"a\n").unwrap();
        std::fs::write(dir.path().join("gone.md"), b"x\n").unwrap();
        store
            .commit_batch("A", "a@x", "first", &["keep.md".into(), "gone.md".into()])
            .unwrap();

        std::fs::write(dir.path().join("keep.md"), b"a\nb\n").unwrap();
        std::fs::remove_file(dir.path().join("gone.md")).unwrap();
        std::fs::write(dir.path().join("fresh.md"), b"n\n").unwrap();

        let log = space_log(&store, None, 50, None).unwrap();
        assert_eq!(
            statuses(&log.uncommitted),
            vec![
                ("fresh.md".to_string(), "added".to_string()),
                ("gone.md".to_string(), "deleted".to_string()),
                ("keep.md".to_string(), "modified".to_string()),
            ]
        );
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
        let log = space_log(&store, None, 50, None).unwrap();
        assert_eq!(paths(&log.commits[0].files), vec!["bin.dat".to_string()]);
        assert_eq!(log.commits[0].added, 0);
        assert_eq!(log.commits[0].removed, 0);
    }

    #[test]
    fn file_at_with_parent_reads_the_version_before_a_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("doomed.md"), b"alpha").unwrap();
        store
            .commit_batch("alice", "alice@x", "add", &["doomed.md".into()])
            .unwrap();
        std::fs::remove_file(dir.path().join("doomed.md")).unwrap();
        let deletion = store
            .commit_batch("alice", "alice@x", "remove", &["doomed.md".into()])
            .unwrap()
            .unwrap();

        assert_eq!(
            file_at(&store, "doomed.md", &deletion, false).unwrap(),
            None
        );
        assert_eq!(
            file_at(&store, "doomed.md", &deletion, true).unwrap(),
            Some(b"alpha".to_vec())
        );
    }

    #[test]
    fn file_at_with_parent_on_a_root_commit_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("note.md"), b"one").unwrap();
        let root = store
            .commit_batch("alice", "alice@x", "add", &["note.md".into()])
            .unwrap()
            .unwrap();

        assert_eq!(file_at(&store, "note.md", &root, true).unwrap(), None);
    }

    #[test]
    fn file_at_with_parent_propagates_a_genuine_git_failure_rather_than_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("doomed.md"), b"alpha").unwrap();
        let rev = store
            .commit_batch("alice", "alice@x", "add", &["doomed.md".into()])
            .unwrap()
            .unwrap();

        // `repo_root()` stays cached as this path even once `.git` is gone,
        // so the git call underneath fails for a reason other than "no
        // parent" -- that must surface as an error, not a silent 404.
        std::fs::remove_dir_all(dir.path().join(".git")).unwrap();

        assert!(file_at(&store, "doomed.md", &rev, true).is_err());
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
        let log = space_log(&store, None, 50, None).unwrap();
        assert!(
            paths(&log.commits[0].files).contains(&"café.md".to_string()),
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

        let log = space_log(&store, None, 50, None).unwrap();
        let renamed = &log.commits[0];
        assert_eq!(renamed.message, "rename");
        let mut files = paths(&renamed.files);
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
        let log = space_log(&store, None, 50, None).unwrap();
        assert_eq!(log.commits.len(), 1);
        assert_eq!(log.commits[0].message, "docs a");
        assert_eq!(paths(&log.commits[0].files), vec!["a.md".to_string()]);
    }

    #[test]
    fn space_log_phrase_matches_message_or_author() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("a.md"), b"1").unwrap();
        store
            .commit_batch("alice", "alice@x", "fix the widget", &["a.md".into()])
            .unwrap();
        std::fs::write(dir.path().join("b.md"), b"1").unwrap();
        store
            .commit_batch("Claude Code", "cc@x", "ingest a source", &["b.md".into()])
            .unwrap();
        std::fs::write(dir.path().join("c.md"), b"1").unwrap();
        store
            .commit_batch("bob", "bob@x", "unrelated", &["c.md".into()])
            .unwrap();

        let by_message = space_log(&store, None, 50, Some("widget")).unwrap();
        assert_eq!(by_message.commits.len(), 1);
        assert_eq!(by_message.commits[0].message, "fix the widget");

        let by_author = space_log(&store, None, 50, Some("Claude")).unwrap();
        assert_eq!(by_author.commits.len(), 1);
        assert_eq!(by_author.commits[0].author, "Claude Code");

        assert_eq!(
            space_log(&store, None, 50, Some("nothing"))
                .unwrap()
                .commits
                .len(),
            0
        );
        assert_eq!(space_log(&store, None, 50, None).unwrap().commits.len(), 3);
    }

    /// Reaching git as a bare argv token, the phrase is a flag: `git log`
    /// exits 0, writes the file and prints nothing, so an "expect no matches"
    /// assertion would pass either way. Searching for a commit that really
    /// contains the phrase discriminates -- `--grep=<phrase>` finds it, a
    /// phrase parsed as a flag finds nothing.
    #[test]
    fn a_phrase_starting_with_a_dash_is_not_treated_as_a_git_flag() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        let decoy = dir.path().join("pwned");
        std::fs::write(dir.path().join("a.md"), b"1").unwrap();
        store
            .commit_batch(
                "alice",
                "alice@x",
                &format!("fix --output={} handling", decoy.display()),
                &["a.md".into()],
            )
            .unwrap();
        std::fs::write(dir.path().join("b.md"), b"1").unwrap();
        store
            .commit_batch("alice", "alice@x", "unrelated", &["b.md".into()])
            .unwrap();

        let phrase = format!("--output={}", decoy.display());
        let out = space_log(&store, None, 50, Some(&phrase)).unwrap();
        assert_eq!(out.commits.len(), 1, "the phrase was not searched for");
        assert!(out.commits[0].message.contains("handling"));
        assert!(!decoy.exists(), "the phrase reached git as a flag");
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
        assert!(file_at(&sub, "../secret.md", &rev, false)
            .unwrap_err()
            .starts_with("invalid path"));
    }

    fn three_commit_repo(dir: &tempfile::TempDir) -> (RevisionStore, String) {
        let store = RevisionStore::open(dir.path(), RevisionsMode::Managed).unwrap();
        std::fs::write(dir.path().join("note.md"), b"one\n").unwrap();
        let first = store
            .commit_batch("alice", "alice@x", "add", &["note.md".into()])
            .unwrap()
            .unwrap();
        std::fs::write(dir.path().join("note.md"), b"two\n").unwrap();
        store
            .commit_batch("bob", "bob@x", "edit", &["note.md".into()])
            .unwrap();
        std::fs::write(dir.path().join("note.md"), b"three\n").unwrap();
        store
            .commit_batch("bob", "bob@x", "edit again", &["note.md".into()])
            .unwrap();
        (store, first)
    }

    #[test]
    fn range_file_diff_spans_several_commits() {
        let dir = tempfile::tempdir().unwrap();
        let (store, first) = three_commit_repo(&dir);
        let diff = range_file_diff(&store, "note.md", &first, &RangeEnd::Head)
            .unwrap()
            .unwrap();
        assert!(diff.contains("-one"), "{diff}");
        assert!(diff.contains("+three"), "{diff}");
        assert!(!diff.contains("+two"), "intermediate state leaked: {diff}");
    }

    #[test]
    fn range_end_working_includes_uncommitted_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let (store, first) = three_commit_repo(&dir);
        std::fs::write(dir.path().join("note.md"), b"four\n").unwrap();
        let diff = range_file_diff(&store, "note.md", &first, &RangeEnd::Working)
            .unwrap()
            .unwrap();
        assert!(diff.contains("+four"), "{diff}");
    }

    #[test]
    fn range_summary_lists_touched_files_with_counts_and_authors() {
        let dir = tempfile::tempdir().unwrap();
        let (store, first) = three_commit_repo(&dir);
        let summary = range_summary(&store, &first, &RangeEnd::Head).unwrap();
        assert_eq!(summary.files.len(), 1);
        assert_eq!(summary.files[0].path, "note.md");
        assert_eq!(summary.files[0].status, "M");
        assert_eq!(summary.files[0].added, 1);
        assert_eq!(summary.files[0].removed, 1);
        assert_eq!(summary.authors, vec!["bob".to_string()]);
    }

    #[test]
    fn range_end_rejects_anything_but_a_sha_head_or_working() {
        assert!(RangeEnd::parse("HEAD").is_some());
        assert!(RangeEnd::parse("WORKING").is_some());
        assert!(RangeEnd::parse(&"a".repeat(40)).is_some());
        assert!(RangeEnd::parse("HEAD~3").is_none());
        assert!(RangeEnd::parse("--output=/tmp/x").is_none());
        assert!(RangeEnd::parse("main").is_none());
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
