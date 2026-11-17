//! Users.json-backed access checks for spaces and the admin surface.

use std::sync::Arc;

use crate::auth::config::{
    DEFAULT_LOCKOUT_LIMIT, DEFAULT_LOCKOUT_TIME_SECS, DEFAULT_SESSION_IDLE_SECS,
};
use axum::http::HeaderMap;

use crate::auth::{
    AuthContext, AuthOutcome, Authenticator, Credentials, LockoutTimer, RequestAuthorizer,
};
use crate::multi::users::UserStore;

/// Session policy shared by the `users.json`-backed surfaces
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionPolicy {
    /// How long a browser session survives without being used.
    pub session_idle_secs: u64,
    pub lockout_time_secs: u64,
    pub lockout_limit: u32,
}

impl Default for SessionPolicy {
    fn default() -> Self {
        Self {
            session_idle_secs: DEFAULT_SESSION_IDLE_SECS,
            lockout_time_secs: DEFAULT_LOCKOUT_TIME_SECS,
            lockout_limit: DEFAULT_LOCKOUT_LIMIT,
        }
    }
}

impl SessionPolicy {
    /// Read `SB_SESSION_DAYS` (or the deprecated `SB_REMEMBER_ME_HOURS`),
    /// `SB_LOCKOUT_TIME` and `SB_LOCKOUT_LIMIT` from the process environment.
    pub fn from_env() -> Self {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Self::parse(
            get("SB_SESSION_DAYS").as_deref(),
            get("SB_REMEMBER_ME_HOURS").as_deref(),
            get("SB_LOCKOUT_TIME").as_deref(),
            get("SB_LOCKOUT_LIMIT").as_deref(),
        )
    }

    /// Parse raw values, falling back to the default for anything absent or
    /// unparseable — same lenient handling as single-space mode, where a typo
    /// leaves the documented default in place instead of refusing to boot.
    /// `SB_REMEMBER_ME_HOURS` only counts when `SB_SESSION_DAYS` is unset.
    pub fn parse(
        session_days: Option<&str>,
        remember_me_hours: Option<&str>,
        lockout_time_secs: Option<&str>,
        lockout_limit: Option<&str>,
    ) -> Self {
        let default = Self::default();
        let positive = |v: &str| v.trim().parse::<u64>().ok().filter(|n| *n > 0);
        let session_idle_secs = match (session_days, remember_me_hours) {
            (Some(days), _) => positive(days).map(|d| d.saturating_mul(86_400)),
            (None, Some(hours)) => {
                tracing::warn!("SB_REMEMBER_ME_HOURS is deprecated; use SB_SESSION_DAYS");
                positive(hours).map(|h| h.saturating_mul(3600))
            }
            (None, None) => None,
        };
        Self {
            session_idle_secs: session_idle_secs.unwrap_or(default.session_idle_secs),
            lockout_time_secs: lockout_time_secs
                .and_then(|v| v.parse().ok())
                .unwrap_or(default.lockout_time_secs),
            lockout_limit: lockout_limit
                .and_then(|v| v.parse().ok())
                .unwrap_or(default.lockout_limit),
        }
    }

    /// A fresh lockout counter for this policy. Each login surface gets its
    /// own, so the thresholds are shared but the counters are not.
    pub fn lockout(&self) -> LockoutTimer {
        LockoutTimer::from_config(self.lockout_time_secs, self.lockout_limit)
    }
}

pub struct SpaceUsersAuth {
    pub store: Arc<UserStore>,
    pub policy: Arc<dyn crate::auth::AccessPolicy>,
}

impl Credentials for SpaceUsersAuth {
    fn verify(&self, username: &str, password: &str) -> bool {
        let allowed = self.policy.level_for(Some(username)) > crate::auth::AccessLevel::None;
        // Always burn the hash check to keep timing uniform.
        let pass_ok = self.store.verify_password(username, password);
        allowed && pass_ok
    }

    fn record_login(&self, username: &str) -> Result<(), String> {
        self.store.record_login(username)
    }
}

