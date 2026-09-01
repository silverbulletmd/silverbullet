use crate::auth::authorizer::{AuthContext, AuthOutcome, RequestAuthorizer};

/// What a caller may do in a space. Ordered: a higher level includes every
/// permission of the levels below it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum AccessLevel {
    #[default]
    None,
    Read,
    Write,
}

/// Turns a verified identity (or the absence of one) into an access level for
/// this space. Every server uses `AuthorizedPolicy` today; a later task adds
/// the multi-space `access`/roles/admin policy built per space.
pub trait AccessPolicy: Send + Sync {
    fn level_for(&self, username: Option<&str>) -> AccessLevel;
}

/// Reaching the policy at all means the authorizer already said yes, which on
/// a single-space server is the whole decision.
pub struct AuthorizedPolicy;

impl AccessPolicy for AuthorizedPolicy {
    fn level_for(&self, _username: Option<&str>) -> AccessLevel {
        AccessLevel::Write
    }
}

/// Turns "no credentials" into an anonymous identity so the policy can grade
/// it, rather than a refusal the middleware would act on directly. Anonymous
/// access is a grant the policy makes, not an absence of authorization.
pub struct AnonymousFallbackAuthorizer {
    inner: Box<dyn RequestAuthorizer>,
}

impl AnonymousFallbackAuthorizer {
    pub fn new(inner: Box<dyn RequestAuthorizer>) -> Self {
        Self { inner }
    }
}

impl RequestAuthorizer for AnonymousFallbackAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        Some(
            self.inner
                .authorize(ctx)
                .unwrap_or_else(AuthOutcome::anonymous),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthOutcome;

    #[test]
    fn levels_are_ordered() {
        assert!(AccessLevel::None < AccessLevel::Read);
        assert!(AccessLevel::Read < AccessLevel::Write);
    }

    #[test]
    fn authorized_policy_grants_write_to_any_username() {
        let policy = AuthorizedPolicy;
        assert_eq!(policy.level_for(Some("zef")), AccessLevel::Write);
        assert_eq!(policy.level_for(None), AccessLevel::Write);
    }

    #[test]
    fn outcome_constructors_carry_the_right_grant() {
        assert_eq!(AuthOutcome::user("zef".into()).grant, None);
        assert_eq!(AuthOutcome::anonymous().grant, None);
        assert_eq!(AuthOutcome::trusted().grant, Some(AccessLevel::Write));
    }

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            None
        }
    }

    #[test]
    fn anonymous_fallback_turns_a_denial_into_an_anonymous_outcome() {
        let authorizer = AnonymousFallbackAuthorizer::new(Box::new(DenyAll));
        let headers = axum::http::HeaderMap::new();
        let ctx = AuthContext {
            method: &axum::http::Method::GET,
            path: "/.fs",
            query: None,
            headers: &headers,
        };
        let outcome = authorizer.authorize(&ctx).expect("always Some");
        assert_eq!(outcome.username, None);
        assert_eq!(outcome.grant, None);
    }
}
