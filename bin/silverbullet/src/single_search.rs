//! Where a single-space server keeps search: in RAM by default; with
//! `SB_SEARCH_DIR`, a writable folder outside the space holding the
//! full-text index, and with `SB_SEARCH_MODEL` also the model and the
//! semantic index. The space folder itself is never written by search, so
//! it may stay read-only. There is no implicit default folder: a container
//! would lose it silently. With a model, the space follows the default, as
//! any space does: on, unless it is too large (decided when it opens).

use std::path::{Path, PathBuf};

use silverbullet_server::multi::data_root::search_dir_conflict;
use silverbullet_server::search::{SearchRoot, SpaceSearch};
use silverbullet_server_search::semantic::catalog;

use crate::single::SINGLE_SPACE_ID;

pub(crate) fn configure(
    space_folder: &Path,
    search_dir: Option<&str>,
    search_model: Option<&str>,
) -> Result<SpaceSearch, String> {
    let Some(dir) = search_dir.map(PathBuf::from) else {
        if let Some(model) = search_model {
            return Err(format!(
                "SB_SEARCH_MODEL={model} needs SB_SEARCH_DIR, a writable folder outside the space for the model and the search indexes"
            ));
        }
        return Ok(SpaceSearch::in_memory());
    };
    if let Some(reason) = search_dir_conflict(space_folder, &dir) {
        return Err(format!(
            "SB_SEARCH_DIR {} can't be used: {reason}",
            dir.display()
        ));
    }
    let spec = match search_model {
        None => None,
        Some(id) => {
            Some(catalog::resolve(id).map_err(|unknown| format!("SB_SEARCH_MODEL {unknown}"))?)
        }
    };
    writable(&dir)?;
    let live = |id: &str| id == SINGLE_SPACE_ID;
    let search = SpaceSearch::in_root(SearchRoot::new(&dir)).boot(spec, Some(&live));
    tracing::info!("Search: indexes in {}", dir.display());
    Ok(search)
}

/// Creates `dir` and proves a file can be written there, so a typo or a
/// read-only mount fails at startup instead of leaving search in RAM.
fn writable(dir: &Path) -> Result<(), String> {
    let refuse = |error: std::io::Error| {
        format!(
            "SB_SEARCH_DIR {} isn't a writable folder: {error}",
            dir.display()
        )
    };
    std::fs::create_dir_all(dir).map_err(refuse)?;
    let probe = dir.join(format!(".write-probe-{}", std::process::id()));
    std::fs::write(&probe, b"").map_err(refuse)?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let space = dir.path().join("Orchard");
        std::fs::create_dir_all(&space).unwrap();
        std::fs::write(space.join("index.md"), "# Orchard").unwrap();
        (dir, space)
    }

    #[test]
    fn without_a_search_dir_nothing_changes() {
        let (_dir, space) = space();
        let search = configure(&space, None, None).unwrap();
        assert!(search.root().is_none());
        assert!(search.model().is_none());
    }

    #[test]
    fn a_model_without_a_search_dir_refuses_to_start() {
        let (_dir, space) = space();
        let error = configure(&space, None, Some("multilingual-e5-small"))
            .err()
            .unwrap();
        assert!(error.contains("SB_SEARCH_DIR"), "{error}");
    }

    #[test]
    fn a_search_dir_inside_the_space_refuses_to_start() {
        let (_dir, space) = space();
        let inside = space.join("search");
        let error = configure(&space, inside.to_str(), None).err().unwrap();
        assert!(error.contains("inside the space folder"), "{error}");
        assert!(!inside.exists(), "nothing created in the space");
    }

    #[test]
    fn an_unknown_model_refuses_to_start_and_lists_the_known_ones() {
        let (dir, space) = space();
        let search_dir = dir.path().join("orchard-search");
        let error = configure(&space, search_dir.to_str(), Some("pear-embed"))
            .err()
            .unwrap();
        assert!(
            error.contains("pear-embed") && error.contains("multilingual-e5-small"),
            "{error}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_unwritable_search_dir_refuses_to_start() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, space) = space();
        let locked = dir.path().join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root ignores permissions: nothing to test then.
        if std::fs::write(locked.join("probe"), b"").is_ok() {
            return;
        }
        let error = configure(&space, locked.join("search").to_str(), None)
            .err()
            .unwrap();
        assert!(error.contains("SB_SEARCH_DIR"), "{error}");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_search_dir_persists_the_indexes_outside_the_space() {
        let (dir, space) = space();
        let search_dir = dir.path().join("orchard-search");
        let search = configure(&space, search_dir.to_str(), None).unwrap();
        assert_eq!(
            search.root().map(|r| r.path().to_path_buf()),
            Some(search_dir.clone())
        );
        assert!(search.model().is_none());
        assert!(search_dir.is_dir());
        assert!(
            std::fs::read_dir(&search_dir).unwrap().all(|e| {
                let name = e.unwrap().file_name();
                name == "indexes" || name == "models"
            }),
            "the write probe leaves nothing behind"
        );
    }
}
