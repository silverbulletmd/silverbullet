//! Materialize a `SpaceConfig` into a running space: Core's regular
//! `ServerState` + router, exactly as the single-space binary builds it. A
//! build failure produces an `Errored` instance (never a crash) so one broken
//! space can't take the server down.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use silverbullet_server_common::space::{
    DiskSpacePrimitives, FallthroughSpacePrimitives, ReadOnlySpacePrimitives,
};
use silverbullet_server_common::{BootConfig, SpacePrimitives};

use crate::auth::{
    AuthConfig, Authenticator, HeadlessTokenAuthorizer, JwtAuthorizer, LockoutTimer, LoginManager,
    RequestAuthorizer,
};
use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
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
    /// Inherit-mode credentials (the admin's).
    pub admin_auth: AuthConfig,
    pub version: String,
    pub main_port: u16,
    pub disable_service_worker: bool,
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

/// Create `<index_page>.md` in `folder` when the space has no `.md` files yet.
/// Mirrors the single-space binary's `ensure_index`, at the fs level.
pub fn seed_index(folder: &Path, index_page: &str) {
    let has_md = std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .any(|e| e.path().extension().is_some_and(|x| x == "md"))
        })
        .unwrap_or(true); // unreadable folder: do nothing
    if has_md {
        return;
    }
    let path = folder.join(format!("{index_page}.md"));
    if let Err(e) = std::fs::write(&path, "# Welcome to your new space!\n") {
        tracing::warn!("could not seed index page {}: {e}", path.display());
    }
}

/// Random 256-bit hex token (headless-browser authorization).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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
    let disk: Box<dyn SpacePrimitives> = if config.read_only {
        Box::new(ReadOnlySpacePrimitives::new(Box::new(disk)))
    } else {
        Box::new(disk)
    };
    let space: Box<dyn SpacePrimitives> = Box::new(FallthroughSpacePrimitives::new(
        disk,
        (deps.assets.base_fs)(),
    ));

    // Per-space auth config (None = open space).
    let auth_config: Option<AuthConfig> = match &config.auth {
        SpaceAuth::Inherit => Some(deps.admin_auth.clone()),
        SpaceAuth::None => None,
        SpaceAuth::Custom {
            user,
            pass_hash,
            auth_token,
            lockout_limit,
            lockout_time,
            remember_me_hours,
        } => {
            if pass_hash.is_empty() {
                return Err("custom auth: no password set yet".into());
            }
            Some(AuthConfig {
                user: user.clone(),
                pass: String::new(),
                pass_hash: Some(pass_hash.clone()),
                auth_token: auth_token.clone(),
                lockout_limit: *lockout_limit,
                lockout_time_secs: *lockout_time,
                remember_me_hours: *remember_me_hours,
            })
        }
    };

    let headless_token = generate_token();
    let (authorizer, login) = match &auth_config {
        None => (None, None),
        Some(ac) => {
            let authenticator = Arc::new(
                Authenticator::load_or_init(&folder, ac)
                    .map_err(|e| format!("could not initialize authentication: {e}"))?,
            );
            let inner: Box<dyn RequestAuthorizer> = Box::new(JwtAuthorizer::with_prefix(
                authenticator.clone(),
                ac.auth_token.clone(),
                prefix.to_string(),
            ));
            let authorizer: Arc<dyn RequestAuthorizer> =
                Arc::new(HeadlessTokenAuthorizer::new(inner, headless_token.clone()));
            let lockout = LockoutTimer::from_config(ac.lockout_time_secs, ac.lockout_limit);
            let login = Arc::new(LoginManager::new(
                authenticator,
                ac.clone(),
                lockout,
                prefix.to_string(),
            ));
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
    use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
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
            admin_auth: crate::auth::AuthConfig::try_parse(
                Some("admin:pw"),
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap(),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
        }
    }

    fn space(binding: Binding, auth: SpaceAuth, folder: &str) -> SpaceConfig {
        SpaceConfig {
            name: "S".into(),
            folder: folder.into(),
            binding,
            auth,
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
    fn builds_running_instance_with_inherit_auth_and_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("spaces/x");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/work/".into(),
            },
            SpaceAuth::Inherit,
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
            SpaceAuth::None,
            dir.path().join("nope").to_str().unwrap(),
        );
        let inst = build_instance("x", &cfg, &deps);
        match &inst.status {
            InstanceStatus::Errored(reason) => assert!(reason.contains("folder"), "{reason}"),
            other => panic!("expected errored, got {other:?}"),
        }
        assert!(inst.router.is_none());
    }

    #[test]
    fn custom_auth_without_password_is_errored() {
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("s");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/x".into(),
            },
            SpaceAuth::Custom {
                user: "u".into(),
                pass_hash: String::new(),
                auth_token: String::new(),
                lockout_limit: 10,
                lockout_time: 60,
                remember_me_hours: 168,
            },
            folder.to_str().unwrap(),
        );
        let inst = build_instance("x", &cfg, &deps);
        assert!(matches!(inst.status, InstanceStatus::Errored(_)));
    }

    #[tokio::test]
    async fn auth_none_space_serves_config_openly() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("open");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/o".into(),
            },
            SpaceAuth::None,
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
    async fn inherit_auth_space_401s_without_credentials() {
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let deps = test_deps(dir.path());
        let folder = dir.path().join("locked");
        std::fs::create_dir_all(&folder).unwrap();
        let cfg = space(
            Binding::Prefix {
                prefix: "/l".into(),
            },
            SpaceAuth::Inherit,
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

    #[test]
    fn seed_index_creates_page_only_in_empty_space() {
        let dir = tempfile::tempdir().unwrap();
        seed_index(dir.path(), "index");
        assert!(dir.path().join("index.md").exists());
        // Non-empty: do not overwrite/add.
        std::fs::write(dir.path().join("other.md"), "x").unwrap();
        seed_index(dir.path(), "home");
        assert!(!dir.path().join("home.md").exists());
    }
}
