//! Fetch a public Git repository's files as a starting point for a new space.
//! GitHub and GitLab are downloaded as a zip snapshot of `HEAD`; any other host
//! falls back to `git clone --depth 1` when `git` is installed.

use std::path::Path;
use std::process::{Command, Stdio};

use crate::starter_kits::StarterError;
use crate::upgrade::safe_extract_path;

/// The zip snapshot URL for a GitHub or GitLab repository URL, `None` for any
/// other host.
pub fn archive_url(repo_url: &str) -> Option<String> {
    let rest = repo_url
        .trim()
        .strip_prefix("https://")
        .or_else(|| repo_url.trim().strip_prefix("http://"))?;
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let (host, path) = rest.split_once('/')?;
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    match host.to_ascii_lowercase().as_str() {
        "github.com" | "www.github.com" => {
            let [owner, repo, ..] = segments[..] else {
                return None;
            };
            let repo = repo.strip_suffix(".git").unwrap_or(repo);
            Some(format!(
                "https://codeload.github.com/{owner}/{repo}/zip/HEAD"
            ))
        }
        "gitlab.com" | "www.gitlab.com" => {
            // Subgroups make the repo boundary ambiguous; `/-/` or `.git` ends it.
            let end = segments
                .iter()
                .position(|s| *s == "-")
                .or_else(|| {
                    segments
                        .iter()
                        .position(|s| s.ends_with(".git"))
                        .map(|i| i + 1)
                })
                .unwrap_or(segments.len());
            let ns = &segments[..end];
            if ns.len() < 2 {
                return None;
            }
            let last = ns[ns.len() - 1];
            let repo = last.strip_suffix(".git").unwrap_or(last);
            let full = [&ns[..ns.len() - 1], &[repo][..]].concat().join("/");
            Some(format!(
                "https://gitlab.com/{full}/-/archive/HEAD/{repo}-HEAD.zip"
            ))
        }
        _ => None,
    }
}

/// Extract a repo snapshot zip into `dest`, dropping its single top-level
/// folder and any `.git/`. Returns the number of files written.
pub fn extract_archive(zip: &[u8], dest: &Path) -> Result<usize, StarterError> {
    let archive_err =
        |what: &str, e: &dyn std::fmt::Display| StarterError::Archive(format!("{what}: {e}"));
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip))
        .map_err(|e| archive_err("could not read archive", &e))?;
    let mut count = 0;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| archive_err("could not read archive entry", &e))?;
        // Never materialise symlinks: they could point at host files.
        let is_symlink = entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000);
        if entry.is_dir() || is_symlink {
            continue;
        }
        let name = entry.name().to_string();
        let Some((_top, rel)) = name.split_once('/') else {
            continue;
        };
        if rel.is_empty() || rel.split('/').next() == Some(".git") {
            continue;
        }
        let out = safe_extract_path(dest, rel).map_err(StarterError::Archive)?;
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| StarterError::Io(e.to_string()))?;
        }
        let mut file = std::fs::File::create(&out).map_err(|e| StarterError::Io(e.to_string()))?;
        std::io::copy(&mut entry, &mut file).map_err(|e| StarterError::Io(e.to_string()))?;
        count += 1;
    }
    Ok(count)
}

/// Recursively copy `src` into `dest`, leaving out any top-level `.git`.
pub fn copy_tree(src: &Path, dest: &Path) -> Result<(), StarterError> {
    fn walk(src: &Path, dest: &Path, top: bool) -> Result<(), StarterError> {
        let io = |e: std::io::Error| StarterError::Io(e.to_string());
        std::fs::create_dir_all(dest).map_err(io)?;
        for entry in std::fs::read_dir(src).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name();
            if top && name == ".git" {
                continue;
            }
            let target = dest.join(&name);
            let kind = entry.file_type().map_err(io)?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                walk(&entry.path(), &target, false)?;
            } else {
                std::fs::copy(entry.path(), &target).map_err(io)?;
            }
        }
        Ok(())
    }
    walk(src, dest, true)
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Only public web URLs are cloned; local paths, `file://` and `ext::`
/// transports would expose the host.
fn clone_allowed(repo_url: &str) -> bool {
    let url = repo_url.trim().to_ascii_lowercase();
    url.starts_with("https://") || url.starts_with("http://")
}

fn clone(repo_url: &str, dest: &Path) -> Result<(), StarterError> {
    let tmp = tempfile::tempdir().map_err(|e| StarterError::Io(e.to_string()))?;
    let checkout = tmp.path().join("repo");
    let out = Command::new("git")
        .args(["clone", "--depth", "1", "--", repo_url])
        .arg(&checkout)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ALLOW_PROTOCOL", "http:https")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| StarterError::Network(format!("could not run git: {e}")))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        return Err(if msg.contains("not found") {
            StarterError::NotFound
        } else {
            StarterError::Network(msg.trim().to_string())
        });
    }
    copy_tree(&checkout, dest)
}

