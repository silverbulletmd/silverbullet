//! Whether this server can serve the Lua Runtime API at all, and if not, why.

use serde::Serialize;

/// Resolved once at server startup and never re-checked. That is deliberate,
/// not a shortcut: the runtime factory captures the same decision for the
/// process lifetime, so a browser installed after boot changes nothing until
/// the server restarts — reporting a fresher answer than the factory can
/// honour would be a lie.
///
/// Serialized internally tagged, so the wire form is `{"status": "no_chrome"}`
/// and `{"status": "failed", "message": "..."}`.
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RuntimeAvailability {
    /// A browser was found (or configured) and the pool was built.
    Available,
    /// No Chrome or Chromium found, and none configured.
    NoChrome,
    /// Turned off server-wide with `SB_RUNTIME_API=0`.
    DisabledByEnv,
    /// A browser was found, but the pool could not be created.
    Failed { message: String },
}
