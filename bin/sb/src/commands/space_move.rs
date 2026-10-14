//! `sb space mv` / `sb space relocate`: change where a folder space lives.
//!
//! All checks happen in [`plan_move`] (pure apart from filesystem reads) so
//! `--dry-run` reports exactly what a real run would do. A real run holds
//! `config.lock` across the checks, the rename and the registry write.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::space::{find_space_index, print_json};
use crate::config::{self, Config, SpaceConfig};

#[derive(Clone, Copy, Debug)]
pub enum MoveMode {
    /// Move the folder, then update the registry.
    Move,
    /// The folder was already moved; only update the registry.
    Relocate { force: bool },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePlan {
    pub id: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub moves_files: bool,
}

fn canonical_string(path: &Path) -> String {
    config::strip_verbatim(&path.to_string_lossy()).to_string()
}

pub fn plan_move(
    cfg: &Config,
    name: &str,
    target: &Path,
    mode: MoveMode,
    sync_by_id: bool,
    is_running: &dyn Fn(&SpaceConfig) -> bool,
) -> Result<MovePlan, String> {
    let space = &cfg.spaces[find_space_index(cfg, name)?];
    if space.folder_path.is_empty() || !space.url.is_empty() {
        return Err(format!("{:?} is not a folder space", space.name));
    }
    if config::is_hidden(space) {
        return Err(format!(
            "{:?} is managed by SilverBullet Desktop and cannot be moved",
            space.name
        ));
    }
    if is_running(space) {
        return Err("Space is running. Close it in SilverBullet Desktop first.".into());
    }
    if space.sync_enabled() && !sync_by_id {
        return Err(format!(
            "{:?} syncs with a remote; moving it with this SilverBullet Desktop version would disconnect sync. Update SilverBullet Desktop or turn off sync for this space first.",
            space.name
        ));
    }
    let from = space.folder_path.clone();
    let to: PathBuf = match mode {
        MoveMode::Move => {
            if std::fs::symlink_metadata(target).is_ok() {
                return Err(format!("{} already exists", target.display()));
            }
            let file_name = target
                .file_name()
                .ok_or_else(|| format!("{} has no folder name", target.display()))?;
            let parent = match target.parent() {
                Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
                _ => std::env::current_dir().map_err(|e| e.to_string())?,
            };
            let parent = std::fs::canonicalize(&parent)
                .map_err(|_| format!("parent folder {} does not exist", parent.display()))?;
            if !Path::new(&from).is_dir() {
                return Err(format!(
                    "{from} does not exist; use 'sb space relocate' if it was moved"
                ));
            }
            check_same_device(Path::new(&from), &parent)?;
            parent.join(file_name)
        }
        MoveMode::Relocate { force } => {
            let to = std::fs::canonicalize(target)
                .map_err(|_| format!("{} does not exist", target.display()))?;
            if !to.is_dir() {
                return Err(format!("{} is not a directory", to.display()));
            }
            if Path::new(&from).exists() && !force {
                return Err(format!(
                    "{from} still exists; pass --force to point the space at {} anyway",
                    to.display()
                ));
            }
            to
        }
    };
    let to = canonical_string(&to);
    if to == from {
        return Err("the space is already at that path".into());
    }
    let windows = cfg!(windows);
    if config::folder_contains(&from, &to, windows) {
        return Err(format!("{to} is inside the space's current folder"));
    }
    for other in cfg
        .spaces
        .iter()
        .filter(|s| s.id != space.id && !s.folder_path.is_empty())
    {
        if config::folder_contains(&other.folder_path, &to, windows)
            || config::folder_contains(&to, &other.folder_path, windows)
        {
            return Err(format!(
                "{to} overlaps space {:?} at {}",
                other.name, other.folder_path
            ));
        }
    }
    Ok(MovePlan {
        id: space.id.clone(),
        name: space.name.clone(),
        from,
        to,
        moves_files: matches!(mode, MoveMode::Move),
    })
}

#[cfg(unix)]
fn check_same_device(from: &Path, to_parent: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let dev = |p: &Path| {
        std::fs::metadata(p)
            .map(|m| m.dev())
            .map_err(|e| e.to_string())
    };
    if dev(from)? != dev(to_parent)? {
        return Err(cross_device_error());
    }
    Ok(())
}

#[cfg(not(unix))]
fn check_same_device(_from: &Path, _to_parent: &Path) -> Result<(), String> {
    Ok(()) // `rename` reports a cross-volume move; see `space_move`.
}

fn cross_device_error() -> String {
    "the target is on a different disk; copy the folder yourself, then run 'sb space relocate'"
        .into()
}

pub fn space_move(
    name: &str,
    target: &str,
    mode: MoveMode,
    dry_run: bool,
    json: bool,
) -> Result<(), String> {
    let _lock = config::lock(&config::config_dir())?;
    let mut cfg = config::load()?;
    // Remote spaces get plan_move's "not a folder space" error instead.
    if cfg
        .spaces
        .get(find_space_index(&cfg, name)?)
        .is_some_and(|s| s.url.is_empty() && !s.folder_path.is_empty())
    {
        crate::commands::space::require_desktop()?;
    }
    let plan = plan_move(
        &cfg,
        name,
        Path::new(target),
        mode,
        config::sync_state_keyed_by_id(),
        &|s| crate::commands::space::running_port(s).is_some(),
    )?;
    if !dry_run {
        if plan.moves_files {
            std::fs::rename(&plan.from, &plan.to).map_err(|e| {
                if e.kind() == std::io::ErrorKind::CrossesDevices {
                    cross_device_error()
                } else {
                    format!("moving {} to {}: {e}", plan.from, plan.to)
                }
            })?;
        }
        let entry = cfg
            .spaces
            .iter_mut()
            .find(|s| s.id == plan.id)
            .expect("planned space exists under the lock");
        entry.folder_path = plan.to.clone();
        if let Err(error) = config::save(&cfg) {
            if plan.moves_files {
                if let Err(undo) = std::fs::rename(&plan.to, &plan.from) {
                    return Err(format!(
                        "{error}; also could not move the folder back ({undo}): it is now at {}",
                        plan.to
                    ));
                }
            }
            return Err(error);
        }
    }
    if json {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Report<'a> {
            #[serde(flatten)]
            plan: &'a MovePlan,
            dry_run: bool,
        }
        return print_json(&Report {
            plan: &plan,
            dry_run,
        });
    }
    let verb = match (dry_run, plan.moves_files) {
        (true, true) => "Would move",
        (true, false) => "Would point",
        (false, true) => "Moved",
        (false, false) => "Pointed",
    };
    println!("{verb} space {:?}: {} -> {}", plan.name, plan.from, plan.to);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder_space(name: &str, path: &Path) -> SpaceConfig {
        SpaceConfig {
            id: format!("id-{name}"),
            name: name.into(),
            folder_path: std::fs::canonicalize(path)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            ..Default::default()
        }
    }

