//! Case-resolution helpers for `DiskSpacePrimitives`.
//!
//! On a case-insensitive filesystem, writing to `notes/a.md` when the disk
//! holds `Notes/A.md` truncates that entry but keeps its old name — so a
//! case-only rename can never take effect. These helpers recover the true
//! on-disk casing and re-case entries to match what the caller asked for.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Keeps concurrent probes on the same root from colliding.
static PROBE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Detect whether `root` lives on a case-insensitive filesystem.
///
/// The probe file is dot-prefixed because `fetch_file_list` and the client's
/// `CheckedSpacePrimitives` both skip those, so it can't surface to a user even
/// if cleanup fails. Any failure reports `false`, keeping the backend on its
/// historical behavior.
pub(crate) fn detect_case_insensitive(root: &Path) -> bool {
    let n = PROBE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let lower = format!(".sb-case-probe-{}-{}", std::process::id(), n);
    let upper = lower.to_uppercase();

    let probe = root.join(&lower);
    if std::fs::write(&probe, b"").is_err() {
        return false;
    }
    let insensitive = std::fs::symlink_metadata(root.join(&upper)).is_ok();
    let _ = std::fs::remove_file(&probe);
    insensitive
}

/// Plan the renames turning the on-disk casing (`actual_rel`) into the
/// requested one (`desired_rel`), both relative to `root`.
///
/// Returns absolute `(from, to)` pairs, outermost first. Each pair assumes
/// every earlier pair already landed, so a caller hitting an error must stop
/// rather than skip ahead.
pub(crate) fn plan_recase(
    root: &Path,
    actual_rel: &Path,
    desired_rel: &Path,
) -> Vec<(PathBuf, PathBuf)> {
    let actual: Vec<_> = actual_rel.components().map(|c| c.as_os_str()).collect();
    let desired: Vec<_> = desired_rel.components().map(|c| c.as_os_str()).collect();

    // Shapes must line up; anything else is a caller bug, and doing nothing is
    // the safe response.
    if actual.len() != desired.len() {
        return Vec::new();
    }

    let mut plan = Vec::new();
    for i in 0..actual.len() {
        if actual[i] == desired[i] {
            continue;
        }
        // Everything shallower than `i` has already been renamed to the
        // desired casing by the time this pair runs.
        let mut from = root.to_path_buf();
        for d in desired.iter().take(i) {
            from.push(d);
        }
        from.push(actual[i]);

        let mut to = root.to_path_buf();
        for d in desired.iter().take(i + 1) {
            to.push(d);
        }
        plan.push((from, to));
    }
    plan
}

/// The case-exact path of an existing entry, relative to `root`, or `None`.
///
/// `rel` must already have been validated by `safe_path`, and `root` must be
/// canonicalized — the containment check below compares against a
/// symlink-resolved path, so an uncanonicalized root (`/var/...` rather than
/// `/private/var/...`) makes every lookup report `None`.
pub(crate) fn true_relative_path(root: &Path, rel: &Path) -> std::io::Result<Option<PathBuf>> {
    let depth = rel.components().count();
    if depth == 0 {
        return Ok(None);
    }
    let Some(abs) = resolve_true_absolute(root, rel)? else {
        return Ok(None);
    };

    let components: Vec<_> = abs.components().collect();
    if components.len() >= depth {
        let prefix: PathBuf = components[..components.len() - depth].iter().collect();
        if paths_equal_ignoring_case(&prefix, root) {
            return Ok(Some(trailing_components(&abs, depth)));
        }
    }

    // `F_GETPATH` and `canonicalize` dereference symlinks, so a page inside a
    // folder symlinked into the space resolves to a path outside it. Those are
    // real space files and must stay re-casable, so recover the casing by
    // matching directory entry names instead — that walk never leaves the space.
    walk_true_relative(root, rel)
}

