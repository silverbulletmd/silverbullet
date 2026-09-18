use super::{
    git,
    sync::{classify, MergeCompletion, SyncError},
};
use serde::{Deserialize, Serialize};
use silverbullet_server_common::revision::sha256_hex;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Stage {
    mode: String,
    oid: String,
    stage: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    path: Vec<u8>,
    stages: Vec<Stage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    Text,
    Binary,
    DeleteModify,
    Unsupported,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub id: String,
    pub path: String,
    pub kind: ConflictKind,
    pub local: bool,
    pub remote: bool,
    pub content_revision: String,
    pub can_resolve: bool,
}

#[derive(Debug, Serialize)]
pub struct ConflictList {
    pub generation: String,
    pub conflicts: Vec<Conflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub generation: String,
    pub action: Resolution,
    pub content_revision: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Resolution {
    Local,
    Remote,
    Edited,
    Delete,
}

#[derive(Debug)]
pub enum ResolveError {
    Stale,
    PreconditionRequired,
    Unsupported,
    Git(SyncError),
}
impl From<SyncError> for ResolveError {
    fn from(value: SyncError) -> Self {
        Self::Git(value)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Accepted {
    entry: Entry,
    revision: String,
    #[serde(default)]
    author: Option<Resolver>,
}

#[derive(Default, Serialize, Deserialize)]
struct Provenance {
    identity: String,
    generation: String,
    #[serde(default)]
    version: u64,
    text: BTreeMap<String, usize>,
    #[serde(default)]
    accepted: BTreeMap<String, Accepted>,
}

fn entries(repo: &Path) -> Result<Vec<Entry>, SyncError> {
    let raw = git::run_bytes(repo, &["ls-files", "-u", "-z"], &[]).map_err(|e| classify(&e))?;
    let mut entries: BTreeMap<Vec<u8>, Vec<Stage>> = BTreeMap::new();
    for record in raw.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let at = record
            .iter()
            .position(|b| *b == b'\t')
            .ok_or_else(|| SyncError::Other("invalid unmerged index".into()))?;
        let fields = std::str::from_utf8(&record[..at])
            .map_err(|_| SyncError::Other("invalid unmerged index".into()))?;
        let fields: Vec<_> = fields.split(' ').collect();
        if fields.len() != 3 {
            return Err(SyncError::Other("invalid unmerged index".into()));
        }
        let stage = fields[2]
            .parse::<u8>()
            .map_err(|_| SyncError::Other("invalid index stage".into()))?;
        entries
            .entry(record[at + 1..].to_vec())
            .or_default()
            .push(Stage {
                mode: fields[0].into(),
                oid: fields[1].into(),
                stage,
            });
    }
    Ok(entries
        .into_iter()
        .map(|(path, stages)| Entry { path, stages })
        .collect())
}

fn entry_id(entry: &Entry) -> String {
    let mut data = entry.path.clone();
    data.extend(serde_json::to_vec(&entry.stages).unwrap());
    sha256_hex(&data)
}

fn display_path(path: &[u8]) -> String {
    match std::str::from_utf8(path) {
        Ok(path) => path.to_string(),
        Err(_) => path.iter().map(|b| format!("\\x{b:02x}")).collect(),
    }
}

pub fn unmerged_paths(repo: &Path) -> Result<Vec<String>, SyncError> {
    Ok(entries(repo)?
        .iter()
        .map(|e| display_path(&e.path))
        .collect())
}

fn identity(repo: &Path) -> Result<String, SyncError> {
    if !super::store::merge_in_progress(repo) {
        return Ok(String::new());
    }
    let head = git::run(repo, &["rev-parse", "HEAD"], &[]).map_err(|e| classify(&e))?;
    let incoming = git::run(repo, &["rev-parse", "MERGE_HEAD"], &[]).map_err(|e| classify(&e))?;
    Ok(sha256_hex(format!("{head}{incoming}").as_bytes()))
}

fn provenance_path(repo: &Path) -> Result<PathBuf, SyncError> {
    let path = git::run(
        repo,
        &["rev-parse", "--git-path", "silverbullet-conflicts.json"],
        &[],
    )
    .map_err(|e| classify(&e))?;
    Ok(repo.join(path.trim()))
}

fn load_provenance(repo: &Path, identity: &str) -> Provenance {
    provenance_path(repo)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Provenance>(&b).ok())
        .filter(|p| p.identity == identity)
        .unwrap_or_else(|| Provenance {
            identity: identity.into(),
            generation: identity.into(),
            ..Default::default()
        })
}

fn safe_path(repo: &Path, bytes: &[u8]) -> Option<PathBuf> {
    let name = std::str::from_utf8(bytes).ok()?;
    let path = Path::new(name);
    if name.is_empty() || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let mut full = repo.to_path_buf();
    for component in path.components() {
        full.push(component);
        match std::fs::symlink_metadata(&full) {
            Ok(meta) if meta.file_type().is_symlink() => return None,
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return None,
        }
    }
    Some(full)
}

fn revision(path: Option<&Path>) -> String {
    match path.map(std::fs::read) {
        Some(Ok(bytes)) => sha256_hex(&bytes),
        Some(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => "missing".into(),
        _ => "unavailable".into(),
    }
}

fn blob(repo: &Path, stage: &Stage) -> Result<Vec<u8>, SyncError> {
    git::run_bytes(repo, &["cat-file", "blob", &stage.oid], &[]).map_err(|e| classify(&e))
}

fn text_attributes(repo: &Path, path: &str) -> Option<usize> {
    let out = git::run_bytes(
        repo,
        &[
            "check-attr",
            "-z",
            "merge",
            "diff",
            "text",
            "filter",
            "working-tree-encoding",
            "conflict-marker-size",
            "--",
            path,
        ],
        &[],
    )
    .ok()?;
    let parts: Vec<_> = out.split(|b| *b == 0).collect();
    let mut size = 7;
    for triple in parts.chunks_exact(3) {
        let name = std::str::from_utf8(triple[1]).ok()?;
        let value = std::str::from_utf8(triple[2]).ok()?;
        match name {
            "merge" if value == "unspecified" => {
                let default =
                    git::run(repo, &["config", "--get", "merge.default"], &[]).unwrap_or_default();
                if !matches!(default.trim(), "" | "text") {
                    return None;
                }
            }
            "merge" if !matches!(value, "set" | "text") => return None,
            "diff" | "text" if value == "unset" => return None,
            "filter" | "working-tree-encoding" if value != "unspecified" => return None,
            "conflict-marker-size" if value != "unspecified" => size = value.parse().ok()?,
            _ => (),
        }
    }
    (3..=256).contains(&size).then_some(size)
}

fn marker(line: &str, size: usize, byte: u8) -> bool {
    line.as_bytes().iter().take_while(|b| **b == byte).count() >= size
}

fn complete_markers(body: &str, size: usize) -> bool {
    let mut stage = 0;
    for line in body.lines() {
        if marker(line, size, b'<') {
            stage = 1;
        } else if stage == 1 && marker(line, size, b'=') {
            stage = 2;
        } else if stage == 2 && marker(line, size, b'>') {
            return true;
        }
    }
    false
}

fn marker_remains(body: &str) -> bool {
    body.lines().any(|line| {
        [b'<', b'=', b'>', b'|']
            .iter()
            .any(|b| marker(line.trim_start(), 3, *b))
    })
}

fn classify_entry(
    repo: &Path,
    entry: &Entry,
    provenance: &Provenance,
) -> Result<ConflictKind, SyncError> {
    let Some(path) = safe_path(repo, &entry.path) else {
        return Ok(ConflictKind::Unsupported);
    };
    if entry
        .stages
        .iter()
        .any(|s| !matches!(s.mode.as_str(), "100644" | "100755"))
    {
        return Ok(ConflictKind::Unsupported);
    }
    let stages: Vec<_> = entry.stages.iter().map(|s| s.stage).collect();
    match stages.as_slice() {
        [1, 2] | [1, 3] => return Ok(ConflictKind::DeleteModify),
        [2, 3] | [1, 2, 3] => (),
        _ => return Ok(ConflictKind::Unsupported),
    }
    for stage in &entry.stages {
        let bytes = blob(repo, stage)?;
        if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
            return Ok(ConflictKind::Binary);
        }
    }
    if path.extension().and_then(|p| p.to_str()) != Some("md") {
        return Ok(ConflictKind::Unsupported);
    }
    let name = std::str::from_utf8(&entry.path).unwrap();
    let Some(size) = text_attributes(repo, name) else {
        return Ok(ConflictKind::Unsupported);
    };
    if provenance.text.get(&entry_id(entry)) == Some(&size) {
        return Ok(ConflictKind::Text);
    }
    Ok(ConflictKind::Unsupported)
}

fn reconstruct_text(repo: &Path, entry: &Entry, size: usize) -> Result<bool, SyncError> {
    let Some(path) = safe_path(repo, &entry.path) else {
        return Ok(false);
    };
    if path.extension().and_then(|s| s.to_str()) != Some("md")
        || entry
            .stages
            .iter()
            .any(|s| !matches!(s.mode.as_str(), "100644" | "100755"))
    {
        return Ok(false);
    }
    if ![2, 3]
        .iter()
        .all(|n| entry.stages.iter().any(|s| s.stage == *n))
    {
        return Ok(false);
    }
    let temp = tempfile::tempdir().map_err(|e| SyncError::Other(e.to_string()))?;
    for number in [1, 2, 3] {
        let bytes = match entry.stages.iter().find(|s| s.stage == number) {
            Some(stage) => blob(repo, stage)?,
            None => Vec::new(),
        };
        if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
            return Ok(false);
        }
        std::fs::write(temp.path().join(number.to_string()), bytes)
            .map_err(|e| SyncError::Other(e.to_string()))?;
    }
    let output = git::git_command()
        .arg("-C")
        .arg(repo)
        .args(["merge-file", "-p", "--marker-size", &size.to_string()])
        .arg(temp.path().join("2"))
        .arg(temp.path().join("1"))
        .arg(temp.path().join("3"))
        .output()
        .map_err(|e| SyncError::Other(e.to_string()))?;
    Ok(output
        .status
        .code()
        .is_some_and(|code| (1..128).contains(&code))
        && std::str::from_utf8(&output.stdout)
            .ok()
            .is_some_and(|body| complete_markers(body, size)))
}

