//! Removes the copies of bundled repository pages that spaces kept at
//! `Repositories/` before bundled repositories moved to `Library/Repository/`.
//! Those copies were made copy-on-write when a bundled repository was updated,
//! and now shadow nothing while still loading as stale repository pages.

use std::path::Path;

const LEGACY_REPOSITORY_DIR: &str = "Repositories";
const LEGACY_REPOSITORY_FILES: &[&str] = &["Std.md", "SilverBulletMD.md"];

/// Deletes `<root>/Repositories/Std.md` and `<root>/Repositories/SilverBulletMD.md`,
/// then `Repositories/` itself if that left it empty. Works on the space folder
/// directly, so bundled layers are never involved. Returns the space paths it
/// removed. Safe to run on every start.
pub fn remove_legacy_repository_pages(root: &Path) -> Vec<String> {
    let dir = root.join(LEGACY_REPOSITORY_DIR);
    // Exact names from read_dir, not exists(): on a case-insensitive filesystem
    // the latter would also match a user's own `repositories/std.md`
    let has_dir = std::fs::read_dir(root).is_ok_and(|entries| {
        entries.flatten().any(|e| {
            e.file_name() == LEGACY_REPOSITORY_DIR && e.file_type().is_ok_and(|t| t.is_dir())
        })
    });
    if !has_dir {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !LEGACY_REPOSITORY_FILES.contains(&name) || !entry.file_type().is_ok_and(|t| t.is_file())
        {
            continue;
        }
        let path = format!("{LEGACY_REPOSITORY_DIR}/{name}");
        match std::fs::remove_file(entry.path()) {
            Ok(()) => {
                tracing::info!(space = %root.display(), "Removed legacy repository page {path}");
                removed.push(path);
            }
            Err(e) => {
                tracing::warn!(space = %root.display(), "Could not remove legacy repository page {path}: {e}")
            }
        }
    }
    if !removed.is_empty() {
        // Fails, as intended, when the user keeps other pages there
        let _ = std::fs::remove_dir(&dir);
    }
    removed.sort();
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, path: &str) {
        let full = root.join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, "x").unwrap();
    }

    #[test]
    fn removes_legacy_pages_and_the_emptied_folder() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "Repositories/Std.md");
        write(dir.path(), "Repositories/SilverBulletMD.md");
        assert_eq!(
            remove_legacy_repository_pages(dir.path()),
            vec!["Repositories/SilverBulletMD.md", "Repositories/Std.md"]
        );
        assert!(!dir.path().join("Repositories").exists());
        assert!(remove_legacy_repository_pages(dir.path()).is_empty());
    }

    #[test]
    fn keeps_other_pages_and_the_folder_holding_them() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "Repositories/Std.md");
        write(dir.path(), "Repositories/Mine.md");
        write(dir.path(), "Library/Repository/Std.md");
        assert_eq!(
            remove_legacy_repository_pages(dir.path()),
            vec!["Repositories/Std.md"]
        );
        assert!(dir.path().join("Repositories/Mine.md").exists());
        assert!(dir.path().join("Library/Repository/Std.md").exists());
    }
}