/// Download the repository at `repo_url` into `dest`.
pub fn fetch(repo_url: &str, dest: &Path) -> Result<(), StarterError> {
    let Some(url) = archive_url(repo_url) else {
        if clone_allowed(repo_url) && git_available() {
            return clone(repo_url, dest);
        }
        return Err(StarterError::UnsupportedHost);
    };
    let resp = reqwest::blocking::get(&url).map_err(|e| StarterError::Network(e.to_string()))?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(StarterError::NotFound);
    }
    if !status.is_success() {
        return Err(StarterError::Network(format!("download failed: {status}")));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| StarterError::Network(e.to_string()))?;
    extract_archive(&bytes, dest).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, body) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn archive_url_variants() {
        let gh = Some("https://codeload.github.com/a/b/zip/HEAD".to_string());
        for url in [
            "https://github.com/a/b",
            "https://github.com/a/b.git",
            "https://github.com/a/b/",
            "https://github.com/a/b/tree/main/docs",
            "http://www.github.com/a/b",
            "https://github.com/a/b?tab=readme-ov-file",
            "https://github.com/a/b#readme",
        ] {
            assert_eq!(archive_url(url), gh, "{url}");
        }
        assert_eq!(
            archive_url("https://gitlab.com/g/sub/r.git"),
            Some("https://gitlab.com/g/sub/r/-/archive/HEAD/r-HEAD.zip".to_string())
        );
        assert_eq!(
            archive_url("https://gitlab.com/g/sub/r/-/tree/main"),
            Some("https://gitlab.com/g/sub/r/-/archive/HEAD/r-HEAD.zip".to_string())
        );
        assert_eq!(
            archive_url("https://gitlab.com/g/sub/r?ref_type=heads"),
            Some("https://gitlab.com/g/sub/r/-/archive/HEAD/r-HEAD.zip".to_string())
        );
        assert_eq!(archive_url("https://codeberg.org/a/b"), None);
        assert_eq!(archive_url("https://github.com/a"), None);
    }

    #[test]
    fn extract_strips_top_folder_and_git() {
        let zip = zip_of(&[
            ("r-HEAD/index.md", "hi"),
            ("r-HEAD/Library/X.md", "x"),
            ("r-HEAD/.git/config", "c"),
            ("r-HEAD/.github/ci.yml", "ci"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(extract_archive(&zip, dir.path()).unwrap(), 3);
        assert!(dir.path().join("index.md").exists());
        assert!(dir.path().join("Library/X.md").exists());
        assert!(dir.path().join(".github/ci.yml").exists());
        assert!(!dir.path().join(".git").exists());
    }

    #[test]
    fn clone_only_for_http_urls() {
        assert!(clone_allowed("https://example.com/r.git"));
        assert!(clone_allowed("http://example.com/r"));
        for url in [
            "/srv/repo",
            "file:///srv/repo",
            "ext::sh -c id",
            "git@host:r",
            "-uoption",
        ] {
            assert!(!clone_allowed(url), "{url}");
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            fetch("file:///srv/repo", dir.path()),
            Err(StarterError::UnsupportedHost)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn copy_tree_skips_symlinks_and_git() {
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.md"), "a").unwrap();
        std::os::unix::fs::symlink("/etc/passwd", src.path().join("index.md")).unwrap();
        std::os::unix::fs::symlink("/nonexistent", src.path().join("dangling")).unwrap();
        std::fs::create_dir_all(src.path().join(".git")).unwrap();
        let dest = tempfile::tempdir().unwrap();
        copy_tree(src.path(), dest.path()).unwrap();
        assert!(dest.path().join("a.md").exists());
        assert!(!dest.path().join("index.md").exists());
        assert!(!dest.path().join("dangling").exists());
        assert!(!dest.path().join(".git").exists());
    }

    #[cfg(unix)]
    #[test]
    fn extract_skips_symlink_entries() {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("r-HEAD/a.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"a").unwrap();
        w.add_symlink(
            "r-HEAD/index.md",
            "/etc/passwd",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        let zip = w.finish().unwrap().into_inner();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(extract_archive(&zip, dir.path()).unwrap(), 1);
        assert!(!dir.path().join("index.md").exists());
    }

    #[test]
    fn extract_rejects_bad_archive_and_traversal() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            extract_archive(b"nope", dir.path()),
            Err(StarterError::Archive(_))
        ));
        let zip = zip_of(&[("r-HEAD/../../evil.md", "x")]);
        assert!(matches!(
            extract_archive(&zip, dir.path()),
            Err(StarterError::Archive(_))
        ));
    }
}
