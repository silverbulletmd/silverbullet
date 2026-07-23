//! First-run provisioning: the single implementation behind the setup
//! wizard, the HTTP setup API, and the CLI. Creates `users.json` and
//! `spaces.json` from scratch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::multi::config::{MultiConfig, SpaceConfig};
use crate::multi::instance::{resolve_folder, seed_index};
use crate::multi::users::{UserEntry, UsersConfig, USERS_FILE};
use crate::multi::validate::{validate, FieldError};

const SPACES_FILE: &str = "spaces.json";

/// The first space to create alongside the admin account, if any.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstSpace {
    pub name: String,
    /// `"/"` binds at the root; anything else is a URL prefix. Must not be
    /// empty (empty is ambiguous between "root" and "no prefix picked yet").
    pub prefix: String,
    /// Empty = default (`spaces/<id>` under the root).
    #[serde(default)]
    pub folder: String,
}

/// Everything needed to provision a brand-new server root: the admin account
/// plus an optional first space.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    pub admin_username: String,
    pub admin_password: String,
    #[serde(default)]
    pub space: Option<FirstSpace>,
}

fn err(field: &str, message: impl Into<String>) -> Vec<FieldError> {
    vec![FieldError {
        field: field.into(),
        message: message.into(),
    }]
}

/// Whether this server root has already been provisioned (`users.json`
/// exists). Multi-space mode refuses to boot without it; setup refuses to
/// run again once it's there.
pub fn is_configured(root: &Path) -> bool {
    root.join(USERS_FILE).exists()
}

/// Absolute, canonicalized form of a path — the data root the wizard shows
/// the user, and the yardstick the portability guard measures a submitted
/// folder against. Falls back gracefully when the path (or a leading chunk of
/// it) doesn't exist yet: canonicalize the nearest existing ancestor and
/// re-attach the missing tail, or, failing even that, absolutize without
/// touching the filesystem. Resolving symlinks matters on macOS, where a raw
/// `/tmp/...` or `/var/...` canonicalizes to `/private/tmp/...` — comparing
/// non-canonical paths there would wrongly conclude a folder lies outside the
/// root.
pub(crate) fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(c) = std::fs::canonicalize(path) {
        return c;
    }
    // Walk up to the nearest existing ancestor, canonicalize it, then rejoin
    // the not-yet-existing tail we walked past.
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = path;
    while let Some(parent) = cur.parent() {
        if let Some(name) = cur.file_name() {
            tail.push(name.to_os_string());
        }
        if let Ok(mut c) = std::fs::canonicalize(parent) {
            for seg in tail.iter().rev() {
                c.push(seg);
            }
            return c;
        }
        cur = parent;
    }
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Keep `spaces.json` portable: an absolute folder that lives *inside* the
/// data root is stored relative to the root (`/data/spaces/notes` with root
/// `/data` becomes `spaces/notes`), so moving the whole root elsewhere still
/// resolves. An absolute folder *outside* the root is stored verbatim (it's a
/// deliberate external mount), and a relative folder is already portable.
/// Compares canonicalized forms so symlinked temp dirs (macOS `/tmp` vs
/// `/private/tmp`) don't defeat the containment check; the caller must have
/// already created the folder so it canonicalizes cleanly.
fn relativize_folder_field(root: &Path, folder: &str) -> String {
    let p = Path::new(folder);
    if !p.is_absolute() {
        return folder.to_string();
    }
    let canon_root = canonicalize_best_effort(root);
    let canon_folder = canonicalize_best_effort(p);
    match canon_folder.strip_prefix(&canon_root) {
        Ok(rel) => rel.to_string_lossy().to_string(),
        Err(_) => folder.to_string(),
    }
}

