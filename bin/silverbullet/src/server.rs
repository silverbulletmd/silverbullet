//! Wire `Config` + the embedded bundle into the server crate's `ServerState`,
//! then serve it.

use std::sync::Arc;

use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

use silverbullet_server::auth::{
    AuthConfig, Authenticator, HeadlessTokenAuthorizer, JwtAuthorizer, LockoutTimer, LoginManager,
    RequestAuthorizer,
};
use silverbullet_server::shell::ShellConfig;
use silverbullet_server::{metrics::Metrics, ServerState, ServerVersion};
use silverbullet_server_common::space::{
    DiskSpacePrimitives, FallthroughSpacePrimitives, ReadOnlySpacePrimitives,
};
use silverbullet_server_common::{BootConfig, SpacePrimitives};

use crate::config::Config;
use crate::embed::{BaseFsAssets, ClientAssets, EmbeddedSpace};

const DEFAULT_INDEX_MD: &str = include_str!("../space_template/index.md");

/// Absolute path to the generated `version.json` baked at compile time (dev
/// machine). Used only by debug builds (see [`server_version`]).
const VERSION_JSON_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../version.json");

/// How `/.ping` reports the server version.
///
/// Release builds embed the bundle and report the compile-time [`crate::VERSION`].
/// Debug builds serve the bundle from disk (rust-embed reads it live), so a
/// frontend rebuild swaps in a client with a new `publicVersion`; we therefore
/// re-read `version.json` on each ping so the reported version follows it
/// without a server restart (otherwise the client shows a perpetual
/// "new version available" banner). Falls back to the baked version on any error.
fn server_version() -> ServerVersion {
    if cfg!(debug_assertions) {
        ServerVersion::Dynamic(Box::new(|| {
            read_version().unwrap_or_else(|| crate::VERSION.to_string())
        }))
    } else {
        crate::VERSION.into()
    }
}

/// Read `version` from the generated `version.json` (`{ "version": "…" }`).
fn read_version() -> Option<String> {
    let src = std::fs::read_to_string(VERSION_JSON_PATH).ok()?;
    let value: serde_json::Value = serde_json::from_str(&src).ok()?;
    let v = value.get("version")?.as_str()?.trim();
    (!v.is_empty()).then(|| v.to_string())
}

/// The verifying side (request authorizer) plus the issuing side (login manager)
/// of authentication, built together so they share one `Authenticator`.
type Auth = (Arc<dyn RequestAuthorizer>, Arc<LoginManager>);

/// Generate a random 256-bit token, hex-encoded. Used to authorize the headless
/// browser page (passed as `?token=` and accepted by `HeadlessTokenAuthorizer`).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG must be available");
    let mut s = String::with_capacity(64);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Build the authorizer (verifying side) and `LoginManager` (issuing side) from
/// `SB_USER`/`SB_AUTH_TOKEN`/lockout/remember-me env. `None` = an open server.
/// Both share one `Authenticator` (and its persisted secret + salt).
///
/// When auth is enabled, the `JwtAuthorizer` is wrapped with
/// `HeadlessTokenAuthorizer` so the headless browser page can authenticate via
/// the always-generated `headless_token` (`?token=`).
fn build_auth(config: &Config, headless_token: &str) -> Result<Option<Auth>, String> {
    let Some(auth_config) = AuthConfig::from_env().map_err(|e| e.0)? else {
        return Ok(None);
    };
    let authenticator = Arc::new(
        Authenticator::load_or_init(std::path::Path::new(&config.space_folder), &auth_config)
            .map_err(|e| format!("could not initialize authentication: {e}"))?,
    );
    tracing::info!(
        "user authentication enabled for user {:?}",
        auth_config.user
    );
    let inner: Box<dyn RequestAuthorizer> = Box::new(JwtAuthorizer::new(
        authenticator.clone(),
        auth_config.auth_token.clone(),
    ));
    let authorizer: Arc<dyn RequestAuthorizer> = Arc::new(HeadlessTokenAuthorizer::new(
        inner,
        headless_token.to_string(),
    ));
    let lockout =
        LockoutTimer::from_config(auth_config.lockout_time_secs, auth_config.lockout_limit);
    let login = Arc::new(LoginManager::new(
        authenticator,
        auth_config,
        lockout,
        config.host_url_prefix.clone(),
    ));
    Ok(Some((authorizer, login)))
}

/// Build the headless-Chrome runtime backend, or `None` when the runtime API is
/// disabled (SB_RUNTIME_API off, read-only, or no Chrome found) or Chrome fails
/// to launch. The transport connects to the server once its listener is up.
fn build_runtime(
    config: &Config,
    headless_token: &str,
) -> Option<Box<dyn silverbullet_server::runtime::RuntimeBackend>> {
    let server_url = format!("http://127.0.0.1:{}{}", config.port, config.host_url_prefix);
    let chrome_cfg = silverbullet_server_runtime_chrome::ChromeConfig::from_env(
        server_url,
        headless_token.to_string(),
        &config.space_folder,
        config.read_only,
    )?;
    let logs = silverbullet_server::runtime::LogBuffer::new();
    match silverbullet_server_runtime_chrome::ChromeTransport::launch(chrome_cfg, logs.clone()) {
        Ok(transport) => {
            tracing::info!(
                "headless Chrome runtime configured (launches on first runtime request)"
            );
            Some(Box::new(silverbullet_server::runtime::ClientRuntime::new(
                transport, logs,
            )))
        }
        Err(e) => {
            tracing::warn!("Runtime API disabled: could not launch Chrome: {e}");
            None
        }
    }
}

