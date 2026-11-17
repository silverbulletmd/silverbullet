//! The migration plan: what moves where and which `spaces.json` entry the old
//! folder's env-var settings become. Computed against the disk, which it
//! only reads apart from the writability probe in `find_blockers`.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use silverbullet_server_common::RevisionsMode;

use super::blockers::{find_blockers, Blocker, PROBE_PREFIX};
use super::execute::JOURNAL_TMP_PREFIX;
use crate::multi::config::{Binding, MultiConfig, ShellSettings, SpaceAccess, SpaceConfig};
use crate::multi::data_root::folder_conflict;
use crate::multi::instance::resolve_folder;
use crate::multi::validate::{normalize_prefix, validate, FieldError};
use crate::shell::ShellConfig;

/// The per-space part of the single-space `SB_*` environment.
#[derive(Debug, Clone)]
pub struct SingleSpaceSettings {
    pub name: String,
    /// Normalized like `SB_URL_PREFIX`: empty for the root.
    pub url_prefix: String,
    pub read_only: bool,
    pub index_page: String,
    pub description: String,
    pub theme_color: String,
    pub head_html: String,
    pub space_ignore: String,
    pub log_push: bool,
    pub revisions: RevisionsMode,
}

/// The one root-bound space single-space mode serves, at folder `.`.
pub fn synthesize_space(settings: &SingleSpaceSettings, shell: ShellConfig) -> SpaceConfig {
    let prefix = if settings.url_prefix.is_empty() {
        "/".to_string()
    } else {
        settings.url_prefix.clone()
    };

    SpaceConfig {
        name: settings.name.clone(),
        folder: ".".to_string(),
        binding: Binding::Prefix { prefix },
        access: Some(SpaceAccess::None),
        legacy_public: None,
        members: Default::default(),
        read_only: settings.read_only,
        shell: ShellSettings {
            enabled: !settings.read_only && shell.enabled,
            whitelist: shell.whitelist,
        },
        index_page: settings.index_page.clone(),
        description: settings.description.clone(),
        theme_color: settings.theme_color.clone(),
        head_html: settings.head_html.clone(),
        space_ignore: settings.space_ignore.clone(),
        log_push: settings.log_push,
        semantic_search: Default::default(),
        revisions: settings.revisions,
        git_sync: None,
        revisions_commit: None,
        client_identity_path: None,
        former_prefixes: Vec::new(),
        extra: Default::default(),
    }
}

/// A legacy single-space install as its environment described it.
#[derive(Clone)]
pub struct LegacyEnv {
    /// The data folder exactly as configured; clients named their database after it.
    pub data_folder: String,
    /// `SB_URL_PREFIX`, always normalized (empty for the root, otherwise a
    /// leading `/` and no trailing one): routes are built from it as is.
    pub url_prefix: String,
    /// From [`synthesize_space`].
    pub space: SpaceConfig,
    /// `SB_USER`, split at the first `:` like `AuthConfig` does.
    pub user: Option<(String, String)>,
    pub auth_token: Option<String>,
    pub search_model: Option<String>,
    /// `false` when `SB_RUNTIME_API` turned the Runtime API off.
    pub runtime_api: bool,
    /// `SB_RUNTIME_IDLE_TIMEOUT`, in minutes.
    pub runtime_idle_timeout: Option<u64>,
    /// The legacy env vars that are set, which the migration makes unnecessary.
    pub set_vars: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visitors {
    None,
    Read,
    Write,
}

impl From<Visitors> for SpaceAccess {
    fn from(visitors: Visitors) -> Self {
        match visitors {
            Visitors::None => SpaceAccess::None,
            Visitors::Read => SpaceAccess::Read,
            Visitors::Write => SpaceAccess::Write,
        }
    }
}

/// Who administers the migrated server, as the plan form submits it. The
/// password of `CreateNew` lives only for the request: it is never serialized.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AdminChoice {
    /// Keep the `SB_USER` account; its password comes from the environment.
    Create {
        username: String,
    },
    CreateNew {
        username: String,
        #[serde(default, skip_serializing)]
        password: String,
    },
    NoAccounts,
}