/// The root's stored casing may differ from its true on-disk casing, so a
/// containment check has to ignore case.
fn paths_equal_ignoring_case(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Drops the space root (whose casing we must never touch) from a resolved
/// absolute path. `strip_prefix` can't do this: it fails when the root's true
/// casing differs from the one we hold.
fn trailing_components(path: &Path, n: usize) -> PathBuf {
    let comps: Vec<_> = path.components().map(|c| c.as_os_str()).collect();
    let start = comps.len().saturating_sub(n);
    let mut out = PathBuf::new();
    for c in &comps[start..] {
        out.push(c);
    }
    out
}

#[cfg(target_os = "macos")]
fn resolve_true_absolute(root: &Path, rel: &Path) -> std::io::Result<Option<PathBuf>> {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;
    use std::os::unix::io::AsRawFd;

    // Opening a directory read-only is allowed on Unix, so this covers folders
    // as well as files.
    let file = match std::fs::File::open(root.join(rel)) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };

    let mut buf = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: `buf` is PATH_MAX bytes, which is what F_GETPATH requires, and
    // the fd is owned by `file` for the duration of the call.
    let rc = unsafe {
        libc::fcntl(
            file.as_raw_fd(),
            libc::F_GETPATH,
            buf.as_mut_ptr() as *mut libc::c_char,
        )
    };
    if rc < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    buf.truncate(len);
    Ok(Some(PathBuf::from(OsString::from_vec(buf))))
}

