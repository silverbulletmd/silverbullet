//! Multi-space mode wiring: env validation, embedded-asset and Chrome-runtime
//! factories, unified /.dashboard surface construction, and the serve loop.

use std::path::PathBuf;
use std::sync::Arc;

use silverbullet_server::auth::mcp::cimd::CimdFetcher;
use silverbullet_server::auth::mcp::clients::ClientRegistry;
use silverbullet_server::auth::mcp::grants::GrantStore;
use silverbullet_server::auth::mcp::{wall_clock, McpOAuthState};
use silverbullet_server::auth::oauth::CodeStore;
use silverbullet_server::auth::{
    Authenticator, BrowserSessions, LoginManager, MULTI_AUTH_FILE_NAME,
};
use silverbullet_server::handlers::mcp_oauth::{self, SessionConsent};
use silverbullet_server::metrics::Metrics;
use silverbullet_server::multi::access::SessionPolicy;
use silverbullet_server::multi::admin_api::{build_admin_api_router, AdminState, McpAvailability};
use silverbullet_server::multi::dashboard::{build_dashboard_router, DashboardState};
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{
    AssetFactories, InstanceAuth, InstanceDeps, RuntimeFactory, RuntimeRequest,
};
use silverbullet_server::multi::manager::MultiManager;
use silverbullet_server::multi::users::UserStore;
use silverbullet_server::runtime::RuntimeAvailability;
use silverbullet_server_common::space::BUNDLED_COPY_ON_WRITE;
use silverbullet_server_common::SpacePrimitives;
use silverbullet_server_mcp::{MultiHost, Tools};

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
    let mcp_env_enabled = !env_off("SB_MCP");
    if !mcp_env_enabled {
        tracing::info!("MCP disabled by SB_MCP=0");
    }
    let mcp_stores = load_mcp_stores(&root);
    let mcp_availability = if !mcp_env_enabled {
        McpAvailability::DisabledByEnv
    } else if let Err(message) = &mcp_stores {
        McpAvailability::Failed {
            message: message.clone(),
        }
    } else {
        McpAvailability::Available
    };
    let mcp_stores = mcp_stores.ok();

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
            base_fs: Box::new(|| {
                Box::new(
                    EmbeddedSpace::<BaseFsAssets>::new().with_copy_on_write(BUNDLED_COPY_ON_WRITE),
                )
            }),
        },
        runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
        runtime_availability: runtime_availability.clone(),
        // Set from server.json when the manager boots.
        runtime_idle_timeout: Default::default(),
        default_font: Default::default(),
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
        search: silverbullet_server::search::SpaceSearch::in_root(
            silverbullet_server::search::search_root(&root),
        ),
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
    let mut admin_state = AdminState::new(
        manager.clone(),
        store.clone(),
        authenticator.clone(),
        runtime_availability,
    )
    .with_provider_store(providers.clone());
    admin_state = match &mcp_stores {
        Some((_, grants)) => admin_state.with_mcp(grants.clone(), mcp_availability),
        None => admin_state.with_mcp_availability(mcp_availability),
    };
    let admin_state = Arc::new(admin_state);
    let version_store = store.clone();
    let users = store.clone();
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
    let font_manager = manager.clone();
    let central = Arc::new(
        silverbullet_server::handlers::central_auth::CentralAuth::new(
            providers.clone(),
            authenticator.clone(),
            store.clone(),
            central_login.clone(),
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
        .with_server_name(Arc::new(move || name_manager.server_name()))
        .with_default_font(Arc::new(move || font_manager.default_font())),
    );
    let mut dashboard_state = DashboardState::new(
        manager.clone(),
        store,
        authenticator.clone(),
        session,
        Box::new(EmbeddedSpace::<ClientAssets>::new()),
    );
    if let Some((_, grants)) = &mcp_stores {
        dashboard_state = dashboard_state.with_mcp_grants(grants.clone());
    }
    let dashboard_state = Arc::new(dashboard_state);
    let mcp_stores_loaded = mcp_stores.is_some();
    let gate = manager.clone();
    let mcp_enabled: Arc<dyn Fn() -> bool + Send + Sync> =
        Arc::new(move || mcp_env_enabled && mcp_stores_loaded && gate.mcp_enabled());
    let oauth = mcp_stores
        .as_ref()
        .map(|(_, grants)| (authenticator.clone(), grants.clone()));
    let (mcp, mcp_host) = mcp_router(&manager, &users, oauth, mcp_enabled.clone());
    let mut router = build_main_router(
        manager,
        Some(build_dashboard_router(
            dashboard_state,
            build_admin_api_router(admin_state),
        )),
        crate::VERSION.to_string(),
    )
    .merge(silverbullet_server::handlers::central_auth::router(central))
    .merge(mcp);
    if let Some((clients, grants)) = mcp_stores {
        spawn_client_gc(clients.clone(), grants.clone());
        let state = Arc::new(McpOAuthState {
            authenticator,
            accounts: mcp_host,
            clients,
            cimd: Arc::new(CimdFetcher::new()),
            grants,
            codes: CodeStore::new(),
            consent: Arc::new(SessionConsent {
                csrf: central_login,
                bundle: Box::new(EmbeddedSpace::<ClientAssets>::new()),
            }),
            now: wall_clock(),
        });
        router = router.merge(mcp_oauth::router(state, mcp_enabled));
    }
    let log = format!(
        "SilverBullet multi-space server running: {} (Dashboard at /.dashboard)",
        crate::server::startup_url(&config.bind_host, config.port)
    );
    Ok((router, log))
}