impl std::fmt::Debug for AdminChoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdminChoice::Create { username } => f
                .debug_struct("Create")
                .field("username", username)
                .finish(),
            AdminChoice::CreateNew { username, .. } => f
                .debug_struct("CreateNew")
                .field("username", username)
                .finish_non_exhaustive(),
            AdminChoice::NoAccounts => f.write_str("NoAccounts"),
        }
    }
}

/// The admin account a plan creates, without its password: the executor
/// takes that from `SB_USER` (`FromEnv`) or from the submitted form (`New`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AdminPlan {
    FromEnv { username: String },
    New { username: String },
    NoAccounts,
}

/// The editable part of the plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEdits {
    pub name: String,
    pub prefix: String,
    /// The space's folder name under `spaces/`.
    pub folder: String,
    pub visitors: Visitors,
    pub admin: AdminChoice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub moves: Vec<Move>,
    pub space_id: String,
    pub space: SpaceConfig,
    pub admin: AdminPlan,
    /// `SB_AUTH_TOKEN` becomes an API token of the admin.
    pub api_token: bool,
    pub search_model: Option<String>,
    /// Becomes `runtimeApi` in `server.json`; only `false` is written.
    pub runtime_api: bool,
    /// Becomes `runtimeIdleTimeout` (minutes) in `server.json`.
    pub runtime_idle_timeout: Option<u64>,
    pub env_to_remove: Vec<String>,
    pub url_changed: bool,
    pub blockers: Vec<Blocker>,
}

const DEFAULT_NAME: &str = "Notes";

pub fn default_edits(env: &LegacyEnv) -> PlanEdits {
    let name = if env.set_vars.iter().any(|var| var == "SB_NAME") {
        env.space.name.clone()
    } else {
        DEFAULT_NAME.to_string()
    };
    let prefix = match normalize_prefix(&env.url_prefix) {
        prefix if prefix.is_empty() => "/".to_string(),
        prefix => prefix,
    };
    let (visitors, admin) = match &env.user {
        Some((username, _)) => (
            Visitors::None,
            AdminChoice::Create {
                username: username.clone(),
            },
        ),
        None => (
            if env.space.read_only {
                Visitors::Read
            } else {
                Visitors::Write
            },
            AdminChoice::CreateNew {
                username: String::new(),
                password: String::new(),
            },
        ),
    };
    PlanEdits {
        folder: slug(&name),
        name,
        prefix,
        visitors,
        admin,
    }
}

/// Lowercase ASCII letters and digits; every other run becomes one `-`.
fn slug(name: &str) -> String {
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "space".to_string()
    } else {
        slug.to_string()
    }
}

fn field_error(errors: &mut Vec<FieldError>, field: &str, message: impl Into<String>) {
    errors.push(FieldError {
        field: field.to_string(),
        message: message.into(),
    });
}

fn valid_username(username: &str) -> bool {
    !username.is_empty() && !username.contains(':') && !username.contains('/')
}

fn admin_plan(env: &LegacyEnv, admin: &AdminChoice, errors: &mut Vec<FieldError>) -> AdminPlan {
    match admin {
        AdminChoice::Create { username } => {
            let username = username.trim();
            if env.user.is_none() {
                field_error(
                    errors,
                    "admin",
                    "SB_USER is not set; create a new administrator",
                );
            }
            if !valid_username(username) {
                field_error(errors, "adminUsername", "invalid username");
            }
            AdminPlan::FromEnv {
                username: username.to_string(),
            }
        }
        AdminChoice::CreateNew { username, password } => {
            let username = username.trim();
            if !valid_username(username) {
                field_error(errors, "adminUsername", "invalid username");
            }
            if password.is_empty() {
                field_error(errors, "adminPassword", "password must not be empty");
            }
            AdminPlan::New {
                username: username.to_string(),
            }
        }
        AdminChoice::NoAccounts => AdminPlan::NoAccounts,
    }
}

