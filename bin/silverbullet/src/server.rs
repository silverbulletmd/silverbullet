//! Server entry point: parse `Config` from the environment + CLI flags, then
//! dispatch to the boot mode the data folder calls for.

use std::future::Future;
use std::pin::Pin;

use crate::config::Config;

pub async fn run(
    hostname: Option<String>,
    port: Option<u16>,
    folder: Option<String>,
    single: bool,
) -> Result<(), String> {
    if single {
        return Err(
            "--single was removed: single-space folders are now migrated to a \
                    multi-space server. Start without --single and open the migration page \
                    the log points to"
                .into(),
        );
    }
    let config = Config::from_env(hostname, port, folder)?;
    tracing::info!("SilverBullet {}", crate::VERSION);

    let shutdown = Shutdown::install();
    let root = std::path::PathBuf::from(&config.data_folder);
    tracing::info!(
        "Data folder: {}",
        root.canonicalize()
            .unwrap_or_else(|_| root.clone())
            .display()
    );
    match crate::boot::detect(&root, &|k| std::env::var(k).ok())? {
        crate::boot::BootMode::Migrate => crate::boot::run_migrate_server(config, shutdown).await,
        crate::boot::BootMode::Setup => crate::boot::run_setup_server(config, shutdown).await,
        crate::boot::BootMode::Multi => crate::multi::run_multi(config, shutdown).await,
    }
}

/// `silverbullet publish`: serve one folder as a public, read-only site from an
/// in-memory configuration. Never looks at the folder as a data root, so
/// migration and setup can't trigger, and writes nothing to disk.
pub async fn run_publish(
    hostname: Option<String>,
    port: Option<u16>,
    folder: Option<String>,
) -> Result<(), String> {
    let env = |k: &str| std::env::var(k).ok();
    let settings = crate::publish::publish_settings(folder, &env)?;
    let config = Config::from_env(
        Some(crate::publish::publish_bind_host(hostname, &env)),
        port,
        Some(settings.folder.to_string_lossy().into_owned()),
    )?;
    tracing::info!("SilverBullet {}", crate::VERSION);

    let shutdown = Shutdown::install();
    let source = crate::multi::StackSource::InMemory(crate::publish::publish_source(&settings));
    let (router, _) =
        crate::multi::build_multi_stack(&config, source, Some(shutdown.rx.clone())).await?;
    let url = match &config.unix_socket {
        Some(_) => listen_address(&config),
        None => format!("{}{}/", listen_address(&config), settings.url_prefix),
    };
    let announce = format!(
        "publishing {} at {url} (read-only, public)",
        settings.folder.display()
    );
    serve_announcing(&config, router, shutdown, Some(&announce)).await
}

/// Shares one OS shutdown signal with the server and its SSE streams.
/// Streams must finish so graceful shutdown can drain their connections.
/// A watch channel retains the signal for receivers that subscribe later.
pub(crate) struct Shutdown {
    pub(crate) rx: tokio::sync::watch::Receiver<()>,
    pub(crate) future: Pin<Box<dyn Future<Output = ()> + Send>>,
}

pub(crate) fn startup_url(host: &str, port: u16) -> String {
    if host == "127.0.0.1" {
        format!("http://localhost:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

impl Shutdown {
    pub(crate) fn install() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(());
        let future = Box::pin(async move {
            wait_for_os_signal().await;
            tracing::info!("shutting down");
            let _ = tx.send(());
        });
        Shutdown { rx, future }
    }
}

/// Where [`serve`] listens, for log lines.
pub(crate) fn listen_address(config: &Config) -> String {
    match &config.unix_socket {
        Some(socket) => format!("unix://{socket}"),
        None => startup_url(&config.bind_host, config.port),
    }
}

/// Serve `router` on `SB_UNIX_SOCKET` when set, otherwise on the TCP bind
/// address. Every listener (setup wizard, migration, multi-space) goes through
/// here so the socket choice is made in one place.
pub(crate) async fn serve(
    config: &Config,
    router: axum::Router,
    shutdown: Shutdown,
) -> Result<(), String> {
    serve_announcing(config, router, shutdown, None).await
}

/// [`serve`], logging `announce` instead of the usual running line once the
/// listener is bound.
pub(crate) async fn serve_announcing(
    config: &Config,
    router: axum::Router,
    shutdown: Shutdown,
    announce: Option<&str>,
) -> Result<(), String> {
    match &config.unix_socket {
        Some(socket) => serve_unix(socket, router, shutdown, announce).await,
        None => serve_tcp(&config.bind_host, config.port, router, shutdown, announce).await,
    }
}

pub(crate) async fn serve_tcp(
    host: &str,
    port: u16,
    router: axum::Router,
    shutdown: Shutdown,
    announce: Option<&str>,
) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    match announce {
        Some(line) => tracing::info!("{line}"),
        None => tracing::info!("SilverBullet is now running: {}", startup_url(host, port)),
    }
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown.future)
        .await
        .map_err(|e| format!("server error: {e}"))
}

#[cfg(unix)]
pub(crate) async fn serve_unix(
    path: &str,
    router: axum::Router,
    shutdown: Shutdown,
    announce: Option<&str>,
) -> Result<(), String> {
    let _ = std::fs::remove_file(path); // clear a stale socket
    let listener = tokio::net::UnixListener::bind(path)
        .map_err(|e| format!("failed to bind unix socket {path}: {e}"))?;
    match announce {
        Some(line) => tracing::info!("{line}"),
        None => tracing::info!("SilverBullet is now running: unix://{path}"),
    }
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown.future)
        .await
        .map_err(|e| format!("server error: {e}"))
}

#[cfg(not(unix))]
pub(crate) async fn serve_unix(
    _path: &str,
    _router: axum::Router,
    _shutdown: Shutdown,
    _announce: Option<&str>,
) -> Result<(), String> {
    Err("unix sockets are not supported on this platform".to_string())
}

/// Resolves when the process receives SIGINT (Ctrl-C) or SIGTERM.
async fn wait_for_os_signal() {
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
}

#[cfg(test)]
mod tests {
    #[test]
    fn startup_url_shows_localhost_for_default_loopback_binding() {
        assert_eq!(
            super::startup_url("127.0.0.1", 3000),
            "http://localhost:3000"
        );
    }

    #[test]
    fn startup_url_preserves_other_bind_hosts() {
        assert_eq!(super::startup_url("0.0.0.0", 4000), "http://0.0.0.0:4000");
    }

    #[test]
    fn listen_address_names_the_unix_socket() {
        let mut config =
            crate::config::Config::from_env(None, Some(3000), Some("./notes".into())).unwrap();
        config.unix_socket = None;
        assert_eq!(super::listen_address(&config), "http://localhost:3000");
        config.unix_socket = Some("sb.sock".into());
        assert_eq!(super::listen_address(&config), "unix://sb.sock");
    }
}
