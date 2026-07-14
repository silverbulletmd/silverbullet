//! Dynamically managed TCP listeners for port-bound spaces. Reconciles the
//! bound-port set against the routing table on every config change. Each port
//! serves whatever instance the CURRENT table maps it to, so editing a space
//! swaps content without rebinding; only adding/removing ports touches sockets.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Router;
use tower::ServiceExt;

use crate::multi::instance::InstanceStatus;
use crate::multi::manager::MultiManager;

/// Reconcile-on-change loop: bind an initial set of listeners, then re-reconcile
/// on every config change until the manager is dropped (watch channel closes).
pub async fn run_listener_manager(manager: Arc<MultiManager>, bind_host: String) {
    let mut rx = manager.subscribe_changes();
    let mut tasks: HashMap<u16, tokio::task::JoinHandle<()>> = HashMap::new();
    loop {
        reconcile(&manager, &bind_host, &mut tasks).await;
        if rx.changed().await.is_err() {
            break; // manager dropped — shut down
        }
    }
}

async fn reconcile(
    manager: &Arc<MultiManager>,
    bind_host: &str,
    tasks: &mut HashMap<u16, tokio::task::JoinHandle<()>>,
) {
    let wanted: HashSet<u16> = manager.registry().current().ports().into_iter().collect();

    // Unbind removed ports.
    let stale: Vec<u16> = tasks
        .keys()
        .filter(|p| !wanted.contains(p))
        .copied()
        .collect();
    for port in stale {
        if let Some(handle) = tasks.remove(&port) {
            handle.abort();
            manager.set_bind_error(port, None);
            tracing::info!("unbound space port {port}");
        }
    }

    // Bind new ports.
    for port in wanted {
        if tasks.contains_key(&port) {
            continue;
        }
        match tokio::net::TcpListener::bind((bind_host, port)).await {
            Ok(listener) => {
                manager.set_bind_error(port, None);
                let router = port_router(manager.clone(), port);
                tracing::info!("space listening on http://{bind_host}:{port}");
                let handle = tokio::spawn(async move {
                    let _ = axum::serve(listener, router).await;
                });
                tasks.insert(port, handle);
            }
            Err(e) => {
                tracing::warn!("could not bind space port {port}: {e}");
                manager.set_bind_error(port, Some(format!("could not bind port {port}: {e}")));
            }
        }
    }
}

/// Router for one dedicated port: every request resolves the port's current
/// instance from the live registry, so editing a port-bound space swaps content
/// without rebinding.
fn port_router(manager: Arc<MultiManager>, port: u16) -> Router {
    Router::new()
        .fallback(serve_port)
        .with_state((manager, port))
}

async fn serve_port(
    State((manager, port)): State<(Arc<MultiManager>, u16)>,
    req: Request,
) -> Response {
    let Some(inst) = manager.registry().current().resolve_port(port) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "No space bound to this port",
        )
            .into_response();
    };
    match inst.router.clone() {
        Some(router) => match router.oneshot(req).await {
            Ok(resp) => resp,
            Err(never) => match never {},
        },
        None => {
            let reason = match &inst.status {
                InstanceStatus::Errored(r) => r.clone(),
                _ => "space unavailable".into(),
            };
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("Space unavailable: {reason}"),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceDeps};
    use crate::multi::manager::MultiManager;
    use silverbullet_server_common::space::MemorySpacePrimitives;

    fn deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_| None),
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

    fn payload(name: &str, port: u16) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding: Binding::Port { port },
            auth: SpaceAuth::None,
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

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    /// Minimal HTTP GET over a raw socket (no client dependency needed).
    async fn http_get_status(port: u16, path: &str) -> Option<u16> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .ok()?;
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = String::new();
        stream.read_to_string(&mut buf).await.ok()?;
        buf.split_whitespace().nth(1)?.parse().ok()
    }

    async fn wait_for_status(port: u16, path: &str, want: u16) -> bool {
        for _ in 0..100 {
            if http_get_status(port, path).await == Some(want) {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        false
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ports_bind_serve_and_unbind_with_config() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), 3000, None).unwrap();
        let _task = tokio::spawn(run_listener_manager(m.clone(), "127.0.0.1".into()));

        let port = free_port();
        let id = m.create(payload("P", port)).unwrap();
        assert!(
            wait_for_status(port, "/.ping", 200).await,
            "port space must serve /.ping"
        );

        m.delete(&id).unwrap();
        // After removal the port stops answering (connection refused -> None).
        for _ in 0..100 {
            if http_get_status(port, "/.ping").await.is_none() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("port should have been unbound");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn bind_conflict_marks_space_errored() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), 3000, None).unwrap();
        let _task = tokio::spawn(run_listener_manager(m.clone(), "127.0.0.1".into()));

        // Occupy a port, then configure a space on it.
        let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = blocker.local_addr().unwrap().port();
        let id = m.create(payload("Clash", port)).unwrap();

        for _ in 0..100 {
            let list = m.list();
            if list[&id]["status"]["state"] == "errored" {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("bind conflict should mark the space errored");
    }
}
