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
    AuthConfig, Authenticator, HeadlessTokenAuthorizer, JwtAuthorizer, LockoutTimer, LoginManager,
    RequestAuthorizer,
};
use crate::multi::access::{
    SpaceUsersAuth, UserTokenAuthorizer, USERS_LOCKOUT_LIMIT, USERS_LOCKOUT_TIME_SECS,
    USERS_REMEMBER_ME_HOURS,
};
use crate::multi::config::{Binding, SpaceConfig};
use crate::multi::users::UserStore;
use crate::multi::validate::normalize_prefix;
use crate::shell::ShellConfig;
use crate::state::{ServerState, ServerVersion};

/// Factories that produce the read-only asset layers (client bundle + base_fs).
/// Injected because the embedded assets live in the bin crate, not here.
pub struct AssetFactories {
    pub client_bundle: Box<dyn Fn() -> Box<dyn SpacePrimitives> + Send + Sync>,
    pub base_fs: Box<dyn Fn() -> Box<dyn SpacePrimitives> + Send + Sync>,
}

/// Everything the runtime factory needs to (maybe) build a backend for a space.
pub struct RuntimeRequest<'a> {
    pub space_folder: &'a str,
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
    /// Content seeded into a brand-new empty space's index page. The bin
    /// crate supplies the rich `space_template/index.md`; test helpers in
    /// this crate can use any short string.
    pub index_template: String,
}

