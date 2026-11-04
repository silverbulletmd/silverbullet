//! `sb space`: listing, adding, creating, moving and removing spaces.

use super::*;

#[test]
fn space_ls_empty_config() {
    let cfg = tempfile::tempdir().unwrap();
    assert_eq!(
        run_sb(&["space", "ls"], cfg.path()).stdout_text().trim(),
        "[]"
    );
    let out = run_sb(&["space", "ls", "--text"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout_text().contains("No spaces configured"),
        "got stdout: {:?}",
        out.stdout
    );
}

#[test]
fn space_rm_missing_errors() {
    let cfg = tempfile::tempdir().unwrap();
    let out = run_sb(&["space", "rm", "does-not-exist"], cfg.path());
    assert_ne!(out.code, 0, "expected non-zero exit");
    assert!(
        out.stderr.contains("is not available"),
        "got stderr: {:?}",
        out.stderr
    );
}

/// Make `sb` see an installed (not running) SilverBullet Desktop: folder-space
/// management requires one. The launch program only has to exist.
fn install_desktop_stub(config_home: &std::path::Path) {
    let dir = config_home.join("silverbullet");
    std::fs::create_dir_all(&dir).unwrap();
    let host = serde_json::json!({
        "version": 1,
        "runtime": dir.join("runtime.json"),
        "launch": [std::env::current_exe().unwrap()],
        "open": "silverbullet://open?path={path}",
    });
    std::fs::write(dir.join("desktop-host.json"), host.to_string()).unwrap();
}

#[test]
fn folder_space_management_requires_desktop_but_listing_and_removal_do_not() {
    let cfg = tempfile::tempdir().unwrap();
    let spaces = tempfile::tempdir().unwrap();
    let folder = spaces.path().join("harbor");
    std::fs::create_dir(&folder).unwrap();
    for args in [
        vec![
            "space",
            "create",
            spaces.path().join("atlas").to_str().unwrap(),
        ],
        vec!["space", "add", folder.to_str().unwrap()],
    ] {
        let out = run_sb(&args, cfg.path());
        assert_ne!(out.code, 0, "{args:?}");
        assert!(
            out.stderr.contains("requires SilverBullet Desktop"),
            "{}",
            out.stderr
        );
    }
    assert!(
        !spaces.path().join("atlas").exists(),
        "nothing created without Desktop"
    );

    // Entries left behind by an uninstalled Desktop.
    let dir = cfg.path().join("silverbullet");
    std::fs::create_dir_all(&dir).unwrap();
    let folder_path = std::fs::canonicalize(&folder).unwrap();
    std::fs::write(
        dir.join("config.json"),
        serde_json::json!({"spaces": [
            {"id": "id-harbor", "name": "harbor", "folderPath": folder_path, "auth": {"method": "none"}},
            {"id": "id-web", "name": "web", "url": "https://notes.example.com", "auth": {"method": "none"}},
        ]})
        .to_string(),
    )
    .unwrap();
    let moved = spaces.path().join("harbor-moved");
    for args in [
        vec!["space", "rename", "harbor", "harbor-2"],
        vec!["space", "mv", "harbor", moved.to_str().unwrap()],
        vec![
            "space",
            "relocate",
            "harbor",
            spaces.path().to_str().unwrap(),
            "--force",
        ],
    ] {
        let out = run_sb(&args, cfg.path());
        assert_ne!(out.code, 0, "{args:?}");
        assert!(
            out.stderr.contains("requires SilverBullet Desktop"),
            "{}",
            out.stderr
        );
    }
    assert!(
        folder.is_dir() && !moved.exists(),
        "nothing moved without Desktop"
    );

    let list: serde_json::Value =
        serde_json::from_slice(&run_sb(&["space", "ls"], cfg.path()).stdout).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(
        run_sb(&["space", "rename", "web", "web-2"], cfg.path()).code,
        0
    );
    let out = run_sb(&["space", "rm", "harbor"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(folder.is_dir(), "removing never deletes files");
}

#[test]
fn space_create_then_add_round_trip() {
    let cfg = tempfile::tempdir().unwrap();
    install_desktop_stub(cfg.path());
    let spaces = tempfile::tempdir().unwrap();
    let new = spaces.path().join("harbor");
    let out = run_sb(
        &["space", "create", new.to_str().unwrap(), "--json"],
        cfg.path(),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let created: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(created["name"], "harbor");
    assert!(new.is_dir());

    let missing = spaces.path().join("missing");
    let out = run_sb(&["space", "add", missing.to_str().unwrap()], cfg.path());
    assert_ne!(out.code, 0);
    assert!(out.stderr.contains("sb space create"), "{}", out.stderr);
    assert!(!missing.exists());

    let registry: serde_json::Value = serde_json::from_slice(
        &std::fs::read(cfg.path().join("silverbullet/config.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(registry["spaces"][0]["env"]["shellBackend"], "off");
    assert_eq!(registry["spaces"][0]["env"]["revisions"], "managed");
}

#[test]
fn space_ls_json_lists_entries() {
    let cfg = tempfile::tempdir().unwrap();
    install_desktop_stub(cfg.path());
    let out = run_sb(&["space", "ls", "--json"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert_eq!(out.stdout_text().trim(), "[]");
    let spaces = tempfile::tempdir().unwrap();
    let folder = spaces.path().join("harbor");
    assert_eq!(
        run_sb(&["space", "create", folder.to_str().unwrap()], cfg.path()).code,
        0
    );
    assert_eq!(
        run_sb(&["space", "rename", "harbor", "atlas"], cfg.path()).code,
        0
    );
    let out = run_sb(&["space", "ls", "--json"], cfg.path());
    let list: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(list[0]["name"], "atlas");
    assert_eq!(list[0]["syncEnabled"], false);
    assert!(list[0]["id"].as_str().unwrap().len() == 36);
}

#[test]
fn space_mv_moves_files_and_updates_registry() {
    let cfg = tempfile::tempdir().unwrap();
    install_desktop_stub(cfg.path());
    let spaces = tempfile::tempdir().unwrap();
    let from = spaces.path().join("harbor");
    assert_eq!(
        run_sb(&["space", "create", from.to_str().unwrap()], cfg.path()).code,
        0
    );
    std::fs::write(from.join("index.md"), "# Harbor\n").unwrap();
    let to = spaces.path().join("harbor-moved");

    let dry = run_sb(
        &[
            "space",
            "mv",
            "harbor",
            to.to_str().unwrap(),
            "--dry-run",
            "--json",
        ],
        cfg.path(),
    );
    assert_eq!(dry.code, 0, "stderr: {}", dry.stderr);
    assert!(
        from.join("index.md").exists() && !to.exists(),
        "dry run must not move"
    );

    let out = run_sb(
        &["space", "mv", "harbor", to.to_str().unwrap(), "--json"],
        cfg.path(),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert_eq!(
        std::fs::read_to_string(to.join("index.md")).unwrap(),
        "# Harbor\n"
    );
    assert!(!from.exists());
    let list: serde_json::Value =
        serde_json::from_slice(&run_sb(&["space", "ls", "--json"], cfg.path()).stdout).unwrap();
    assert_eq!(
        list[0]["folderPath"].as_str().unwrap(),
        std::fs::canonicalize(&to).unwrap().to_string_lossy()
    );
}

#[test]
fn space_relocate_points_at_already_moved_folder() {
    let cfg = tempfile::tempdir().unwrap();
    install_desktop_stub(cfg.path());
    let spaces = tempfile::tempdir().unwrap();
    let from = spaces.path().join("atlas");
    assert_eq!(
        run_sb(&["space", "create", from.to_str().unwrap()], cfg.path()).code,
        0
    );
    let to = spaces.path().join("atlas-elsewhere");
    std::fs::rename(&from, &to).unwrap();
    let out = run_sb(
        &["space", "set-path", "atlas", to.to_str().unwrap()],
        cfg.path(),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let list: serde_json::Value =
        serde_json::from_slice(&run_sb(&["space", "ls", "--json"], cfg.path()).stdout).unwrap();
    assert_eq!(
        list[0]["folderPath"].as_str().unwrap(),
        std::fs::canonicalize(&to).unwrap().to_string_lossy()
    );
}

#[test]
fn space_rm_accepts_an_id() {
    let cfg = tempfile::tempdir().unwrap();
    let dir = cfg.path().join("silverbullet");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("config.json"),
        r#"{"spaces":[{"id":"id-ada","name":"Harbor","url":"https://example.invalid","auth":{"method":"none"}}]}"#,
    )
    .unwrap();
    let out = run_sb(&["space", "rm", "id-ada"], cfg.path());
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let list = run_sb(&["space", "ls", "--json"], cfg.path());
    assert_eq!(list.json().as_array().unwrap().len(), 0);
}
