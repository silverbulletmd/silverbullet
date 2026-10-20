//! Stateless three-way merge (`POST /.merge`), used by share sync to merge a
//! page changed on both sides, whatever the remote's provider. Writes nothing.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use silverbullet_server_common::space::disk::MERGE_SIZE_LIMIT;
use silverbullet_server_merge::{contains_conflict_markers, merge, MergeOutcome};

/// Three request bodies of up to `MERGE_SIZE_LIMIT` each, JSON-escaped.
pub const MERGE_BODY_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
struct MergeRequest {
    base: String,
    /// The proposed side
    local: String,
    /// The current side
    remote: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum MergeResponse {
    Clean { text: String },
    Conflicted { text: String },
}

const NO_STORE: [(header::HeaderName, &str); 1] = [(header::CACHE_CONTROL, "no-store")];

pub async fn handle_merge(body: axum::body::Bytes) -> Response {
    // Parsing and merging megabytes of text is CPU work
    tokio::task::spawn_blocking(move || merge_response(&body))
        .await
        .unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, NO_STORE, "Merge failed").into_response()
        })
}

fn merge_response(body: &[u8]) -> Response {
    let Ok(req) = serde_json::from_slice::<MergeRequest>(body) else {
        return (StatusCode::BAD_REQUEST, NO_STORE, "Malformed JSON body").into_response();
    };
    let inputs = [&req.base, &req.local, &req.remote];
    if inputs.iter().any(|t| t.len() > MERGE_SIZE_LIMIT) {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            NO_STORE,
            "Text exceeds the merge size limit",
        )
            .into_response();
    }
    if inputs.iter().any(|t| contains_conflict_markers(t)) {
        return (
            StatusCode::CONFLICT,
            NO_STORE,
            "Input already contains SB conflict markers",
        )
            .into_response();
    }
    let response = match merge(&req.base, &req.local, &req.remote) {
        MergeOutcome::Clean(text) => MergeResponse::Clean { text },
        // Unlike `/.fs` reconcile, no hunk cap: markers are the user's to resolve
        MergeOutcome::Conflicted { text, .. } => MergeResponse::Conflicted { text },
    };
    (NO_STORE, Json(response)).into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::auth::{AccessLevel, AuthContext, AuthOutcome, RequestAuthorizer};
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use silverbullet_server_common::space::disk::MERGE_SIZE_LIMIT;
    use silverbullet_server_merge::{contains_conflict_markers, merge, MergeOutcome};
    use tower::ServiceExt;

    async fn post_merge(
        state: Arc<crate::state::ServerState>,
        base: &str,
        local: &str,
        remote: &str,
    ) -> (StatusCode, serde_json::Value) {
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.merge")
                    .header("Content-Type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "base": base, "local": local, "remote": remote })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    #[tokio::test]
    async fn merge_clean_combines_both_sides() {
        let base = "line1\nline2\nline3\n";
        let local = "line1-local\nline2\nline3\n";
        let remote = "line1\nline2\nline3-remote\n";
        let MergeOutcome::Clean(expected) = merge(base, local, remote) else {
            panic!("expected a clean merge");
        };
        assert_eq!(expected, "line1-local\nline2\nline3-remote\n");

        let state = Arc::new(test_state());
        let names = || -> Vec<String> {
            let mut names: Vec<String> = state
                .space
                .fetch_file_list()
                .unwrap()
                .into_iter()
                .map(|m| m.name)
                .collect();
            names.sort();
            names
        };
        let before = names();
        let (status, json) = post_merge(state.clone(), base, local, remote).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"], "clean");
        assert_eq!(json["text"], expected);
        assert_eq!(names(), before);
    }

    #[tokio::test]
    async fn merge_conflicted_returns_markers() {
        let base = "line1\nline2\n";
        let local = "local-line1\nline2\n";
        let remote = "remote-line1\nline2\n";
        let MergeOutcome::Conflicted { text: expected, .. } = merge(base, local, remote) else {
            panic!("expected a conflict");
        };

        let (status, json) = post_merge(Arc::new(test_state()), base, local, remote).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"], "conflicted");
        assert_eq!(json["text"], expected);
        assert!(contains_conflict_markers(json["text"].as_str().unwrap()));
    }

    #[tokio::test]
    async fn merge_refuses_inputs_with_markers() {
        let MergeOutcome::Conflicted { text: marked, .. } = merge("a\n", "b\n", "c\n") else {
            panic!("expected a conflict");
        };
        for (base, local, remote) in [
            (marked.as_str(), "x\n", "y\n"),
            ("x\n", marked.as_str(), "y\n"),
            ("x\n", "y\n", marked.as_str()),
        ] {
            let (status, _) = post_merge(Arc::new(test_state()), base, local, remote).await;
            assert_eq!(status, StatusCode::CONFLICT);
        }
    }

    #[tokio::test]
    async fn merge_refuses_oversized_inputs() {
        let big = "a".repeat(MERGE_SIZE_LIMIT + 1);
        let (status, _) = post_merge(Arc::new(test_state()), "x\n", &big, "y\n").await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn merge_rejects_malformed_json() {
        let resp = crate::build_router(Arc::new(test_state()))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.merge")
                    .body(Body::from("{\"base\": 1}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            None
        }
    }

    #[tokio::test]
    async fn merge_requires_auth() {
        let mut state = test_state();
        state.authorizer = Some(Arc::new(DenyAll));
        let resp = crate::build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.merge")
                    .body(Body::from(
                        serde_json::json!({ "base": "a\n", "local": "b\n", "remote": "a\n" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // Graded like a write, so read-only visitors can't use it as a CPU sink
        assert_eq!(
            crate::router::required_level(&Method::POST, "/.merge"),
            AccessLevel::Write
        );
    }

    struct Anonymous;
    impl RequestAuthorizer for Anonymous {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            Some(AuthOutcome::anonymous())
        }
    }

    struct FixedPolicy(AccessLevel);
    impl crate::auth::AccessPolicy for FixedPolicy {
        fn level_for(&self, _username: Option<&str>) -> AccessLevel {
            self.0
        }
    }

    /// A public (`access: "read"`) space lets anonymous visitors read, but not merge.
    #[tokio::test]
    async fn merge_refuses_anonymous_readers_of_a_public_space() {
        let mut state = test_state();
        state.authorizer = Some(Arc::new(Anonymous));
        state.access_policy = Arc::new(FixedPolicy(AccessLevel::Read));
        let (status, _) = post_merge(Arc::new(state), "a\n", "b\n", "a\n").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