fn folder_name_error(folder: &str) -> Option<&'static str> {
    if folder.is_empty() {
        Some("folder must not be empty")
    } else if folder == "." || folder == ".." || folder.contains(['/', '\\']) {
        Some("folder must be a single folder name")
    } else {
        None
    }
}

/// The Runtime API's browser profiles, which multi-space mode keeps in the
/// data root too, so they stay there.
pub(super) const CHROME_DATA_DIR: &str = ".chrome-data";

/// Top-level entries of `root`, sorted, minus the single-space auth file
/// (the migration handles that one itself), the browser profiles and the
/// probes and journal temporaries a crash left behind (`find_blockers`,
/// `create_journal`).
pub(super) fn top_level_entries(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        let probe = name.to_str().is_some_and(|name| {
            name.starts_with(PROBE_PREFIX)
                || (name.starts_with(JOURNAL_TMP_PREFIX) && name.ends_with(".tmp"))
        });
        if name != crate::auth::AUTH_FILE_NAME && name != CHROME_DATA_DIR && !probe {
            entries.push(entry.path());
        }
    }
    entries.sort();
    Ok(entries)
}

/// The plan for `edits`, or every field error. A plan with errors can't run.
pub fn compute_plan(
    root: &Path,
    env: &LegacyEnv,
    edits: &PlanEdits,
) -> Result<MigrationPlan, Vec<FieldError>> {
    let (plan, errors) = compute_plan_with_errors(root, env, edits)?;
    if errors.is_empty() {
        Ok(plan)
    } else {
        Err(errors)
    }
}

