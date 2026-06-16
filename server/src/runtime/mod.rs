//! The Lua runtime seam: a `RuntimeBackend` (consumed by the router), built
//! from a per-backend `ClientTransport` via the shared `ClientRuntime`. This
//! crate ships the seam and a fake transport for tests; real transports
//! (headless Chrome, the App's webview) live elsewhere.

pub mod backend;
pub mod client;
pub mod logs;
pub mod transport;

pub use backend::{RuntimeBackend, RuntimeError};
pub use client::{build_global_call_js, ClientRuntime};
pub use logs::{LogBuffer, LogEntry};
pub use transport::ClientTransport;
