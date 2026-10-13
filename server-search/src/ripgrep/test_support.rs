use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use super::{discover, Engine, RipgrepBackend};
use crate::{RequestCx, SpaceView};

/// Lists every file under `root` except dot paths and `hidden`, as storage
/// does for control files and `SB_SPACE_IGNORE` matches.
pub struct DirView {
    pub root: PathBuf,
    pub hidden: HashSet<String>,
    /// Left out of `list` but still served by `read_prefix`, so a test can
    /// tell the listing filter apart from the read check.
    pub unlisted: HashSet<String>,
}

impl DirView {
    pub fn new(root: &Path, hidden: &[&str]) -> Self {
        Self {
            root: root.to_path_buf(),
            hidden: hidden.iter().map(|s| s.to_string()).collect(),
            unlisted: HashSet::new(),
        }
    }

    pub fn unlisted(mut self, paths: &[&str]) -> Self {
        self.unlisted = paths.iter().map(|s| s.to_string()).collect();
        self
    }

    fn walk(&self, dir: &Path, prefix: &str, out: &mut HashSet<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(String::from) else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let path = format!("{prefix}{name}");
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                self.walk(&entry.path(), &format!("{path}/"), out);
            } else if entry.path().is_file()
                && !self.hidden.contains(&path)
                && !self.unlisted.contains(&path)
            {
                out.insert(path);
            }
        }
    }
}

impl SpaceView for DirView {
    fn list(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        self.walk(&self.root, "", &mut out);
        out
    }

    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
        if self.hidden.contains(path) || path.split('/').any(|p| p.starts_with('.')) {
            return None;
        }
        let data = std::fs::read(self.root.join(path)).ok()?;
        Some(data[..len.min(data.len())].to_vec())
    }
}

/// A temporary space holding `files`.
pub fn space(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (name, body) in files {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
    dir
}

/// A backend over `dir` whose storage hides dot paths and `hidden`, or `None`
/// (test skipped) when rg is not installed and not required.
pub fn backend(dir: &Path, hidden: &[&str]) -> Option<RipgrepBackend> {
    backend_with(dir, DirView::new(dir, hidden))
}

/// A backend over `dir` that sees the space through `view`; see `backend`.
pub fn backend_with(dir: &Path, view: impl SpaceView + 'static) -> Option<RipgrepBackend> {
    let Some(bin) = discover::binary() else {
        assert!(
            !discover::ripgrep_required(),
            "SB_REQUIRE_RIPGREP=1 but rg is not installed"
        );
        eprintln!("skipping: ripgrep not installed");
        return None;
    };
    Some(RipgrepBackend::new(
        dir.to_path_buf(),
        Engine::Ready(bin.to_path_buf()),
        Arc::new(view),
    ))
}

pub fn cx() -> RequestCx {
    RequestCx::unlimited(Duration::from_secs(3))
}

/// An in-memory view that lists and serves exactly `files`.
pub struct MemView(pub std::collections::HashMap<String, Vec<u8>>);

impl MemView {
    pub fn new(files: &[(&str, &str)]) -> Self {
        Self(
            files
                .iter()
                .map(|(p, body)| (p.to_string(), body.as_bytes().to_vec()))
                .collect(),
        )
    }
}

impl SpaceView for MemView {
    fn list(&self) -> HashSet<String> {
        self.0.keys().cloned().collect()
    }

    fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
        let data = self.0.get(path)?;
        Some(data[..len.min(data.len())].to_vec())
    }
}
