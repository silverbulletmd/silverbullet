//! Typed response DTOs for the server HTTP API.
//!
//! These mirror, field-for-field, the anonymous `json!({ ... })` literals that
//! handlers previously returned, so swapping a handler onto a typed body does
//! NOT change the wire format. They exist in every build (a handler returns
//! `Json(Self)` regardless of the `openapi` feature); only the `utoipa::ToSchema`
//! derive is feature-gated, so the OpenAPI document can describe the response
//! shape.
//!
//! Each DTO carries a `#[cfg(test)]` assertion that its serialized form equals
//! the exact JSON the old `json!` produced, which is the contract that keeps
//! this a behavior-preserving refactor.

use serde::Serialize;
#[cfg(feature = "openapi")]
use utoipa::ToSchema;

use crate::multi::validate::FieldError;
use crate::runtime::availability::RuntimeAvailability;
use crate::runtime::logs::LogEntry;

/// `{ "status": "ok" }` — returned by every mutating handler on success.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct StatusResponse {
    pub status: String,
}

impl StatusResponse {
    pub fn ok() -> Self {
        StatusResponse {
            status: "ok".to_string(),
        }
    }
}

/// `{ "errors": [ { "field": "...", "message": "..." } ] }` — returned by
/// validation-rejecting handlers. Reuses the existing `FieldError` wire type.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct ErrorListResponse {
    pub errors: Vec<FieldError>,
}

/// `{ "status": "error", "error": "..." }` — returned by `handle_login` on a
/// bad credential or lockout (distinct from `ErrorListResponse`: it carries a
/// single human-readable `error` string, not a field list).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct LoginErrorResponse {
    pub status: String,
    pub error: String,
}

impl LoginErrorResponse {
    pub fn new(error: impl Into<String>) -> Self {
        LoginErrorResponse {
            status: "error".to_string(),
            error: error.into(),
        }
    }
}

/// `{ "username": "...", "admin": bool }` — returned by `handle_session`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct SessionResponse {
    pub username: String,
    pub admin: bool,
}

/// `{ "username": "...", "admin": bool, "fullName": "...", "email": "..." }` —
/// returned by `handle_get_profile`. `fullName`/`email` are the profile fields
/// as plain strings (the handler defaults them to `""`), so the shape always
/// includes all four keys, unlike the optional `Profile` wire type.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    pub username: String,
    pub admin: bool,
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub email: String,
}

/// `{ "runtimeApi": <availability> }` — returned by `handle_server_info`. The
/// value is the internally-tagged `RuntimeAvailability` enum
/// (`{ "status": "available" }`, `{ "status": "no_chrome" }`, …).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct ServerInfoResponse {
    #[serde(rename = "runtimeApi")]
    pub runtime_api: RuntimeAvailability,
}

/// `{ "committed": bool }` — returned by `handle_snapshot`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotResponse {
    pub committed: bool,
}

/// `{ "logs": [ ... ] }` — returned by `handle_runtime_logs`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct LogsResponse {
    pub logs: Vec<LogEntry>,
}

/// `{ "token": "..." }` — returned by `handle_create_token`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct TokenResponse {
    pub token: String,
}

/// `{ "status": "ok", "redirect": "..." }` — returned by `handle_auth_post`
/// (standalone login) after a successful credential check.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct AuthLoginResponse {
    pub status: String,
    pub redirect: String,
}

/// `{ "id": "..." }` — returned by `handle_create` (admin space create).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct CreateSpaceResponse {
    pub id: String,
}

/// `{ "root": "..." }` — returned by `handle_status` (setup wizard).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct SetupStatusResponse {
    pub root: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ser(v: &impl Serialize) -> String {
        serde_json::to_string(v).expect("response DTO must serialize")
    }

    #[test]
    fn status_response_matches_literal() {
        assert_eq!(ser(&StatusResponse::ok()), r#"{"status":"ok"}"#);
    }

    #[test]
    fn error_list_response_matches_literal() {
        let body = ErrorListResponse {
            errors: vec![FieldError {
                field: "id".to_string(),
                message: "no such space".to_string(),
            }],
        };
        assert_eq!(
            ser(&body),
            r#"{"errors":[{"field":"id","message":"no such space"}]}"#
        );
    }

    #[test]
    fn login_error_response_matches_literal() {
        let body = LoginErrorResponse::new("Invalid username and/or password");
        assert_eq!(
            ser(&body),
            r#"{"status":"error","error":"Invalid username and/or password"}"#
        );
    }

    #[test]
    fn session_response_matches_literal() {
        let body = SessionResponse {
            username: "alice".to_string(),
            admin: true,
        };
        assert_eq!(ser(&body), r#"{"username":"alice","admin":true}"#);
    }

    #[test]
    fn profile_view_matches_literal() {
        let body = ProfileView {
            username: "alice".to_string(),
            admin: false,
            full_name: "Alice A".to_string(),
            email: "a@x.io".to_string(),
        };
        assert_eq!(
            ser(&body),
            r#"{"username":"alice","admin":false,"fullName":"Alice A","email":"a@x.io"}"#
        );
    }

    #[test]
    fn server_info_response_matches_literal() {
        let body = ServerInfoResponse {
            runtime_api: RuntimeAvailability::Available,
        };
        assert_eq!(ser(&body), r#"{"runtimeApi":{"status":"available"}}"#);
    }

    #[test]
    fn snapshot_response_matches_literal() {
        let body = SnapshotResponse { committed: true };
        assert_eq!(ser(&body), r#"{"committed":true}"#);
    }

    #[test]
    fn logs_response_matches_literal() {
        let body = LogsResponse {
            logs: vec![LogEntry {
                level: "info".to_string(),
                text: "hi".to_string(),
                timestamp: 1,
            }],
        };
        assert_eq!(
            ser(&body),
            r#"{"logs":[{"level":"info","text":"hi","timestamp":1}]}"#
        );
    }

    #[test]
    fn token_response_matches_literal() {
        let body = TokenResponse {
            token: "abc".to_string(),
        };
        assert_eq!(ser(&body), r#"{"token":"abc"}"#);
    }

    #[test]
    fn auth_login_response_matches_literal() {
        let body = AuthLoginResponse {
            status: "ok".to_string(),
            redirect: "/".to_string(),
        };
        assert_eq!(ser(&body), r#"{"status":"ok","redirect":"/"}"#);
    }

    #[test]
    fn create_space_response_matches_literal() {
        let body = CreateSpaceResponse {
            id: "my-space".to_string(),
        };
        assert_eq!(ser(&body), r#"{"id":"my-space"}"#);
    }

    #[test]
    fn setup_status_response_matches_literal() {
        let body = SetupStatusResponse {
            root: "/data".to_string(),
        };
        assert_eq!(ser(&body), r#"{"root":"/data"}"#);
    }
}