/// The account signed in through the server-wide browser cookie for the
/// request's host, if its session is still current (user enabled, password
/// unchanged, session not revoked).
pub fn signed_in_user(
    authenticator: &Authenticator,
    users: &UserStore,
    headers: &HeaderMap,
) -> Option<String> {
    let cookie = crate::auth::scoped_auth_cookie_name(&crate::auth::request_host(headers), "");
    let token = crate::auth::cookie_value(headers, &cookie)?;
    let claims = authenticator.verify_browser_jwt(&token).ok()?;
    users
        .session_is_current(&claims.username, claims.credential_version.as_deref())
        .then_some(claims.username)
}

/// Account credentials without an authorization check. Used by the unified
/// `/.dashboard` surface, where any valid account may log in before the page
/// filters the space list — and, for administrators, the management screens —
/// to that account's actual access.
pub struct AnyUserAuth {
    pub store: Arc<UserStore>,
}

impl Credentials for AnyUserAuth {
    fn verify(&self, username: &str, password: &str) -> bool {
        self.store.verify_password(username, password)
    }

    fn record_login(&self, username: &str) -> Result<(), String> {
        self.store.record_login(username)
    }
}

/// Accepts `Authorization: Bearer <user-api-token>` for any user passing
/// `allow`; delegates everything else to `inner`.
pub struct UserTokenAuthorizer {
    inner: Box<dyn RequestAuthorizer>,
    store: Arc<UserStore>,
    allow: Box<dyn Fn(&str) -> bool + Send + Sync>,
}

impl UserTokenAuthorizer {
    pub fn new(
        inner: Box<dyn RequestAuthorizer>,
        store: Arc<UserStore>,
        allow: Box<dyn Fn(&str) -> bool + Send + Sync>,
    ) -> Self {
        Self {
            inner,
            store,
            allow,
        }
    }
}

