use std::sync::Arc;

use async_trait::async_trait;
use axum::http::header;
use silverbullet_server::auth::access::{AccessLevel, AccessPolicy};
use silverbullet_server::auth::mcp::grants::GrantStore;
use silverbullet_server::auth::mcp::{
    canonical_mcp_url, resource_metadata_url, GrantableSpace, McpAccountHost, SCOPE,
};
use silverbullet_server::auth::Authenticator;
use silverbullet_server::multi::config::Binding;
use silverbullet_server::multi::instance::SpaceInstance;
use silverbullet_server::multi::manager::{MultiManager, VisibleSpace};
use silverbullet_server::multi::policy::SpaceAccessPolicy;
use silverbullet_server::multi::users::UserStore;

use crate::host::{forward, HostError, McpHost, SpaceInfo, SpaceRequest, SpaceResponse};
use crate::{AuthFailure, Authenticate, Caller, CallerCredential};

pub struct MultiHost {
    manager: Arc<MultiManager>,
    users: Arc<UserStore>,
    oauth: Option<OAuth>,
}

struct OAuth {
    authenticator: Arc<Authenticator>,
    grants: Arc<GrantStore>,
}

impl MultiHost {
    pub fn new(manager: Arc<MultiManager>, users: Arc<UserStore>) -> Self {
        Self {
            manager,
            users,
            oauth: None,
        }
    }

    pub fn with_oauth(
        mut self,
        authenticator: Arc<Authenticator>,
        grants: Arc<GrantStore>,
    ) -> Self {
        self.oauth = Some(OAuth {
            authenticator,
            grants,
        });
        self
    }

    /// Computed from the live config on every call so role changes apply at once.
    fn policy(&self, instance: &SpaceInstance) -> SpaceAccessPolicy {
        let config = &instance.config;
        SpaceAccessPolicy::new(
            self.users.clone(),
            config.access(),
            config.members.clone(),
            config.read_only,
        )
    }

    fn writable(&self, instance: &SpaceInstance, username: &str) -> bool {
        self.policy(instance).level_for(Some(username)) == AccessLevel::Write
    }

    /// Whether `caller` may use `instance` now: the user can write to it and
    /// the grant covers it. Only grants are honored here, since `/.mcp` on a
    /// multi-space server authenticates nothing else.
    fn allowed(&self, caller: &Caller, instance: &SpaceInstance) -> bool {
        let granted = match &caller.credential {
            CallerCredential::Grant { spaces, .. } => spaces.contains(&instance.id),
            CallerCredential::Local => false,
        };
        granted && self.writable(instance, &caller.username)
    }

    fn primary_url(&self) -> Option<String> {
        self.manager.primary_url()
    }

    /// The OAuth branch of [`Authenticate`]: a JWT bound to this request's
    /// `/.mcp` URL whose grant is still live, still the user's, and made under
    /// the user's current credentials.
    fn authenticate_grant(
        &self,
        oauth: &OAuth,
        headers: &axum::http::HeaderMap,
        token: &str,
    ) -> Result<Caller, AuthFailure> {
        let audience = canonical_mcp_url(headers, self.primary_url().as_deref());
        let claims = oauth
            .authenticator
            .verify_mcp_access(token, &audience)
            .map_err(|_| AuthFailure::InvalidToken)?;
        let now = now_secs();
        let grant = oauth
            .grants
            .get_live(&claims.grant, now)
            .ok_or(AuthFailure::InvalidToken)?;
        if grant.username != claims.sub
            || grant.client_id != claims.client_id
            || grant.resource != audience
            || !self
                .users
                .session_is_current(&grant.username, grant.credential_version.as_deref())
        {
            return Err(AuthFailure::InvalidToken);
        }
        if !grant.scope.split(' ').any(|scope| scope == SCOPE) {
            return Err(AuthFailure::InsufficientScope);
        }
        oauth.grants.touch(&grant.id, now);
        Ok(Caller {
            username: grant.username,
            credential: CallerCredential::Grant {
                grant_id: grant.id,
                spaces: grant.spaces.into_iter().collect(),
                credential_version: grant.credential_version,
            },
        })
    }

    /// What the space router sees: a short-lived token for this space alone,
    /// since space endpoints refuse MCP access tokens. It does no space check
    /// of its own: callers must gate with `allowed()` first. Public so tests
    /// can check the scope of what `request` forwards.
    #[doc(hidden)]
    pub fn forward_bearer(&self, caller: &Caller, space: &str) -> Result<String, HostError> {
        let unavailable = || HostError::Unavailable(format!("space \"{space}\" is unavailable"));
        let (
            CallerCredential::Grant {
                credential_version, ..
            },
            Some(oauth),
        ) = (&caller.credential, &self.oauth)
        else {
            return Err(unavailable());
        };
        oauth
            .authenticator
            .issue_space_forward_token(&caller.username, credential_version.clone(), space)
            .map_err(|_| unavailable())
    }

