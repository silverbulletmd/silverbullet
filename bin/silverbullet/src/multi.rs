//! Multi-space mode wiring: env validation, embedded-asset and Chrome-runtime
//! factories, unified /.spaces surface construction, and the serve loop.

use std::path::PathBuf;
use std::sync::Arc;

use silverbullet_server::auth::{Authenticator, MULTI_AUTH_FILE_NAME};
use silverbullet_server::metrics::Metrics;
use silverbullet_server::multi::access::SessionPolicy;
use silverbullet_server::multi::admin_api::{build_admin_api_router, AdminState};
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{
    AssetFactories, InstanceAuth, InstanceDeps, RuntimeFactory, RuntimeRequest,
};
use silverbullet_server::multi::manager::MultiManager;
use silverbullet_server::multi::space_index::{build_spaces_router, SpaceIndexState};
use silverbullet_server::multi::users::UserStore;
use silverbullet_server::runtime::RuntimeAvailability;

use crate::config::Config;
use crate::embed::{BaseFsAssets, ClientAssets, EmbeddedSpace};

/// Env vars that are per-space JSON config in multi-space mode; warned about if
/// set (they are configured per space in spaces.json, not process-globally).
const IGNORED_IN_MULTI: &[&str] = &[
    "SB_READ_ONLY",
    "SB_NAME",
    "SB_INDEX_PAGE",
    "SB_DESCRIPTION",
    "SB_THEME_COLOR",
    "SB_HEAD_HTML",
    "SB_SPACE_IGNORE",
    "SB_LOG_PUSH",
    "SB_URL_PREFIX",
    "SB_SHELL_WHITELIST",
    "SB_USER",
];

/// Build the full multi-space serving stack from a provisioned root
pub async fn build_multi_stack(config: &Config) -> Result<(axum::Router, String), String> {
    if config.unix_socket.is_some() {
        return Err("SB_UNIX_SOCKET is not supported in multi-space mode".into());
    }
    for var in IGNORED_IN_MULTI {
        if std::env::var(var).map(|v| !v.is_empty()).unwrap_or(false) {
            tracing::warn!(
                "{var} is ignored in multi-space mode — configure this per space in spaces.json"
            );
        }
    }

    let root = PathBuf::from(&config.space_folder);
    std::fs::create_dir_all(&root).map_err(|e| format!("could not create server root: {e}"))?;
    warn_if_world_readable(&root.join("spaces.json"));
    warn_if_world_readable(&root.join("users.json"));
    warn_if_world_readable(&root.join(MULTI_AUTH_FILE_NAME));

    let store = UserStore::open(&root)?.ok_or_else(|| {
        "no users.json found: this folder is not fully provisioned, complete setup first"
            .to_string()
    })?;
    let authenticator = Arc::new(
        Authenticator::load_or_init_with_stamp_named(
            &root,
            "account-managed-session-v1",
            MULTI_AUTH_FILE_NAME,
        )
        .map_err(|e| format!("could not initialize server authentication: {e}"))?,
    );

    // Server-wide session policy: sessions minted here are valid across every
    // space, so the remember-me window and lockout thresholds come from the
    // environment rather than per-space `spaces.json` config.
    let session = SessionPolicy::from_env();

    let metrics = config.metrics_port.map(|_| Arc::new(Metrics::new()));
    let (runtime, runtime_availability) = space_runtime_factory(&root);
    let deps = InstanceDeps {
        root: root.clone(),
        assets: AssetFactories {
            client_bundle: Box::new(|| Box::new(EmbeddedSpace::<ClientAssets>::new())),
            base_fs: Box::new(|| Box::new(EmbeddedSpace::<BaseFsAssets>::new())),
        },
        runtime,
        metrics: metrics.clone(),
        auth: InstanceAuth::Accounts {
            users: store.clone(),
            authenticator: authenticator.clone(),
            session,
        },
        version: crate::VERSION.to_string(),
        main_port: config.port,
        disable_service_worker: config.disable_service_worker,
        shell_disabled: config.shell_disabled,
        index_template: crate::DEFAULT_INDEX_MD.to_string(),
    };

    let known_users = store.usernames();
    let manager = MultiManager::boot(root.clone(), deps, known_users)?;
    tracing::info!(
        "SilverBullet multi-space mode: {} space(s) configured",
        manager.registry().current().instances.len()
    );
    if config.shell_disabled {
        // Only worth saying when it actually contradicts spaces.json — the
        // point is to make the override visible to someone wondering why a
        // space they configured for shell access can't run commands.
        let overridden = manager
            .registry()
            .current()
            .instances
            .values()
            .filter(|instance| instance.config.shell.enabled && !instance.config.read_only)
            .count();
        if overridden > 0 {
            tracing::warn!(
                "SB_SHELL_BACKEND disables shell command execution server-wide, \
                 overriding {overridden} space(s) that enable it in spaces.json"
            );
        }
    }

    // Metrics on a dedicated port (server-global, aggregated across spaces).
    if let (Some(mport), Some(metrics)) = (config.metrics_port, metrics.clone()) {
        let maddr = format!("{}:{}", config.bind_host, mport);
        let listener = tokio::net::TcpListener::bind(&maddr)
            .await
            .map_err(|e| format!("failed to bind metrics on {maddr}: {e}"))?;
        let mrouter = axum::Router::new().route(
            "/metrics",
            axum::routing::get(move || {
                let metrics = metrics.clone();
                async move {
                    (
                        [(
                            axum::http::header::CONTENT_TYPE,
                            "text/plain; version=0.0.4",
                        )],
                        metrics.gather(),
                    )
                }
            }),
        );
        tracing::info!("metrics on http://{maddr}/metrics");
        tokio::spawn(async move {
            let _ = axum::serve(listener, mrouter).await;
        });
    }

    // Main listener: the unified /.spaces surface + prefix/host spaces.
    let admin_state = Arc::new(AdminState::new(
        manager.clone(),
        store.clone(),
        authenticator.clone(),
        runtime_availability,
    ));
    let spaces_state = Arc::new(SpaceIndexState::new(
        manager.clone(),
        store,
        authenticator,
        session,
        Box::new(EmbeddedSpace::<ClientAssets>::new()),
    ));
    let router = build_main_router(
        manager,
        Some(build_spaces_router(
            spaces_state,
            build_admin_api_router(admin_state),
        )),
        crate::VERSION.to_string(),
    );
    let addr = format!("{}:{}", config.bind_host, config.port);
    let log =
        format!("SilverBullet multi-space server running: http://{addr} (spaces at /.spaces)");
    Ok((router, log))
}

