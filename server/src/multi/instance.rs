//! Materialize a `SpaceConfig` into a running space: Core's regular
//! `ServerState` + router, exactly as the single-space binary builds it. A
//! build failure produces an `Errored` instance (never a crash) so one broken
//! space can't take the server down.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use silverbullet_server_common::space::{
    DiskSpacePrimitives, FallthroughSpacePrimitives, ReadOnlySpacePrimitives,
};
use silverbullet_server_common::{BootConfig, FileMeta, SpaceError, SpacePrimitives};

use crate::auth::{
    headless_cookie_name, AuthConfig, Authenticator, HeadlessTokenAuthorizer, JwtAuthorizer,
    LockoutTimer, LoginManager, RequestAuthorizer,
};
use crate::multi::access::{SessionPolicy, SpaceUsersAuth, UserTokenAuthorizer};
use crate::multi::config::{Binding, SpaceAccess, SpaceConfig};
use crate::multi::policy::SpaceAccessPolicy;
use crate::multi::users::UserStore;
use crate::multi::validate::normalize_prefix;
use crate::shell::ShellConfig;
use crate::state::{ServerState, ServerVersion, SpacePrefixes};

/// Factories that produce the read-only asset layers (client bundle + base_fs).
/// Injected because the embedded assets live in the bin crate, not here.
pub struct AssetFactories {
    pub client_bundle: Box<dyn Fn() -> Box<dyn SpacePrimitives> + Send + Sync>,
    pub base_fs: Box<dyn Fn() -> Box<dyn SpacePrimitives> + Send + Sync>,
}

/// Everything the runtime factory needs to (maybe) build a backend for a space.
pub struct RuntimeRequest<'a> {
    pub space_id: &'a str,
    pub server_url: String,
    pub headless_token: &'a str,
    pub read_only: bool,
}

/// Builds a runtime backend for a space, or `None` when unavailable/disabled.
pub type RuntimeFactory =
    Box<dyn Fn(&RuntimeRequest) -> Option<Box<dyn crate::runtime::RuntimeBackend>> + Send + Sync>;

/// Shared inputs for building every space instance.
pub struct InstanceDeps {
    pub root: PathBuf,
    pub assets: AssetFactories,
    pub runtime: RuntimeFactory,
    pub metrics: Option<Arc<crate::metrics::Metrics>>,
    /// Authentication source for every instance built by this manager.
    pub auth: InstanceAuth,
    pub version: String,
    pub main_port: u16,
    pub disable_service_worker: bool,
    /// Process-global shell kill switch from `SB_SHELL_BACKEND` (see
    /// `shell::disabled_by_env`). When set, no space runs shell commands
    /// regardless of its own `spaces.json` settings. It only ever disables:
    /// a space that turned the shell off stays off.
    pub shell_disabled: bool,
    /// Content seeded into a brand-new empty space's index page. The bin
    /// crate supplies the rich `space_template/index.md`; test helpers in
    /// this crate can use any short string.
    pub index_template: String,
    /// Process-wide shutdown signal, cloned into every instance's
    /// `ServerState::shutdown`. See that field's doc comment.
    pub shutdown: Option<tokio::sync::watch::Receiver<()>>,
    /// The origin's space roots, cloned into every instance's
    /// `ServerState::space_prefixes` and republished by `MultiManager` on
    /// every config change. See that type's doc comment.
    pub space_prefixes: SpacePrefixes,
}

/// Single-space servers retain their classic environment credentials. An
/// account-managed multi-space server shares one user store, JWT signing
/// secret, salt, browser session, and session policy across all of its spaces.
pub enum InstanceAuth {
    Single(Option<AuthConfig>),
    Accounts {
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
        /// Remember-me window and lockout thresholds for every space's
        /// `/.auth`. Server-wide, like the session it issues.
        session: SessionPolicy,
    },
}

struct AccountIdentity {
    store: Arc<UserStore>,
    members: BTreeSet<String>,
}

impl crate::auth::IdentityResolver for AccountIdentity {
    fn resolve(&self, username: Option<&str>) -> crate::auth::UserProfile {
        let Some(username) = username else {
            return crate::auth::UserProfile::default();
        };
        let profile = self.store.profile(username).unwrap_or_default();
        crate::auth::UserProfile {
            username: Some(username.to_string()),
            full_name: profile.full_name,
            email: profile.email,
        }
    }

    fn accounts(&self) -> Option<Vec<crate::auth::UserProfile>> {
        let mut names = self.members.clone();
        names.extend(
            self.store
                .usernames()
                .into_iter()
                .filter(|name| self.store.is_admin(name)),
        );
        Some(
            names
                .into_iter()
                .map(|name| {
                    let profile = self.store.profile(&name).unwrap_or_default();
                    crate::auth::UserProfile {
                        username: Some(name),
                        full_name: profile.full_name,
                        email: None,
                    }
                })
                .collect(),
        )
    }
}

fn account_identity(
    users: Arc<UserStore>,
    members: BTreeSet<String>,
) -> Arc<dyn crate::auth::IdentityResolver> {
    Arc::new(AccountIdentity {
        store: users,
        members,
    })
}

