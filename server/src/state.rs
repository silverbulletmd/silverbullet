use std::sync::Arc;

use silverbullet_server_common::{BootConfig, SpacePrimitives};

use crate::auth::RequestAuthorizer;
use crate::metrics::Metrics;
use crate::runtime::RuntimeBackend;
use crate::shell::ShellConfig;

/// Shared dependencies for the OIDC flow, threaded from `InstanceDeps` into
/// `ServerState` so the main-router OIDC handlers can access them without
/// reaching into the spaces router's private state.
#[cfg(feature = "oidc")]
pub struct OidcDeps {
    pub oidc: Arc<crate::auth::oidc::OidcState>,
    pub users: Arc<crate::multi::users::UserStore>,
    pub authenticator: Arc<crate::auth::authenticator::Authenticator>,
}

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
    /// PWA theme color (`SB_THEME_COLOR`), surfaced in the generated
    /// `manifest.json`. Defaults to `#e1e1e1`.
    pub theme_color: String,
    /// Space description (`SB_DESCRIPTION`), surfaced in the generated
    /// `manifest.json`.
    pub space_description: String,
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
    /// Lua runtime backend for `/.runtime/*`. May be disabled, when None: those endpoints 503.
    pub runtime: Option<Arc<dyn RuntimeBackend>>,
    /// Broadcast channel of file-system change events, backing `GET /.events`.
    /// `None` (non-disk backend or watcher unavailable) -> the endpoint 404s
    /// and clients fall back to polling.
    pub fs_events: Option<tokio::sync::broadcast::Sender<crate::watcher::FsEvent>>,
    /// Fires once when the process begins shutting down. `/.events` races its
    /// SSE stream against this so the response body ends and graceful
    /// shutdown can drain the connection instead of waiting on it forever.
    /// `None` (the default for tests and embedders that manage their own
    /// process lifetime, e.g. the App) means "never fires" -- a stream then
    /// simply runs until the client disconnects, today's behavior.
    pub shutdown: Option<tokio::sync::watch::Receiver<()>>,
    /// Per-space content-hash cache, per-path mutation locks, and the
    /// expected-write attribution map for conditional `/.fs` writes. Shared
    /// (`Arc`) with the space's fs watcher, which consults the same map to
    /// enrich the events it emits.
    pub fs_guard: Arc<crate::fs_guard::FsGuard>,
    /// Git-backed revision history for this space. `None` when revisions are
    /// disabled, or when `Managed` mode could not initialize a repo.
    pub revisions: Option<Arc<crate::revisions::RevisionEngine>>,
    /// Turns a request's verified username into a full identity (see
    /// `auth::IdentityResolver`). `username_only()` for a server with no
    /// profile store behind it.
    pub identity: Arc<dyn crate::auth::IdentityResolver>,
    /// Per-space OIDC dependencies (provider client + account store +
    /// authenticator). `None` when the `oidc` feature is disabled,
    /// `SB_OIDC_ISSUER` is unset, discovery failed, or the space is not
    /// accounts-managed.
    #[cfg(feature = "oidc")]
    pub oidc_deps: Option<OidcDeps>,
}
