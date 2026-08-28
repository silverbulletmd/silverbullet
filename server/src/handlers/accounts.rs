use std::sync::Arc;

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Serialize;

use crate::auth::{Actor, UserProfile};
use crate::state::ServerState;

#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountEntry {
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    full_name: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    me: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Every account with access to this space, with the caller marked. A
/// deployment with no accounts reports the caller alone; an anonymous caller on
/// a space that does have accounts is told about nobody.
#[cfg_attr(feature = "openapi", utoipa::path(
    get,
    path = "/.accounts",
    tag = "System",
    responses((status = 200, body = [AccountEntry], description = "Account switcher list (authenticated)"))
))]
pub async fn handle_accounts(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
) -> Response {
    let Some(directory) = state.identity.accounts() else {
        return Json(vec![AccountEntry {
            username: actor.username,
            full_name: actor.full_name,
            me: true,
        }])
        .into_response();
    };
    let Some(me) = actor.username else {
        return Json(Vec::<AccountEntry>::new()).into_response();
    };
    let mut entries: Vec<AccountEntry> = directory
        .into_iter()
        .map(|profile: UserProfile| AccountEntry {
            me: profile.username.as_deref() == Some(me.as_str()),
            username: profile.username,
            full_name: profile.full_name,
        })
        .collect();
    if !entries.iter().any(|entry| entry.me) {
        entries.push(AccountEntry {
            username: Some(me),
            full_name: actor.full_name,
            me: true,
        });
    }
    Json(entries).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{Actor, UserProfile};
    use axum::Extension;
    use std::sync::Arc;

    struct Directory(Option<Vec<UserProfile>>);

    impl crate::auth::IdentityResolver for Directory {
        fn resolve(&self, username: Option<&str>) -> UserProfile {
            UserProfile {
                username: username.map(str::to_string),
                ..Default::default()
            }
        }
        fn accounts(&self) -> Option<Vec<UserProfile>> {
            self.0.clone()
        }
    }

    fn person(username: &str, full_name: Option<&str>) -> UserProfile {
        UserProfile {
            username: Some(username.into()),
            full_name: full_name.map(str::to_string),
            email: None,
        }
    }

    fn actor(username: Option<&str>, full_name: Option<&str>) -> Actor {
        Actor {
            username: username.map(str::to_string),
            full_name: full_name.map(str::to_string),
            email: Some("never@served.example".into()),
        }
    }

    async fn body(directory: Option<Vec<UserProfile>>, actor: Actor) -> serde_json::Value {
        let mut state = crate::test_support::test_state();
        state.identity = Arc::new(Directory(directory));
        let resp = handle_accounts(axum::extract::State(Arc::new(state)), Extension(actor)).await;
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn a_multi_space_roster_marks_the_caller() {
        let v = body(
            Some(vec![
                person("ada", Some("Ada Lovelace")),
                person("bob", None),
            ]),
            actor(Some("bob"), None),
        )
        .await;
        assert_eq!(v[0]["username"], "ada");
        assert_eq!(v[0]["fullName"], "Ada Lovelace");
        assert!(v[0].get("me").is_none());
        assert_eq!(v[1]["username"], "bob");
        assert_eq!(v[1]["me"], true);
    }

    #[tokio::test]
    async fn no_entry_ever_carries_an_email() {
        let v = body(Some(vec![person("ada", None)]), actor(Some("ada"), None)).await;
        assert!(v[0].get("email").is_none());
    }

    /// An anonymous reader of a public space gets nothing: the roster is for
    /// collaborators.
    #[tokio::test]
    async fn an_anonymous_caller_sees_an_empty_roster() {
        let v = body(Some(vec![person("ada", None)]), actor(None, None)).await;
        assert_eq!(v.as_array().unwrap().len(), 0);
    }

    /// A caller the directory does not list (a headless token, an account
    /// removed mid-session) still learns who they are.
    #[tokio::test]
    async fn a_caller_missing_from_the_directory_is_appended() {
        let v = body(
            Some(vec![person("ada", None)]),
            actor(Some("ghost"), Some("Ghost")),
        )
        .await;
        assert_eq!(v.as_array().unwrap().len(), 2);
        assert_eq!(v[1]["username"], "ghost");
        assert_eq!(v[1]["me"], true);
    }

    /// The App: an identity with no account behind it.
    #[tokio::test]
    async fn a_deployment_without_accounts_reports_just_the_caller() {
        let v = body(None, actor(None, Some("Zef Hemel"))).await;
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert!(v[0]["username"].is_null());
        assert_eq!(v[0]["fullName"], "Zef Hemel");
        assert_eq!(v[0]["me"], true);
    }
}