/// Prevent a space deliberately rooted at the multi-space data directory from
/// reading or mutating the server's account, routing, and session state.
struct ServerControlFileFilter {
    inner: Box<dyn SpacePrimitives>,
}

impl ServerControlFileFilter {
    fn new(inner: Box<dyn SpacePrimitives>) -> Self {
        Self { inner }
    }

    fn reserved(path: &str) -> bool {
        let mut components = Path::new(path)
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(name) => name.to_str(),
                std::path::Component::CurDir => None,
                _ => Some(""),
            });
        let Some(name) = components.next() else {
            return false;
        };
        components.next().is_none()
            && matches!(
                name,
                "users.json"
                    | "users.json.tmp"
                    | "spaces.json"
                    | "spaces.json.tmp"
                    | crate::auth::MULTI_AUTH_FILE_NAME
            )
    }
}

impl SpacePrimitives for ServerControlFileFilter {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let mut files = self.inner.fetch_file_list()?;
        files.retain(|file| !Self::reserved(&file.name));
        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        if Self::reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.get_file_meta(path)
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        if Self::reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.read_file(path)
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        if Self::reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.write_file(path, data, meta)
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        if Self::reserved(path) {
            return Err(SpaceError::NotFound);
        }
        self.inner.delete_file(path)
    }
}

/// Whether a space built successfully.
#[derive(Debug)]
pub enum InstanceStatus {
    Running,
    Errored(String),
}

/// A materialized space: its config plus a ready-to-mount router (or `None`
/// when the build errored).
pub struct SpaceInstance {
    pub id: String,
    pub config: SpaceConfig,
    /// Normalized prefix; "" for host bindings.
    pub prefix: String,
    pub status: InstanceStatus,
    /// `None` when errored.
    pub router: Option<axum::Router>,
}

/// Resolve a space's folder: empty -> `<root>/spaces/<id>`, `"."` -> `<root>`
/// itself, relative -> under root, absolute -> as-is.
pub fn resolve_folder(root: &Path, id: &str, folder: &str) -> PathBuf {
    if folder.is_empty() {
        root.join("spaces").join(id)
    } else if folder == "." {
        root.to_path_buf()
    } else {
        let p = Path::new(folder);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            root.join(p)
        }
    }
}

/// Create `<index_page>.md` in `folder` (with `content`) when the space has no
/// `.md` files yet. Mirrors the single-space binary's former `ensure_index`
/// exactly: emptiness is decided by a recursive walk (honoring `space_ignore`),
/// not a shallow `read_dir`, so a space with markdown only in subdirectories
/// isn't treated as empty. The walk stops at the first `.md` file, so an
/// already-populated space costs O(1), not a full listing, on every boot. Uses `DiskSpacePrimitives::write_file`
/// for the actual write so nested index pages (e.g. `notes/index`) get their
/// parent directories created for free.
pub fn seed_index(folder: &Path, index_page: &str, content: &str, space_ignore: &str) {
    let disk = match DiskSpacePrimitives::new(folder, space_ignore) {
        Err(e) => {
            // Unreadable/missing folder: do nothing (matches the old
            // `ensure_index`'s behavior of leaving the space alone on error).
            tracing::warn!("could not check space state at {}: {e}", folder.display());
            return;
        }
        Ok(disk) => disk,
    };
    if disk.has_file_with_suffix(".md") {
        return;
    }
    let path = format!("{index_page}.md");
    if let Err(e) = disk.write_file(&path, content.as_bytes(), None) {
        tracing::warn!("could not seed index page {path}: {e}");
    }
}

/// Random 256-bit hex token (headless-browser authorization).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A space's authorizer + login manager (both `None` for an open space).
type AuthPair = (
    Option<Arc<dyn RequestAuthorizer>>,
    Option<Arc<LoginManager>>,
);

/// Classic single-space authorizer/login pair: one `AuthConfig` drives both
/// the JWT authorizer (with its bearer token) and the login manager.
fn build_env_style_auth(
    space_id: &str,
    folder: &Path,
    prefix: &str,
    ac: &AuthConfig,
    headless_token: &str,
) -> Result<AuthPair, String> {
    let authenticator = Arc::new(
        Authenticator::load_or_init(folder, ac)
            .map_err(|e| format!("could not initialize authentication: {e}"))?,
    );
    let inner: Box<dyn RequestAuthorizer> = Box::new(
        JwtAuthorizer::with_prefix(
            authenticator.clone(),
            ac.auth_token.clone(),
            prefix.to_string(),
        )
        .for_space(space_id),
    );
    let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(HeadlessTokenAuthorizer::new(
        inner,
        headless_cookie_name(space_id),
        headless_token.to_string(),
    ));
    let lockout = LockoutTimer::from_config(ac.lockout_time_secs, ac.lockout_limit);
    let login = Arc::new(
        LoginManager::new(
            authenticator,
            Arc::new(ac.clone()),
            ac.remember_me_hours,
            lockout,
            prefix.to_string(),
        )
        .for_space(space_id),
    );
    Ok((Some(authorizer), Some(login)))
}

