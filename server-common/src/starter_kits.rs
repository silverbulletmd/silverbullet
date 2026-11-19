//! Starter kits: content and config bundled into the binary and copied into a
//! newly created space. A kit is a folder under `starter-kits/` with a
//! `kit.json` manifest (never copied) and the pages to seed.

use std::path::Path;

use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};

use crate::git_starting_point;
use crate::space::DiskSpacePrimitives;
use crate::SpacePrimitives;

pub const DEFAULT_KIT: &str = "personal-space";

const MANIFEST: &str = "kit.json";
const CONFIG_PAGE: &str = "Library/Config.md";
const STANDARD_CONFIG: &str = "```space-lua\nconfig.set(\"view.defaults\", { [\"std.spaceTree\"] = { dock = \"lhs\", open = true } })\n```\n";

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../starter-kits"]
#[exclude = ".*"]
#[exclude = "*/.*"]
struct KitAssets;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InterfaceLevel {
    Minimal,
    Standard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub order: i32,
    pub interface: InterfaceLevel,
    pub has_preview: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Starter {
    Kit {
        id: String,
        #[serde(default)]
        interface: Option<InterfaceLevel>,
    },
    Git {
        url: String,
    },
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApplyOutcome {
    Applied,
    Skipped,
    None,
}

/// What happened to a new space's starter content, serialized as the
/// `starterContent` and `starterError` fields of a create response. The space
/// exists either way; `Failed` means its folder may be empty or partial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "starterContent", rename_all = "camelCase")]
pub enum StarterResult {
    Applied,
    Skipped,
    None,
    Failed {
        #[serde(rename = "starterError")]
        error: String,
    },
}

impl From<ApplyOutcome> for StarterResult {
    fn from(outcome: ApplyOutcome) -> Self {
        match outcome {
            ApplyOutcome::Applied => Self::Applied,
            ApplyOutcome::Skipped => Self::Skipped,
            ApplyOutcome::None => Self::None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StarterError {
    #[error("Unknown starter kit: {0}")]
    UnknownKit(String),
    #[error("{0}")]
    Io(String),
    #[error("Not found")]
    NotFound,
    #[error("Unsupported host")]
    UnsupportedHost,
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Archive(String),
}

impl StarterError {
    /// The create-form field this error belongs on, and the message to show.
    pub fn field_error(&self) -> (&'static str, String) {
        match self {
            Self::UnknownKit(id) => ("starter", format!("Unknown starter kit: {id}")),
            Self::NotFound => ("gitUrl", "Repository not found or not public".into()),
            Self::UnsupportedHost => ("gitUrl", "Enter a public https:// repository address. GitHub and GitLab always work; other hosts need git installed.".into()),
            Self::Network(e) => ("gitUrl", format!("Could not download the repository: {e}")),
            Self::Archive(e) | Self::Io(e) => {
                ("gitUrl", format!("Could not read the repository: {e}"))
            }
        }
    }
}

#[derive(Debug)]
pub enum PreparedStarter {
    Kit {
        id: String,
        interface: Option<InterfaceLevel>,
    },
    Files(tempfile::TempDir),
    None,
}

#[derive(Deserialize)]
struct Manifest {
    name: String,
    description: String,
    order: i32,
    interface: InterfaceLevel,
    #[serde(default)]
    preview: Option<String>,
}

fn manifest(id: &str) -> Option<Manifest> {
    let file = KitAssets::get(&format!("{id}/{MANIFEST}"))?;
    serde_json::from_slice(&file.data).ok()
}

pub fn list() -> Vec<KitInfo> {
    let mut ids: Vec<String> = KitAssets::iter()
        .filter_map(|p| {
            let (id, rest) = p.split_once('/')?;
            (rest == MANIFEST).then(|| id.to_string())
        })
        .collect();
    ids.sort();
    ids.dedup();
    let mut kits: Vec<KitInfo> = ids
        .into_iter()
        .filter_map(|id| {
            let m = manifest(&id)?;
            let has_preview = m
                .preview
                .as_ref()
                .is_some_and(|p| KitAssets::get(&format!("{id}/{p}")).is_some());
            Some(KitInfo {
                id,
                name: m.name,
                description: m.description,
                order: m.order,
                interface: m.interface,
                has_preview,
            })
        })
        .collect();
    kits.sort_by_key(|k| k.order);
    kits
}

pub fn preview(id: &str) -> Option<(Vec<u8>, String)> {
    let file_name = manifest(id)?.preview?;
    let file = KitAssets::get(&format!("{id}/{file_name}"))?;
    let mime = mime_guess::from_path(&file_name)
        .first_or_octet_stream()
        .to_string();
    Some((file.data.into_owned(), mime))
}

fn open_disk(folder: &Path, space_ignore: &str) -> Result<DiskSpacePrimitives, StarterError> {
    DiskSpacePrimitives::new(folder, space_ignore).map_err(|e| StarterError::Io(e.to_string()))
}

pub fn folder_has_notes(folder: &Path, space_ignore: &str) -> bool {
    // A status check must not write the case-sensitivity probe into the folder.
    match DiskSpacePrimitives::for_reading(folder, space_ignore) {
        Ok(disk) => disk.has_file_with_suffix(".md"),
        Err(e) => {
            tracing::warn!("could not check space state at {}: {e}", folder.display());
            false
        }
    }
}

pub fn apply_kit(
    id: &str,
    folder: &Path,
    index_page: &str,
    space_ignore: &str,
    interface: Option<InterfaceLevel>,
) -> Result<ApplyOutcome, StarterError> {
    let files = kit_files(id, index_page, interface)?;
    let disk = open_disk(folder, space_ignore)?;
    if disk.has_file_with_suffix(".md") {
        return Ok(ApplyOutcome::Skipped);
    }
    for (path, data) in &files {
        write(&disk, path, data)?;
    }
    Ok(ApplyOutcome::Applied)
}

/// The files a kit seeds, with `index.md` renamed to `index_page` and, for the
/// standard interface, the generated `Library/Config.md`.
pub fn kit_files(
    id: &str,
    index_page: &str,
    interface: Option<InterfaceLevel>,
) -> Result<Vec<(String, Vec<u8>)>, StarterError> {
    let m = manifest(id).ok_or_else(|| StarterError::UnknownKit(id.to_string()))?;
    let prefix = format!("{id}/");
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for asset in KitAssets::iter() {
        let Some(rel) = asset.strip_prefix(&prefix) else {
            continue;
        };
        if rel == MANIFEST || m.preview.as_deref() == Some(rel) {
            continue;
        }
        let Some(file) = KitAssets::get(&asset) else {
            continue;
        };
        let target = if rel == "index.md" {
            format!("{index_page}.md")
        } else {
            rel.to_string()
        };
        files.push((target, file.data.into_owned()));
    }
    if interface.unwrap_or(m.interface) == InterfaceLevel::Standard {
        match files.iter_mut().find(|(p, _)| p == CONFIG_PAGE) {
            Some((_, data)) => {
                if !data.ends_with(b"\n") {
                    data.push(b'\n');
                }
                data.push(b'\n');
                data.extend_from_slice(STANDARD_CONFIG.as_bytes());
            }
            None => files.push((CONFIG_PAGE.to_string(), STANDARD_CONFIG.as_bytes().to_vec())),
        }
    }
    Ok(files)
}

fn write(disk: &DiskSpacePrimitives, path: &str, data: &[u8]) -> Result<(), StarterError> {
    disk.write_file(path, data, None)
        .map(|_| ())
        .map_err(|e| StarterError::Io(format!("could not write {path}: {e}")))
}

pub fn prepare(starter: &Starter) -> Result<PreparedStarter, StarterError> {
    prepare_with(starter, git_starting_point::fetch)
}

/// [`prepare`] with the Git download injected, so callers can test without a
/// network.
pub fn prepare_with(
    starter: &Starter,
    fetch: impl Fn(&str, &Path) -> Result<(), StarterError>,
) -> Result<PreparedStarter, StarterError> {
    match starter {
        Starter::Kit { id, interface } => {
            if manifest(id).is_none() {
                return Err(StarterError::UnknownKit(id.clone()));
            }
            Ok(PreparedStarter::Kit {
                id: id.clone(),
                interface: *interface,
            })
        }
        Starter::Git { url } => {
            let dir = tempfile::tempdir().map_err(|e| StarterError::Io(e.to_string()))?;
            fetch(url, dir.path())?;
            Ok(PreparedStarter::Files(dir))
        }
        Starter::None => Ok(PreparedStarter::None),
    }
}

/// [`apply_prepared`] for a space that is already registered: a failure is
/// logged and reported rather than undoing the space.
pub fn apply(
    p: PreparedStarter,
    folder: &Path,
    index_page: &str,
    space_ignore: &str,
) -> StarterResult {
    match apply_prepared(p, folder, index_page, space_ignore) {
        Ok(outcome) => outcome.into(),
        Err(e) => {
            tracing::warn!("could not apply starter to {}: {e}", folder.display());
            StarterResult::Failed {
                error: e.to_string(),
            }
        }
    }
}

pub fn apply_prepared(
    p: PreparedStarter,
    folder: &Path,
    index_page: &str,
    space_ignore: &str,
) -> Result<ApplyOutcome, StarterError> {
    match p {
        PreparedStarter::Kit { id, interface } => {
            apply_kit(&id, folder, index_page, space_ignore, interface)
        }
        PreparedStarter::Files(dir) => {
            if open_disk(folder, space_ignore)?.has_file_with_suffix(".md") {
                return Ok(ApplyOutcome::Skipped);
            }
            git_starting_point::copy_tree(dir.path(), folder)?;
            Ok(ApplyOutcome::Applied)
        }
        PreparedStarter::None => Ok(ApplyOutcome::None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(id: &str, dir: &Path) -> Result<ApplyOutcome, StarterError> {
        apply_kit(id, dir, "index", "", None)
    }

    #[test]
    fn list_returns_kits_sorted_by_order() {
        let kits = list();
        let ids: Vec<&str> = kits.iter().map(|k| k.id.as_str()).collect();
        assert_eq!(ids, ["personal-space", "team-space", "blank-space"]);
        assert!(kits.windows(2).all(|w| w[0].order <= w[1].order));
    }

    #[test]
    fn assets_exclude_dotfiles() {
        assert!(KitAssets::iter().all(|p| !p.split('/').any(|s| s.starts_with('.'))));
        assert!(KitAssets::iter().any(|p| p.contains("/Library/")));
    }

    #[test]
    fn starter_result_serializes_as_create_response_fields() {
        assert_eq!(
            serde_json::to_value(StarterResult::Applied).unwrap(),
            serde_json::json!({"starterContent": "applied"})
        );
        assert_eq!(
            serde_json::to_value(StarterResult::Failed {
                error: "disk full".into()
            })
            .unwrap(),
            serde_json::json!({"starterContent": "failed", "starterError": "disk full"})
        );
    }

    #[test]
    fn preview_is_none_without_a_file() {
        assert!(preview("blank-space").is_none());
        assert!(preview("nope").is_none());
    }

    #[test]
    fn apply_writes_index_and_skips_manifest() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            apply("blank-space", dir.path()).unwrap(),
            ApplyOutcome::Applied
        );
        assert!(dir.path().join("index.md").exists());
        assert!(!dir.path().join("kit.json").exists());
    }

    #[test]
    fn apply_uses_custom_index_page() {
        let dir = tempfile::tempdir().unwrap();
        apply_kit("blank-space", dir.path(), "home", "", None).unwrap();
        assert!(dir.path().join("home.md").exists());
        assert!(!dir.path().join("index.md").exists());
    }

    #[test]
    fn apply_skips_folder_with_notes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "mine").unwrap();
        assert_eq!(
            apply("blank-space", dir.path()).unwrap(),
            ApplyOutcome::Skipped
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "mine"
        );
        assert!(!dir.path().join("index.md").exists());
    }

    #[test]
    fn apply_ignores_non_markdown_and_ignored_md() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("pic.png"), "x").unwrap();
        std::fs::create_dir_all(dir.path().join("drafts")).unwrap();
        std::fs::write(dir.path().join("drafts/x.md"), "x").unwrap();
        let out = apply_kit("blank-space", dir.path(), "index", "drafts/", None).unwrap();
        assert_eq!(out, ApplyOutcome::Applied);
        assert!(dir.path().join("index.md").exists());
    }

    #[test]
    fn standard_interface_writes_view_defaults() {
        let dir = tempfile::tempdir().unwrap();
        apply_kit(
            "blank-space",
            dir.path(),
            "index",
            "",
            Some(InterfaceLevel::Standard),
        )
        .unwrap();
        let cfg = std::fs::read_to_string(dir.path().join("Library/Config.md")).unwrap();
        assert!(cfg.contains("view.defaults") && cfg.contains("std.spaceTree"));

        let dir = tempfile::tempdir().unwrap();
        apply_kit(
            "blank-space",
            dir.path(),
            "index",
            "",
            Some(InterfaceLevel::Minimal),
        )
        .unwrap();
        assert!(!dir.path().join("Library/Config.md").exists());
    }

    #[test]
    fn kit_files_renames_index_and_omits_manifest() {
        let files = kit_files("blank-space", "home", None).unwrap();
        let names: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(names.contains(&"home.md"));
        assert!(!names.contains(&"index.md") && !names.contains(&"kit.json"));
    }

    #[test]
    fn unknown_kit_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            apply("nope", dir.path()),
            Err(StarterError::UnknownKit(_))
        ));
    }

    #[test]
    fn prepare_and_apply_prepared() {
        let kit = Starter::Kit {
            id: "blank-space".into(),
            interface: None,
        };
        let dir = tempfile::tempdir().unwrap();
        let p = prepare(&kit).unwrap();
        assert_eq!(
            apply_prepared(p, dir.path(), "index", "").unwrap(),
            ApplyOutcome::Applied
        );
        assert!(matches!(
            prepare(&Starter::Kit {
                id: "nope".into(),
                interface: None
            }),
            Err(StarterError::UnknownKit(_))
        ));
        let p = prepare(&Starter::None).unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            apply_prepared(p, dir.path(), "index", "").unwrap(),
            ApplyOutcome::None
        );
        assert!(!dir.path().join("index.md").exists());
    }

    fn git(url: &str) -> Starter {
        Starter::Git { url: url.into() }
    }

    fn stub_fetch(url: &str, dest: &Path) -> Result<(), StarterError> {
        assert_eq!(url, "https://example.com/r");
        std::fs::write(dest.join("index.md"), "from repo").unwrap();
        std::fs::create_dir_all(dest.join("Library")).unwrap();
        std::fs::write(dest.join("Library/X.md"), "x").unwrap();
        Ok(())
    }

    #[test]
    fn prepare_with_git_fetches_then_applies_as_is() {
        let p = prepare_with(&git("https://example.com/r"), stub_fetch).unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            apply_prepared(p, dir.path(), "home", "").unwrap(),
            ApplyOutcome::Applied
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("index.md")).unwrap(),
            "from repo"
        );
        assert!(dir.path().join("Library/X.md").exists());
        assert!(!dir.path().join("home.md").exists());
    }

    #[test]
    fn apply_prepared_files_skips_folder_with_notes() {
        let p = prepare_with(&git("https://example.com/r"), stub_fetch).unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "mine").unwrap();
        assert_eq!(
            apply_prepared(p, dir.path(), "index", "").unwrap(),
            ApplyOutcome::Skipped
        );
        assert!(!dir.path().join("index.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn apply_reports_a_failed_write_without_relabeling_it() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = prepare(&Starter::Kit {
            id: "blank-space".into(),
            interface: None,
        })
        .unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = super::apply(p, dir.path(), "index", "");
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let StarterResult::Failed { error } = result else {
            panic!("expected a failure, got {result:?}");
        };
        assert!(!error.contains("repository"), "{error}");
    }

    #[test]
    fn prepare_with_propagates_fetch_errors() {
        let r = prepare_with(&git("https://example.com/r"), |_, _| {
            Err(StarterError::NotFound)
        });
        assert!(matches!(r, Err(StarterError::NotFound)));
    }
}
