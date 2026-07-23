//! Server entry point: parse `Config` from the environment + CLI flags, then
//! dispatch to multi-space or single-space serving.

use crate::config::Config;

pub async fn run(
    hostname: Option<String>,
    port: Option<u16>,
    folder: Option<String>,
    single: bool,
) -> Result<(), String> {
    let config = Config::from_env(hostname, port, folder)?;
    tracing::info!("SilverBullet {}", crate::VERSION);

    let root = std::path::PathBuf::from(&config.space_folder);
    match crate::boot::detect(&root, single, &|k| std::env::var(k).ok())? {
        crate::boot::BootMode::Single => crate::single::run_single(config).await,
        crate::boot::BootMode::Setup => crate::boot::run_setup_server(config).await,
        crate::boot::BootMode::Multi => crate::multi::run_multi(config).await,
    }
}

pub(crate) async fn serve_tcp(host: &str, port: u16, router: axum::Router) -> Result<(), String> {
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
pub(crate) async fn serve_unix(path: &str, router: axum::Router) -> Result<(), String> {
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
pub(crate) async fn serve_unix(_path: &str, _router: axum::Router) -> Result<(), String> {
    Err("unix sockets are not supported on this platform".to_string())
}

/// Resolve when the process receives SIGINT (Ctrl-C) or SIGTERM.
pub(crate) async fn shutdown_signal() {
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
