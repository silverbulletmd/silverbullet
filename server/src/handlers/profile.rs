use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};

use crate::auth::Actor;

/// The calling request's identity, for a client that wants to know who it is
/// signed in as. A projection of the `Actor` the auth middleware resolved, so
/// it behaves the same on a multi-space server, a single-space server, and the
/// App without any of them being special-cased here.
pub async fn handle_profile(Extension(actor): Extension<Actor>) -> Response {
    Json(serde_json::json!({
        "username": actor.username,
        "fullName": actor.full_name,
        "email": actor.email,
    }))
    .into_response()
}

#[cfg(test)]
async fn body_json(resp: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn profile_projects_the_actor() {
        let actor = Actor {
            username: Some("ada".into()),
            full_name: Some("Ada Lovelace".into()),
            email: Some("ada@example.org".into()),
        };
        let body = body_json(handle_profile(Extension(actor)).await).await;
        assert_eq!(body["username"], "ada");
        assert_eq!(body["fullName"], "Ada Lovelace");
        assert_eq!(body["email"], "ada@example.org");
    }

    #[tokio::test]
    async fn an_identityless_request_reports_nulls_not_a_placeholder() {
        let body = body_json(handle_profile(Extension(Actor::default())).await).await;
        assert!(body["username"].is_null());
        assert!(body["fullName"].is_null());
        assert!(body["email"].is_null());
    }
}
