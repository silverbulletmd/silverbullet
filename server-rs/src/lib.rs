//! The SilverBullet HTTP server library: an `axum` router over
//! `silverbullet_common`'s synchronous `SpacePrimitives`. Handlers are thin
//! `async` wrappers that delegate storage I/O to `spawn_blocking` so business
//! logic stays synchronous. The router is reusable, so an embedder can mount
//! additional routes on top of it.

pub mod auth;
pub mod handlers;
pub mod router;
pub mod shell;
pub mod state;

pub use router::build_router;
pub use state::AppState;

#[cfg(test)]
mod test_support {
    use crate::state::AppState;
    use silverbullet_common::space::MemorySpacePrimitives;
    use silverbullet_common::BootConfig;
    use std::sync::Arc;

    /// An `AppState` backed by a fresh in-memory space and a fresh in-memory
    /// "bundle" (also a MemorySpacePrimitives). Tests seed files as needed.
    pub fn test_state() -> Arc<AppState> {
        let bundle = MemorySpacePrimitives::new();
        Arc::new(AppState {
            space: Box::new(MemorySpacePrimitives::new()),
            client_bundle: Some(Box::new(bundle)),
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
            authorizer: None,
            shell: crate::shell::ShellConfig {
                enabled: true,
                whitelist: vec![],
            },
        })
    }
}