/// Like `compute_plan`, but a plan is still returned when only the
/// administrator or visitors choices are wrong: they don't change what moves,
/// so the preview can show it next to their errors. `Err` when no plan can be
/// built (a bad name, URL or folder, or an unreadable folder).
pub fn compute_plan_with_errors(
    root: &Path,
    env: &LegacyEnv,
    edits: &PlanEdits,
) -> Result<(MigrationPlan, Vec<FieldError>), Vec<FieldError>> {
    let mut errors = Vec::new();
    // Errors that leave the plan computable, kept apart from `errors`.
    let mut soft = Vec::new();

    let name = edits.name.trim();
    let prefix_input = edits.prefix.trim();
    if prefix_input.is_empty() {
        field_error(
            &mut errors,
            "prefix",
            "prefix must not be empty (use \"/\" for the root)",
        );
    }
    let folder = edits.folder.trim();
    let folder_error = folder_name_error(folder);
    if let Some(message) = folder_error {
        field_error(&mut errors, "folder", message);
    }
    let admin = admin_plan(env, &edits.admin, &mut soft);
    if admin == AdminPlan::NoAccounts && edits.visitors == Visitors::None {
        field_error(
            &mut soft,
            "visitors",
            "without accounts, visitors need read or read & write access",
        );
    }

    let space_id = uuid::Uuid::new_v4().to_string();
    let prefix = normalize_prefix(prefix_input);
    let old_prefix = normalize_prefix(&env.url_prefix);
    let url_changed = prefix != old_prefix;
    let mut space = env.space.clone();
    space.name = name.to_string();
    space.folder = format!("spaces/{folder}");
    space.binding = Binding::Prefix { prefix };
    space.access = Some(edits.visitors.into());
    space.client_identity_path = Some(env.data_folder.clone());
    space.former_prefixes = if url_changed {
        vec![old_prefix]
    } else {
        Vec::new()
    };
    space.normalize();

    let config = MultiConfig {
        spaces: HashMap::from([(space_id.clone(), space.clone())]),
    };
    for error in validate(&config, root, &BTreeSet::new()) {
        let field = error
            .field
            .strip_prefix(&format!("{space_id}."))
            .unwrap_or(&error.field);
        let field = if field == "binding" { "prefix" } else { field };
        field_error(&mut errors, field, error.message);
    }
    if folder_error.is_none() {
        if let Some(message) = folder_conflict(root, &space_id, &space.folder) {
            field_error(&mut errors, "folder", message);
        }
    }
    if !errors.is_empty() {
        errors.extend(soft);
        return Err(errors);
    }

    let entries = top_level_entries(root).map_err(|e| {
        vec![FieldError {
            field: String::new(),
            message: format!("could not list {}: {e}", root.display()),
        }]
    })?;
    let dest = resolve_folder(root, &space_id, &space.folder);
    let blockers = find_blockers(root, &dest, &entries);
    let moves = entries
        .into_iter()
        .filter_map(|from| {
            let name = from.file_name()?.to_str()?;
            Some(Move {
                to: dest.join(name),
                from,
            })
        })
        .collect();

    let mut env_to_remove = env.set_vars.clone();
    env_to_remove.sort();
    env_to_remove.dedup();

    let plan = MigrationPlan {
        moves,
        space_id,
        api_token: env.auth_token.is_some() && admin != AdminPlan::NoAccounts,
        admin,
        space,
        search_model: env.search_model.clone(),
        runtime_api: env.runtime_api,
        runtime_idle_timeout: env.runtime_idle_timeout,
        env_to_remove,
        url_changed,
        blockers,
    };
    Ok((plan, soft))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    fn settings_fixture() -> SingleSpaceSettings {
        SingleSpaceSettings {
            name: "SilverBullet".into(),
            url_prefix: String::new(),
            read_only: false,
            index_page: "index".into(),
            description: "Powerful and programmable note taking app".into(),
            theme_color: "#fcfcfd".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: RevisionsMode::Unmanaged,
        }
    }

    fn shell_on() -> ShellConfig {
        ShellConfig {
            enabled: true,
            whitelist: vec![],
        }
    }

    /// An install as the environment `vars` (`SB_*` name, value) describes it.
    pub(crate) fn legacy_env(data_folder: &str, vars: &[(&str, &str)]) -> LegacyEnv {
        let get = |name: &str| {
            vars.iter()
                .find(|(var, _)| *var == name)
                .map(|(_, value)| value.to_string())
        };
        let mut settings = settings_fixture();
        if let Some(name) = get("SB_NAME") {
            settings.name = name;
        }
        if let Some(prefix) = get("SB_URL_PREFIX") {
            settings.url_prefix = normalize_prefix(&prefix);
        }
        settings.read_only = get("SB_READ_ONLY").is_some();
        LegacyEnv {
            data_folder: data_folder.into(),
            url_prefix: settings.url_prefix.clone(),
            space: synthesize_space(&settings, shell_on()),
            user: get("SB_USER").and_then(|user| {
                let (name, pass) = user.split_once(':')?;
                Some((name.to_string(), pass.to_string()))
            }),
            auth_token: get("SB_AUTH_TOKEN"),
            search_model: get("SB_SEARCH_MODEL"),
            runtime_api: !matches!(get("SB_RUNTIME_API").as_deref(), Some("0" | "false")),
            runtime_idle_timeout: get("SB_RUNTIME_IDLE_TIMEOUT").map(|v| v.parse().unwrap()),
            set_vars: vars.iter().map(|(var, _)| var.to_string()).collect(),
        }
    }

    fn data_root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.md"), "# Hello").unwrap();
        (dir, root)
    }

    #[test]
    fn root_prefix_when_no_url_prefix() {
        let s = synthesize_space(&settings_fixture(), shell_on());
        assert!(matches!(&s.binding, Binding::Prefix { prefix } if prefix == "/"));
    }

    #[test]
    fn url_prefix_override_is_carried_through() {
        let mut settings = settings_fixture();
        settings.url_prefix = "/wiki".into();
        let s = synthesize_space(&settings, shell_on());
        assert!(matches!(&s.binding, Binding::Prefix { prefix } if prefix == "/wiki"));
    }

    #[test]
    fn read_only_propagates_and_disables_shell() {
        let mut settings = settings_fixture();
        settings.read_only = true;
        let s = synthesize_space(&settings, shell_on());
        assert!(s.read_only);
        assert!(!s.shell.enabled);
    }

    #[test]
    fn shell_whitelist_flows_through_when_writable() {
        let shell = ShellConfig {
            enabled: true,
            whitelist: vec!["git".into(), "npm".into()],
        };
        let s = synthesize_space(&settings_fixture(), shell);
        assert!(s.shell.enabled);
        assert_eq!(s.shell.whitelist, vec!["git", "npm"]);
    }

    #[test]
    fn core_fields_map_from_settings() {
        let mut settings = settings_fixture();
        settings.name = "My Notes".into();
        settings.index_page = "home".into();
        settings.space_ignore = "*.tmp".into();
        settings.theme_color = "#123456".into();
        settings.log_push = true;
        let s = synthesize_space(&settings, shell_on());
        assert_eq!(s.name, "My Notes");
        assert_eq!(s.index_page, "home");
        assert_eq!(s.space_ignore, "*.tmp");
        assert_eq!(s.theme_color, "#123456");
        assert!(s.log_push);
        assert_eq!(s.folder, ".");
        assert!(
            s.semantic_search.is_default(),
            "semantic search follows the default"
        );
    }

    #[test]
    fn defaults_follow_env() {
        let env = legacy_env(
            "/data",
            &[
                ("SB_NAME", "Notes"),
                ("SB_URL_PREFIX", "/wiki"),
                ("SB_USER", "pat:secret"),
            ],
        );
        let edits = default_edits(&env);
        assert_eq!(edits.name, "Notes");
        assert_eq!(edits.prefix, "/wiki");
        assert_eq!(edits.folder, "notes");
        assert_eq!(edits.visitors, Visitors::None);
        assert_eq!(
            edits.admin,
            AdminChoice::Create {
                username: "pat".into()
            }
        );

        let open_read_only = legacy_env("/data", &[("SB_READ_ONLY", "1")]);
        assert_eq!(default_edits(&open_read_only).visitors, Visitors::Read);
        let open = legacy_env("/data", &[]);
        let edits = default_edits(&open);
        assert_eq!(edits.visitors, Visitors::Write);
        assert_eq!(edits.prefix, "/");
        assert!(matches!(edits.admin, AdminChoice::CreateNew { .. }));
    }

    #[test]
    fn folder_slug_from_name() {
        assert_eq!(slug("My Notes!"), "my-notes");
        assert_eq!(slug("  Team -- Wiki  "), "team-wiki");
        assert_eq!(slug("Ünïcode"), "n-code");
        assert_eq!(slug("!!!"), "space");
    }

    #[test]
    fn plan_moves_every_top_level_entry() {
        let (_dir, root) = data_root();
        std::fs::create_dir(root.join("Journal")).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".DS_Store"), "").unwrap();
        std::fs::write(root.join(crate::auth::AUTH_FILE_NAME), "{}").unwrap();
        let env = legacy_env(
            root.to_str().unwrap(),
            &[("SB_NAME", "Notes"), ("SB_USER", "pat:secret")],
        );
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();

        let dest = root.join("spaces/notes");
        let expected: Vec<Move> = [".DS_Store", ".git", "Journal", "index.md"]
            .iter()
            .map(|name| Move {
                from: root.join(name),
                to: dest.join(name),
            })
            .collect();
        assert_eq!(plan.moves, expected);
        assert!(plan.blockers.is_empty(), "{:?}", plan.blockers);
    }

    #[test]
    fn leftover_probe_and_journal_temp_are_not_moved() {
        let (_dir, root) = data_root();
        std::fs::write(root.join(".migration-probe-1234"), "").unwrap();
        std::fs::write(root.join(".migration-journal.json.1234.tmp"), "").unwrap();
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        let moved: Vec<&Path> = plan.moves.iter().map(|m| m.from.as_path()).collect();
        assert_eq!(moved, vec![root.join("index.md")]);
    }

    #[test]
    fn space_carries_identity_and_settings() {
        let (_dir, root) = data_root();
        let mut env = legacy_env("./notes", &[("SB_NAME", "Notes"), ("SB_READ_ONLY", "1")]);
        env.space.index_page = "home".into();
        env.space.theme_color = "#123456".into();
        env.space.revisions = RevisionsMode::Managed;
        env.space.shell = ShellSettings {
            enabled: true,
            whitelist: vec!["git".into()],
        };
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::NoAccounts;
        let plan = compute_plan(&root, &env, &edits).unwrap();

        let space = &plan.space;
        assert_eq!(
            space.client_identity_path.as_deref(),
            Some("./notes"),
            "the data folder verbatim, not canonicalized"
        );
        assert_eq!(space.folder, "spaces/notes");
        assert_eq!(space.index_page, "home");
        assert!(space.read_only);
        assert_eq!(space.shell, env.space.shell);
        assert_eq!(space.theme_color, "#123456");
        assert_eq!(space.revisions, RevisionsMode::Managed);
        assert_eq!(space.access(), SpaceAccess::Read);
        assert_eq!(plan.admin, AdminPlan::NoAccounts);
    }

    #[test]
    fn url_change_records_former_prefix() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let mut edits = default_edits(&env);
        edits.prefix = "/notes".into();
        let plan = compute_plan(&root, &env, &edits).unwrap();
        assert!(plan.url_changed);
        assert_eq!(plan.space.former_prefixes, vec!["/"]);
        assert_eq!(plan.space.binding.prefix(), "/notes");

        let env = legacy_env("/data", &[("SB_URL_PREFIX", "/wiki"), ("SB_USER", "pat:x")]);
        for typed in ["wiki/", "/wiki/", "/wiki"] {
            let mut edits = default_edits(&env);
            edits.prefix = typed.into();
            let plan = compute_plan(&root, &env, &edits).unwrap();
            assert!(!plan.url_changed, "{typed}");
            assert!(plan.space.former_prefixes.is_empty(), "{typed}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_is_moved_not_followed() {
        let (dir, root) = data_root();
        let target = dir.path().join("elsewhere");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("page.md"), "outside").unwrap();
        std::os::unix::fs::symlink(&target, root.join("Linked")).unwrap();
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        let linked: Vec<&Move> = plan
            .moves
            .iter()
            .filter(|m| m.from.starts_with(root.join("Linked")))
            .collect();
        assert_eq!(
            linked,
            vec![&Move {
                from: root.join("Linked"),
                to: root.join("spaces/notes/Linked"),
            }]
        );
        assert!(plan.blockers.is_empty(), "{:?}", plan.blockers);
    }

    #[test]
    fn collision_shows_up_as_a_blocker() {
        let (_dir, root) = data_root();
        std::fs::create_dir(root.join("spaces")).unwrap();
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        assert_eq!(
            plan.blockers,
            vec![Blocker::Collision {
                name: "spaces".into()
            }]
        );
    }

    #[test]
    fn invalid_edits_are_field_errors() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[]);
        let edits = PlanEdits {
            name: " ".into(),
            prefix: "/.hidden".into(),
            folder: "../escape".into(),
            visitors: Visitors::None,
            admin: AdminChoice::CreateNew {
                username: "a:b".into(),
                password: String::new(),
            },
        };
        let errors = compute_plan(&root, &env, &edits).unwrap_err();
        let mut fields: Vec<&str> = errors.iter().map(|e| e.field.as_str()).collect();
        fields.sort();
        assert_eq!(
            fields,
            vec!["adminPassword", "adminUsername", "folder", "name", "prefix"]
        );
    }

    #[test]
    fn protocol_relative_prefix_is_a_field_error() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let mut edits = default_edits(&env);
        edits.prefix = "//evil.example".into();
        let errors = compute_plan(&root, &env, &edits).unwrap_err();
        assert!(errors.iter().any(|e| e.field == "prefix"), "{errors:?}");
    }

    #[test]
    fn accountless_needs_visitor_access() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[]);
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::NoAccounts;
        edits.visitors = Visitors::None;
        let errors = compute_plan(&root, &env, &edits).unwrap_err();
        assert_eq!(errors[0].field, "visitors");
    }

    #[test]
    fn env_admin_requires_sb_user() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[]);
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::Create {
            username: "pat".into(),
        };
        let errors = compute_plan(&root, &env, &edits).unwrap_err();
        assert_eq!(errors[0].field, "admin");
    }

    #[test]
    fn auth_token_and_search_model_carry_over() {
        let (_dir, root) = data_root();
        let env = legacy_env(
            "/data",
            &[
                ("SB_USER", "pat:secret"),
                ("SB_AUTH_TOKEN", "token"),
                ("SB_SEARCH_MODEL", "model"),
            ],
        );
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        assert!(plan.api_token);
        assert_eq!(plan.search_model.as_deref(), Some("model"));
        assert_eq!(
            plan.env_to_remove,
            vec!["SB_AUTH_TOKEN", "SB_SEARCH_MODEL", "SB_USER"]
        );

        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::NoAccounts;
        edits.visitors = Visitors::Write;
        assert!(!compute_plan(&root, &env, &edits).unwrap().api_token);
    }

    #[test]
    fn runtime_settings_carry_over() {
        let (_dir, root) = data_root();
        let env = legacy_env(
            "/data",
            &[
                ("SB_USER", "pat:secret"),
                ("SB_RUNTIME_API", "0"),
                ("SB_RUNTIME_IDLE_TIMEOUT", "5"),
            ],
        );
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        assert!(!plan.runtime_api);
        assert_eq!(plan.runtime_idle_timeout, Some(5));
        assert_eq!(
            plan.env_to_remove,
            vec!["SB_RUNTIME_API", "SB_RUNTIME_IDLE_TIMEOUT", "SB_USER"]
        );

        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        assert!(plan.runtime_api);
        assert_eq!(plan.runtime_idle_timeout, None);
    }

    #[test]
    fn plan_round_trips_without_a_password() {
        let (_dir, root) = data_root();
        let env = legacy_env("/data", &[]);
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::CreateNew {
            username: "pat".into(),
            password: "hunter2".into(),
        };
        let plan = compute_plan(&root, &env, &edits).unwrap();
        let json = serde_json::to_string(&plan).unwrap();
        assert!(!json.contains("hunter2"));
        assert_eq!(serde_json::from_str::<MigrationPlan>(&json).unwrap(), plan);
        assert!(!serde_json::to_string(&edits).unwrap().contains("hunter2"));
        assert!(!format!("{edits:?}").contains("hunter2"));
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_entry_is_a_blocker_not_a_move() {
        use std::os::unix::ffi::OsStrExt;
        let (_dir, root) = data_root();
        let odd = root.join(std::ffi::OsStr::from_bytes(b"caf\xe9.md"));
        if std::fs::write(&odd, "").is_err() {
            // The filesystem (e.g. APFS) refuses non-UTF-8 names.
            return;
        }
        let env = legacy_env("/data", &[("SB_USER", "pat:secret")]);
        let plan = compute_plan(&root, &env, &default_edits(&env)).unwrap();
        assert_eq!(
            plan.blockers,
            vec![Blocker::UnsupportedName {
                name: "caf\u{FFFD}.md".into()
            }]
        );
        assert!(plan.moves.iter().all(|m| m.from != odd));
        serde_json::to_string(&plan).unwrap();
    }
}
