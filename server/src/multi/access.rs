//! Users.json-backed access checks for spaces and the admin surface.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::auth::{AuthContext, Credentials, RequestAuthorizer};
use crate::multi::users::UserStore;

/// Session policy shared by the `users.json`-backed surfaces — the admin UI
/// (`admin_api.rs`) and users-model spaces (`instance.rs`). Kept in one place
/// so both apply the same remember-me window and lockout thresholds.
///
/// Sessions expire after a week, matching the standalone default.
pub const USERS_REMEMBER_ME_HOURS: u64 = 168;
pub const USERS_LOCKOUT_TIME_SECS: u64 = 60;
pub const USERS_LOCKOUT_LIMIT: u32 = 10;

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
    fn is_authorized(&self, ctx: &AuthContext) -> bool {
        if let Some(token) = ctx
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        {
            if let Some(user) = self.store.resolve_token(token) {
                return (self.allow)(&user);
            }
        }
        self.inner.is_authorized(ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue, Method};

    /// Temp `UserStore` with admin `root`, member `bob`, outsider `eve`.
    fn store() -> (tempfile::TempDir, Arc<UserStore>) {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::create_empty(dir.path()).unwrap();
        store.create_user("root", "rootpw123", true).unwrap();
        store.create_user("bob", "bobpw12345", false).unwrap();
        store.create_user("eve", "evepw12345", false).unwrap();
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
        fn is_authorized(&self, _ctx: &AuthContext) -> bool {
            false
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
