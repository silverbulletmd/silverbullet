use std::sync::Arc;

use silverbullet_common::{BootConfig, SpacePrimitives};

use crate::auth::RequestAuthorizer;
use crate::shell::ShellConfig;

/// Shared state for the HTTP server. Holds what the file/config/bundle
/// endpoints need; further capabilities (auth, runtime evaluation) attach
/// additional state as they are introduced.
pub struct AppState {
    /// The space's file storage (user files, with the bundle/base_fs layers
    /// composed in by the caller).
    pub space: Box<dyn SpacePrimitives>,
    /// Read-only client bundle (HTML/CSS/JS) served at the SPA fallback.
    /// `None` disables bundle serving (returns 404).
    pub client_bundle: Option<Box<dyn SpacePrimitives>>,
    /// Boot configuration returned from `/.config`.
    pub boot_config: BootConfig,
    /// Absolute path of the space folder, surfaced in `X-Space-Path` headers.
    pub space_folder_path: String,
    /// Server version string, surfaced in `/.ping`'s `X-Server-Version`.
    pub version: String,
    /// Authentication strategy for protected routes. `None` means the server is
    /// open (no authentication).
    pub authorizer: Option<Arc<dyn RequestAuthorizer>>,
    /// Shell-execution policy for `/.shell`.
    pub shell: ShellConfig,
}