    /// The spaces `username` can write to now, by name:
    /// what `spaces` lists and what consent offers.
    fn writable_listing(&self, username: &str) -> Vec<(VisibleSpace, Arc<SpaceInstance>)> {
        let admin = self.users.is_admin(username);
        self.manager
            .list_accessible(username, admin)
            .into_iter()
            .filter_map(|space| {
                let instance = self.manager.instance(&space.id)?;
                self.writable(&instance, username)
                    .then_some((space, instance))
            })
            .collect()
    }
}

impl Authenticate for MultiHost {
    fn authenticate(&self, headers: &axum::http::HeaderMap) -> Result<Caller, AuthFailure> {
        let Some(value) = headers.get(header::AUTHORIZATION) else {
            return Err(AuthFailure::Missing);
        };
        let value = value.to_str().map_err(|_| AuthFailure::InvalidToken)?;
        let (scheme, token) = value.split_once(' ').unwrap_or((value, ""));
        let token = token.trim();
        if !scheme.eq_ignore_ascii_case("bearer") {
            return Err(AuthFailure::InvalidToken);
        }
        if token.is_empty() {
            return Err(AuthFailure::Missing);
        }
        let oauth = self.oauth.as_ref().ok_or(AuthFailure::InvalidToken)?;
        self.authenticate_grant(oauth, headers, token)
    }

    fn resource_metadata(&self, headers: &axum::http::HeaderMap) -> Option<String> {
        self.oauth.as_ref()?;
        Some(resource_metadata_url(
            headers,
            self.primary_url().as_deref(),
        ))
    }
}

impl McpAccountHost for MultiHost {
    fn signed_in_user(&self, headers: &axum::http::HeaderMap) -> Option<String> {
        let oauth = self.oauth.as_ref()?;
        silverbullet_server::multi::access::signed_in_user(
            &oauth.authenticator,
            &self.users,
            headers,
        )
    }

    fn writable_spaces(&self, username: &str) -> Vec<GrantableSpace> {
        self.writable_listing(username)
            .into_iter()
            .map(|(space, instance)| {
                // Admins can write to every space, so counting them would mark
                // every space shared.
                let policy = self.policy(&instance);
                let shared = policy.level_for(None) == AccessLevel::Write
                    || instance.config.members.keys().any(|member| {
                        member != username
                            && self.users.is_enabled(member)
                            && !self.users.is_admin(member)
                            && policy.level_for(Some(member)) == AccessLevel::Write
                    });
                GrantableSpace {
                    id: space.id,
                    name: space.name,
                    shared,
                }
            })
            .collect()
    }

    fn credential_version(&self, username: &str) -> Option<String> {
        self.users.credential_version(username)
    }

    fn session_is_current(&self, username: &str, version: Option<&str>) -> bool {
        self.users.session_is_current(username, version)
    }

    fn login_url(&self, return_to: &str) -> String {
        format!(
            "/.dashboard/login?next={}",
            percent_encoding::utf8_percent_encode(return_to, percent_encoding::NON_ALPHANUMERIC)
        )
    }

    fn server_name(&self) -> String {
        self.manager.server_name()
    }

    fn primary_url(&self) -> Option<String> {
        MultiHost::primary_url(self)
    }
}

#[async_trait]
impl McpHost for MultiHost {
    fn spaces(&self, caller: &Caller) -> Vec<SpaceInfo> {
        self.writable_listing(&caller.username)
            .into_iter()
            .filter(|(_, instance)| self.allowed(caller, instance))
            .map(|(space, instance)| {
                let runtime = self.manager.runtime_enabled()
                    && instance.runtime.is_some()
                    && self
                        .policy(&instance)
                        .runtime_allowed(Some(&caller.username));
                SpaceInfo {
                    id: space.id,
                    name: space.name,
                    runtime,
                }
            })
            .collect()
    }

    async fn request(
        &self,
        caller: &Caller,
        space: &str,
        req: SpaceRequest,
    ) -> Result<SpaceResponse, HostError> {
        let not_available =
            || HostError::NotAvailable(format!("space \"{space}\" is not available"));
        let instance = self.manager.instance(space).ok_or_else(not_available)?;
        if !self.allowed(caller, &instance) {
            return Err(not_available());
        }
        let Some(router) = instance.router.clone() else {
            return Err(HostError::Unavailable(format!(
                "space \"{space}\" is unavailable"
            )));
        };

        let host = match &instance.config.binding {
            Binding::Host { host, .. } => host.clone(),
            Binding::Prefix { .. } => self
                .manager
                .primary_url()
                .and_then(|url| authority_of(&url))
                .unwrap_or_else(|| "localhost".into()),
        };

        let bearer = self.forward_bearer(caller, space)?;
        forward(router, &host, &bearer, req).await
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `host[:port]` of a configured primary URL.
fn authority_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    (!authority.is_empty()).then(|| authority.to_owned())
}