#[cfg(windows)]
fn resolve_true_absolute(root: &Path, rel: &Path) -> std::io::Result<Option<PathBuf>> {
    // On Windows `canonicalize` goes through GetFinalPathNameByHandle, which
    // reports true casing. The `\\?\` prefix it returns is harmless here
    // because the caller only keeps the trailing components.
    match std::fs::canonicalize(root.join(rel)) {
        Ok(p) => Ok(Some(p)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Portable fallback. Only reachable on a case-insensitive mount on a
/// non-Mac/Windows host (CIFS, ext4 casefold), so the per-component `read_dir`
/// cost stays confined to the setups that need it.
#[cfg(not(any(target_os = "macos", windows)))]
fn resolve_true_absolute(root: &Path, rel: &Path) -> std::io::Result<Option<PathBuf>> {
    if let Err(e) = std::fs::symlink_metadata(root.join(rel)) {
        if e.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(e);
    }
    Ok(walk_true_relative(root, rel)?.map(|r| root.join(r)))
}

fn find_entry(dir: &Path, name: &std::ffi::OsStr) -> std::io::Result<Option<std::ffi::OsString>> {
    let wanted = name.to_string_lossy();
    let mut case_insensitive_match = None;
    for entry in std::fs::read_dir(dir)? {
        let found = entry?.file_name();
        if found == name {
            return Ok(Some(found)); // exact match always wins
        }
        if found.to_string_lossy().eq_ignore_ascii_case(&wanted) {
            case_insensitive_match = Some(found);
        }
    }
    Ok(case_insensitive_match)
}

fn walk_true_relative(root: &Path, rel: &Path) -> std::io::Result<Option<PathBuf>> {
    let mut dir = root.to_path_buf();
    let mut resolved = PathBuf::new();
    for comp in rel.components() {
        match find_entry(&dir, comp.as_os_str())? {
            Some(real) => {
                dir.push(&real);
                resolved.push(&real);
            }
            None => return Ok(None),
        }
    }
    Ok(Some(resolved))
}

/// Apply a plan from `plan_recase`, best-effort.
///
/// Never surfaces an error: if a rename fails the caller's write still lands
/// through the case-insensitive alias, which is the historical behavior.
/// Failures are expected in the wild — on Windows a directory rename fails
/// while antivirus or a search indexer holds a handle inside it.
///
/// Stops at the first problem rather than skipping ahead, since every later
/// pair assumes the earlier renames landed.
pub(crate) fn apply_recase(plan: &[(PathBuf, PathBuf)]) {
    for (from, to) in plan {
        // Fires when a plan pair's `from` is itself the symlinked entry:
        // renaming the link rather than what it points at is not ours to do.
        // Renames *through* a symlinked directory pass this check and should —
        // an external folder symlinked into a space holds real space files, and
        // renaming one is exactly what the user asked for.
        //
        // Reachable on every platform. On macOS and Windows it is the fallback
        // walk in `true_relative_path` that produces such a pair, since the OS
        // resolver's own answer never survives the containment check.
        match std::fs::symlink_metadata(from) {
            Ok(md) if md.file_type().is_symlink() => {
                tracing::debug!(
                    "not re-casing {}: symlinked components may point outside the space",
                    from.display()
                );
                return;
            }
            Ok(_) => {}
            Err(e) => {
                tracing::debug!("not re-casing {}: {}", from.display(), e);
                return;
            }
        }
        if let Err(e) = std::fs::rename(from, to) {
            tracing::debug!(
                "could not re-case {} to {}: {} — writing through the existing name",
                from.display(),
                to.display(),
                e
            );
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// The probe must agree with what the filesystem actually does, on every
    /// platform. This is the test that gives the probe meaning on Linux CI
    /// (where it must report false) and on a Mac (where it must report true).
    #[test]
    fn probe_matches_filesystem_behavior() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("CaseProbeControl.md"), b"x").unwrap();
        let control = std::fs::symlink_metadata(dir.path().join("caseprobecontrol.md")).is_ok();

        assert_eq!(detect_case_insensitive(dir.path()), control);
    }

    #[test]
    fn probe_leaves_no_files_behind() {
        let dir = tempdir().unwrap();
        detect_case_insensitive(dir.path());

        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(
            leftovers.is_empty(),
            "probe left files behind: {leftovers:?}"
        );
    }

    #[test]
    fn probe_on_unwritable_root_reports_case_sensitive() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("nope");
        // Never created — writing into it fails, which must degrade to false
        // rather than panicking.
        assert!(!detect_case_insensitive(&sub));
    }

    fn plan(root: &str, actual: &str, desired: &str) -> Vec<(String, String)> {
        plan_recase(Path::new(root), Path::new(actual), Path::new(desired))
            .into_iter()
            .map(|(f, t)| {
                (
                    f.to_string_lossy().into_owned(),
                    t.to_string_lossy().into_owned(),
                )
            })
            .collect()
    }

    #[test]
    fn identical_paths_need_no_renames() {
        assert!(plan("/s", "Notes/A.md", "Notes/A.md").is_empty());
    }

    #[test]
    fn file_component_only() {
        assert_eq!(
            plan("/s", "Notes/OldName.md", "Notes/oldname.md"),
            vec![(
                "/s/Notes/OldName.md".to_string(),
                "/s/Notes/oldname.md".to_string()
            )]
        );
    }

    #[test]
    fn folder_component_only() {
        assert_eq!(
            plan("/s", "Notes/a.md", "notes/a.md"),
            vec![("/s/Notes".to_string(), "/s/notes".to_string())]
        );
    }

    /// Outermost first, and each later pair is expressed in terms of the
    /// *already renamed* prefix — otherwise the second rename would target a
    /// path that no longer exists.
    #[test]
    fn every_differing_component_outermost_first() {
        assert_eq!(
            plan("/s", "Notes/Sub/A.md", "notes/sub/a.md"),
            vec![
                ("/s/Notes".to_string(), "/s/notes".to_string()),
                ("/s/notes/Sub".to_string(), "/s/notes/sub".to_string()),
                (
                    "/s/notes/sub/A.md".to_string(),
                    "/s/notes/sub/a.md".to_string()
                ),
            ]
        );
    }

    #[test]
    fn matching_components_are_left_alone() {
        assert_eq!(
            plan("/s", "Notes/Sub/A.md", "Notes/sub/A.md"),
            vec![("/s/Notes/Sub".to_string(), "/s/Notes/sub".to_string())]
        );
    }

    /// Defensive: a caller that hands us paths of different shapes gets no
    /// renames rather than a garbage sequence.
    #[test]
    fn mismatched_depth_plans_nothing() {
        assert!(plan("/s", "Notes/a.md", "a.md").is_empty());
    }

    #[test]
    fn exact_case_resolves_to_itself() {
        let dir = tempdir().unwrap();
        // `true_relative_path` requires an already-canonical root (its real
        // caller does this at construction); on macOS `tempdir()` returns a
        // path under `/var`, itself a symlink to `/private/var`, which would
        // otherwise make the new containment check reject everything.
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        std::fs::write(root.join("Notes/A.md"), b"x").unwrap();

        let got = true_relative_path(&root, Path::new("Notes/A.md")).unwrap();
        assert_eq!(got, Some(PathBuf::from("Notes/A.md")));
    }

    #[test]
    fn missing_path_resolves_to_none() {
        let dir = tempdir().unwrap();
        let got = true_relative_path(dir.path(), Path::new("Notes/nope.md")).unwrap();
        assert_eq!(got, None);
    }

    /// The whole point: asking with the wrong casing reports the *real* casing
    /// of every component. Gated to macOS — on Linux there is nothing to
    /// reveal, and a test that runs but asserts nothing is worse than absent.
    #[cfg(target_os = "macos")]
    #[test]
    fn wrong_case_reveals_true_casing() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        if !detect_case_insensitive(&root) {
            return; // rare case-sensitive APFS volume
        }
        std::fs::create_dir_all(root.join("Notes/Sub")).unwrap();
        std::fs::write(root.join("Notes/Sub/MixedCase.md"), b"x").unwrap();

        let got = true_relative_path(&root, Path::new("notes/sub/mixedcase.md")).unwrap();
        assert_eq!(got, Some(PathBuf::from("Notes/Sub/MixedCase.md")));
    }

    /// `F_GETPATH` resolves symlinks all the way through, so a component that
    /// is a symlink to something outside the space resolves to a path that is
    /// textually outside the root. That must not leak as a relative path built
    /// from those outside components (e.g. `deep/A.md`) — recovering by name
    /// walk must still land on the in-space path through the symlink.
    #[cfg(target_os = "macos")]
    #[test]
    fn symlinked_component_resolves_inside_the_space() {
        let space_dir = tempdir().unwrap();
        let space = space_dir.path().canonicalize().unwrap();
        if !detect_case_insensitive(&space) {
            return; // rare case-sensitive APFS volume
        }
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("A.md"), b"x").unwrap();
        std::os::unix::fs::symlink(outside.path(), space.join("Linked")).unwrap();

        let got = true_relative_path(&space, Path::new("Linked/A.md")).unwrap();
        assert_eq!(got, Some(PathBuf::from("Linked/A.md")));
    }

    /// A page inside a symlinked-in folder is a real space file, so its casing
    /// must be recoverable even though the OS resolver reports a path outside
    /// the space.
    #[cfg(target_os = "macos")]
    #[test]
    fn symlinked_folder_contents_resolve_by_walking() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        if !detect_case_insensitive(&root) {
            return; // rare case-sensitive APFS volume
        }
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("Sub.md"), b"x").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("Linked")).unwrap();

        let got = true_relative_path(&root, Path::new("Linked/sub.md")).unwrap();
        assert_eq!(got, Some(PathBuf::from("Linked/Sub.md")));
    }

    #[test]
    fn applies_renames_in_order() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Notes/Sub")).unwrap();
        std::fs::write(dir.path().join("Notes/Sub/A.md"), b"body").unwrap();

        apply_recase(&plan_recase(
            dir.path(),
            Path::new("Notes/Sub/A.md"),
            Path::new("notes/sub/a.md"),
        ));

        assert_eq!(
            std::fs::read(dir.path().join("notes/sub/a.md")).unwrap(),
            b"body"
        );
        let top: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(top, vec!["notes".to_string()]);
    }

    /// A symlinked component may point outside the space entirely; renaming it
    /// is out of bounds, so the whole plan stops there.
    #[cfg(unix)]
    #[test]
    fn stops_at_a_symlinked_component() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("A.md"), b"body").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("Linked")).unwrap();

        apply_recase(&plan_recase(
            dir.path(),
            Path::new("Linked/A.md"),
            Path::new("linked/a.md"),
        ));

        // Reads the literal directory entry name rather than doing a
        // case-insensitive path lookup (`.join("Linked").is_symlink()`) —
        // on default APFS that lookup would still resolve to a renamed
        // `linked` entry and pass either way, masking a regression.
        let entries: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["Linked".to_string()]);
        assert!(outside.path().join("A.md").exists());
    }

    #[test]
    fn missing_source_is_a_no_op() {
        let dir = tempdir().unwrap();
        apply_recase(&plan_recase(
            dir.path(),
            Path::new("Gone.md"),
            Path::new("gone.md"),
        ));
        assert!(!dir.path().join("gone.md").exists());
    }

    #[test]
    fn stops_after_a_missing_source_instead_of_skipping_ahead() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Second.md"), b"body").unwrap();

        apply_recase(&[
            (dir.path().join("Missing.md"), dir.path().join("missing.md")),
            (dir.path().join("Second.md"), dir.path().join("second.md")),
        ]);

        let entries: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["Second.md".to_string()]);
    }

    #[test]
    fn stops_after_a_failed_rename_not_just_a_missing_source() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("First.md"), b"one").unwrap();
        std::fs::write(dir.path().join("Second.md"), b"two").unwrap();

        apply_recase(&[
            (
                dir.path().join("First.md"),
                dir.path().join("no-such-dir/first.md"),
            ),
            (dir.path().join("Second.md"), dir.path().join("second.md")),
        ]);

        let mut entries: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        entries.sort();
        assert_eq!(
            entries,
            vec!["First.md".to_string(), "Second.md".to_string()]
        );
    }
}
