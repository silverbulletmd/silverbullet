//! Multi-space mode wiring: env validation, embedded-asset and Chrome-runtime
//! factories, unified /.dashboard surface construction, and the serve loop.

use std::path::PathBuf;
use std::sync::Arc;

use silverbullet_server::auth::{
    Authenticator, BrowserSessions, LoginManager, MULTI_AUTH_FILE_NAME,
};
use silverbullet_server::metrics::Metrics;
use silverbullet_server::multi::access::SessionPolicy;
use silverbullet_server::multi::admin_api::{build_admin_api_router, AdminState};
use silverbullet_server::multi::dashboard::{build_dashboard_router, DashboardState};
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{
    AssetFactories, InstanceAuth, InstanceDeps, RuntimeFactory, RuntimeRequest,
};
use silverbullet_server::multi::manager::MultiManager;
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
    "SB_REVISIONS",
];

/// Build the full multi-space serving stack from a provisioned root.
/// `shutdown_rx` is cloned into every space's `ServerState::shutdown`; `None`
/// (e.g. from a test) means those spaces' `/.events` streams never see a
/// shutdown signal, matching pre-signal behavior.
pub async fn build_multi_stack(
    config: &Config,
    shutdown_rx: Option<tokio::sync::watch::Receiver<()>>,
) -> Result<(axum::Router, String), String> {
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

    let root = PathBuf::from(&config.data_folder);
    std::fs::create_dir_all(&root).map_err(|e| format!("could not create data folder: {e}"))?;
    warn_if_world_readable(&root.join("spaces.json"));
    warn_if_world_readable(&root.join("users.json"));
    warn_if_world_readable(&root.join(MULTI_AUTH_FILE_NAME));

    let started = std::time::Instant::now();
    let store = UserStore::open(&root)?.ok_or_else(|| {
        "no users.json found: this folder is not fully provisioned, complete setup first"
            .to_string()
    })?;
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis(),
        "multi-space users loaded"
    );
    let started = std::time::Instant::now();
    let authenticator = Arc::new(
        Authenticator::load_or_init_with_stamp_named(
            &root,
            "account-managed-session-v1",
            MULTI_AUTH_FILE_NAME,
        )
        .map_err(|e| format!("could not initialize server authentication: {e}"))?
        .with_browser_sessions(Arc::new(
            BrowserSessions::load(&root).map_err(|e| e.to_string())?,
        )),
    );

    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis(),
        "multi-space authentication loaded"
    );

    // Server-wide session policy: sessions minted here are valid across every
    // space, so the remember-me window and lockout thresholds come from the
    // environment rather than per-space `spaces.json` config.
    let session = SessionPolicy::from_env();

    let metrics = config.metrics_port.map(|_| Arc::new(Metrics::new()));
    let started = std::time::Instant::now();
    let (runtime, runtime_availability) = space_runtime_factory(&root, false);
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis(),
        "multi-space runtime configured"
    );
    let deps = InstanceDeps {
        root: root.clone(),
        assets: AssetFactories {
            client_bundle: Box::new(|| Box::new(EmbeddedSpace::<ClientAssets>::new())),
            base_fs: Box::new(|| Box::new(EmbeddedSpace::<BaseFsAssets>::new())),
        },
        runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
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
        shutdown: shutdown_rx,
    };

    let known_users = store.usernames();
    let started = std::time::Instant::now();
    let manager = MultiManager::boot(root.clone(), deps, known_users)?;
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis(),
        "multi-dashboard booted"
    );
    tracing::info!(
        "SilverBullet multi-space mode: {} space(s) configured",
        manager.registry().current().instances.len()
    );
    if config.shell_disabled {
        // Warn only when the environment overrides the space configuration.
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

    let providers = Arc::new(silverbullet_server::auth::oidc::store::ProviderStore::open(
        &root,
    )?);
    let admin_state = Arc::new(
        AdminState::new(
            manager.clone(),
            store.clone(),
            authenticator.clone(),
            runtime_availability,
        )
        .with_provider_store(providers.clone()),
    );
    let version_store = store.clone();
    let central_login = Arc::new(
        LoginManager::new(
            authenticator.clone(),
            Arc::new(silverbullet_server::multi::access::AnyUserAuth {
                store: store.clone(),
            }),
            session.remember_me_hours,
            session.lockout(),
            String::new(),
        )
        .with_credential_version(Arc::new(move |username| {
            version_store
                .credential_version(username)
                .unwrap_or_default()
        }))
        .with_server_wide_session(),
    );
    let routing_manager = manager.clone();
    let primary_manager = manager.clone();
    let name_manager = manager.clone();
    let central = Arc::new(
        silverbullet_server::handlers::central_auth::CentralAuth::new(
            providers.clone(),
            authenticator.clone(),
            store.clone(),
            central_login,
            Box::new(EmbeddedSpace::<ClientAssets>::new()),
            Arc::new(move |url| {
                let table = routing_manager.registry().current();
                let hostname = url.host_str()?;
                let host_scope = match url.port() {
                    Some(port) => format!("{hostname}:{port}"),
                    None => hostname.to_owned(),
                };
                let host_scope =
                    silverbullet_server::multi::validate::normalize_host_authority(&host_scope);
                let configured_host = table.instances.values().any(|instance| {
                    instance.config.binding.host_scope().as_deref() == Some(&host_scope)
                });
                let central_host = routing_manager
                    .primary_url()
                    .or_else(|| providers.configured().map(|c| c.central_origin.clone()))
                    .and_then(|origin| {
                        silverbullet_server::auth::oidc::config::validated_url(&origin).ok()
                    })
                    .is_some_and(|origin| origin.origin() == url.origin());
                if !configured_host && !central_host {
                    return None;
                }
                let (_, prefix) = table.resolve_main(&host_scope, url.path())?;
                Some(format!("{prefix}/"))
            }),
        )?
        .with_primary_url(Arc::new(move || primary_manager.primary_url()))
        .with_server_name(Arc::new(move || name_manager.server_name())),
    );
    let dashboard_state = Arc::new(DashboardState::new(
        manager.clone(),
        store,
        authenticator,
        session,
        Box::new(EmbeddedSpace::<ClientAssets>::new()),
    ));
    let router = build_main_router(
        manager,
        Some(build_dashboard_router(
            dashboard_state,
            build_admin_api_router(admin_state),
        )),
        crate::VERSION.to_string(),
    )
    .merge(silverbullet_server::handlers::central_auth::router(central));
    let addr = format!("{}:{}", config.bind_host, config.port);
    let log = format!(
        "SilverBullet multi-space server running: http://{addr} (Dashboard at /.dashboard)"
    );
    Ok((router, log))
}

pub(crate) async fn run_multi(
    config: Config,
    shutdown: crate::server::Shutdown,
) -> Result<(), String> {
    let (router, log) = build_multi_stack(&config, Some(shutdown.rx.clone())).await?;
    let addr = format!("{}:{}", config.bind_host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    tracing::info!("{log}");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown.future)
        .await
        .map_err(|e| format!("server error: {e}"))
}

pub(crate) fn space_runtime_factory(
    server_root: &std::path::Path,
    single_instance: bool,
) -> (RuntimeFactory, RuntimeAvailability) {
    use silverbullet_server_runtime_chrome::RuntimeUnavailable;

    let (pool, availability) = match if single_instance {
        silverbullet_server_runtime_chrome::ChromeConfig::from_env(server_root)
    } else {
        silverbullet_server_runtime_chrome::ChromeConfig::from_env_for_multi(server_root)
    } {
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
    let factory: RuntimeFactory = Arc::new(move |req: &RuntimeRequest| {
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