/// Session validity only: revocation on password change or account deletion.
/// Whether the account may touch *this* space is the policy's decision, so a
/// read-role member's token must verify here rather than being rejected.
fn session_claims_filter(
    store: Arc<UserStore>,
) -> Box<dyn Fn(&crate::auth::authenticator::Claims) -> bool + Send + Sync> {
    Box::new(move |claims| {
        store.session_is_current(&claims.username, claims.credential_version.as_deref())
    })
}

fn any_account_filter(store: Arc<UserStore>) -> Box<dyn Fn(&str) -> bool + Send + Sync> {
    Box::new(move |username| store.user_exists(username))
}

pub fn build_instance(id: &str, config: &SpaceConfig, deps: &InstanceDeps) -> SpaceInstance {
    let prefix = match &config.binding {
        Binding::Prefix { prefix } => normalize_prefix(prefix),
        _ => String::new(),
    };
    match try_build_state(id, config, &prefix, deps) {
        Ok(state) => SpaceInstance {
            id: id.to_string(),
            config: config.clone(),
            prefix,
            status: InstanceStatus::Running,
            router: Some(crate::build_router(Arc::new(state))),
        },
        Err(reason) => {
            tracing::warn!("space {id} is errored: {reason}");
            SpaceInstance {
                id: id.to_string(),
                config: config.clone(),
                prefix,
                status: InstanceStatus::Errored(reason),
                router: None,
            }
        }
    }
}

