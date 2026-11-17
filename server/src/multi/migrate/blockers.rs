//! What stops a migration from running: entries that collide with the new
//! layout, entries a rename can't move, and a data root the server can't write.

use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{JOURNAL_FILE, REPORT_FILE};
use crate::multi::data_root::is_reserved_top_level;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Blocker {
    Collision {
        name: String,
    },
    /// A mount point at or inside an entry to move: a rename can't take it along.
    Mount {
        path: PathBuf,
    },
    /// A name that isn't valid UTF-8, shown lossily.
    UnsupportedName {
        name: String,
    },
    NotWritable,
}

impl Blocker {
    pub fn message(&self) -> String {
        match self {
            Blocker::Collision { name } => format!(
                "The folder already contains \"{name}\", which the multi-space layout needs. Move or rename it, then reload this page."
            ),
            Blocker::Mount { path } => format!(
                "\"{}\" is a separate mount (for example a Docker volume or bind mount), so it can't be moved by renaming. Move its contents into the folder and remove the mount, then reload this page.",
                path.display()
            ),
            Blocker::UnsupportedName { name } => format!(
                "\"{name}\" has a name that isn't valid UTF-8, which SilverBullet can't serve. Rename it, then reload this page."
            ),
            Blocker::NotWritable => "The folder is not writable (for example a read-only mount). Give the server write access, then reload this page.".to_string(),
        }
    }
}

/// Whether a top-level entry named `name` is in the way of the new layout.
fn collides(name: &str) -> bool {
    is_reserved_top_level(name)
        || ["spaces", JOURNAL_FILE, REPORT_FILE]
            .iter()
            .any(|taken| taken.eq_ignore_ascii_case(name))
}

/// Why moving `entries` (top-level paths in `root`) into `dest` can't
/// proceed. Writes and deletes one probe file in `root`; otherwise only reads.
/// `dest` need not exist yet. Not exhaustive: a directory's own permissions,
/// or outside Linux a mount nested deeper inside a directory, can still fail
/// a rename, which the migration journal recovers from.
pub fn find_blockers(root: &Path, dest: &Path, entries: &[PathBuf]) -> Vec<Blocker> {
    let mut blockers = Vec::new();
    for entry in entries {
        let Some(name) = entry.file_name() else {
            continue;
        };
        match name.to_str() {
            Some(name) if collides(name) => blockers.push(Blocker::Collision {
                name: name.to_string(),
            }),
            Some(_) => {}
            None => blockers.push(Blocker::UnsupportedName {
                name: name.to_string_lossy().into_owned(),
            }),
        }
    }
    for blocker in cross_device(dest, entries)
        .into_iter()
        .chain(mount_table_blockers(root, entries))
    {
        if !blockers.contains(&blocker) {
            blockers.push(blocker);
        }
    }
    if !writable(root) {
        blockers.push(Blocker::NotWritable);
    }
    blockers
}

#[cfg(unix)]
fn cross_device(dest: &Path, entries: &[PathBuf]) -> Vec<Blocker> {
    use std::os::unix::fs::MetadataExt;
    let Some(dest_dev) = dest
        .ancestors()
        .find_map(|dir| std::fs::metadata(dir).ok())
        .map(|meta| meta.dev())
    else {
        return Vec::new();
    };
    entries
        .iter()
        .filter(|entry| std::fs::symlink_metadata(entry).is_ok_and(|meta| meta.dev() != dest_dev))
        .map(|entry| Blocker::Mount {
            path: entry.clone(),
        })
        .collect()
}

#[cfg(not(unix))]
fn cross_device(_dest: &Path, _entries: &[PathBuf]) -> Vec<Blocker> {
    Vec::new()
}

/// Docker volumes and bind mounts often share the device of the folder they
/// are mounted in, so `cross_device` misses them; the mount table doesn't.
#[cfg(target_os = "linux")]
fn mount_table_blockers(root: &Path, entries: &[PathBuf]) -> Vec<Blocker> {
    let Ok(table) = std::fs::read("/proc/self/mountinfo") else {
        return Vec::new();
    };
    let real_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    nested_mounts(root, &real_root, entries, &mount_points(&table))
}

