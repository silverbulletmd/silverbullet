//! First-run provisioning: the single implementation behind the setup
//! wizard, the HTTP setup API, and the CLI. Creates `users.json` and
//! `spaces.json` from scratch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::multi::config::{Binding, MultiConfig, SpaceAccess, SpaceConfig};
use crate::multi::instance::{resolve_folder, seed_index};
use crate::multi::server_config::ServerConfig;
use crate::multi::users::{Profile, UserEntry, UsersConfig, USERS_FILE};
use crate::multi::validate::FieldError;

const SPACES_FILE: &str = "spaces.json";

/// The first space to create alongside the admin account, if any.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstSpace {
    pub name: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub host: Option<String>,
    /// Empty = default (`spaces/<id>` under the root).
    #[serde(default)]
    pub folder: String,
    #[serde(default = "default_revisions")]
    pub revisions: silverbullet_server_common::RevisionsMode,
}

fn default_revisions() -> silverbullet_server_common::RevisionsMode {
    silverbullet_server_common::RevisionsMode::Managed
}

/// Everything needed to provision a brand-new server root: the admin account
/// plus an optional first space.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    #[serde(default)]
    pub primary_url: Option<String>,
    pub admin_username: String,
    pub admin_password: String,
    #[serde(default)]
    pub admin_full_name: String,
    #[serde(default)]
    pub admin_email: String,
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
    let profile = Profile {
        full_name: crate::auth::clean_full_name(&req.admin_full_name)
            .map_err(|e| err("adminFullName", e))?,
        email: crate::auth::clean_email(&req.admin_email).map_err(|e| err("adminEmail", e))?,
    };

    let spaces_path = root.join(SPACES_FILE);
    let mut spaces = MultiConfig::load(&spaces_path).map_err(|e| err("", e))?;

    let password_hash =
        crate::auth::password::hash_password(&req.admin_password).map_err(|e| err("", e))?;
    let mut users = UsersConfig::default();
    users.users.insert(
        username.to_string(),
        UserEntry {
            password_hash: Some(password_hash),
            sso: None,
            admin: true,
            disabled: false,
            full_name: profile.full_name,
            email: profile.email,
            tokens: BTreeMap::new(),
            session_epoch: 0,
            account_generation: Some(uuid::Uuid::new_v4().to_string()),
            last_login: None,
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
        if let Some(host) = first.host.as_deref() {
            if host.trim().is_empty() {
                return Err(err("space.host", "hostname must not be empty"));
            }
            if !super::validate::valid_host_authority(host) {
                return Err(err(
                    "space.host",
                    "host must be an ASCII DNS name or canonical IPv4 address, optionally followed by a port from 1 to 65535",
                ));
            }
        }
        let binding_value = match &first.host {
            Some(host) => serde_json::json!({ "host": host, "prefix": prefix }),
            None => serde_json::json!({ "prefix": prefix }),
        };
        let binding: Binding = serde_json::from_value(binding_value)
            .map_err(|e| err("space.binding", format!("invalid binding: {e}")))?;

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

        // Store folders inside the data root relatively so spaces.json stays portable.
        // Run after creation so canonicalization can resolve the full path.
        let folder_field = relativize_folder_field(root, &folder_field);

        // Build through Deserialize so shared fields retain the same defaults
        // as hand-written config, then apply the new-space revisions policy.
        let mut cfg: SpaceConfig = serde_json::from_value(serde_json::json!({
            "name": first.name,
            "binding": binding,
        }))
        .map_err(|e| err("", format!("internal error building space config: {e}")))?;
        cfg.folder = folder_field;
        cfg.revisions = first.revisions;
        cfg.normalize();
        debug_assert!(cfg.access() == SpaceAccess::None);
        debug_assert!(cfg.members.is_empty());

        seed_index(
            &folder_path,
            &cfg.index_page,
            index_template,
            &cfg.space_ignore,
        );
        spaces.spaces.insert(id, cfg);
    }

    let mut server_config =
        ServerConfig::load(&root.join("server.json")).map_err(|e| err("", e))?;
    if let Some(primary_url) = &req.primary_url {
        server_config.primary_url = Some(primary_url.clone());
    }
    server_config.validate(&spaces)?;
    let known_users: BTreeSet<String> = users.users.keys().cloned().collect();
    let primary_host = server_config.primary_host();
    let errors =
        super::validate::validate_for_primary(&spaces, root, &known_users, primary_host.as_deref());
    if !errors.is_empty() {
        return Err(errors);
    }
    server_config.validate_paths(root, &spaces)?;
    server_config
        .save(&root.join("server.json"))
        .map_err(|e| err("", e))?;

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
            primary_url: None,
            admin_username: "ada".into(),
            admin_password: "hunter22".into(),
            admin_full_name: String::new(),
            admin_email: String::new(),
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
            host: None,
            prefix: "/".into(),
            folder: String::new(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));
        run_setup(dir.path(), &request, "# Hello\n").unwrap();

        let users_path = dir.path().join(USERS_FILE);
        assert!(users_path.exists());
        #[cfg(unix)]
        assert_0600(&users_path);

        let store = UserStore::open(dir.path()).unwrap().unwrap();
        assert!(store.verify_password("ada", "hunter22"));
        assert!(store.is_admin("ada"));

        let spaces_path = dir.path().join(SPACES_FILE);
        assert!(spaces_path.exists());
        #[cfg(unix)]
        assert_0600(&spaces_path);

        // The freshly provisioned file must use the same shape every other
        // write path produces: an explicit `access`, never the legacy key.
        let raw = std::fs::read_to_string(&spaces_path).unwrap();
        assert!(raw.contains("\"access\""), "{raw}");
        assert!(!raw.contains("\"public\""), "{raw}");

        let cfg = MultiConfig::load(&spaces_path).unwrap();
        assert_eq!(cfg.spaces.len(), 1);
        let (id, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.name, "Notes");
        assert!(matches!(&space.binding, Binding::Prefix { prefix } if prefix.is_empty()));
        assert_eq!(space.access(), SpaceAccess::None);
        assert!(space.members.is_empty());
        assert!(!space.shell.enabled);
        assert_eq!(
            space.revisions,
            silverbullet_server_common::RevisionsMode::Managed
        );

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
            host: None,
            prefix: "/work".into(),
            folder: "custom/work".into(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
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
        // Absolute folders inside the data root must be stored relatively
        // so spaces.json remains portable.
        let dir = tempfile::tempdir().unwrap();
        let abs = dir.path().join("spaces").join("notes");
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            host: None,
            prefix: "/".into(),
            folder: abs.to_string_lossy().to_string(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));
        run_setup(dir.path(), &request, "# Hello\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let (_, space) = cfg.spaces.iter().next().unwrap();
        assert_eq!(space.folder, "spaces/notes");
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
            host: None,
            prefix: "/".into(),
            folder: folder.clone(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
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
            host: None,
            prefix: "/work".into(),
            folder: "custom/work".into(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
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
    fn setup_persists_primary_url_and_hostname_space() {
        let dir = tempfile::tempdir().unwrap();
        let mut request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: "/".into(),
            host: Some("notes.example.com".into()),
            folder: String::new(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));
        request.primary_url = Some("https://manage.example.com".into());
        run_setup(dir.path(), &request, "# Hello\n").unwrap();
        let server = ServerConfig::load(&dir.path().join("server.json")).unwrap();
        assert_eq!(
            server.primary_url.as_deref(),
            Some("https://manage.example.com")
        );
        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let space = cfg.spaces.values().next().unwrap();
        assert!(matches!(
            &space.binding,
            Binding::Host { host, prefix }
                if host == "notes.example.com" && prefix.is_empty()
        ));
    }

    #[test]
    fn setup_accepts_hostname_and_port_with_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Work".into(),
            prefix: "/work".into(),
            host: Some("team.example.com:3000".into()),
            folder: String::new(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));

        run_setup(dir.path(), &request, "# Work\n").unwrap();

        let cfg = MultiConfig::load(&dir.path().join(SPACES_FILE)).unwrap();
        let space = cfg.spaces.values().next().unwrap();
        assert!(matches!(
            &space.binding,
            Binding::Host { host, prefix }
                if host == "team.example.com:3000" && prefix == "/work"
        ));
    }

    #[test]
    fn setup_requires_an_explicit_path_for_a_hostname() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: " ".into(),
            host: Some("notes.example.com".into()),
            folder: String::new(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));

        let errors = run_setup(dir.path(), &request, "# Notes\n").unwrap_err();
        assert_eq!(errors[0].field, "space.prefix");
        assert!(!is_configured(dir.path()));
    }

    #[test]
    fn setup_reports_a_blank_hostname_on_the_hostname_field() {
        let dir = tempfile::tempdir().unwrap();
        let request = req(Some(FirstSpace {
            name: "Notes".into(),
            prefix: "/".into(),
            host: Some(" ".into()),
            folder: String::new(),
            revisions: silverbullet_server_common::RevisionsMode::Managed,
        }));

        let errors = run_setup(dir.path(), &request, "# Notes\n").unwrap_err();
        assert_eq!(errors[0].field, "space.host");
        assert!(!is_configured(dir.path()));
    }

    #[test]
    fn setup_rejects_malformed_hostname_on_the_hostname_field() {
        for host in [
            " notes.example.test",
            "notes..example.test",
            "user@notes.example.test",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let request = req(Some(FirstSpace {
                name: "Notes".into(),
                prefix: "/work".into(),
                host: Some(host.into()),
                folder: String::new(),
                revisions: silverbullet_server_common::RevisionsMode::Managed,
            }));
            let errors = run_setup(dir.path(), &request, "# Notes\n").unwrap_err();
            assert_eq!(errors[0].field, "space.host", "{host}");
            assert!(!is_configured(dir.path()));
        }
    }

    #[test]
    fn primary_url_accepts_prefix_and_same_host_spaces() {
        for (prefix, host) in [("/", None), ("/", Some("manage.example.com"))] {
            let dir = tempfile::tempdir().unwrap();
            let mut request = req(Some(FirstSpace {
                name: "Notes".into(),
                prefix: prefix.into(),
                host: host.map(String::from),
                folder: String::new(),
                revisions: silverbullet_server_common::RevisionsMode::Managed,
            }));
            request.primary_url = Some("https://manage.example.com".into());
            run_setup(dir.path(), &request, "").unwrap();
            assert!(is_configured(dir.path()));
            assert!(dir.path().join("server.json").exists());
        }
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
    fn a_bad_profile_field_is_reported_against_that_field() {
        let dir = tempfile::tempdir().unwrap();

        let mut request = req(None);
        request.admin_full_name = "Ada <Lovelace>".into();
        let errs = run_setup(dir.path(), &request, "x").unwrap_err();
        assert_eq!(errs[0].field, "adminFullName", "{errs:?}");

        let mut request = req(None);
        request.admin_email = "ada @example.org".into();
        let errs = run_setup(dir.path(), &request, "x").unwrap_err();
        assert_eq!(errs[0].field, "adminEmail", "{errs:?}");

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
