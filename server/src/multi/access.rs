//! Users.json-backed access checks for spaces and the admin surface.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::auth::config::{
    DEFAULT_LOCKOUT_LIMIT, DEFAULT_LOCKOUT_TIME_SECS, DEFAULT_REMEMBER_ME_HOURS,
};
use crate::auth::{AuthContext, AuthOutcome, Credentials, LockoutTimer, RequestAuthorizer};
use crate::multi::users::UserStore;

/// Session policy shared by the `users.json`-backed surfaces
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionPolicy {
    pub remember_me_hours: u64,
    pub lockout_time_secs: u64,
    pub lockout_limit: u32,
}

impl Default for SessionPolicy {
    fn default() -> Self {
        Self {
            remember_me_hours: DEFAULT_REMEMBER_ME_HOURS,
            lockout_time_secs: DEFAULT_LOCKOUT_TIME_SECS,
            lockout_limit: DEFAULT_LOCKOUT_LIMIT,
        }
    }
}

impl SessionPolicy {
    /// Read `SB_REMEMBER_ME_HOURS`, `SB_LOCKOUT_TIME` and `SB_LOCKOUT_LIMIT`
    /// from the process environment, mirroring `AuthConfig::from_env`.
    pub fn from_env() -> Self {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Self::parse(
            get("SB_REMEMBER_ME_HOURS").as_deref(),
            get("SB_LOCKOUT_TIME").as_deref(),
            get("SB_LOCKOUT_LIMIT").as_deref(),
        )
    }

    /// Parse raw values, falling back to the default for anything absent or
    /// unparseable — same lenient handling as single-space mode, where a typo
    /// leaves the documented default in place instead of refusing to boot.
    pub fn parse(
        remember_me_hours: Option<&str>,
        lockout_time_secs: Option<&str>,
        lockout_limit: Option<&str>,
    ) -> Self {
        let default = Self::default();
        Self {
            remember_me_hours: remember_me_hours
                .and_then(|v| v.parse().ok())
                .unwrap_or(default.remember_me_hours),
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
    pub members: BTreeSet<String>,
}

impl Credentials for SpaceUsersAuth {
    fn verify(&self, username: &str, password: &str) -> bool {
        let allowed = self.store.is_admin(username) || self.members.contains(username);
        // Always burn the hash check to keep timing uniform.
        let pass_ok = self.store.verify_password(username, password);
        allowed && pass_ok
    }
}

/// Account credentials without an authorization check. Used by the unified
/// `/.spaces` surface, where any valid account may log in before the page
/// filters the space list — and, for administrators, the management screens —
/// to that account's actual access.
pub struct AnyUserAuth {
    pub store: Arc<UserStore>,
}

impl Credentials for AnyUserAuth {
    fn verify(&self, username: &str, password: &str) -> bool {
        self.store.verify_password(username, password)
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
            if let Some(user) = self.store.resolve_token(token) {
                return if (self.allow)(&user) {
                    Some(AuthOutcome {
                        username: Some(user),
                    })
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
    fn session_policy_defaults_match_single_space_mode() {
        let policy = SessionPolicy::parse(None, None, None);
        assert_eq!(policy, SessionPolicy::default());
        // The documented single-space defaults: 7 days, 60s, 10 attempts.
        assert_eq!(policy.remember_me_hours, 168);
        assert_eq!(policy.lockout_time_secs, 60);
        assert_eq!(policy.lockout_limit, 10);
        let env_style = crate::auth::AuthConfig::try_parse(Some("u:p"), None, None, None, None)
            .unwrap()
            .unwrap();
        assert_eq!(policy.remember_me_hours, env_style.remember_me_hours);
        assert_eq!(policy.lockout_time_secs, env_style.lockout_time_secs);
        assert_eq!(policy.lockout_limit, env_style.lockout_limit);
    }

    #[test]
    fn session_policy_parses_overrides() {
        let policy = SessionPolicy::parse(Some("48"), Some("30"), Some("5"));
        assert_eq!(policy.remember_me_hours, 48);
        assert_eq!(policy.lockout_time_secs, 30);
        assert_eq!(policy.lockout_limit, 5);
    }

    /// A typo must not change the policy (and must not refuse to boot) —
    /// matching how `AuthConfig` treats an unparseable value.
    #[test]
    fn session_policy_ignores_unparseable_values() {
        let policy = SessionPolicy::parse(Some("forever"), Some(""), Some("-1"));
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

    /// Temp `UserStore` with admin `root`, member `bob`, outsider `eve`.
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
            .create_user("eve", "evepw12345", false, Profile::default())
            .unwrap();
        (dir, store)
    }

    fn members() -> BTreeSet<String> {
        ["bob".to_string()].into_iter().collect()
    }

    #[test]
    fn space_users_auth_admin_yes_member_yes_outsider_no_wrong_password_no() {
        let (_dir, store) = store();
        let auth = SpaceUsersAuth {
            store: store.clone(),
            members: members(),
        };
        assert!(auth.verify("root", "rootpw123"), "admin allowed");
        assert!(auth.verify("bob", "bobpw12345"), "member allowed");
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

        // No token: falls through to inner (DenyAll -> false).
        let h_none = HeaderMap::new();
        assert!(!authorizer.is_authorized(&ctx(&h_none)));
    }
}