pub async fn run_multi(config: Config) -> Result<(), String> {
    let (router, log) = build_multi_stack(&config).await?;
    let addr = format!("{}:{}", config.bind_host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    tracing::info!("{log}");
    axum::serve(listener, router)
        .with_graceful_shutdown(crate::server::shutdown_signal())
        .await
        .map_err(|e| format!("server error: {e}"))
}

/// Build the runtime factory for a server rooted at `server_root`, plus the
/// availability the Space Manager reports to administrators.
///
/// One `ChromePool` — one Chrome process — serves every space; each space gets
/// its own page, log buffer, and auth cookie. The pool is created eagerly but
/// launches nothing until some space's runtime API is first used.
pub(crate) fn space_runtime_factory(
    server_root: &std::path::Path,
) -> (RuntimeFactory, RuntimeAvailability) {
    use silverbullet_server_runtime_chrome::RuntimeUnavailable;

    let (pool, availability) =
        match silverbullet_server_runtime_chrome::ChromeConfig::from_env(server_root) {
            Ok(config) => match silverbullet_server_runtime_chrome::ChromePool::new(config) {
                Ok(pool) => (Some(pool), RuntimeAvailability::Available),
                Err(e) => {
                    tracing::warn!("runtime API disabled: could not create the Chrome pool: {e}");
                    (
                        None,
                        RuntimeAvailability::Failed {
                            message: e.to_string(),
                        },
                    )
                }
            },
            Err(RuntimeUnavailable::DisabledByEnv) => {
                tracing::info!("runtime API disabled by SB_RUNTIME_API=0");
                (None, RuntimeAvailability::DisabledByEnv)
            }
            Err(RuntimeUnavailable::NoChrome) => {
                tracing::info!("runtime API disabled: no Chrome or Chromium found");
                (None, RuntimeAvailability::NoChrome)
            }
        };
    let factory: RuntimeFactory = Box::new(move |req: &RuntimeRequest| {
        let pool = pool.as_ref()?;
        if req.read_only {
            return None;
        }
        let page = silverbullet_server_runtime_chrome::SpacePage {
            server_url: req.server_url.clone(),
            headless_token: req.headless_token.to_string(),
            cookie_name: silverbullet_server::auth::headless_cookie_name(req.space_id),
        };
        let logs = silverbullet_server::runtime::LogBuffer::new();
        let transport = pool.transport_for(page, logs.clone());
        Some(Box::new(silverbullet_server::runtime::ClientRuntime::new(
            transport, logs,
        )))
    });
    (factory, availability)
}

#[cfg(unix)]
fn warn_if_world_readable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.permissions().mode() & 0o077 != 0 {
            tracing::warn!(
                "{} is group/world-readable — it contains auth config; chmod 600 recommended",
                path.display()
            );
        }
    }
}

#[cfg(not(unix))]
fn warn_if_world_readable(_path: &std::path::Path) {}