fn try_build_state(
    id: &str,
    config: &SpaceConfig,
    prefix: &str,
    deps: &InstanceDeps,
) -> Result<ServerState, String> {
    let folder = resolve_folder(&deps.root, id, &config.folder);
    if !folder.is_dir() {
        return Err(format!("space folder does not exist: {}", folder.display()));
    }
    let folder_str = folder.to_string_lossy().to_string();

    let disk = DiskSpacePrimitives::new(&folder_str, &config.space_ignore)
        .map_err(|e| format!("failed to open space folder {folder_str}: {e}"))?;
    let mut disk: Box<dyn SpacePrimitives> = Box::new(disk);
    let account_managed = matches!(&deps.auth, InstanceAuth::Accounts { .. });
    let folder_is_server_root = folder.canonicalize().ok() == deps.root.canonicalize().ok();
    if account_managed && folder_is_server_root {
        disk = Box::new(ServerControlFileFilter::new(disk));
    }
    let disk: Box<dyn SpacePrimitives> = if config.read_only {
        Box::new(ReadOnlySpacePrimitives::new(disk))
    } else {
        disk
    };
    let space: Box<dyn SpacePrimitives> = Box::new(FallthroughSpacePrimitives::new(
        disk,
        (deps.assets.base_fs)(),
    ));

    // Authentication establishes identity. Account-managed servers share that
    // identity across every prefix; each space still grades it against its
    // own live `SpaceAccessPolicy` (access level, member role, admin, freeze).
    let headless_token = generate_token();
    let members: BTreeSet<String> = config.members.keys().cloned().collect();

    let access_policy: Arc<dyn crate::auth::AccessPolicy> = match &deps.auth {
        InstanceAuth::Accounts { users, .. } => Arc::new(SpaceAccessPolicy::new(
            users.clone(),
            config.access(),
            config.members.clone(),
            config.read_only,
        )),
        InstanceAuth::Single(_) => Arc::new(crate::auth::AuthorizedPolicy),
    };

    // Single-space mode always synthesizes `access: none` (it has no accounts
    // model for `access` to mean anything against, see `synthesize` in
    // `bin/silverbullet/src/single.rs`), so for it this has to key off
    // whether an authorizer was configured at all -- an absent one is the
    // open-server case this field exists to keep serving SSR to.
    let anonymous_readable = match &deps.auth {
        InstanceAuth::Accounts { .. } => config.access() != SpaceAccess::None,
        InstanceAuth::Single(auth) => auth.is_none(),
    };

    // Whether a stranger off the internet can author content here. SSR renders
    // page markdown with raw HTML intact, so `anonymous_readable` alone is not
    // a safe gate for it: on an anonymously *writable* space that would serve
    // an attacker's stored HTML to every later visitor and crawler.
    let anonymous_writable = match &deps.auth {
        InstanceAuth::Accounts { .. } => config.access() == SpaceAccess::Write,
        InstanceAuth::Single(auth) => auth.is_none() && !config.read_only,
    };

    let (authorizer, login): AuthPair = match &deps.auth {
        InstanceAuth::Single(None) => (None, None),
        InstanceAuth::Single(Some(config)) => {
            build_env_style_auth(id, &folder, prefix, config, &headless_token)?
        }
        InstanceAuth::Accounts {
            users: store,
            authenticator,
            session,
        } => {
            let jwt: Box<dyn RequestAuthorizer> = Box::new(
                JwtAuthorizer::with_filter(
                    authenticator.clone(),
                    String::new(),
                    String::new(),
                    session_claims_filter(store.clone()),
                )
                .for_space(id),
            );
            let tokens: Box<dyn RequestAuthorizer> = Box::new(UserTokenAuthorizer::new(
                jwt,
                store.clone(),
                any_account_filter(store.clone()),
            ));
            let inner: Box<dyn RequestAuthorizer> = Box::new(HeadlessTokenAuthorizer::new(
                tokens,
                headless_cookie_name(id),
                headless_token.clone(),
            ));
            let authorizer: Arc<dyn RequestAuthorizer> =
                Arc::new(crate::auth::AnonymousFallbackAuthorizer::new(inner));
            let verifier = Arc::new(SpaceUsersAuth {
                store: store.clone(),
                policy: access_policy.clone(),
            });
            let version_store = store.clone();
            let login = Arc::new(
                LoginManager::new(
                    authenticator.clone(),
                    verifier,
                    session.remember_me_hours,
                    session.lockout(),
                    prefix.to_string(),
                )
                .with_credential_version(Arc::new(move |username| {
                    version_store
                        .credential_version(username)
                        .unwrap_or_default()
                }))
                .with_server_wide_session()
                .for_space(id),
            );
            (Some(authorizer), Some(login))
        }
    };

    // Runtime: only when enabled, writable, and reachable via 127.0.0.1.
    // Host-bound spaces can't be addressed by IP, so their runtime is disabled.
    let runtime = if config.runtime_api && !config.read_only {
        let server_url = match &config.binding {
            Binding::Prefix { .. } => format!("http://127.0.0.1:{}{prefix}", deps.main_port),
            Binding::Host { .. } => {
                tracing::debug!("space {id}: runtimeApi unsupported for host bindings, disabled");
                String::new()
            }
        };
        if server_url.is_empty() {
            None
        } else {
            (deps.runtime)(&RuntimeRequest {
                space_id: id,
                server_url,
                headless_token: &headless_token,
                read_only: config.read_only,
            })
        }
    } else {
        None
    };
    let runtime: Option<Arc<dyn crate::runtime::RuntimeBackend>> = runtime.map(Arc::from);

    let shell_enabled = config.shell.enabled && !config.read_only && !deps.shell_disabled;
    let fs_guard = Arc::new(crate::fs_guard::FsGuard::default());
    let fs_events = crate::start_watcher(
        &folder,
        &config.space_ignore,
        crate::WatchMode::from_env(),
        fs_guard.clone(),
    );
    let revisions = crate::revisions::RevisionStore::open(&folder, config.revisions).map(|store| {
        crate::revisions::RevisionEngine::start(store, fs_events.as_ref().map(|tx| tx.subscribe()))
    });

    Ok(ServerState {
        space,
        client_bundle: (deps.assets.client_bundle)(),
        boot_config: BootConfig {
            space_folder_path: folder_str.clone(),
            space_name: config.name.clone(),
            index_page: config.index_page.clone(),
            read_only: config.read_only,
            log_push: config.log_push,
            enable_client_encryption: authorizer.is_some() && config.access() == SpaceAccess::None,
            account_managed,
            shell_backend: if shell_enabled {
                "local".into()
            } else {
                "noop".into()
            },
            disable_service_worker: deps.disable_service_worker,
            sync_protocol_version: 2,
            revisions: config.revisions,
        },
        space_prefixes: deps.space_prefixes.clone(),
        space_folder_path: folder_str,
        version: ServerVersion::Static(deps.version.clone()),
        host_url_prefix: prefix.to_string(),
        additional_head_html: config.head_html.clone(),
        theme_color: config.theme_color.clone(),
        space_description: config.description.clone(),
        authorizer,
        anonymous_readable,
        anonymous_writable,
        access_policy,
        login,
        shell: ShellConfig {
            enabled: shell_enabled,
            whitelist: config.shell.whitelist.clone(),
        },
        metrics: deps.metrics.clone(),
        runtime,
        fs_events,
        shutdown: deps.shutdown.clone(),
        fs_guard,
        revisions,
        identity: match &deps.auth {
            InstanceAuth::Accounts { users, .. } => account_identity(users.clone(), members),
            InstanceAuth::Single(_) => crate::auth::username_only(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MemberEntry, ShellSettings, SpaceConfig};
    use crate::multi::users::Profile;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;

    fn test_deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_req| None),
            metrics: None,
            auth: InstanceAuth::Single(Some(
                crate::auth::AuthConfig::try_parse(Some("admin:pw"), None, None, None, None)
                    .unwrap()
                    .unwrap(),
            )),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: false,
            index_template: "# Test space\n".into(),
            shutdown: None,
            space_prefixes: Default::default(),
        }
    }

    fn space(binding: Binding, folder: &str) -> SpaceConfig {
        SpaceConfig {
            name: "S".into(),
            folder: folder.into(),
            binding,
            access: Some(SpaceAccess::None),
            legacy_public: None,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            extra: Default::default(),
        }
    }

    #[test]
    fn resolves_folders_default_relative_absolute() {
        let root = std::path::Path::new("/root");
        assert_eq!(resolve_folder(root, "id1", ""), root.join("spaces/id1"));
        assert_eq!(resolve_folder(root, "id1", "."), root.to_path_buf());
        assert_eq!(resolve_folder(root, "id1", "sub/dir"), root.join("sub/dir"));
        let abs = if cfg!(windows) { r"C:\abs" } else { "/abs" };
        assert_eq!(
            resolve_folder(root, "id1", abs),
            std::path::PathBuf::from(abs)
        );
    }

    #[test]
    fn builds_running_single_instance_with_auth_and_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/work/".into(),
            },
            folder.to_str().unwrap(),
        );
        let inst = build_instance("x", &cfg, &deps);
        assert!(
            matches!(inst.status, InstanceStatus::Running),
            "{:?}",
            inst.status
        );
        assert_eq!(inst.prefix, "/work");
        assert!(inst.router.is_some());
    }

    #[test]
    fn wires_fs_watcher_into_state() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/work".into(),
            },
            folder.to_str().unwrap(),
        );
        let state = try_build_state("x", &cfg, "/work", &deps).unwrap();
        assert!(state.fs_events.is_some());
    }

    #[test]
    fn managed_revisions_inits_git_and_starts_the_engine() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let mut cfg = space(
            Binding::Prefix {
                prefix: "/work".into(),
            },
            folder.to_str().unwrap(),
        );
        cfg.revisions = silverbullet_server_common::RevisionsMode::Managed;
        let state = try_build_state("x", &cfg, "/work", &deps).unwrap();
        assert!(folder.join(".git").exists());
        assert!(state.revisions.is_some());
    }

    #[test]
    fn disabled_revisions_yields_no_engine() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/work".into(),
            },
            folder.to_str().unwrap(),
        );
        let state = try_build_state("x", &cfg, "/work", &deps).unwrap();
        assert!(state.revisions.is_none());
    }

    #[test]
    fn shell_kill_switch_overrides_per_space_settings() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let mut cfg = space(
            Binding::Prefix {
                prefix: "/work".into(),
            },
            folder.to_str().unwrap(),
        );
        cfg.shell = ShellSettings {
            enabled: true,
            whitelist: vec!["git".into()],
        };

        // Baseline: with no process-global override, spaces.json decides.
        let mut deps = test_deps(dir.path());
        let state = try_build_state("x", &cfg, "/work", &deps).unwrap();
        assert!(state.shell.enabled);
        assert_eq!(state.boot_config.shell_backend, "local");

        // `SB_SHELL_BACKEND=off` forces the shell off for every space,
        // whatever spaces.json says (regression guard: a single-space server
        // that disabled the shell must keep it disabled after migrating).
        deps.shell_disabled = true;
        let state = try_build_state("x", &cfg, "/work", &deps).unwrap();
        assert!(!state.shell.enabled);
        assert_eq!(state.boot_config.shell_backend, "noop");
    }

    #[test]
    fn missing_folder_yields_errored_instance() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let cfg = space(
            Binding::Prefix {
                prefix: "/x".into(),
            },
            dir.path().join("nope").to_str().unwrap(),
        );
        let inst = build_instance("x", &cfg, &deps);
        match &inst.status {
            InstanceStatus::Errored(reason) => assert!(reason.contains("folder"), "{reason}"),
            other => panic!("expected errored, got {other:?}"),
        }
        assert!(inst.router.is_none());
    }

    #[tokio::test]
    async fn auth_none_space_serves_config_openly() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        deps.auth = InstanceAuth::Single(None);
        let folder = dir.path().join("open");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/o".into(),
            },
            folder.to_str().unwrap(),
        );
        let inst = build_instance("o", &cfg, &deps);
        let resp = inst
            .router
            .unwrap()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn single_auth_space_401s_without_credentials() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("locked");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/l".into(),
            },
            folder.to_str().unwrap(),
        );
        let inst = build_instance("l", &cfg, &deps);
        let resp = inst
            .router
            .unwrap()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    fn space_users_model(
        binding: Binding,
        access: SpaceAccess,
        members: std::collections::BTreeMap<String, MemberEntry>,
        folder: &str,
    ) -> SpaceConfig {
        SpaceConfig {
            name: "S".into(),
            folder: folder.into(),
            binding,
            access: Some(access),
            legacy_public: None,
            members,
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            extra: Default::default(),
        }
    }

    /// An account-managed instance at the given `access` level, with no
    /// members and no admins — only `access` decides what an anonymous or
    /// unknown caller may do. Returns the `TempDir` guard alongside the
    /// state: the space folder must outlive the caller's use of the state
    /// (e.g. a request through its router), so the guard has to be bound in
    /// the caller's own scope rather than dropped here.
    fn state_with_access(access: SpaceAccess) -> (tempfile::TempDir, ServerState) {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        let mut deps = test_deps(dir.path());
        deps.auth = InstanceAuth::Accounts {
            users: store,
            authenticator: Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into())),
            session: SessionPolicy::default(),
        };
        let folder = dir.path().join("space");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/s".into(),
            },
            access,
            Default::default(),
            folder.to_str().unwrap(),
        );
        let state = try_build_state("s", &cfg, "/s", &deps).unwrap();
        (dir, state)
    }

    fn read_public_state() -> (tempfile::TempDir, Arc<ServerState>) {
        let (dir, state) = state_with_access(SpaceAccess::Read);
        (dir, Arc::new(state))
    }

    #[tokio::test]
    async fn a_read_public_space_serves_config_to_an_anonymous_caller() {
        use tower::ServiceExt;
        let (_dir, state) = read_public_state();
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_read_public_space_refuses_an_anonymous_write() {
        use tower::ServiceExt;
        let (_dir, state) = read_public_state();
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/.fs/index.md")
                    .body(Body::from("hi"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(response.headers().get("location").is_some());
    }

    #[test]
    fn every_account_managed_space_has_a_login_manager() {
        for access in [SpaceAccess::None, SpaceAccess::Read, SpaceAccess::Write] {
            let (_dir, state) = state_with_access(access);
            assert!(state.login.is_some(), "{access:?}");
            assert!(state.authorizer.is_some(), "{access:?}");
        }
    }

    #[test]
    fn anonymous_readable_tracks_the_account_managed_access_level() {
        // Pins the regression this field exists to fix: a public,
        // account-managed space (`access: read`) must still drive the SSR
        // gate, now that every account-managed space has an authorizer and
        // `authorizer.is_none()` can no longer tell public from private.
        let (_dir_none, none) = state_with_access(SpaceAccess::None);
        assert!(!none.anonymous_readable);
        let (_dir_read, read) = state_with_access(SpaceAccess::Read);
        assert!(read.anonymous_readable);
        let (_dir_write, write) = state_with_access(SpaceAccess::Write);
        assert!(write.anonymous_readable);
    }

    #[test]
    fn anonymous_writable_tracks_who_may_author_the_content() {
        // Gates SSR alongside `anonymous_readable`: only `access: "write"`
        // (legacy `public: true`) lets a stranger author a page, and rendering
        // stranger-authored markdown into the shell would serve stored HTML.
        let (_dir_none, none) = state_with_access(SpaceAccess::None);
        assert!(!none.anonymous_writable);
        let (_dir_read, read) = state_with_access(SpaceAccess::Read);
        assert!(!read.anonymous_writable);
        let (_dir_write, write) = state_with_access(SpaceAccess::Write);
        assert!(write.anonymous_writable);
    }

    #[test]
    fn an_open_single_space_is_anonymous_writable_unless_frozen() {
        // No authorizer at all means anyone may write, so its content is no
        // more trustworthy than a `access: "write"` space's -- unless the
        // freeze stops every writer, which is what keeps SSR working for the
        // classic public read-only wiki.
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        deps.auth = InstanceAuth::Single(None);
        let folder = dir.path().join("open");
        std::fs::create_dir_all(&folder).unwrap();
        let mut cfg = space(
            Binding::Prefix {
                prefix: "/o".into(),
            },
            folder.to_str().unwrap(),
        );
        let writable = try_build_state("o", &cfg, "/o", &deps).unwrap();
        assert!(writable.anonymous_writable);

        cfg.read_only = true;
        let frozen = try_build_state("o", &cfg, "/o", &deps).unwrap();
        assert!(!frozen.anonymous_writable);
        assert!(frozen.anonymous_readable);
    }

    #[test]
    fn open_single_space_is_anonymous_readable() {
        // Pins the other regression: a single-space server with no
        // authorizer at all (the classic open public wiki) must keep
        // `anonymous_readable == true` even though its synthesized config's
        // `access` is always `none` (see `synthesize` in
        // `bin/silverbullet/src/single.rs`) -- unlike an account-managed
        // space, single-space mode can't use `config.access()` here.
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        deps.auth = InstanceAuth::Single(None);
        let folder = dir.path().join("open");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/o".into(),
            },
            folder.to_str().unwrap(),
        );
        let state = try_build_state("o", &cfg, "/o", &deps).unwrap();
        assert!(state.anonymous_readable);
    }

    #[test]
    fn auth_protected_single_space_is_not_anonymous_readable() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path()); // default: Single(Some(admin:pw))
        let folder = dir.path().join("locked");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/l".into(),
            },
            folder.to_str().unwrap(),
        );
        let state = try_build_state("l", &cfg, "/l", &deps).unwrap();
        assert!(!state.anonymous_readable);
    }

    #[test]
    fn client_encryption_is_off_wherever_anonymous_access_is_on() {
        let (_dir_none, none) = state_with_access(SpaceAccess::None);
        assert!(none.boot_config.enable_client_encryption);
        let (_dir_read, read) = state_with_access(SpaceAccess::Read);
        assert!(!read.boot_config.enable_client_encryption);
        let (_dir_write, write) = state_with_access(SpaceAccess::Write);
        assert!(!write.boot_config.enable_client_encryption);
    }

    #[tokio::test]
    async fn a_private_account_managed_space_still_refuses_an_anonymous_caller() {
        use tower::ServiceExt;
        // The fallback authorizer grants an anonymous identity so the policy
        // can grade it; on a private space the policy still says `None`.
        let (_dir, state) = state_with_access(SpaceAccess::None);
        let state = Arc::new(state);
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_private_account_managed_space_redirects_page_navigation_to_login() {
        use tower::ServiceExt;
        // The SPA-shell gate has to grade the request the way the middleware
        // does. Asking the authorizer a yes/no question cannot work here:
        // `AnonymousFallbackAuthorizer` always says yes, so the gate would be
        // vacuously open and the `?from=` deep-link return would be lost.
        let (_dir, state) = state_with_access(SpaceAccess::None);
        state
            .client_bundle
            .write_file(".client/index.html", b"<html></html>", None)
            .unwrap();
        let response = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/SomePage")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response.headers().get("location").unwrap(),
            "/s/.auth?from=/SomePage"
        );
    }

    #[tokio::test]
    async fn a_read_public_space_serves_the_shell_for_page_navigation() {
        use tower::ServiceExt;
        let (_dir, state) = read_public_state();
        state
            .client_bundle
            .write_file(".client/index.html", b"<html></html>", None)
            .unwrap();
        let response = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/SomePage")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn public_space_serves_config_openly() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        deps.auth = InstanceAuth::Accounts {
            users: store,
            authenticator: Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into())),
            session: SessionPolicy::default(),
        };
        let folder = dir.path().join("pub");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/p".into(),
            },
            SpaceAccess::Write,
            Default::default(),
            folder.to_str().unwrap(),
        );
        let inst = build_instance("p", &cfg, &deps);
        assert!(
            matches!(inst.status, InstanceStatus::Running),
            "{:?}",
            inst.status
        );
        let resp = inst
            .router
            .unwrap()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn members_backed_space_401s_anon_200s_member_403s_outsider() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("bob", "bobpw12345", false, Profile::default())
            .unwrap();
        store
            .create_user("eve", "evepw12345", false, Profile::default())
            .unwrap();
        let bob_token = store.create_token("bob", "t").unwrap();
        let eve_token = store.create_token("eve", "t").unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
        deps.auth = InstanceAuth::Accounts {
            users: store,
            authenticator,
            session: SessionPolicy::default(),
        };

        let folder = dir.path().join("members");
        std::fs::create_dir_all(&folder).unwrap();
        let mut members = std::collections::BTreeMap::new();
        members.insert("bob".to_string(), MemberEntry::default());
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/m".into(),
            },
            SpaceAccess::None,
            members,
            folder.to_str().unwrap(),
        );
        let inst = build_instance("m", &cfg, &deps);
        assert!(
            matches!(inst.status, InstanceStatus::Running),
            "{:?}",
            inst.status
        );
        let router = inst.router.unwrap();

        let anon = router
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(anon.status(), axum::http::StatusCode::UNAUTHORIZED);

        let member_resp = router
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .header("authorization", format!("Bearer {bob_token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(member_resp.status(), axum::http::StatusCode::OK);

        // Eve holds a valid account and token, so she is authenticated — the
        // policy just grades her below `Read`. That is a known-account
        // refusal (403), distinct from an anonymous visitor (401).
        let outsider_resp = router
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.config")
                    .header("authorization", format!("Bearer {eve_token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(outsider_resp.status(), axum::http::StatusCode::FORBIDDEN);
    }

    /// End-to-end through the real authorizer chain: a member hitting
    /// `/.accounts` on a members-backed space must see the roster with
    /// themselves marked, not an empty list.
    #[tokio::test]
    async fn accounts_endpoint_reports_the_roster_to_a_member() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user(
                "bob",
                "bobpw12345",
                false,
                Profile {
                    full_name: Some("Bob Smith".into()),
                    email: None,
                },
            )
            .unwrap();
        store
            .create_user("root", "rootpw12345", true, Profile::default())
            .unwrap();
        let bob_token = store.create_token("bob", "t").unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
        deps.auth = InstanceAuth::Accounts {
            users: store,
            authenticator,
            session: SessionPolicy::default(),
        };

        let folder = dir.path().join("members");
        std::fs::create_dir_all(&folder).unwrap();
        let mut members = std::collections::BTreeMap::new();
        members.insert("bob".to_string(), MemberEntry::default());
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/m".into(),
            },
            SpaceAccess::None,
            members,
            folder.to_str().unwrap(),
        );
        let inst = build_instance("m", &cfg, &deps);
        let router = inst.router.unwrap();

        let resp = router
            .oneshot(
                axum::http::Request::builder()
                    .uri("/.accounts")
                    .header("authorization", format!("Bearer {bob_token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let names: Vec<&str> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["username"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["bob", "root"], "body was {v}");
        assert_eq!(v[0]["me"], true, "the caller must be marked: {v}");
        assert_eq!(v[0]["fullName"], "Bob Smith");
    }

    #[tokio::test]
    async fn root_folder_space_cannot_read_server_control_files() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("admin", "adminpw1", true, Profile::default())
            .unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join(crate::auth::MULTI_AUTH_FILE_NAME), "secret").unwrap();
        std::fs::write(dir.path().join("note.md"), "visible").unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
        deps.auth = InstanceAuth::Accounts {
            users: store.clone(),
            authenticator: authenticator.clone(),
            session: SessionPolicy::default(),
        };

        let cfg = space_users_model(
            Binding::Prefix { prefix: "/".into() },
            SpaceAccess::None,
            Default::default(),
            dir.path().to_str().unwrap(),
        );
        let router = build_instance("root", &cfg, &deps).router.unwrap();
        let version = store.credential_version("admin").unwrap();
        let jwt = authenticator
            .issue_jwt_with_version("admin", version, 3600)
            .unwrap();
        let get = |path: &str| {
            axum::http::Request::builder()
                .uri(path)
                .header("host", "localhost")
                .header("cookie", format!("auth_localhost={jwt}"))
                .body(axum::body::Body::empty())
                .unwrap()
        };

        assert_eq!(
            router
                .clone()
                .oneshot(get("/.fs/note.md"))
                .await
                .unwrap()
                .status(),
            axum::http::StatusCode::OK
        );
        for path in [
            "/.fs/users.json",
            "/.fs/spaces.json",
            "/.fs/.silverbullet.session.json",
        ] {
            assert_eq!(
                router.clone().oneshot(get(path)).await.unwrap().status(),
                axum::http::StatusCode::NOT_FOUND,
                "{path} must not expose server control state"
            );
        }
    }

    #[test]
    fn seed_index_creates_page_only_in_empty_space() {
        let dir = tempfile::tempdir().unwrap();
        seed_index(dir.path(), "index", "# Hello\n", "");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("index.md")).unwrap(),
            "# Hello\n"
        );
        // Non-empty: do not overwrite/add.
        std::fs::write(dir.path().join("other.md"), "x").unwrap();
        seed_index(dir.path(), "home", "# Hello\n", "");
        assert!(!dir.path().join("home.md").exists());
    }

    #[test]
    fn seed_index_ignores_markdown_nested_in_subdirectories() {
        // Regression test: a space with markdown only in subdirectories (e.g.
        // daily/2026-07-20.md, no top-level .md) must NOT be considered empty
        // and must NOT get a spurious index page seeded at its root. The old
        // shallow `read_dir` check missed this; `fetch_file_list()` is
        // recursive and catches it.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/page.md"), "hi").unwrap();
        seed_index(dir.path(), "index", "# Hello\n", "");
        assert!(
            !dir.path().join("index.md").exists(),
            "space with markdown only in a subdirectory must not be seeded"
        );
    }

    #[test]
    fn seed_index_seeds_when_only_md_is_gitignored() {
        // Old semantics (former `ensure_index`, backed by
        // `DiskSpacePrimitives::fetch_file_list`): ignored files are excluded
        // from the listing used to decide emptiness. So a space whose only
        // `.md` file is gitignored is still treated as empty and gets seeded.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ignored.md"), "x").unwrap();
        seed_index(dir.path(), "index", "# Hello\n", "ignored.md");
        assert!(
            dir.path().join("index.md").exists(),
            "a space whose only .md is gitignored should still be seeded"
        );
    }

    #[test]
    fn seed_index_creates_parent_dirs_for_nested_index_page() {
        // SB_INDEX_PAGE=notes/index: the seeded file's parent directory must
        // be created (DiskSpacePrimitives::write_file does this for free).
        let dir = tempfile::tempdir().unwrap();
        seed_index(dir.path(), "notes/index", "# Hello\n", "");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("notes/index.md")).unwrap(),
            "# Hello\n"
        );
    }

    #[test]
    fn account_resolver_fills_the_profile_for_a_known_user() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user(
                "ada",
                "pw123456",
                true,
                crate::multi::users::Profile {
                    full_name: Some("Ada Lovelace".into()),
                    email: Some("ada@example.org".into()),
                },
            )
            .unwrap();
        let resolver = account_identity(store, BTreeSet::new());
        assert_eq!(
            resolver.resolve(Some("ada")),
            crate::auth::UserProfile {
                username: Some("ada".into()),
                full_name: Some("Ada Lovelace".into()),
                email: Some("ada@example.org".into()),
            }
        );
        // An unknown or absent user degrades to username-only, never an error.
        assert_eq!(
            resolver.resolve(Some("ghost")),
            crate::auth::UserProfile {
                username: Some("ghost".into()),
                ..Default::default()
            }
        );
        assert_eq!(resolver.resolve(None), crate::auth::UserProfile::default());
    }

    #[test]
    fn the_account_directory_is_members_plus_admins() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user(
                "root",
                "pw123456",
                true,
                crate::multi::users::Profile::default(),
            )
            .unwrap();
        store
            .create_user(
                "ada",
                "pw123456",
                false,
                crate::multi::users::Profile {
                    full_name: Some("Ada Lovelace".into()),
                    email: Some("ada@example.org".into()),
                },
            )
            .unwrap();
        store
            .create_user(
                "zoe",
                "pw123456",
                false,
                crate::multi::users::Profile::default(),
            )
            .unwrap();

        let members: BTreeSet<String> = ["ada".to_string()].into_iter().collect();
        let resolver = account_identity(store, members);

        let accounts = resolver
            .accounts()
            .expect("account-managed deployments have a directory");
        let names: Vec<Option<String>> = accounts.iter().map(|a| a.username.clone()).collect();
        assert_eq!(
            names,
            vec![Some("ada".to_string()), Some("root".to_string())]
        );
        assert_eq!(accounts[0].full_name.as_deref(), Some("Ada Lovelace"));
        // The directory carries no addresses: `/.accounts` must never serve one.
        assert!(accounts.iter().all(|a| a.email.is_none()));
    }

    #[test]
    fn a_deployment_without_accounts_has_no_directory() {
        assert!(crate::auth::username_only().accounts().is_none());
    }
}