/// `0` or `false` turns an `SB_MCP*` switch off; anything else leaves it on.
fn env_off(key: &str) -> bool {
    matches!(std::env::var(key).as_deref(), Ok("0") | Ok("false"))
}

/// The embedded `Library/Std` pages, the skills `help` lists for a space
/// whose runtime cannot answer.
fn bundled_std_pages() -> Vec<(String, Vec<u8>)> {
    let base = EmbeddedSpace::<BaseFsAssets>::new();
    base.fetch_file_list()
        .unwrap_or_default()
        .into_iter()
        .filter(|meta| meta.name.starts_with("Library/Std/") && meta.name.ends_with(".md"))
        .filter_map(|meta| {
            let (bytes, _) = base.read_file(&meta.name).ok()?;
            Some((meta.name, bytes))
        })
        .collect()
}

/// `/.mcp` for multi-space mode. `enabled` covers the admin toggle
/// (`server.json`, applied without a restart) and `SB_MCP=0`; when false the
/// endpoint answers 404. The host is also the authorization server's
/// account host.
fn mcp_router(
    manager: &Arc<MultiManager>,
    users: &Arc<UserStore>,
    oauth: Option<(Arc<Authenticator>, Arc<GrantStore>)>,
    enabled: Arc<dyn Fn() -> bool + Send + Sync>,
) -> (axum::Router, Arc<MultiHost>) {
    let mut host = MultiHost::new(manager.clone(), users.clone());
    if let Some((authenticator, grants)) = oauth {
        host = host.with_oauth(authenticator, grants);
    }
    let host = Arc::new(host);
    let tools =
        Arc::new(Tools::new(host.clone(), crate::VERSION).with_bundled_pages(bundled_std_pages()));
    let router = silverbullet_server_mcp::mcp_router_gated(tools, host.clone(), enabled);
    (router, host)
}

/// The MCP grant and client stores. A corrupt or unwritable file turns MCP
/// off (OAuth routes and `/.mcp`) instead of stopping the server.
fn load_mcp_stores(
    root: &std::path::Path,
) -> Result<(Arc<ClientRegistry>, Arc<GrantStore>), String> {
    let clients = ClientRegistry::load(root).map_err(|e| {
        tracing::error!("MCP is off: could not load MCP client registrations: {e}");
        format!("could not load MCP client registrations: {e}")
    })?;
    let grants = GrantStore::load(root).map_err(|e| {
        tracing::error!("MCP is off: could not load MCP grants: {e}");
        format!("could not load MCP grants: {e}")
    })?;
    Ok((Arc::new(clients), Arc::new(grants)))
}

/// Drops stale client registrations now and once a day.
fn spawn_client_gc(clients: Arc<ClientRegistry>, grants: Arc<GrantStore>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 3600));
        loop {
            interval.tick().await;
            let now = (wall_clock())();
            let (clients, grants) = (clients.clone(), grants.clone());
            let _ = tokio::task::spawn_blocking(move || {
                clients.gc(now, &|id| grants.has_live_grant_for_client(id, now))
            })
            .await;
        }
    });
}

pub(crate) async fn run_multi(
    config: Config,
    shutdown: crate::server::Shutdown,
) -> Result<(), String> {
    for (var, value) in [
        ("SB_SEARCH_DIR", &config.search_dir),
        ("SB_SEARCH_MODEL", &config.search_model),
    ] {
        if value.is_some() {
            tracing::warn!("{var} applies to single-space mode only and is ignored; a multi-space server keeps search under search/ in its data folder and names its model in server.json");
        }
    }
    if config.runtime_idle_timeout.is_some() {
        tracing::warn!("SB_RUNTIME_IDLE_TIMEOUT applies to single-space mode only and is ignored; a multi-space server sets runtimeIdleTimeout in server.json (Admin → APIs)");
    }
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
    let profile_root = std::fs::canonicalize(server_root).unwrap_or_else(|_| server_root.into());
    let factory: RuntimeFactory = Arc::new(move |req: &RuntimeRequest| {
        let pool = pool.as_ref()?;
        if req.read_only {
            return None;
        }
        let page = silverbullet_server_runtime_chrome::SpacePage {
            server_url: req.server_url.clone(),
            headless_token: req.headless_token.to_string(),
            cookie_name: silverbullet_server::auth::headless_cookie_name(req.space_id),
            profile: silverbullet_server_runtime_chrome::profile_dir_name(
                &profile_root,
                req.space_id,
                req.username,
            ),
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
