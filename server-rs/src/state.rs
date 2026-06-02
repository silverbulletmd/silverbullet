use std::sync::Arc;

use silverbullet_common::{BootConfig, SpacePrimitives};

use crate::auth::RequestAuthorizer;
use crate::metrics::Metrics;
use crate::runtime::RuntimeBackend;
use crate::shell::ShellConfig;

/// Shared state for the HTTP server. Holds what the file/config/bundle
/// endpoints need; further capabilities (auth, runtime evaluation) attach
/// additional state as they are introduced.
pub struct AppState {
    /// The space's file storage (user files, with the bundle/base_fs layers
    /// composed in by the caller).
    pub space: Box<dyn SpacePrimitives>,
    /// Read-only client bundle (HTML/CSS/JS) served at the SPA fallback. The
    /// server cannot serve a usable UI without it, so it is required — callers
    /// must fail at startup rather than construct an `AppState` without one.
    pub client_bundle: Box<dyn SpacePrimitives>,
    /// Boot configuration returned from `/.config`.
    pub boot_config: BootConfig,
    /// Absolute path of the space folder, surfaced in `X-Space-Path` headers.
    pub space_folder_path: String,
    /// Server version string, surfaced in `/.ping`'s `X-Server-Version`.
    pub version: String,
    /// URL prefix the server is mounted under (e.g. `/wiki`), injected into the
    /// `index.html` `<base href>`. Empty for a root-mounted server.
    pub host_url_prefix: String,
    /// Extra HTML injected into the `<head>` of the served `index.html`
    /// (`SB_HEAD_HTML`). Empty by default.
    pub additional_head_html: String,
    /// Authentication strategy for protected routes. `None` means the server is
    /// open (no authentication).
    pub authorizer: Option<Arc<dyn RequestAuthorizer>>,
    /// Shell-execution policy for `/.shell`.
    pub shell: ShellConfig,
    /// Request metrics. `None` disables counting and `/metrics`.
    pub metrics: Option<Arc<Metrics>>,
    /// Lua runtime backend for `/.runtime/*`. `None` ⇒ those endpoints 503.
    pub runtime: Option<Box<dyn RuntimeBackend>>,
}