/// Build the `ServerState` for the configured space.
fn build_state(config: &Config) -> Result<ServerState, String> {
    // Disk space (the user's files), optionally read-only, with the embedded
    // base_fs as a read-only underlay (disk is primary + writable).
    let disk = DiskSpacePrimitives::new(&config.space_folder, &config.gitignore)
        .map_err(|e| format!("failed to open space folder {}: {e}", config.space_folder))?;

    // Seed an index page into a brand-new empty space (before composing base_fs,
    // whose .md files would otherwise make the space look non-empty).
    ensure_index(&disk, &config.index_page);

    let disk: Box<dyn SpacePrimitives> = if config.read_only {
        Box::new(ReadOnlySpacePrimitives::new(Box::new(disk)))
    } else {
        Box::new(disk)
    };
    let space: Box<dyn SpacePrimitives> = Box::new(FallthroughSpacePrimitives::new(
        disk,
        Box::new(EmbeddedSpace::<BaseFsAssets>::new()),
    ));

    let metrics = config.metrics_port.map(|_| Arc::new(Metrics::new()));

    // Always generate a headless token: it authorizes the headless browser page
    // when auth is enabled, and is harmlessly ignored by the open server when not.
    let headless_token = generate_token();

    // Bearer/JWT enforcement + browser login when SB_USER is set.
    let (authorizer, login) = match build_auth(config, &headless_token)? {
        Some((a, l)) => (Some(a), Some(l)),
        None => (None, None),
    };

    let boot_config = BootConfig {
        space_folder_path: config.space_folder.clone(),
        space_name: config.space_name.clone(),
        index_page: config.index_page.clone(),
        read_only: config.read_only,
        log_push: config.log_push,
        // Client encryption is offered whenever the space is authenticated;
        // the client only activates it once the login page opts in, which
        // lands with that page in a follow-up.
        enable_client_encryption: authorizer.is_some(),
        shell_backend: if config.read_only {
            "noop".into()
        } else {
            "local".into()
        },
        disable_service_worker: config.disable_service_worker,
    };

    Ok(ServerState {
        space,
        client_bundle: Box::new(EmbeddedSpace::<ClientAssets>::new()),
        boot_config,
        space_folder_path: config.space_folder.clone(),
        version: server_version(),
        host_url_prefix: config.host_url_prefix.clone(),
        additional_head_html: config.additional_head_html.clone(),
        theme_color: config.theme_color.clone(),
        space_description: config.space_description.clone(),
        authorizer,
        login,
        // `ShellConfig::from_env` already disables shell running in read-only
        // mode, so it covers both cases.
        shell: ShellConfig::from_env(config.read_only),
        metrics,
        // Headless-Chrome runtime (None when the runtime API is disabled, the
        // space is read-only, or no Chrome is available); /.runtime/* returns
        // 503 in that case.
        runtime: build_runtime(config, &headless_token),
    })
}

/// Create `{index_page}.md` if the space has no `.md` files yet (a fresh space).
fn ensure_index(space: &impl SpacePrimitives, index_page: &str) {
    match space.fetch_file_list() {
        Ok(files) if files.iter().any(|f| f.name.ends_with(".md")) => return,
        Ok(_) => {}
        Err(e) => {
            tracing::warn!("could not check space state: {e}");
            return;
        }
    }
    let path = format!("{index_page}.md");
    tracing::info!("empty space detected, creating {path}");
    if let Err(e) = space.write_file(&path, DEFAULT_INDEX_MD.as_bytes(), None) {
        tracing::warn!("could not write index page {path}: {e}");
    }
}

pub async fn run(
    hostname: Option<String>,
    port: Option<u16>,
    folder: Option<String>,
) -> Result<(), String> {
    let config = Config::from_env(hostname, port, folder)?;
    tracing::info!("SilverBullet {}", crate::VERSION);
    let state = Arc::new(build_state(&config)?);

    // Optional Prometheus metrics on a separate port.
    if let Some(mport) = config.metrics_port {
        let maddr = format!("{}:{}", config.bind_host, mport);
        let mrouter = silverbullet_server::metrics_router(state.clone());
        let listener = tokio::net::TcpListener::bind(&maddr)
            .await
            .map_err(|e| format!("failed to bind metrics on {maddr}: {e}"))?;
        tracing::info!("metrics on http://{maddr}/metrics");
        tokio::spawn(async move {
            let _ = axum::serve(listener, mrouter)
                .with_graceful_shutdown(shutdown_signal())
                .await;
        });
    }

    let router = silverbullet_server::build_router(state);
    let router = if config.http_logging {
        router.layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
    } else {
        router
    };

    if config.bind_host == "127.0.0.1" {
        tracing::info!(
            "SilverBullet is only available locally; pass -L0.0.0.0 (behind a TLS terminator) to expose it"
        );
    }

    if let Some(socket) = &config.unix_socket {
        serve_unix(socket, router).await
    } else {
        serve_tcp(&config.bind_host, config.port, router).await
    }
}

async fn serve_tcp(host: &str, port: u16, router: axum::Router) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    let shown = if host == "127.0.0.1" {
        format!("http://localhost:{port}")
    } else {
        format!("http://{addr}")
    };
    tracing::info!("SilverBullet is now running: {shown}");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| format!("server error: {e}"))
}

#[cfg(unix)]
async fn serve_unix(path: &str, router: axum::Router) -> Result<(), String> {
    let _ = std::fs::remove_file(path); // clear a stale socket
    let listener = tokio::net::UnixListener::bind(path)
        .map_err(|e| format!("failed to bind unix socket {path}: {e}"))?;
    tracing::info!("SilverBullet is now running: unix://{path}");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| format!("server error: {e}"))
}

#[cfg(not(unix))]
async fn serve_unix(_path: &str, _router: axum::Router) -> Result<(), String> {
    Err("unix sockets are not supported on this platform".to_string())
}

/// Resolve when the process receives SIGINT (Ctrl-C) or SIGTERM.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
