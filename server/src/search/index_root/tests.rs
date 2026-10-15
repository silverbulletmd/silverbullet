use super::*;

#[test]
fn locations_take_only_one_safe_component() {
    let root = IndexRoot::in_data_root(Path::new("/data"));
    assert_eq!(root.path(), Path::new("/data/search/indexes"));
    for id in [
        "0f6c2b9e-1d4a-4c1b-9a8e-2b6f1e9d0c3a",
        "notes",
        "work_2",
        "a.b",
    ] {
        assert!(
            matches!(root.location(id), Location::Disk(p) if p == root.path().join(id)),
            "{id}"
        );
    }
    let long = "x".repeat(129);
    for id in [
        "",
        ".",
        "..",
        ".hidden",
        "a/b",
        "a\\b",
        "C:",
        "C:x",
        "/abs",
        "../x",
        "a b",
        "é",
        long.as_str(),
    ] {
        assert!(matches!(root.location(id), Location::Memory), "{id:?}");
    }
}

/// A directory that can't be removed yet (a commit still writing) is
/// removed once it can be.
#[cfg(unix)]
#[test]
fn removing_a_space_retries_until_the_directory_can_be_deleted() {
    use std::os::unix::fs::PermissionsExt;
    let data = tempfile::tempdir().unwrap();
    let root = IndexRoot::in_data_root(data.path());
    let space = root.path().join("fern");
    let schema = space.join("fulltext-v2");
    std::fs::create_dir_all(&schema).unwrap();
    std::fs::write(schema.join("meta.json"), "{}").unwrap();
    // No write permission: its files can't be unlinked for now.
    std::fs::set_permissions(&schema, std::fs::Permissions::from_mode(0o500)).unwrap();
    if std::fs::write(schema.join("probe"), "x").is_ok() {
        // Permissions don't bind (running as root): nothing to retry.
        std::fs::set_permissions(&schema, std::fs::Permissions::from_mode(0o700)).unwrap();
        return;
    }
    let unlock = {
        let schema = schema.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(600));
            std::fs::set_permissions(&schema, std::fs::Permissions::from_mode(0o700)).unwrap();
        })
    };
    root.remove_space_now("fern");
    unlock.join().unwrap();
    assert!(!space.exists(), "removed after the retries");
    root.remove_space_now("never-indexed");
    root.remove_space_now("..");
    assert!(root.path().is_dir(), "an unsafe id removes nothing");
}

#[test]
fn index_dirs_are_removed_only_inside_the_indexes_directory() {
    let root = tempfile::tempdir().unwrap();
    let indexes = root.path().join("search/indexes");
    std::fs::create_dir_all(indexes.join("gone/fulltext-v2")).unwrap();
    std::fs::create_dir_all(root.path().join("outside")).unwrap();
    assert!(remove_index_dir(&indexes, &indexes.join("gone")).unwrap());
    assert!(!indexes.join("gone").exists());
    assert!(!remove_index_dir(&indexes, &indexes.join("missing")).unwrap());
    for dir in [
        indexes.clone(),
        indexes.join(".."),
        indexes.join("../../outside"),
        root.path().join("outside"),
    ] {
        assert!(
            !remove_index_dir(&indexes, &dir).unwrap(),
            "{}",
            dir.display()
        );
    }
    assert!(indexes.is_dir() && root.path().join("outside").is_dir());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.path().join("outside"), indexes.join("link")).unwrap();
        assert!(!remove_index_dir(&indexes, &indexes.join("link")).unwrap());
        assert!(root.path().join("outside").is_dir());
    }
}

