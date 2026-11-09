//! Moves a space's legacy root `CONFIG.md` to `Library/Config.md`, where
//! configuration lives since it became an ordinary Tool Page.

use std::path::Path;

use crate::space::disk::GitignoreMatcher;

pub const LEGACY_CONFIG_FILE: &str = "CONFIG.md";
pub const CONFIG_FILE: &str = "Library/Config.md";

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigMigration {
    /// No root `CONFIG.md` file
    NotNeeded,
    Moved,
    /// Both files exist; neither was touched
    BothExist,
    /// Moving it could break or hide the configuration; left for the user
    Skipped(String),
    Failed(String),
}

/// Renames `<root>/CONFIG.md` to `<root>/Library/Config.md` when only the
/// former exists. Works on the space folder directly, so bundled layers are
/// never involved. `space_ignore` holds the space's ignore patterns. Safe to
/// run on every start.
pub fn migrate_config_page(root: &Path, space_ignore: &str) -> ConfigMigration {
    let Ok(entries) = std::fs::read_dir(root) else {
        return ConfigMigration::NotNeeded;
    };
    let entries: Vec<_> = entries.flatten().collect();
    // Matched by exact name: on a case-insensitive filesystem `exists()` would
    // also pick up an ordinary page called `config.md`.
    let Some(legacy_type) = entries
        .iter()
        .find(|e| e.file_name() == LEGACY_CONFIG_FILE)
        .and_then(|e| e.file_type().ok())
    else {
        return ConfigMigration::NotNeeded;
    };
    if legacy_type.is_dir() {
        return ConfigMigration::NotNeeded;
    }
    if legacy_type.is_symlink() {
        // Renaming moves the link itself, and a relative link breaks under Library/
        return skip(root, format!("{LEGACY_CONFIG_FILE} is a symbolic link"));
    }
    // create_dir_all("Library") would land in a differently cased folder on a
    // case-insensitive filesystem, and create a second folder on another
    let has_library = entries.iter().any(|e| e.file_name() == "Library");
    if let Some(other) = entries.iter().find(|e| {
        let name = e.file_name();
        name != "Library"
            && name.to_string_lossy().eq_ignore_ascii_case("library")
            && e.file_type().is_ok_and(|t| t.is_dir())
    }) {
        if !has_library {
            return skip(
                root,
                format!(
                    "the space has a folder named {}, not Library",
                    other.file_name().to_string_lossy()
                ),
            );
        }
    }
    let target = root.join(CONFIG_FILE);
    if target.symlink_metadata().is_ok() {
        tracing::warn!(
            space = %root.display(),
            "Both {LEGACY_CONFIG_FILE} and {CONFIG_FILE} exist in {}, nothing was moved. Merge {LEGACY_CONFIG_FILE} into {CONFIG_FILE} by hand: only {CONFIG_FILE} is loaded.",
            root.display()
        );
        return ConfigMigration::BothExist;
    }
    if GitignoreMatcher::from_patterns(root, space_ignore).is_ignored(CONFIG_FILE, false) {
        return skip(
            root,
            format!("the space's ignore rules exclude {CONFIG_FILE}"),
        );
    }
    let legacy = root.join(LEGACY_CONFIG_FILE);
    let result = target
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::rename(&legacy, &target));
    match result {
        Ok(()) => {
            tracing::info!(
                space = %root.display(),
                "Moved {LEGACY_CONFIG_FILE} to {CONFIG_FILE} in {} (configuration now lives in Library/)",
                root.display()
            );
            ConfigMigration::Moved
        }
        Err(e) => {
            tracing::warn!(
                space = %root.display(),
                "Could not move {} to {}: {e}",
                legacy.display(),
                target.display()
            );
            ConfigMigration::Failed(e.to_string())
        }
    }
}