fn reopen(repo: &Path, entry: &Entry) -> Result<(), SyncError> {
    let mut input = format!("0 {}\t", "0".repeat(40)).into_bytes();
    input.extend_from_slice(&entry.path);
    input.push(0);
    for stage in &entry.stages {
        input.extend_from_slice(
            format!("{} {} {}\t", stage.mode, stage.oid, stage.stage).as_bytes(),
        );
        input.extend_from_slice(&entry.path);
        input.push(0);
    }
    let mut child = git::git_command()
        .arg("-C")
        .arg(repo)
        .args(["update-index", "-z", "--index-info"])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| SyncError::Other(e.to_string()))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&input)
        .map_err(|e| SyncError::Other(e.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|e| SyncError::Other(e.to_string()))?;
    if !output.status.success() {
        return Err(classify(&String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

fn revalidate_accepted(repo: &Path, provenance: &mut Provenance) -> Result<(), SyncError> {
    let mut changed = false;
    for (id, accepted) in provenance.accepted.clone() {
        let disk = revision(safe_path(repo, &accepted.entry.path).as_deref());
        let name = std::str::from_utf8(&accepted.entry.path)
            .map_err(|_| SyncError::Other("unsupported accepted path".into()))?;
        let staged = git::run_bytes(repo, &["show", &format!(":{name}")], &[])
            .ok()
            .map(|bytes| sha256_hex(&bytes))
            .unwrap_or_else(|| "missing".into());
        if disk != accepted.revision || staged != accepted.revision {
            reopen(repo, &accepted.entry)?;
            provenance.accepted.remove(&id);
            changed = true;
        }
    }
    if changed {
        provenance.version += 1;
        save_provenance(repo, provenance)?;
    }
    Ok(())
}

fn record_acceptance(
    repo: &Path,
    entry: &Entry,
    bytes: Option<&[u8]>,
    author: Option<Resolver>,
) -> Result<(), SyncError> {
    let mut provenance = load_provenance(repo, &identity(repo)?);
    provenance.accepted.insert(
        entry_id(entry),
        Accepted {
            entry: entry.clone(),
            revision: bytes.map(sha256_hex).unwrap_or_else(|| "missing".into()),
            author,
        },
    );
    provenance.version += 1;
    save_provenance(repo, &provenance)
}

pub fn begin_merge(repo: &Path) -> Result<(), SyncError> {
    let head = git::run(repo, &["rev-parse", "HEAD"], &[]).map_err(|e| classify(&e))?;
    let incoming = git::run(repo, &["rev-parse", "FETCH_HEAD"], &[]).map_err(|e| classify(&e))?;
    let provenance = Provenance {
        identity: sha256_hex(format!("{head}{incoming}").as_bytes()),
        generation: uuid::Uuid::new_v4().to_string(),
        ..Default::default()
    };
    save_provenance(repo, &provenance)
}

fn save_provenance(repo: &Path, provenance: &Provenance) -> Result<(), SyncError> {
    let dest = provenance_path(repo)?;
    let mut file = tempfile::NamedTempFile::new_in(dest.parent().unwrap())
        .map_err(|e| SyncError::Other(e.to_string()))?;
    file.write_all(&serde_json::to_vec(provenance).unwrap())
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| SyncError::Other(e.to_string()))?;
    file.persist(&dest)
        .map_err(|e| SyncError::Other(e.to_string()))?;
    #[cfg(unix)]
    std::fs::File::open(dest.parent().unwrap())
        .and_then(|directory| directory.sync_all())
        .map_err(|e| SyncError::Other(e.to_string()))?;
    Ok(())
}

pub fn capture(repo: &Path) -> Result<(), SyncError> {
    let identity = identity(repo)?;
    if identity.is_empty() {
        return Ok(());
    }
    let mut provenance = load_provenance(repo, &identity);
    for entry in entries(repo)? {
        if safe_path(repo, &entry.path).is_none() {
            continue;
        }
        let Some(name) = std::str::from_utf8(&entry.path).ok() else {
            continue;
        };
        let Some(size) = text_attributes(repo, name) else {
            continue;
        };
        if !provenance.text.contains_key(&entry_id(&entry)) && reconstruct_text(repo, &entry, size)?
        {
            provenance.text.insert(entry_id(&entry), size);
        }
    }
    save_provenance(repo, &provenance)
}

fn listing(repo: &Path) -> Result<(ConflictList, Vec<Entry>), SyncError> {
    let identity = identity(repo)?;
    if !identity.is_empty() {
        capture(repo)?;
    }
    let provenance = load_provenance(repo, &identity);
    let entries = entries(repo)?;
    let mut data = identity.into_bytes();
    data.extend_from_slice(provenance.generation.as_bytes());
    data.extend_from_slice(&provenance.version.to_le_bytes());
    let mut conflicts = Vec::new();
    for entry in &entries {
        let id = entry_id(entry);
        data.extend_from_slice(id.as_bytes());
        conflicts.push(Conflict {
            id,
            path: display_path(&entry.path),
            kind: classify_entry(repo, entry, &provenance)?,
            local: entry.stages.iter().any(|s| s.stage == 2),
            remote: entry.stages.iter().any(|s| s.stage == 3),
            content_revision: revision(safe_path(repo, &entry.path).as_deref()),
            can_resolve: safe_path(repo, &entry.path).is_some()
                && entry
                    .stages
                    .iter()
                    .all(|stage| matches!(stage.mode.as_str(), "100644" | "100755")),
        });
    }
    Ok((
        ConflictList {
            generation: sha256_hex(&data),
            conflicts,
        },
        entries,
    ))
}

pub fn list(repo: &Path) -> Result<ConflictList, SyncError> {
    listing(repo).map(|(list, _)| list)
}

fn stage_bytes(repo: &Path, entry: &Entry, bytes: &[u8], mode: &str) -> Result<(), SyncError> {
    let path = std::str::from_utf8(&entry.path)
        .map_err(|_| SyncError::Other("unsupported path".into()))?;
    let mut child = git::git_command()
        .arg("-C")
        .arg(repo)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| SyncError::Other(e.to_string()))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(bytes)
        .map_err(|e| SyncError::Other(e.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|e| SyncError::Other(e.to_string()))?;
    if !output.status.success() {
        return Err(classify(&String::from_utf8_lossy(&output.stderr)));
    }
    let oid = String::from_utf8_lossy(&output.stdout);
    git::run(
        repo,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            mode,
            oid.trim(),
            path,
        ],
        &[],
    )
    .map_err(|e| classify(&e))?;
    Ok(())
}

pub fn download(
    repo: &Path,
    id: &str,
    generation: &str,
    side: &str,
) -> Result<Vec<u8>, ResolveError> {
    let (snapshot, records) = listing(repo)?;
    if snapshot.generation != generation {
        return Err(ResolveError::Stale);
    }
    let number = match side {
        "local" => 2,
        "remote" => 3,
        _ => return Err(ResolveError::Unsupported),
    };
    let index = snapshot
        .conflicts
        .iter()
        .position(|c| c.id == id)
        .ok_or(ResolveError::Stale)?;
    let stage = records[index]
        .stages
        .iter()
        .find(|s| s.stage == number)
        .ok_or(ResolveError::Unsupported)?;
    Ok(blob(repo, stage)?)
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Resolver {
    pub name: String,
    pub email: String,
}

pub fn resolve(
    repo: &Path,
    id: &str,
    request: &ResolveRequest,
) -> Result<ConflictList, ResolveError> {
    resolve_as(repo, id, request, None)
}

pub fn resolve_as(
    repo: &Path,
    id: &str,
    request: &ResolveRequest,
    author: Option<Resolver>,
) -> Result<ConflictList, ResolveError> {
    let expected = request
        .content_revision
        .as_ref()
        .ok_or(ResolveError::PreconditionRequired)?;
    let (snapshot, records) = listing(repo)?;
    if snapshot.generation != request.generation {
        return Err(ResolveError::Stale);
    }
    let index = snapshot
        .conflicts
        .iter()
        .position(|c| c.id == id)
        .ok_or(ResolveError::Stale)?;
    let conflict = &snapshot.conflicts[index];
    if &conflict.content_revision != expected {
        return Err(ResolveError::Stale);
    }
    let entry = &records[index];
    let path = safe_path(repo, &entry.path).ok_or(ResolveError::Unsupported)?;
    if !conflict.can_resolve {
        return Err(ResolveError::Unsupported);
    }
    let bytes = match request.action {
        Resolution::Local | Resolution::Remote => {
            let side = if matches!(request.action, Resolution::Local) {
                2
            } else {
                3
            };
            entry
                .stages
                .iter()
                .find(|s| s.stage == side)
                .map(|s| blob(repo, s).map(|b| (b, s.mode.clone())))
                .transpose()?
        }
        Resolution::Edited => {
            let bytes = std::fs::read(&path).map_err(|_| ResolveError::Unsupported)?;
            Some((
                bytes,
                entry
                    .stages
                    .iter()
                    .find(|s| s.stage == 2)
                    .unwrap_or(&entry.stages[0])
                    .mode
                    .clone(),
            ))
        }
        Resolution::Delete => None,
    };
    if revision(Some(&path)) != *expected || listing(repo)?.0.generation != request.generation {
        return Err(ResolveError::Stale);
    }
    if let Some((bytes, mode)) = bytes {
        if !matches!(request.action, Resolution::Edited) {
            let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())
                .map_err(|_| ResolveError::Unsupported)?;
            file.write_all(&bytes)
                .map_err(|_| ResolveError::Unsupported)?;
            file.persist(&path).map_err(|_| ResolveError::Unsupported)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(
                    &path,
                    std::fs::Permissions::from_mode(if mode == "100755" { 0o755 } else { 0o644 }),
                )
                .map_err(|_| ResolveError::Unsupported)?;
            }
        }
        record_acceptance(repo, entry, Some(&bytes), author.clone())?;
        stage_bytes(repo, entry, &bytes, &mode)?;
    } else {
        record_acceptance(repo, entry, None, author.clone())?;
        match std::fs::remove_file(&path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(ResolveError::Unsupported),
        }
        git::run(
            repo,
            &[
                "update-index",
                "--force-remove",
                "--",
                std::str::from_utf8(&entry.path).unwrap(),
            ],
            &[],
        )
        .map_err(|e| ResolveError::Git(classify(&e)))?;
    }
    Ok(list(repo)?)
}

pub fn try_complete_merge(repo: &Path) -> Result<MergeCompletion, SyncError> {
    if !super::store::merge_in_progress(repo) {
        return Ok(MergeCompletion::Pending);
    }
    let mut accepted = load_provenance(repo, &identity(repo)?);
    revalidate_accepted(repo, &mut accepted)?;
    let (snapshot, records) = listing(repo)?;
    let provenance = load_provenance(repo, &identity(repo)?);
    let mut unresolved = None;
    for (conflict, entry) in snapshot.conflicts.iter().zip(&records) {
        if conflict.kind != ConflictKind::Text {
            if conflict.kind != ConflictKind::DeleteModify {
                unresolved.get_or_insert(conflict.path.clone());
            }
            continue;
        }
        let Some(path) = safe_path(repo, &entry.path) else {
            continue;
        };
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(body) = std::str::from_utf8(&bytes) else {
            continue;
        };
        if bytes.contains(&0) || marker_remains(body) {
            continue;
        }
        if revision(Some(&path)) != conflict.content_revision {
            continue;
        }
        record_acceptance(repo, entry, Some(&bytes), None)?;
        stage_bytes(
            repo,
            entry,
            &bytes,
            &entry.stages.iter().find(|s| s.stage == 2).unwrap().mode,
        )?;
    }
    if let Some(path) = unresolved {
        return Ok(MergeCompletion::Unresolvable { path });
    }
    let mut accepted = load_provenance(repo, &identity(repo)?);
    revalidate_accepted(repo, &mut accepted)?;
    if !entries(repo)?.is_empty() || identity(repo)? != provenance.identity {
        return Ok(MergeCompletion::Pending);
    }
    let authors: Vec<_> = accepted
        .accepted
        .values()
        .filter_map(|record| record.author.as_ref())
        .collect();
    let mut args = vec![
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "--no-verify",
        "--no-edit",
    ];
    let trailers: std::collections::BTreeSet<_> = authors
        .iter()
        .map(|author| format!("Resolved-by: {} <{}>", author.name, author.email))
        .collect();
    for trailer in &trailers {
        args.push("--trailer");
        args.push(trailer);
    }
    let author = authors
        .first()
        .map(|author| (author.name.as_str(), author.email.as_str()));
    git::run(repo, &args, &super::store::commit_env(author)).map_err(|e| classify(&e))?;
    if let Ok(path) = provenance_path(repo) {
        let _ = std::fs::remove_file(path);
    }
    Ok(MergeCompletion::Completed)
}

#[cfg(test)]
mod tests {
    use super::super::sync::tests::conflict_fixture;
    use super::*;

    fn request(list: &ConflictList, action: Resolution) -> ResolveRequest {
        ResolveRequest {
            generation: list.generation.clone(),
            action,
            content_revision: Some(list.conflicts[0].content_revision.clone()),
        }
    }

    #[test]
    fn a_custom_default_merge_driver_cannot_acquire_text_provenance() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        git::run(work.path(), &["merge", "--abort"], &[]).unwrap();
        git::run(work.path(), &["config", "merge.default", "custom"], &[]).unwrap();
        git::run(
            work.path(),
            &[
                "config",
                "merge.custom.driver",
                "printf 'custom output\\n' > %A; exit 1",
            ],
            &[],
        )
        .unwrap();
        super::super::sync::tick(work.path(), &[], false).unwrap();
        assert_eq!(
            std::fs::read(work.path().join("Sample.md")).unwrap(),
            b"custom output\n"
        );
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::Unsupported);
        assert_eq!(
            serde_json::to_value(&before.conflicts[0]).unwrap()["canResolve"],
            true
        );
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Unresolvable {
                path: "Sample.md".into()
            }
        );
        assert!(super::super::store::merge_in_progress(work.path()));
        resolve(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Edited),
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[test]
    fn a_regular_non_markdown_conflict_offers_explicit_resolution() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.txt", Some(b"base\n"), b"local\n", b"remote\n");
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::Unsupported);
        assert_eq!(
            serde_json::to_value(&before.conflicts[0]).unwrap()["canResolve"],
            true
        );
        resolve(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Remote),
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
        assert_eq!(
            std::fs::read(work.path().join("Sample.txt")).unwrap(),
            b"remote\n"
        );
    }

    #[test]
    fn shortened_delimiters_keep_text_conflicts_pending() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        for body in [
            "<<<<<< HEAD\nresolved\n",
            "resolved\n======\n",
            "resolved\n>>>>>> FETCH_HEAD\n",
            "|||||| base\nresolved\n",
        ] {
            std::fs::write(work.path().join("Sample.md"), body).unwrap();
            assert_eq!(
                try_complete_merge(work.path()).unwrap(),
                MergeCompletion::Pending,
                "{body:?}"
            );
        }
    }

    #[test]
    fn indented_delimiters_keep_text_conflicts_pending() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        for body in [
            "  <<<<<<< HEAD\nresolved\n",
            "resolved\n\t=======\n",
            "resolved\n  >>>>>>> FETCH_HEAD\n",
            "  ||||||| base\nresolved\n",
        ] {
            std::fs::write(work.path().join("Sample.md"), body).unwrap();
            assert_eq!(
                try_complete_merge(work.path()).unwrap(),
                MergeCompletion::Pending,
                "{body:?}"
            );
        }
    }

    #[test]
    fn accepted_text_is_reopened_when_markers_return_before_other_files_resolve() {
        let (remote, seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        git::run(work.path(), &["merge", "--abort"], &[]).unwrap();
        for (repo, text) in [(seed.path(), "incoming\n"), (work.path(), "ours\n")] {
            std::fs::write(repo.join("Other.md"), text).unwrap();
            git::run(repo, &["add", "Other.md"], &[]).unwrap();
            git::run(repo, &["commit", "-qm", "other page"], &[]).unwrap();
        }
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        super::super::sync::tick(work.path(), &[], false).unwrap();
        std::fs::write(work.path().join("Sample.md"), b"combined\n").unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
        std::fs::write(work.path().join("Sample.md"), b"<<<<<<< HEAD\nnew edit\n").unwrap();
        std::fs::write(work.path().join("Other.md"), b"combined too\n").unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
        assert!(unmerged_paths(work.path())
            .unwrap()
            .contains(&"Sample.md".into()));
        drop(remote);
    }

    #[test]
    fn missing_provenance_is_reconstructed_after_the_file_was_edited() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        std::fs::remove_file(provenance_path(work.path()).unwrap()).unwrap();
        std::fs::write(work.path().join("Sample.md"), b"combined\n").unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[test]
    fn explicit_edited_choice_can_keep_legitimate_marker_like_content() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        std::fs::write(
            work.path().join("Sample.md"),
            b"=======\nThis separator is intentional.\n",
        )
        .unwrap();
        let before = list(work.path()).unwrap();
        resolve(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Edited),
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
        assert!(git::run(work.path(), &["show", "HEAD:Sample.md"], &[])
            .unwrap()
            .starts_with("======="));
    }

    #[test]
    fn delete_modify_requires_an_explicit_side_or_delete() {
        let remote = super::super::sync::tests::bare_remote();
        let seed = super::super::sync::tests::seeded_clone(remote.path());
        let work = super::super::sync::tests::plain_clone(remote.path());
        git::run(seed.path(), &["rm", "note.md"], &[]).unwrap();
        git::run(seed.path(), &["commit", "-qm", "delete page"], &[]).unwrap();
        git::run(seed.path(), &["push", "-q"], &[]).unwrap();
        std::fs::write(work.path().join("note.md"), "local edit\n").unwrap();
        git::run(work.path(), &["add", "note.md"], &[]).unwrap();
        git::run(work.path(), &["commit", "-qm", "edit page"], &[]).unwrap();
        super::super::sync::tick(work.path(), &[], false).unwrap();
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::DeleteModify);
        assert!(!before.conflicts[0].remote);
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
        resolve(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Delete),
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
        assert!(!work.path().join("note.md").exists());
    }

    #[test]
    fn diff3_markers_with_custom_size_resume_after_all_markers_disappear() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        git::run(work.path(), &["merge", "--abort"], &[]).unwrap();
        git::run(
            work.path(),
            &["config", "merge.conflictStyle", "diff3"],
            &[],
        )
        .unwrap();
        std::fs::write(
            work.path().join(".git/info/attributes"),
            "Sample.md conflict-marker-size=12\n",
        )
        .unwrap();
        super::super::sync::tick(work.path(), &[], false).unwrap();
        assert!(std::fs::read_to_string(work.path().join("Sample.md"))
            .unwrap()
            .contains("||||||||||||"));
        std::fs::write(
            work.path().join("Sample.md"),
            "|||||||||||| base\nresolved\n",
        )
        .unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
        std::fs::write(work.path().join("Sample.md"), "resolved\n").unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[cfg(unix)]
    #[test]
    fn undecodable_paths_are_opaque_but_their_sides_can_be_downloaded() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        let mut entry = entries(work.path()).unwrap().remove(0);
        entry.path = b"Sample-\xff.md".to_vec();
        git::run(
            work.path(),
            &["update-index", "--force-remove", "Sample.md"],
            &[],
        )
        .unwrap();
        reopen(work.path(), &entry).unwrap();
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::Unsupported);
        assert!(before.conflicts[0].path.contains("\\xff"));
        assert_eq!(
            serde_json::to_value(&before.conflicts[0]).unwrap()["canResolve"],
            false
        );
        assert_eq!(
            download(
                work.path(),
                &before.conflicts[0].id,
                &before.generation,
                "remote"
            )
            .unwrap(),
            b"remote\n"
        );
        assert!(matches!(
            resolve(
                work.path(),
                &before.conflicts[0].id,
                &request(&before, Resolution::Remote)
            ),
            Err(ResolveError::Unsupported)
        ));
    }

    #[test]
    fn explicit_resolution_uses_verified_attribution_for_the_merge() {
        let (_remote, _seed, work) =
            conflict_fixture("Picture.bin", Some(b"base\0"), b"local\0", b"remote\0");
        let before = list(work.path()).unwrap();
        resolve_as(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Remote),
            Some(Resolver {
                name: "Morgan Example".into(),
                email: "morgan@example.test".into(),
            }),
        )
        .unwrap();
        git::run(work.path(), &["config", "user.name", ""], &[]).unwrap();
        git::run(work.path(), &["config", "user.email", ""], &[]).unwrap();
        try_complete_merge(work.path()).unwrap();
        assert_eq!(
            git::run(
                work.path(),
                &["show", "-s", "--format=%an <%ae>", "HEAD"],
                &[]
            )
            .unwrap()
            .trim(),
            "Morgan Example <morgan@example.test>"
        );
    }

    #[test]
    fn a_stale_saved_revision_leaves_disk_and_index_untouched() {
        let (_remote, _seed, work) =
            conflict_fixture("Picture.bin", Some(b"base\0"), b"local\0", b"remote\0");
        let before = list(work.path()).unwrap();
        let request = request(&before, Resolution::Remote);
        std::fs::write(work.path().join("Picture.bin"), b"new saved\0").unwrap();
        let index = git::run_bytes(work.path(), &["ls-files", "-u", "-z"], &[]).unwrap();
        assert!(matches!(
            resolve(work.path(), &before.conflicts[0].id, &request),
            Err(ResolveError::Stale)
        ));
        assert_eq!(
            std::fs::read(work.path().join("Picture.bin")).unwrap(),
            b"new saved\0"
        );
        assert_eq!(
            git::run_bytes(work.path(), &["ls-files", "-u", "-z"], &[]).unwrap(),
            index
        );
    }

    #[test]
    fn explicit_binary_remote_choice_stages_exact_remote_bytes() {
        let (_remote, _seed, work) =
            conflict_fixture("Picture.bin", Some(b"base\0"), b"local\0", b"remote\0");
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::Binary);
        let after = resolve(
            work.path(),
            &before.conflicts[0].id,
            &request(&before, Resolution::Remote),
        )
        .unwrap();
        assert!(after.conflicts.is_empty());
        assert_eq!(
            std::fs::read(work.path().join("Picture.bin")).unwrap(),
            b"remote\0"
        );
        assert_eq!(
            git::run_bytes(work.path(), &["show", ":Picture.bin"], &[]).unwrap(),
            b"remote\0"
        );
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[test]
    fn an_old_generation_cannot_resolve_a_new_merge_of_the_same_heads() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        let before = list(work.path()).unwrap();
        git::run(work.path(), &["merge", "--abort"], &[]).unwrap();
        super::super::sync::tick(work.path(), &[], false).unwrap();
        assert!(matches!(
            resolve(
                work.path(),
                &before.conflicts[0].id,
                &request(&before, Resolution::Local)
            ),
            Err(ResolveError::Stale)
        ));
    }

    #[test]
    fn resolution_requires_a_content_precondition_even_for_delete() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        let before = list(work.path()).unwrap();
        let mut request = request(&before, Resolution::Delete);
        request.content_revision = None;
        assert!(matches!(
            resolve(work.path(), &before.conflicts[0].id, &request),
            Err(ResolveError::PreconditionRequired)
        ));
    }

    #[test]
    fn text_provenance_survives_restart_after_markers_disappear() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        std::fs::write(work.path().join("Sample.md"), b"combined\n").unwrap();
        capture(work.path()).unwrap();
        assert_eq!(
            list(work.path()).unwrap().conflicts[0].kind,
            ConflictKind::Text
        );
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[test]
    fn a_three_stage_partial_marker_cannot_be_committed() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        std::fs::write(work.path().join("Sample.md"), b"local\n=======\nremote\n").unwrap();
        assert_eq!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Pending
        );
    }

    #[test]
    fn a_binary_attribute_never_acquires_text_auto_resolution() {
        let (_remote, _seed, work) =
            conflict_fixture("Sample.md", Some(b"base\n"), b"local\n", b"remote\n");
        std::fs::write(work.path().join(".gitattributes"), b"Sample.md -merge\n").unwrap();
        std::fs::write(work.path().join("Sample.md"), b"local\n").unwrap();
        assert_ne!(
            list(work.path()).unwrap().conflicts[0].kind,
            ConflictKind::Text
        );
        assert_ne!(
            try_complete_merge(work.path()).unwrap(),
            MergeCompletion::Completed
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_replacement_is_never_read_or_resolved() {
        let (_remote, _seed, work) = conflict_fixture("Sample.md", None, b"local\n", b"remote\n");
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(outside.path(), b"outside\n").unwrap();
        std::fs::remove_file(work.path().join("Sample.md")).unwrap();
        std::os::unix::fs::symlink(outside.path(), work.path().join("Sample.md")).unwrap();
        let before = list(work.path()).unwrap();
        assert_eq!(before.conflicts[0].kind, ConflictKind::Unsupported);
        assert!(matches!(
            resolve(
                work.path(),
                &before.conflicts[0].id,
                &request(&before, Resolution::Remote)
            ),
            Err(ResolveError::Unsupported)
        ));
        assert_eq!(std::fs::read(outside.path()).unwrap(), b"outside\n");
    }
}