    fn setup() -> (tempfile::TempDir, Config) {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("harbor")).unwrap();
        std::fs::create_dir(tmp.path().join("atlas")).unwrap();
        let cfg = Config {
            spaces: vec![
                folder_space("harbor", &tmp.path().join("harbor")),
                folder_space("atlas", &tmp.path().join("atlas")),
            ],
        };
        (tmp, cfg)
    }

    const IDLE: &dyn Fn(&SpaceConfig) -> bool = &|_| false;

    #[test]
    fn mv_plans_canonical_target() {
        let (tmp, cfg) = setup();
        let plan = plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("harbor-2"),
            MoveMode::Move,
            false,
            IDLE,
        )
        .unwrap();
        let parent = std::fs::canonicalize(tmp.path()).unwrap();
        assert_eq!(plan.to, parent.join("harbor-2").to_string_lossy());
        assert!(plan.moves_files);
    }

    #[test]
    fn mv_refuses_existing_target_and_missing_parent() {
        let (tmp, cfg) = setup();
        std::fs::create_dir(tmp.path().join("taken")).unwrap();
        assert!(plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("taken"),
            MoveMode::Move,
            false,
            IDLE
        )
        .unwrap_err()
        .contains("already exists"));
        assert!(plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("no/such/dir"),
            MoveMode::Move,
            false,
            IDLE
        )
        .unwrap_err()
        .contains("parent"));
    }

    #[test]
    fn mv_refuses_nesting() {
        let (tmp, cfg) = setup();
        let into_other = plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("atlas/harbor"),
            MoveMode::Move,
            false,
            IDLE,
        )
        .unwrap_err();
        assert!(into_other.contains("atlas"), "{into_other}");
        let into_self = plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("harbor/sub"),
            MoveMode::Move,
            false,
            IDLE,
        )
        .unwrap_err();
        assert!(into_self.contains("inside"), "{into_self}");
    }

    #[test]
    fn mv_refuses_running_space() {
        let (tmp, cfg) = setup();
        let err = plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("x"),
            MoveMode::Move,
            false,
            &|_| true,
        )
        .unwrap_err();
        assert!(err.contains("Close it in SilverBullet Desktop"), "{err}");
    }

    #[test]
    fn mv_sync_requires_marker() {
        let (tmp, mut cfg) = setup();
        cfg.spaces[0]
            .extra
            .insert("sync".into(), serde_json::json!({"enabled": true}));
        let err = plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("x"),
            MoveMode::Move,
            false,
            IDLE,
        )
        .unwrap_err();
        assert!(err.contains("sync"), "{err}");
        assert!(plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("x"),
            MoveMode::Move,
            true,
            IDLE
        )
        .is_ok());
    }

    #[test]
    fn relocate_requires_existing_target_and_force_when_old_remains() {
        let (tmp, cfg) = setup();
        std::fs::create_dir(tmp.path().join("moved")).unwrap();
        let relocate = |target: &str, force: bool| {
            plan_move(
                &cfg,
                "harbor",
                &tmp.path().join(target),
                MoveMode::Relocate { force },
                false,
                IDLE,
            )
        };
        assert!(relocate("missing", false)
            .unwrap_err()
            .contains("does not exist"));
        let err = relocate("moved", false).unwrap_err();
        assert!(err.contains("--force"), "{err}");
        assert!(!relocate("moved", true).unwrap().moves_files);
    }

    #[test]
    fn remote_and_hidden_spaces_cannot_move() {
        let (tmp, mut cfg) = setup();
        cfg.spaces.push(SpaceConfig {
            name: "web".into(),
            url: "https://x.example.com".into(),
            ..Default::default()
        });
        assert!(plan_move(
            &cfg,
            "web",
            &tmp.path().join("x"),
            MoveMode::Move,
            false,
            IDLE
        )
        .unwrap_err()
        .contains("folder space"));
        cfg.spaces[0]
            .extra
            .insert("ephemeral".into(), serde_json::json!({"entryFile": "a.md"}));
        assert!(plan_move(
            &cfg,
            "harbor",
            &tmp.path().join("x"),
            MoveMode::Move,
            false,
            IDLE
        )
        .is_err());
    }

    #[test]
    fn relocate_refuses_overlap_and_same_path() {
        let (tmp, cfg) = setup();
        let relocate = |target: &Path| {
            plan_move(
                &cfg,
                "harbor",
                target,
                MoveMode::Relocate { force: true },
                false,
                IDLE,
            )
        };
        assert!(relocate(&tmp.path().join("atlas"))
            .unwrap_err()
            .contains("atlas"));
        assert!(relocate(&tmp.path().join("harbor"))
            .unwrap_err()
            .contains("already"));
        assert!(relocate(tmp.path()).unwrap_err().contains("overlaps"));
    }
}