#[test]
fn sweeping_removes_orphans_and_old_formats_only() {
    let root = tempfile::tempdir().unwrap();
    let indexes = root.path().join("search/indexes");
    let current = silverbullet_server_search::fulltext::SCHEMA_DIR;
    for dir in [
        format!("live/{current}"),
        "live/fulltext-v1".to_string(),
        "live/notes".to_string(),
        format!("skipped/{current}"),
        format!("orphan/{current}"),
        "orphan/fulltext-v1".to_string(),
        "odd name/fulltext-v1".to_string(),
        ".hidden/fulltext-v1".to_string(),
        "empty".to_string(),
        "not-an-index/cache".to_string(),
        "mixed/fulltext-v1".to_string(),
        "old-only/fulltext-v1".to_string(),
        "live/semantic-v1".to_string(),
        "live/semantic-v0".to_string(),
        "semantic-only/semantic-v1".to_string(),
        "both-kinds/fulltext-v1".to_string(),
        "both-kinds/semantic-v1".to_string(),
        "semantic-mixed/semantic-v1".to_string(),
        "skipped/semantic-v1".to_string(),
    ] {
        std::fs::create_dir_all(indexes.join(dir)).unwrap();
    }
    std::fs::write(indexes.join(format!("live/{current}/meta.json")), "{}").unwrap();
    std::fs::write(indexes.join("stray.txt"), "x").unwrap();
    std::fs::write(indexes.join("mixed/notes.txt"), "x").unwrap();
    std::fs::write(indexes.join("semantic-mixed/notes.txt"), "x").unwrap();
    std::fs::create_dir_all(root.path().join("outside/fulltext-v1")).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.path().join("outside"), indexes.join("linked")).unwrap();
        std::os::unix::fs::symlink(
            root.path().join("outside/fulltext-v1"),
            indexes.join("live/fulltext-v0"),
        )
        .unwrap();
        std::fs::create_dir_all(indexes.join("linked-schema")).unwrap();
        std::os::unix::fs::symlink(
            root.path().join("outside/fulltext-v1"),
            indexes.join("linked-schema/fulltext-v1"),
        )
        .unwrap();
        std::os::unix::fs::symlink(
            root.path().join("outside/fulltext-v1"),
            indexes.join("live/semantic-v9"),
        )
        .unwrap();
    }

    IndexRoot::in_data_root(root.path()).sweep(&|id| matches!(id, "live" | "skipped"));

    assert!(!indexes.join("orphan").exists());
    assert!(!indexes.join("old-only").exists());
    // Not shaped like an index: someone else's data.
    assert!(indexes.join("empty").is_dir());
    assert!(indexes.join("not-an-index/cache").is_dir());
    assert!(indexes.join("mixed/fulltext-v1").is_dir());
    assert!(indexes.join("mixed/notes.txt").is_file());
    assert!(!indexes.join("live/fulltext-v1").exists());
    assert!(indexes.join(format!("live/{current}/meta.json")).is_file());
    assert!(indexes.join("live/notes").is_dir());
    assert!(
        indexes.join("live/semantic-v1").is_dir(),
        "the current semantic schema stays"
    );
    assert!(
        !indexes.join("live/semantic-v0").exists(),
        "an old semantic schema goes"
    );
    assert!(
        !indexes.join("semantic-only").exists(),
        "an orphan with only a semantic index goes"
    );
    assert!(
        !indexes.join("both-kinds").exists(),
        "an orphan with both indexes goes"
    );
    assert!(
        indexes.join("semantic-mixed/semantic-v1").is_dir(),
        "shares with other data"
    );
    assert!(
        indexes.join("skipped/semantic-v1").is_dir(),
        "a skipped space keeps it"
    );
    assert!(indexes.join(format!("skipped/{current}")).is_dir());
    assert!(indexes.join("odd name/fulltext-v1").is_dir());
    assert!(indexes.join(".hidden/fulltext-v1").is_dir());
    assert!(indexes.join("stray.txt").is_file());
    assert!(root.path().join("outside/fulltext-v1").is_dir());
    #[cfg(unix)]
    assert!(indexes.join("linked-schema/fulltext-v1").exists());
    #[cfg(unix)]
    assert!(
        indexes.join("live/semantic-v9").exists(),
        "a symlinked schema directory is never followed or removed"
    );
    // A missing index root is nothing to sweep.
    IndexRoot::in_data_root(&root.path().join("missing")).sweep(&|_| false);
}

#[test]
fn sweeping_models_removes_only_superseded_revisions() {
    use silverbullet_server_search::semantic::catalog;
    let root = tempfile::tempdir().unwrap();
    let models = super::super::search_root(root.path()).models();
    assert_eq!(models, root.path().join("search/models"));
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    // A model the catalog no longer offers.
    let dropped = "bge-small-en-v1.5@5c38ec7c405ec4b44b94cc5a9bb96e735b38267a".to_string();
    let superseded = format!("{}@0123abcd", e5.id);
    for dir in [
        e5.dir_name(),
        superseded.clone(),
        dropped.clone(),
        "custom@1".into(),
        "notes".into(),
    ] {
        std::fs::create_dir_all(models.join(dir)).unwrap();
    }
    sweep_models(&models);
    assert!(models.join(e5.dir_name()).is_dir());
    assert!(!models.join(&superseded).exists());
    assert!(
        models.join(&dropped).is_dir(),
        "a model outside the catalog stays"
    );
    assert!(models.join("custom@1").is_dir() && models.join("notes").is_dir());
    #[cfg(unix)]
    {
        // A symlinked old revision is never followed or removed.
        std::fs::create_dir_all(root.path().join("elsewhere")).unwrap();
        let linked = models.join(format!("{}@fedcba98", e5.id));
        std::os::unix::fs::symlink(root.path().join("elsewhere"), &linked).unwrap();
        sweep_models(&models);
        assert!(linked.exists() && root.path().join("elsewhere").is_dir());
    }
    sweep_models(&root.path().join("missing/search/models"));
}

#[test]
fn a_removal_fence_holds_until_every_guard_drops() {
    let removals = Removals::default();
    let outer = removals.start("4f1d-orchard");
    let inner = removals.start("4f1d-orchard");
    assert!(removals.contains("4f1d-orchard"));
    assert!(!removals.contains("4f1d-garden"));
    removals.wait("4f1d-garden");
    drop(inner);
    assert!(
        removals.contains("4f1d-orchard"),
        "one guard still holds it"
    );
    let waiter = {
        let removals = removals.clone();
        std::thread::spawn(move || removals.wait("4f1d-orchard"))
    };
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(!waiter.is_finished(), "waits while fenced");
    drop(outer);
    waiter.join().unwrap();
    assert!(!removals.contains("4f1d-orchard"));
}