/// Provision `root`: write a fresh `users.json` (admin account) and
/// `spaces.json` (optionally with one first space).
/// Fails closed — on any error nothing is written — except that a
/// directory may already have been created for the first space (mirrors
/// `MultiManager::create`, which has the same property).
pub fn run_setup(
    root: &Path,
    req: &SetupRequest,
    index_template: &str,
) -> Result<(), Vec<FieldError>> {
    if is_configured(root) {
        return Err(err("", "this server is already configured"));
    }

    let username = req.admin_username.trim();
    if username.is_empty() || username.contains(':') || username.contains('/') {
        return Err(err("adminUsername", "invalid username"));
    }
    if req.admin_password.is_empty() {
        return Err(err("adminPassword", "password must not be empty"));
    }

    let spaces_path = root.join(SPACES_FILE);
    let mut spaces = MultiConfig::load(&spaces_path).map_err(|e| err("", e))?;

    let password_hash =
        crate::auth::password::hash_password(&req.admin_password).map_err(|e| err("", e))?;
    let mut users = UsersConfig::default();
    users.users.insert(
        username.to_string(),
        UserEntry {
            password_hash,
            admin: true,
            tokens: BTreeMap::new(),
            extra: Default::default(),
        },
    );

    if let Some(first) = &req.space {
        let prefix = first.prefix.trim();
        if prefix.is_empty() {
            return Err(err(
                "space.prefix",
                "prefix must not be empty (use \"/\" for the root)",
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let folder_field = if first.folder.is_empty() {
            format!("spaces/{id}")
        } else {
            first.folder.clone()
        };
        let folder_path = resolve_folder(root, &id, &folder_field);
        std::fs::create_dir_all(&folder_path).map_err(|e| {
            err(
                "space.folder",
                format!("could not create folder {}: {e}", folder_path.display()),
            )
        })?;

        // Portability guard: an absolute folder inside the data root is stored
        // relative to it (the wizard now prepopulates an absolute `<root>/…`
        // path, and storing that verbatim would pin `spaces.json` to this
        // machine's layout). Runs *after* `create_dir_all` so the folder
        // exists and canonicalizes cleanly. Relativizing doesn't change where
        // files land — `resolve_folder(root, id, "spaces/notes")` resolves
        // back to the very directory we just created.
        let folder_field = relativize_folder_field(root, &folder_field);

        // Build a fresh SpaceConfig through Deserialize so every field
        // (index_page, description, theme_color, shell, ...) picks up the
        // same defaults a hand-typed spaces.json entry would get, rather
        // than duplicating those defaults here.
        let mut cfg: SpaceConfig = serde_json::from_value(serde_json::json!({
            "name": first.name,
            "binding": { "prefix": prefix },
        }))
        .map_err(|e| err("", format!("internal error building space config: {e}")))?;
        cfg.folder = folder_field;
        debug_assert!(!cfg.public);
        debug_assert!(cfg.members.is_empty());

        seed_index(
            &folder_path,
            &cfg.index_page,
            index_template,
            &cfg.space_ignore,
        );
        spaces.spaces.insert(id, cfg);
    }

    let known_users: BTreeSet<String> = users.users.keys().cloned().collect();
    let errors = validate(&spaces, root, &known_users);
    if !errors.is_empty() {
        return Err(errors);
    }

    // users.json before spaces.json: a crash in between leaves users.json
    // written (admin claimed, `is_configured()` == true) but spaces.json
    // unwritten — a safe "admin exists, no new spaces" state. The reverse
    // order would open a window where a space is persisted and served while
    // no admin account exists yet.
    users.save(&root.join(USERS_FILE)).map_err(|e| err("", e))?;
    spaces.save(&spaces_path).map_err(|e| err("", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::Binding;
    use crate::multi::users::UserStore;

    fn req(space: Option<FirstSpace>) -> SetupRequest {
        SetupRequest {
            admin_username: "zef".into(),
            admin_password: "hunter22".into(),
            space,
        }
    }

    #[cfg(unix)]
    fn assert_0600(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{}", path.display());
    }

    #[test]
    fn fresh_setup_writes_both_files_admin_and_root_space() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: "/".into(),
            folder: String::new(),
        }));
        run_setup(dir.path(), &request, "# Hello\n").unwrap();

        let users_path = dir.path().join(USERS_FILE);
        assert!(users_path.exists());
        #[cfg(unix)]
        assert_0600(&users_path);

        let store = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(store.verify_password("zef", "hunter22"));
        assert!(store.is_admin("zef"));

        let spaces_path = dir.path().join(SPACES_FILE);
        assert!(spaces_path.exists());
        #[cfg(unix)]
        assert_0600(&spaces_path);

        let cfg = MultiConfig::load(&spaces_path).unwrap();
        assert_eq!(cfg.spaces.len(), 1);
        let (id, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.name, "Notes");
        assert!(matches!(&space.binding, Binding::Prefix { prefix } if prefix == "/"));
        assert!(!space.public);
        assert!(space.members.is_empty());

        let folder = resolve_folder(dir.path(), id, &space.folder);
        assert_eq!(
            std::fs::read_to_string(folder.join("index.md")).unwrap(),
            "# Hello\n"
        );
    }

    #[test]
    fn work_prefix_variant_with_explicit_folder() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Work".into(),
            prefix: "/work".into(),
            folder: "custom/work".into(),
        }));
        run_setup(dir.path(), &request, "# Work\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        assert_eq!(cfg.spaces.len(), 1);
        let (_, space) = cfg.spaces.iter().next().unwrap();
        assert!(matches!(&space.binding, Binding::Prefix { prefix } if prefix == "/work"));
        assert_eq!(space.folder, "custom/work");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("custom/work/index.md")).unwrap(),
            "# Work\n"
        );
    }

    #[test]
    fn inside_root_absolute_folder_is_relativized() {
        // The wizard now submits an absolute `<root>/spaces/notes`. Stored
        // verbatim that would pin spaces.json to this machine; the guard must
        // relativize it back to "spaces/notes" so the config stays portable.
        let dir = tempfile::tempdir().unwrap();
        let abs = dir.path().join("spaces").join("notes");
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: "/".into(),
            folder: abs.to_string_lossy().to_string(),
        }));
        run_setup(dir.path(), &request, "# Hello\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let (_, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.folder, "spaces/notes");
        // ...and it still resolves to the same directory, seeded index and all.
        assert_eq!(
            std::fs::read_to_string(abs.join("index.md")).unwrap(),
            "# Hello\n"
        );
    }

    #[test]
    fn outside_root_absolute_folder_is_stored_verbatim() {
        // A folder on a genuinely external path is a deliberate mount — keep
        // the absolute path exactly as submitted.
        let dir = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let abs = external.path().join("notes");
        let folder = abs.to_string_lossy().to_string();
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: "/".into(),
            folder: folder.clone(),
        }));
        run_setup(dir.path(), &request, "# Hello\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let (_, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.folder, folder);
        assert!(abs.join("index.md").exists());
    }

    #[test]
    fn relative_folder_input_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Work".into(),
            prefix: "/work".into(),
            folder: "custom/work".into(),
        }));
        run_setup(dir.path(), &request, "# Work\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let (_, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.folder, "custom/work");
    }

    #[test]
    fn setup_without_a_first_space_writes_no_spaces() {
        let dir = tempfile::tempdir().unwrap();
        run_setup(dir.path(), &req(None), "# Hello\n").unwrap();
        assert!(UserStore::open(dir.path()).unwrap().is_some());
        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        assert!(cfg.spaces.is_empty());
    }

    #[test]
    fn rejects_empty_password() {
        let dir = tempfile::tempdir().unwrap();
        let mut request = req(None);
        request.admin_password = "".into();
        let errs = run_setup(dir.path(), &request, "x").unwrap_err();
        assert!(errs.iter().any(|e| e.field == "adminPassword"), "{errs:?}");
        assert!(!is_configured(dir.path()));
    }

    #[test]
    fn rejects_bad_username() {
        let dir = tempfile::tempdir().unwrap();
        for bad in ["", "  ", "with:colon", "with/slash"] {
            let mut request = req(None);
            request.admin_username = bad.into();
            let errs = run_setup(dir.path(), &request, "x").unwrap_err();
            assert!(
                errs.iter().any(|e| e.field == "adminUsername"),
                "{bad:?}: {errs:?}"
            );
        }
        assert!(!is_configured(dir.path()));
    }

    #[test]
    fn rejects_when_already_configured() {
        let dir = tempfile::tempdir().unwrap();
        UserStore::create_empty(dir.path()).unwrap();
        let errs = run_setup(dir.path(), &req(None), "x").unwrap_err();
        assert!(errs.iter().any(|e| e.field.is_empty()), "{errs:?}");
    }
}
