//! Multi-space mode wiring: env validation, embedded-asset and Chrome-runtime
//! factories, admin stack construction, and the serve loop.

use std::path::PathBuf;
use std::sync::Arc;

use silverbullet_server::auth::{AuthConfig, Authenticator};
use silverbullet_server::metrics::Metrics;
use silverbullet_server::multi::admin_api::{build_admin_router, AdminState};
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{AssetFactories, InstanceDeps, RuntimeRequest};
use silverbullet_server::multi::listeners::run_listener_manager;
use silverbullet_server::multi::manager::MultiManager;

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
];

pub async fn run_multi(config: Config) -> Result<(), String> {
    if config.unix_socket.is_some() {
        return Err("SB_UNIX_SOCKET is not supported in multi-space mode".into());
    }
    let admin_auth = AuthConfig::from_env().map_err(|e| e.0)?.ok_or_else(|| {
        "multi-space mode requires SB_USER (admin credentials, user:pass format)".to_string()
    })?;
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

    let admin_authenticator = Arc::new(
        Authenticator::load_or_init(&root, &admin_auth)
            .map_err(|e| format!("could not initialize admin authentication: {e}"))?,
    );
    tracing::info!(
        "multi-space admin authentication enabled for user {:?}",
        admin_auth.user
    );

    let metrics = config.metrics_port.map(|_| Arc::new(Metrics::new()));
    let deps = InstanceDeps {
        root: root.clone(),
        assets: AssetFactories {
            client_bundle: Box::new(|| Box::new(EmbeddedSpace::<ClientAssets>::new())),
            base_fs: Box::new(|| Box::new(EmbeddedSpace::<BaseFsAssets>::new())),
        },
        runtime: Box::new(build_space_runtime),
        metrics: metrics.clone(),
        admin_auth: admin_auth.clone(),
        version: crate::VERSION.to_string(),
        main_port: config.port,
        disable_service_worker: config.disable_service_worker,
    };

    let manager = MultiManager::boot(root, deps, config.port, config.metrics_port)?;
    tracing::info!(
        "SilverBullet multi-space mode: {} space(s) configured",
        manager.registry().current().instances.len()
    );

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

    // Per-port space listeners.
    tokio::spawn(run_listener_manager(
        manager.clone(),
        config.bind_host.clone(),
    ));

    // Main listener: admin + prefix/host spaces.
    let admin_state = Arc::new(AdminState::new(
        manager.clone(),
        admin_authenticator,
        admin_auth,
        Box::new(EmbeddedSpace::<ClientAssets>::new()),
    ));
    let router = build_main_router(manager, build_admin_router(admin_state));
    let addr = format!("{}:{}", config.bind_host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    tracing::info!("SilverBullet multi-space server running: http://{addr} (admin at /.admin/)");
    axum::serve(listener, router)
        .with_graceful_shutdown(crate::server::shutdown_signal())
        .await
        .map_err(|e| format!("server error: {e}"))
}

/// Per-space headless-Chrome runtime factory (same construction as the
/// single-space `build_runtime`).
fn build_space_runtime(
    req: &RuntimeRequest,
) -> Option<Box<dyn silverbullet_server::runtime::RuntimeBackend>> {
    let chrome_cfg = silverbullet_server_runtime_chrome::ChromeConfig::from_env(
        req.server_url.clone(),
        req.headless_token.to_string(),
        req.space_folder,
        req.read_only,
    )?;
    let logs = silverbullet_server::runtime::LogBuffer::new();
    match silverbullet_server_runtime_chrome::ChromeTransport::launch(chrome_cfg, logs.clone()) {
        Ok(transport) => Some(Box::new(silverbullet_server::runtime::ClientRuntime::new(
            transport, logs,
        ))),
        Err(e) => {
            tracing::warn!("runtime disabled for space: could not launch Chrome: {e}");
            None
        }
    }
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
