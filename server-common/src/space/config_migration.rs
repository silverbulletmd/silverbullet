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
/// former exists, and logs the outcome. Works on the space folder directly, so
/// bundled layers are never involved. `space_ignore` holds the space's ignore
/// patterns. Safe to run on every start.
pub fn migrate_config_page(root: &Path, space_ignore: &str) -> ConfigMigration {
    let outcome = migrate(root, space_ignore);
    if let Some((level, message)) = outcome.report(root) {
        if level == tracing::Level::INFO {
            tracing::info!(space = %root.display(), "{message}");
        } else {
            tracing::warn!(space = %root.display(), "{message}");
        }
    }
    outcome
}

impl ConfigMigration {
    /// What to log about this outcome for the space at `root`, if anything
    pub fn report(&self, root: &Path) -> Option<(tracing::Level, String)> {
        let space = root.display();
        let message = match self {
            ConfigMigration::NotNeeded => return None,
            ConfigMigration::Moved => {
                return Some((
                    tracing::Level::INFO,
                    format!(
                        "Moved {LEGACY_CONFIG_FILE} to {CONFIG_FILE} in {space} (configuration now lives in Library/)"
                    ),
                ));
            }
            ConfigMigration::BothExist => format!(
                "Both {LEGACY_CONFIG_FILE} and {CONFIG_FILE} exist in {space}, nothing was moved. Merge {LEGACY_CONFIG_FILE} into {CONFIG_FILE} by hand: only {CONFIG_FILE} is loaded."
            ),
            ConfigMigration::Skipped(reason) => format!(
                "Not moving {LEGACY_CONFIG_FILE} to {CONFIG_FILE} in {space}: {reason}. Move it by hand: only {CONFIG_FILE} is loaded."
            ),
            ConfigMigration::Failed(error) => format!(
                "Could not move {} to {}: {error}",
                root.join(LEGACY_CONFIG_FILE).display(),
                root.join(CONFIG_FILE).display()
            ),
        };
        Some((tracing::Level::WARN, message))
    }
}

fn migrate(root: &Path, space_ignore: &str) -> ConfigMigration {
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
        return ConfigMigration::Skipped(format!("{LEGACY_CONFIG_FILE} is a symbolic link"));
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
            return ConfigMigration::Skipped(format!(
                "the space has a folder named {}, not Library",
                other.file_name().to_string_lossy()
            ));
        }
    }
    let target = root.join(CONFIG_FILE);
    if target.symlink_metadata().is_ok() {
        return ConfigMigration::BothExist;
    }
    if GitignoreMatcher::from_patterns(root, space_ignore).is_ignored(CONFIG_FILE, false) {
        return ConfigMigration::Skipped(format!("the space's ignore rules exclude {CONFIG_FILE}"));
    }
    let result = target
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::rename(root.join(LEGACY_CONFIG_FILE), &target));
    match result {
        Ok(()) => ConfigMigration::Moved,
        Err(e) => ConfigMigration::Failed(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(root: &Path, path: &str) -> String {
        std::fs::read_to_string(root.join(path)).unwrap()
    }

    /// The level and message logged for an outcome in `root`
    fn reported(root: &Path, outcome: &ConfigMigration) -> (tracing::Level, String) {
        outcome.report(root).expect("an outcome worth logging")
    }

    #[test]
    fn reports_the_move_at_info() {
        let dir = tempfile::tempdir().unwrap();
        let (level, message) = reported(dir.path(), &ConfigMigration::Moved);
        assert_eq!(level, tracing::Level::INFO);
        assert!(
            message.contains("Moved CONFIG.md to Library/Config.md"),
            "{message}"
        );
        assert!(
            message.contains(&dir.path().display().to_string()),
            "{message}"
        );
    }

    #[test]
    fn warns_naming_both_files_when_both_exist() {
        let dir = tempfile::tempdir().unwrap();
        let (level, message) = reported(dir.path(), &ConfigMigration::BothExist);
        assert_eq!(level, tracing::Level::WARN);
        assert!(
            message.contains("CONFIG.md and Library/Config.md"),
            "{message}"
        );
        assert!(message.contains("nothing was moved"), "{message}");
    }

    #[test]
    fn reports_nothing_without_config() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(ConfigMigration::NotNeeded.report(dir.path()), None);
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
        let result = migrate_config_page(dir.path(), "");
        assert!(matches!(result, ConfigMigration::Skipped(_)), "{result:?}");
        let (level, message) = reported(dir.path(), &result);
        assert_eq!(level, tracing::Level::WARN);
        assert!(message.contains("Move it by hand"), "{message}");
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
        let result = migrate_config_page(dir.path(), "");
        assert!(matches!(result, ConfigMigration::Skipped(_)), "{result:?}");
        assert!(reported(dir.path(), &result).1.contains("library"));
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
