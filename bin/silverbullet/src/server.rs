//! Server entry point: parse `Config` from the environment + CLI flags, then
//! dispatch to multi-space or single-space serving.

use std::future::Future;
use std::pin::Pin;

use crate::config::Config;

pub async fn run(
    hostname: Option<String>,
    port: Option<u16>,
    folder: Option<String>,
    single: bool,
) -> Result<(), String> {
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
    match crate::boot::detect(&root, single, &|k| std::env::var(k).ok())? {
        crate::boot::BootMode::Single => crate::single::run_single(config, shutdown).await,
        crate::boot::BootMode::Setup => crate::boot::run_setup_server(config, shutdown).await,
        crate::boot::BootMode::Multi => crate::multi::run_multi(config, shutdown).await,
    }
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

pub(crate) async fn serve_tcp(
    host: &str,
    port: u16,
    router: axum::Router,
    shutdown: Shutdown,
) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    let shown = startup_url(host, port);
    tracing::info!("SilverBullet is now running: {shown}");
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
) -> Result<(), String> {
    let _ = std::fs::remove_file(path); // clear a stale socket
    let listener = tokio::net::UnixListener::bind(path)
        .map_err(|e| format!("failed to bind unix socket {path}: {e}"))?;
    tracing::info!("SilverBullet is now running: unix://{path}");
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
}
