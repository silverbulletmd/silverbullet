//! The OAuth authorization surface for the MCP endpoint (`/.mcp`): resource
//! and issuer URLs, redirect rules, authorization codes and audience-bound
//! tokens. Separate from the legacy per-space `/.auth/*` flow, whose tokens
//! space endpoints accept; MCP tokens are accepted only at `/.mcp`.

pub mod cimd;
pub mod client_auth;
pub mod clients;
pub mod consent;
pub mod grants;
pub mod net;
pub mod redirect;
pub mod resource;
pub mod tokens;

pub use redirect::{is_loopback_redirect, redirect_allowed};
pub use resource::{
    authorization_server_metadata, canonical_mcp_url, canonical_origin, normalize_authority,
    protected_resource_metadata, resource_metadata_url,
};
pub use tokens::{
    McpAccessClaims, McpCodeGrant, McpRefreshClaims, ACCESS_TTL_SECS, REFRESH_TTL_SECS, SCOPE,
};

use std::sync::Arc;

use axum::http::HeaderMap;

use crate::auth::oauth::CodeStore;
use crate::auth::Authenticator;
use cimd::CimdFetcher;
use clients::ClientRegistry;
use consent::ConsentApprover;
use grants::GrantStore;

/// A space the user can grant to an MCP app: one they can write to now.
/// `shared` means someone else (another account or the public) can write to
/// it too, so its pages may carry instructions the user did not write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantableSpace {
    pub id: String,
    pub name: String,
    pub shared: bool,
}

/// The accounts behind the authorization server: who is signed in, what they
/// may grant, and whether a grant made earlier still stands.
pub trait McpAccountHost: Send + Sync {
    fn signed_in_user(&self, headers: &HeaderMap) -> Option<String>;
    fn writable_spaces(&self, username: &str) -> Vec<GrantableSpace>;
    fn credential_version(&self, username: &str) -> Option<String>;
    fn session_is_current(&self, username: &str, version: Option<&str>) -> bool;
    fn login_url(&self, return_to: &str) -> String;
    fn server_name(&self) -> String;
    /// The configured public URL; when set it names the resource and issuer
    /// instead of the request's `Host`.
    fn primary_url(&self) -> Option<String> {
        None
    }
}

pub struct McpOAuthState {
    pub authenticator: Arc<Authenticator>,
    pub accounts: Arc<dyn McpAccountHost>,
    pub clients: Arc<ClientRegistry>,
    pub cimd: Arc<CimdFetcher>,
    pub grants: Arc<GrantStore>,
    pub codes: CodeStore<McpCodeGrant>,
    pub consent: Arc<dyn ConsentApprover>,
    pub now: Arc<dyn Fn() -> u64 + Send + Sync>,
}

/// The wall clock in seconds, the default for [`McpOAuthState::now`].
pub fn wall_clock() -> Arc<dyn Fn() -> u64 + Send + Sync> {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    })
}
