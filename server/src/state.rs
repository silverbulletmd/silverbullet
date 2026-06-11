use std::sync::Arc;

use silverbullet_server_common::{BootConfig, SpacePrimitives};

use crate::auth::RequestAuthorizer;
use crate::metrics::Metrics;
use crate::runtime::RuntimeBackend;
use crate::shell::ShellConfig;

/// The version string reported at `/.ping` (`X-Server-Version`). Normally
/// `Static`. The standalone binary uses `Dynamic` in debug builds so the
/// reported version follows a live-rebuilt client bundle (served from disk)
/// without a server restart.
pub enum ServerVersion {
    Static(String),
    Dynamic(Box<dyn Fn() -> String + Send + Sync>),
}

impl ServerVersion {
    /// The current version string.
    pub fn get(&self) -> String {
        match self {
            ServerVersion::Static(v) => v.clone(),
            ServerVersion::Dynamic(f) => f(),
        }
    }
}

impl From<String> for ServerVersion {
    fn from(v: String) -> Self {
        ServerVersion::Static(v)
    }
}

impl From<&str> for ServerVersion {
    fn from(v: &str) -> Self {
        ServerVersion::Static(v.to_string())
    }
}

/// Shared state for the HTTP server. Holds what the file/config/bundle
/// endpoints need; further capabilities (auth, runtime evaluation) attach
/// additional state as they are introduced.
pub struct ServerState {
    /// The space's file storage (user files, with the bundle/base_fs layers
    /// composed in by the caller).
    pub space: Box<dyn SpacePrimitives>,
    /// Read-only client bundle (HTML/CSS/JS) served at the SPA fallback. The
    /// server cannot serve a usable UI without it, so it is required — callers
    /// must fail at startup rather than construct an `ServerState` without one.
    pub client_bundle: Box<dyn SpacePrimitives>,
    /// Boot configuration returned from `/.config`.
    pub boot_config: BootConfig,
    /// Absolute path of the space folder, surfaced in `X-Space-Path` headers.
    pub space_folder_path: String,
    /// Server version, surfaced in `/.ping`'s `X-Server-Version`. The client
    /// compares this against its compiled-in `publicVersion`; a mismatch shows a
    /// "new version available" banner, so it must track the served bundle.
    pub version: ServerVersion,
    /// URL prefix the server is mounted under (e.g. `/wiki`), injected into the
    /// `index.html` `<base href>`. Empty for a root-mounted server.
    pub host_url_prefix: String,
    /// Extra HTML injected into the `<head>` of the served `index.html`
    /// (`SB_HEAD_HTML`). Empty by default.
    pub additional_head_html: String,
    /// Authentication strategy for protected routes. `None` means the server is
    /// open (no authentication).
    pub authorizer: Option<Arc<dyn RequestAuthorizer>>,
    /// The login flow's issuing side (standalone server). `None` mirrors
    /// `authorizer == None` (an open server). Shares the `Authenticator` with
    /// the `authorizer` via `Arc`.
    pub login: Option<Arc<crate::auth::LoginManager>>,
    /// Shell-execution policy for `/.shell`.
    pub shell: ShellConfig,
    /// Request metrics. `None` disables counting and `/metrics`.
    pub metrics: Option<Arc<Metrics>>,
    /// Lua runtime backend for `/.runtime/*`. `None` ⇒ those endpoints 503.
    pub runtime: Option<Box<dyn RuntimeBackend>>,
}