#[cfg(not(target_os = "linux"))]
fn mount_table_blockers(_root: &Path, _entries: &[PathBuf]) -> Vec<Blocker> {
    Vec::new()
}

/// The mount points `mounts` (absolute, as the mount table has them) at or
/// inside one of `entries`, named under `root`. `real_root` is `root` with
/// symlinks resolved, as the mount table would show it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn nested_mounts(
    root: &Path,
    real_root: &Path,
    entries: &[PathBuf],
    mounts: &[PathBuf],
) -> Vec<Blocker> {
    let names: BTreeSet<&OsStr> = entries.iter().filter_map(|e| e.file_name()).collect();
    mounts
        .iter()
        .filter_map(|mount| {
            let inside = mount.strip_prefix(real_root).ok()?;
            let entry = inside.components().next()?;
            names.contains(entry.as_os_str()).then(|| Blocker::Mount {
                path: root.join(inside),
            })
        })
        .collect()
}

/// The mount points listed in `/proc/self/mountinfo` (its fifth field, where
/// the kernel writes space, tab, newline and backslash as `\ooo` and leaves
/// other bytes, UTF-8 or not, as they are).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn mount_points(mountinfo: &[u8]) -> Vec<PathBuf> {
    mountinfo
        .split(|&b| b == b'\n')
        .filter_map(|line| line.split(|&b| b == b' ').nth(4))
        .map(|field| path_from_bytes(unescape_octal(field)))
        .collect()
}

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    use std::os::unix::ffi::OsStringExt;
    PathBuf::from(std::ffi::OsString::from_vec(bytes))
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn unescape_octal(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let code = bytes
            .get(i + 1..i + 4)
            .filter(|_| bytes[i] == b'\\')
            .and_then(|digits| std::str::from_utf8(digits).ok())
            .and_then(|digits| u8::from_str_radix(digits, 8).ok());
        match code {
            Some(byte) => {
                out.push(byte);
                i += 4;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    out
}

/// Names of the files `find_blockers` writes to test the root.
pub(crate) const PROBE_PREFIX: &str = ".migration-probe-";

fn writable(root: &Path) -> bool {
    let probe = root.join(format!("{PROBE_PREFIX}{}", uuid::Uuid::new_v4()));
    let created = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .is_ok();
    if created {
        let _ = std::fs::remove_file(&probe);
    }
    created
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(root: &Path) -> Vec<PathBuf> {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        entries.sort();
        entries
    }

    #[test]
    fn collisions_block() {
        for name in [
            "spaces",
            "spaces.json",
            "users.json",
            "server.json",
            "search",
            ".migration-journal.json",
            "MIGRATION.md",
        ] {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("index.md"), "# Hello").unwrap();
            std::fs::write(dir.path().join(name), "taken").unwrap();
            let blockers = find_blockers(
                dir.path(),
                &dir.path().join("spaces/notes"),
                &entries(dir.path()),
            );
            assert_eq!(
                blockers,
                vec![Blocker::Collision { name: name.into() }],
                "{name}"
            );
        }
    }

    #[test]
    fn ordinary_folder_has_no_blockers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), "# Hello").unwrap();
        std::fs::create_dir(dir.path().join("Journal")).unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let blockers = find_blockers(
            dir.path(),
            &dir.path().join("spaces/notes"),
            &entries(dir.path()),
        );
        assert!(blockers.is_empty(), "{blockers:?}");
    }

    #[test]
    fn messages_name_the_entry() {
        assert!(Blocker::Collision {
            name: "spaces".into()
        }
        .message()
        .contains("\"spaces\""));
        assert!(Blocker::Mount {
            path: "/data/Journal".into()
        }
        .message()
        .contains("/data/Journal"));
    }

    const MOUNTINFO: &str = "\
22 1 0:21 / / rw,relatime shared:1 - overlay overlay rw,lowerdir=/l
95 22 0:36 / /data rw,relatime - virtiofs mac rw
96 95 0:36 /att /data/attachments rw,relatime - virtiofs mac rw
97 95 8:1 / /data/My\\040Files/deep rw,relatime - ext4 /dev/sda1 rw
98 22 8:1 / /database rw,relatime - ext4 /dev/sda1 rw
99 95 8:1 / /data/.chrome-data rw,relatime - ext4 /dev/sda1 rw
";

    #[test]
    fn mountinfo_mount_points_are_unescaped() {
        assert_eq!(
            mount_points(MOUNTINFO.as_bytes()),
            vec![
                PathBuf::from("/"),
                PathBuf::from("/data"),
                PathBuf::from("/data/attachments"),
                PathBuf::from("/data/My Files/deep"),
                PathBuf::from("/database"),
                PathBuf::from("/data/.chrome-data"),
            ]
        );
        assert_eq!(
            mount_points(b"1 2 0:1 / /a\\011b\\134c\\012d rw - x y rw\nshort line\n"),
            vec![PathBuf::from("/a\tb\\c\nd")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_mount_points_keep_their_bytes() {
        use std::os::unix::ffi::OsStrExt;
        let expected = vec![PathBuf::from(OsStr::from_bytes(b"/data/caf\xe9/x"))];
        assert_eq!(
            mount_points(b"1 2 0:1 / /data/caf\\351/x rw - x y rw\n"),
            expected
        );
        assert_eq!(
            mount_points(b"1 2 0:1 / /data/caf\xe9/x rw - x y rw\n"),
            expected
        );
    }

    /// Mounts that share the root's device (Docker volumes and bind mounts)
    /// still can't be renamed; only the mount table shows them.
    #[test]
    fn mounts_inside_moved_entries_block() {
        let root = Path::new("/data");
        let entries: Vec<PathBuf> = ["My Files", "attachments", "index.md"]
            .iter()
            .map(|name| root.join(name))
            .collect();
        assert_eq!(
            nested_mounts(root, root, &entries, &mount_points(MOUNTINFO.as_bytes())),
            vec![
                Blocker::Mount {
                    path: "/data/attachments".into()
                },
                Blocker::Mount {
                    path: "/data/My Files/deep".into()
                },
            ]
        );
        assert_eq!(
            nested_mounts(
                Path::new("./data"),
                root,
                &entries[2..],
                &mount_points(MOUNTINFO.as_bytes())
            ),
            vec![]
        );
        assert_eq!(
            nested_mounts(
                Path::new("./data"),
                root,
                &entries[1..2],
                &mount_points(MOUNTINFO.as_bytes())
            ),
            vec![Blocker::Mount {
                path: "./data/attachments".into()
            }]
        );
    }

    #[cfg(unix)]
    #[test]
    fn not_writable_blocks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.md"), "# Hello").unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(root.join("probe"), "").is_ok() {
            // Running as root: permissions don't stop writes.
            return;
        }
        let blockers = find_blockers(&root, &root.join("spaces/notes"), &entries(&root));
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(blockers, vec![Blocker::NotWritable]);
    }

    #[test]
    fn writable_probe_leaves_no_trace() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), "# Hello").unwrap();
        let before = entries(dir.path());
        let blockers = find_blockers(dir.path(), &dir.path().join("spaces/notes"), &before);
        assert!(blockers.is_empty(), "{blockers:?}");
        assert_eq!(entries(dir.path()), before);
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_name_blocks() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let entry = dir.path().join(std::ffi::OsStr::from_bytes(b"caf\xe9.md"));
        let blockers = find_blockers(dir.path(), &dir.path().join("spaces/notes"), &[entry]);
        assert_eq!(
            blockers,
            vec![Blocker::UnsupportedName {
                name: "caf\u{FFFD}.md".into()
            }]
        );
        assert!(blockers[0].message().contains("caf\u{FFFD}.md"));
    }
}