/// Single-space servers retain their classic environment credentials. An
/// account-managed multi-space server shares one user store, JWT signing
/// secret, salt, and browser session across all of its spaces.
pub enum InstanceAuth {
    Single(Option<AuthConfig>),
    Accounts {
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
    },
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

/// Resolve a space's folder: empty -> `<root>/spaces/<id>`, relative -> under
/// root, absolute -> as-is.
pub fn resolve_folder(root: &Path, id: &str, folder: &str) -> PathBuf {
    if folder.is_empty() {
        root.join("spaces").join(id)
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
/// exactly: emptiness is decided via a recursive `fetch_file_list()` (honoring
/// `space_ignore` + any `.gitignore` in the folder), not a shallow
/// `read_dir`, so a space with markdown only in subdirectories isn't treated
/// as empty. Uses `DiskSpacePrimitives::write_file` for the actual write so
/// nested index pages (e.g. `notes/index`) get their parent directories
/// created for free.
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
    match disk.fetch_file_list() {
        Ok(files) if files.iter().any(|f| f.name.ends_with(".md")) => return,
        Ok(_) => {}
        Err(e) => {
            tracing::warn!("could not check space state: {e}");
            return;
        }
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
    folder: &Path,
    prefix: &str,
    ac: &AuthConfig,
    headless_token: &str,
) -> Result<AuthPair, String> {
    let authenticator = Arc::new(
        Authenticator::load_or_init(folder, ac)
            .map_err(|e| format!("could not initialize authentication: {e}"))?,
    );
    let inner: Box<dyn RequestAuthorizer> = Box::new(JwtAuthorizer::with_prefix(
        authenticator.clone(),
        ac.auth_token.clone(),
        prefix.to_string(),
    ));
    let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(HeadlessTokenAuthorizer::new(
        inner,
        headless_token.to_string(),
    ));
    let lockout = LockoutTimer::from_config(ac.lockout_time_secs, ac.lockout_limit);
    let login = Arc::new(LoginManager::new(
        authenticator,
        Arc::new(ac.clone()),
        ac.remember_me_hours,
        lockout,
        prefix.to_string(),
    ));
    Ok((Some(authorizer), Some(login)))
}

fn member_claims_filter(
    store: Arc<UserStore>,
    members: BTreeSet<String>,
) -> Box<dyn Fn(&crate::auth::authenticator::Claims) -> bool + Send + Sync> {
    Box::new(move |claims| {
        store.session_is_current(&claims.username, claims.credential_version.as_deref())
            && (store.is_admin(&claims.username) || members.contains(&claims.username))
    })
}

fn member_name_filter(
    store: Arc<UserStore>,
    members: BTreeSet<String>,
) -> Box<dyn Fn(&str) -> bool + Send + Sync> {
    Box::new(move |username| store.is_admin(username) || members.contains(username))
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
    // identity across every prefix; each space still applies its own live
    // admin-or-member authorization policy.
    let headless_token = generate_token();
    let (authorizer, login): AuthPair = match &deps.auth {
        InstanceAuth::Single(None) => (None, None),
        InstanceAuth::Single(Some(config)) => {
            build_env_style_auth(&folder, prefix, config, &headless_token)?
        }
        InstanceAuth::Accounts { .. } if config.public => (None, None),
        InstanceAuth::Accounts {
            users: store,
            authenticator,
        } => {
            let members: BTreeSet<String> = config.members.keys().cloned().collect();
            let jwt: Box<dyn RequestAuthorizer> = Box::new(JwtAuthorizer::with_filter(
                authenticator.clone(),
                String::new(),
                String::new(),
                member_claims_filter(store.clone(), members.clone()),
            ));
            let tokens: Box<dyn RequestAuthorizer> = Box::new(UserTokenAuthorizer::new(
                jwt,
                store.clone(),
                member_name_filter(store.clone(), members.clone()),
            ));
            let authorizer: Arc<dyn RequestAuthorizer> =
                Arc::new(HeadlessTokenAuthorizer::new(tokens, headless_token.clone()));
            let verifier = Arc::new(SpaceUsersAuth {
                store: store.clone(),
                members,
            });
            let version_store = store.clone();
            let login = Arc::new(
                LoginManager::new(
                    authenticator.clone(),
                    verifier,
                    USERS_REMEMBER_ME_HOURS,
                    LockoutTimer::from_config(USERS_LOCKOUT_TIME_SECS, USERS_LOCKOUT_LIMIT),
                    prefix.to_string(),
                )
                .with_credential_version(Arc::new(move |username| {
                    version_store
                        .credential_version(username)
                        .unwrap_or_default()
                }))
                .with_server_wide_session(),
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
                tracing::warn!("space {id}: runtimeApi unsupported for host bindings, disabled");
                String::new()
            }
        };
        if server_url.is_empty() {
            None
        } else {
            (deps.runtime)(&RuntimeRequest {
                space_folder: &folder_str,
                server_url,
                headless_token: &headless_token,
                read_only: config.read_only,
            })
        }
    } else {
        None
    };

    let shell_enabled = config.shell.enabled && !config.read_only;
    Ok(ServerState {
        space,
        client_bundle: (deps.assets.client_bundle)(),
        boot_config: BootConfig {
            space_folder_path: folder_str.clone(),
            space_name: config.name.clone(),
            index_page: config.index_page.clone(),
            read_only: config.read_only,
            log_push: config.log_push,
            enable_client_encryption: authorizer.is_some(),
            account_managed,
            shell_backend: if shell_enabled {
                "local".into()
            } else {
                "noop".into()
            },
            disable_service_worker: deps.disable_service_worker,
        },
        space_folder_path: folder_str,
        version: ServerVersion::Static(deps.version.clone()),
        host_url_prefix: prefix.to_string(),
        additional_head_html: config.head_html.clone(),
        theme_color: config.theme_color.clone(),
        space_description: config.description.clone(),
        authorizer,
        login,
        shell: ShellConfig {
            enabled: shell_enabled,
            whitelist: config.shell.whitelist.clone(),
        },
        metrics: deps.metrics.clone(),
        runtime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceConfig};
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
            index_template: "# Test space\n".into(),
        }
    }

    fn space(binding: Binding, folder: &str) -> SpaceConfig {
        SpaceConfig {
            name: "S".into(),
            folder: folder.into(),
            binding,
            public: false,
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
            extra: Default::default(),
        }
    }

    #[test]
    fn resolves_folders_default_relative_absolute() {
        let root = std::path::Path::new("/root");
        assert_eq!(resolve_folder(root, "id1", ""), root.join("spaces/id1"));
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
        public: bool,
        members: std::collections::BTreeMap<String, serde_json::Map<String, serde_json::Value>>,
        folder: &str,
    ) -> SpaceConfig {
        SpaceConfig {
            name: "S".into(),
            folder: folder.into(),
            binding,
            public,
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
            extra: Default::default(),
        }
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
        };
        let folder = dir.path().join("pub");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/p".into(),
            },
            true,
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
    async fn members_backed_space_401s_anon_200s_member_401s_outsider() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store.create_user("bob", "bobpw12345", false).unwrap();
        store.create_user("eve", "evepw12345", false).unwrap();
        let bob_token = store.create_token("bob", "t").unwrap();
        let eve_token = store.create_token("eve", "t").unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
        deps.auth = InstanceAuth::Accounts {
            users: store,
            authenticator,
        };

        let folder = dir.path().join("members");
        std::fs::create_dir_all(&folder).unwrap();
        let mut members = std::collections::BTreeMap::new();
        members.insert("bob".to_string(), serde_json::Map::new());
        let cfg = space_users_model(
            Binding::Prefix {
                prefix: "/m".into(),
            },
            false,
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
        assert_eq!(outsider_resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn root_folder_space_cannot_read_server_control_files() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut deps = test_deps(dir.path());
        let store = crate::multi::users::UserStore::create_empty(dir.path()).unwrap();
        store.create_user("admin", "adminpw1", true).unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join(crate::auth::MULTI_AUTH_FILE_NAME), "secret").unwrap();
        std::fs::write(dir.path().join("note.md"), "visible").unwrap();
        let authenticator = Arc::new(Authenticator::from_secret_bytes(vec![8; 32], "v1".into()));
        deps.auth = InstanceAuth::Accounts {
            users: store.clone(),
            authenticator: authenticator.clone(),
        };

        let cfg = space_users_model(
            Binding::Prefix { prefix: "/".into() },
            false,
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
}