fn skip(root: &Path, reason: String) -> ConfigMigration {
    tracing::warn!(
        space = %root.display(),
        "Not moving {LEGACY_CONFIG_FILE} to {CONFIG_FILE} in {}: {reason}. Move it by hand: only {CONFIG_FILE} is loaded.",
        root.display()
    );
    ConfigMigration::Skipped(reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(root: &Path, path: &str) -> String {
        std::fs::read_to_string(root.join(path)).unwrap()
    }

    #[derive(Clone, Default)]
    struct Captured(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Captured {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Runs the migration and returns its result plus what it logged.
    fn migrate_logged(root: &Path) -> (ConfigMigration, String) {
        let captured = Captured::default();
        let writer = captured.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .with_max_level(tracing::Level::INFO)
            .finish();
        let result =
            tracing::subscriber::with_default(subscriber, || migrate_config_page(root, ""));
        let log = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
        (result, log)
    }

    #[test]
    fn logs_the_move_at_info() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        let (result, log) = migrate_logged(dir.path());
        assert_eq!(result, ConfigMigration::Moved);
        assert!(log.contains("INFO"), "{log}");
        assert!(
            log.contains("Moved CONFIG.md to Library/Config.md"),
            "{log}"
        );
        assert!(log.contains(&dir.path().display().to_string()), "{log}");
    }

    #[test]
    fn warns_naming_both_files_when_both_exist() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Library")).unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "old").unwrap();
        std::fs::write(dir.path().join("Library/Config.md"), "new").unwrap();
        let (_, log) = migrate_logged(dir.path());
        assert!(log.contains("WARN"), "{log}");
        assert!(log.contains("CONFIG.md and Library/Config.md"), "{log}");
        assert!(log.contains("nothing was moved"), "{log}");
    }

    #[test]
    fn logs_nothing_without_config() {
        let dir = tempfile::tempdir().unwrap();
        let (_, log) = migrate_logged(dir.path());
        assert_eq!(log, "");
    }

    #[test]
    fn moves_config_into_library() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        assert_eq!(migrate_config_page(dir.path(), ""), ConfigMigration::Moved);
        assert!(!dir.path().join("CONFIG.md").exists());
        assert_eq!(read(dir.path(), "Library/Config.md"), "cfg");
    }

    #[test]
    fn keeps_an_existing_library_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Library")).unwrap();
        std::fs::write(dir.path().join("Library/Other.md"), "other").unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        assert_eq!(migrate_config_page(dir.path(), ""), ConfigMigration::Moved);
        assert_eq!(read(dir.path(), "Library/Config.md"), "cfg");
        assert_eq!(read(dir.path(), "Library/Other.md"), "other");
    }

    #[test]
    fn no_op_without_config() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), "hi").unwrap();
        assert_eq!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::NotNeeded
        );
        assert!(!dir.path().join("Library").exists());
    }

    #[test]
    fn leaves_both_alone_when_both_exist() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Library")).unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "old").unwrap();
        std::fs::write(dir.path().join("Library/Config.md"), "new").unwrap();
        assert_eq!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::BothExist
        );
        assert_eq!(read(dir.path(), "CONFIG.md"), "old");
        assert_eq!(read(dir.path(), "Library/Config.md"), "new");
    }

    #[test]
    fn idempotent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        assert_eq!(migrate_config_page(dir.path(), ""), ConfigMigration::Moved);
        assert_eq!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::NotNeeded
        );
        assert_eq!(read(dir.path(), "Library/Config.md"), "cfg");
    }

    #[test]
    fn ignores_a_lowercase_config_page() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("config.md"), "a page").unwrap();
        assert_eq!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::NotNeeded
        );
        assert_eq!(read(dir.path(), "config.md"), "a page");
    }

    #[cfg(unix)]
    #[test]
    fn skips_a_symlinked_config() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("real.md"), "cfg").unwrap();
        std::os::unix::fs::symlink("real.md", dir.path().join("CONFIG.md")).unwrap();
        let (result, log) = migrate_logged(dir.path());
        assert!(matches!(result, ConfigMigration::Skipped(_)), "{result:?}");
        assert!(
            log.contains("WARN") && log.contains("Move it by hand"),
            "{log}"
        );
        assert!(dir.path().join("CONFIG.md").symlink_metadata().is_ok());
        assert!(!dir.path().join("Library").exists());
    }

    #[test]
    fn skips_when_space_ignore_excludes_the_target() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        for ignore in ["Library/", "Library/Config.md", "*.md"] {
            assert!(
                matches!(
                    migrate_config_page(dir.path(), ignore),
                    ConfigMigration::Skipped(_)
                ),
                "{ignore}"
            );
        }
        assert_eq!(read(dir.path(), "CONFIG.md"), "cfg");
        assert_eq!(
            migrate_config_page(dir.path(), "drafts/"),
            ConfigMigration::Moved
        );
    }

    #[test]
    fn skips_beside_a_differently_cased_library_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("library")).unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        let (result, log) = migrate_logged(dir.path());
        assert!(matches!(result, ConfigMigration::Skipped(_)), "{result:?}");
        assert!(log.contains("library"), "{log}");
        assert_eq!(read(dir.path(), "CONFIG.md"), "cfg");
    }

    #[test]
    fn fails_cleanly_when_library_is_a_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Library"), "not a folder").unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "cfg").unwrap();
        assert!(matches!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::Failed(_)
        ));
        assert_eq!(read(dir.path(), "CONFIG.md"), "cfg");
    }

    #[test]
    fn ignores_a_config_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("CONFIG.md")).unwrap();
        assert_eq!(
            migrate_config_page(dir.path(), ""),
            ConfigMigration::NotNeeded
        );
        assert!(dir.path().join("CONFIG.md").is_dir());
    }
}