impl RequestAuthorizer for UserTokenAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        if let Some(token) = ctx
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        {
            if let Some((user, version)) = self.store.resolve_token_identity(token) {
                return if (self.allow)(&user) {
                    Some(AuthOutcome::user(user).with_version(Some(version)))
                } else {
                    None
                };
            }
        }
        self.inner.authorize(ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::users::Profile;
    use axum::http::{HeaderMap, HeaderValue, Method};

    #[test]
    fn session_policy_defaults() {
        let policy = SessionPolicy::parse(None, None, None, None);
        assert_eq!(policy, SessionPolicy::default());
        assert_eq!(policy.session_idle_secs, 30 * 86_400);
        assert_eq!(policy.lockout_time_secs, 60);
        assert_eq!(policy.lockout_limit, 10);
    }

    #[test]
    fn session_policy_parses_overrides() {
        let policy = SessionPolicy::parse(Some("10"), None, Some("30"), Some("5"));
        assert_eq!(policy.session_idle_secs, 10 * 86_400);
        assert_eq!(policy.lockout_time_secs, 30);
        assert_eq!(policy.lockout_limit, 5);
    }

    #[test]
    fn session_days_wins_over_remember_me_hours() {
        let policy = SessionPolicy::parse(Some("10"), Some("48"), None, None);
        assert_eq!(policy.session_idle_secs, 10 * 86_400);
    }

    #[test]
    fn remember_me_hours_is_a_fallback() {
        let policy = SessionPolicy::parse(None, Some("48"), None, None);
        assert_eq!(policy.session_idle_secs, 48 * 3600);
    }

    /// A typo must not change the policy (and must not refuse to boot) —
    /// matching how `AuthConfig` treats an unparseable value.
    #[test]
    fn session_policy_ignores_unparseable_values() {
        let policy = SessionPolicy::parse(Some("forever"), None, Some(""), Some("-1"));
        assert_eq!(policy, SessionPolicy::default());
        let policy = SessionPolicy::parse(Some("0"), Some("0"), None, None);
        assert_eq!(policy, SessionPolicy::default());
        let policy = SessionPolicy::parse(None, Some("soon"), None, None);
        assert_eq!(policy, SessionPolicy::default());
    }

    #[test]
    fn session_policy_builds_a_lockout_timer_from_its_thresholds() {
        let timer = SessionPolicy {
            lockout_limit: 2,
            lockout_time_secs: 3600,
            ..SessionPolicy::default()
        }
        .lockout();
        timer.add_count();
        assert!(!timer.is_locked());
        timer.add_count();
        assert!(timer.is_locked());
    }

    /// Temp `UserStore` with admin `root`, write-member `bob`, read-member
    /// `sam`, outsider `eve`.
    fn store() -> (tempfile::TempDir, Arc<UserStore>) {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("root", "rootpw123", true, Profile::default())
            .unwrap();
        store
            .create_user("bob", "bobpw12345", false, Profile::default())
            .unwrap();
        store
            .create_user("sam", "sampw12345", false, Profile::default())
            .unwrap();
        store
            .create_user("eve", "evepw12345", false, Profile::default())
            .unwrap();
        (dir, store)
    }

    fn members_only_policy(store: Arc<UserStore>) -> Arc<dyn crate::auth::AccessPolicy> {
        let mut members = std::collections::BTreeMap::new();
        members.insert(
            "bob".to_string(),
            crate::multi::config::MemberEntry {
                role: crate::multi::config::MemberRole::Write,
                runtime_api: true,
                runtime_api_explicit: true,
                extra: Default::default(),
            },
        );
        members.insert(
            "sam".to_string(),
            crate::multi::config::MemberEntry {
                role: crate::multi::config::MemberRole::Read,
                runtime_api: false,
                runtime_api_explicit: true,
                extra: Default::default(),
            },
        );
        Arc::new(crate::multi::policy::SpaceAccessPolicy::new(
            store,
            crate::multi::config::SpaceAccess::None,
            members,
            false,
        ))
    }

    #[test]
    fn space_users_auth_admin_yes_member_yes_outsider_no_wrong_password_no() {
        let (_dir, store) = store();
        let auth = SpaceUsersAuth {
            store: store.clone(),
            policy: members_only_policy(store),
        };
        assert!(auth.verify("root", "rootpw123"), "admin allowed");
        assert!(auth.verify("bob", "bobpw12345"), "write member allowed");
        assert!(auth.verify("sam", "sampw12345"), "read member allowed");
        assert!(!auth.verify("eve", "evepw12345"), "outsider rejected");
        assert!(!auth.verify("bob", "wrong"), "wrong password rejected");
    }

    #[test]
    fn any_user_auth_accepts_every_valid_account() {
        let (_dir, store) = store();
        let auth = AnyUserAuth { store };
        assert!(auth.verify("root", "rootpw123"));
        assert!(auth.verify("bob", "bobpw12345"));
        assert!(auth.verify("eve", "evepw12345"));
        assert!(!auth.verify("bob", "wrong"));
        assert!(!auth.verify("missing", "anything"));
    }

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            None
        }
    }

    fn ctx<'a>(headers: &'a HeaderMap) -> AuthContext<'a> {
        AuthContext {
            method: &Method::GET,
            path: "/.fs",
            query: None,
            headers,
        }
    }

    #[test]
    fn user_token_authorizer_allows_bobs_token_rejects_eves_falls_through_without_token() {
        let (_dir, store) = store();
        let bob_token = store.create_token("bob", "t1").unwrap();
        let eve_token = store.create_token("eve", "t1").unwrap();
        let allow = |u: &str| u == "bob";
        let authorizer =
            UserTokenAuthorizer::new(Box::new(DenyAll), store.clone(), Box::new(allow));

        let mut h_bob = HeaderMap::new();
        h_bob.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {bob_token}")).unwrap(),
        );
        assert!(authorizer.is_authorized(&ctx(&h_bob)));

        let mut h_eve = HeaderMap::new();
        h_eve.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {eve_token}")).unwrap(),
        );
        assert!(!authorizer.is_authorized(&ctx(&h_eve)));

        let h_none = HeaderMap::new();
        assert!(!authorizer.is_authorized(&ctx(&h_none)));
    }
}
