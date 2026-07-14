//! The SilverBullet HTTP server library: an `axum` router over
//! `silverbullet_server_common`'s synchronous `SpacePrimitives`. Handlers are thin
//! `async` wrappers that delegate storage I/O to `spawn_blocking` so business
//! logic stays synchronous. The router is reusable, so an embedder can mount
//! additional routes on top of it.

pub mod auth;
pub mod handlers;
pub mod metrics;
pub mod multi;
pub mod router;
pub mod runtime;
pub mod shell;
mod ssr;
pub mod state;

pub use router::{build_router, metrics_router};
pub use state::{ServerState, ServerVersion};

#[cfg(test)]
mod test_support {
    use crate::state::ServerState;
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use silverbullet_server_common::BootConfig;

    /// An `ServerState` backed by a fresh in-memory space and a fresh in-memory
    /// "bundle" (also a MemorySpacePrimitives). Tests seed files as needed.
    pub fn test_state() -> ServerState {
        let bundle = MemorySpacePrimitives::new();
        ServerState {
            space: Box::new(MemorySpacePrimitives::new()),
            client_bundle: Box::new(bundle),
            boot_config: BootConfig {
                space_folder_path: "/tmp".into(),
                space_name: "Test".into(),
                index_page: "index".into(),
                read_only: false,
                log_push: false,
                enable_client_encryption: false,
                shell_backend: "local".into(),
                disable_service_worker: true,
            },
            space_folder_path: "/tmp".into(),
            version: "test-version".into(),
            host_url_prefix: String::new(),
            additional_head_html: String::new(),
            theme_color: "#e1e1e1".into(),
            space_description: "Powerful and programmable note taking app".into(),
            authorizer: None,
            login: None,
            shell: crate::shell::ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
            metrics: None,
            runtime: None,
        }
    }
}
