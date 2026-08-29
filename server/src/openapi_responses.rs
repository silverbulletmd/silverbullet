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

use crate::multi::config::SpaceConfig;
use crate::multi::instance::InstanceStatus;
use crate::multi::users::UserEntry;
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

/// `{ "error": "..." }` — returned when the Lua runtime API is disabled (no
/// backend configured): 503 from `not_enabled`, and 400 when the request body
/// is empty (`handle_runtime_*` on a present-but-uninvoked eval).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeErrorResponse {
    pub error: String,
}

/// `{ "error": "...", "code": "..." }` — returned by `runtime_error_response`
/// for an infrastructure-level runtime failure (not ready / transport down /
/// timeout / script error). `code` is a stable machine key (`bridge_unavailable`,
/// `timeout`, `script_error`).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeFailureResponse {
    pub error: String,
    pub code: String,
}

/// `{ "result": <value> }` — returned by `runtime_eval` on a successful Lua
/// evaluation. `value` is the raw JSON the script produced.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeResultResponse {
    pub result: serde_json::Value,
}

/// `{ "error": "revisions disabled" }` — returned by every revisions handler
/// when the space has no history store (404).
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct RevisionsDisabledResponse {
    pub error: String,
}

/// `{ "status": "exists"|"notADirectory"|"missing", "writable": bool,
/// "suggestions": [ ... ] }` — returned by the folder-picker `dir_completion`
/// shared by the admin space form and the setup wizard.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct DirCompletionResponse {
    pub status: String,
    pub writable: bool,
    pub suggestions: Vec<String>,
}

/// A space as listed by the admin API: the full `SpaceConfig` serialization,
/// plus a derived `status` object (`{ "state": "running"|"errored", "reason"? }`)
/// from the live `InstanceStatus`. `space_json` produces this from a config +
/// status pair; it mirrors `SpaceConfig`'s serialization verbatim, so the
/// `config` field reuses `SpaceConfig`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct SpaceView {
    #[serde(flatten)]
    pub config: SpaceConfig,
    pub status: SpaceStatus,
}

/// `{ "state": "running"|"errored", "reason"?: "..." }` — the live status folded
/// into `SpaceView`. `state` is always present; `reason` only when errored.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct SpaceStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl SpaceStatus {
    pub fn from(status: &InstanceStatus) -> Self {
        match status {
            InstanceStatus::Errored(reason) => SpaceStatus {
                state: "errored".to_string(),
                reason: Some(reason.clone()),
            },
            InstanceStatus::Running => SpaceStatus {
                state: "running".to_string(),
                reason: None,
            },
        }
    }
}

/// A user as listed by the admin/user API: the redacted public view. Hashes are
/// dropped; `tokens` carries only each token's `createdAt`. Mirrors the shape
/// `user_json` produced — `fullName`/`email` are `null` when the account has no
/// profile (the original `json!` always emitted the key, with `null` for `None`),
/// so this keeps the wire format byte-identical.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct UserView {
    pub admin: bool,
    #[serde(rename = "fullName")]
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub tokens: std::collections::BTreeMap<String, TokenView>,
}

/// `{ "createdAt": "..." }` — the redacted view of one API token inside `UserView`.
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[derive(Debug, Clone, Serialize)]
pub struct TokenView {
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

impl UserView {
    pub fn from(entry: &UserEntry) -> Self {
        UserView {
            admin: entry.admin,
            full_name: entry.full_name.clone(),
            email: entry.email.clone(),
            tokens: entry
                .tokens
                .iter()
                .map(|(name, token)| {
                    (
                        name.clone(),
                        TokenView {
                            created_at: token.created_at.clone(),
                        },
                    )
                })
                .collect(),
        }
    }
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

    #[test]
    fn runtime_error_response_matches_literal() {
        assert_eq!(
            ser(&RuntimeErrorResponse {
                error: "Runtime API is not enabled".to_string()
            }),
            r#"{"error":"Runtime API is not enabled"}"#
        );
        assert_eq!(
            ser(&RuntimeErrorResponse {
                error: "Request body is required".to_string()
            }),
            r#"{"error":"Request body is required"}"#
        );
    }

    #[test]
    fn runtime_failure_response_matches_literal() {
        assert_eq!(
            ser(&RuntimeFailureResponse {
                error: "runtime not ready".to_string(),
                code: "bridge_unavailable".to_string(),
            }),
            r#"{"error":"runtime not ready","code":"bridge_unavailable"}"#
        );
        assert_eq!(
            ser(&RuntimeFailureResponse {
                error: "runtime request timed out".to_string(),
                code: "timeout".to_string(),
            }),
            r#"{"error":"runtime request timed out","code":"timeout"}"#
        );
        assert_eq!(
            ser(&RuntimeFailureResponse {
                error: "attempt to call a nil value".to_string(),
                code: "script_error".to_string(),
            }),
            r#"{"error":"attempt to call a nil value","code":"script_error"}"#
        );
    }

    #[test]
    fn runtime_result_response_matches_literal() {
        assert_eq!(
            ser(&RuntimeResultResponse {
                result: serde_json::json!(42)
            }),
            r#"{"result":42}"#
        );
        assert_eq!(
            ser(&RuntimeResultResponse {
                result: serde_json::json!({"ok":true})
            }),
            r#"{"result":{"ok":true}}"#
        );
    }

    #[test]
    fn revisions_disabled_response_matches_literal() {
        assert_eq!(
            ser(&RevisionsDisabledResponse {
                error: "revisions disabled".to_string()
            }),
            r#"{"error":"revisions disabled"}"#
        );
    }

    #[test]
    fn dir_completion_response_matches_literal() {
        assert_eq!(
            ser(&DirCompletionResponse {
                status: "exists".to_string(),
                writable: true,
                suggestions: vec!["sub".to_string()],
            }),
            r#"{"status":"exists","writable":true,"suggestions":["sub"]}"#
        );
        assert_eq!(
            ser(&DirCompletionResponse {
                status: "missing".to_string(),
                writable: false,
                suggestions: vec![],
            }),
            r#"{"status":"missing","writable":false,"suggestions":[]}"#
        );
    }

    #[test]
    fn space_view_running_matches_space_json() {
        let cfg = SpaceConfig {
            name: "Work".to_string(),
            folder: String::new(),
            binding: crate::multi::config::Binding::Prefix {
                prefix: "/work".to_string(),
            },
            public: false,
            members: std::collections::BTreeMap::new(),
            read_only: false,
            shell: crate::multi::config::ShellSettings::default(),
            runtime_api: true,
            index_page: "index".to_string(),
            description: "Powerful and programmable note taking app".to_string(),
            theme_color: "#e1e1e1".to_string(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: silverbullet_server_common::RevisionsMode::default(),
            extra: serde_json::Map::new(),
        };
        let running = SpaceView {
            config: cfg.clone(),
            status: SpaceStatus::from(&InstanceStatus::Running),
        };
        let errored = SpaceView {
            config: cfg,
            status: SpaceStatus::from(&InstanceStatus::Errored("bad folder".to_string())),
        };
        assert_eq!(
            ser(&running),
            r##"{"name":"Work","folder":"","binding":{"prefix":"/work"},"public":false,"readOnly":false,"shell":{"enabled":true,"whitelist":[]},"runtimeApi":true,"indexPage":"index","description":"Powerful and programmable note taking app","themeColor":"#e1e1e1","headHtml":"","spaceIgnore":"","logPush":false,"revisions":"disabled","status":{"state":"running"}}"##
        );
        assert_eq!(
            ser(&errored),
            r##"{"name":"Work","folder":"","binding":{"prefix":"/work"},"public":false,"readOnly":false,"shell":{"enabled":true,"whitelist":[]},"runtimeApi":true,"indexPage":"index","description":"Powerful and programmable note taking app","themeColor":"#e1e1e1","headHtml":"","spaceIgnore":"","logPush":false,"revisions":"disabled","status":{"state":"errored","reason":"bad folder"}}"##
        );
    }

    #[test]
    fn user_view_matches_user_json() {
        let mut entry = UserEntry {
            password_hash: "$argon2id$x".to_string(),
            admin: true,
            full_name: Some("Ada Lovelace".to_string()),
            email: Some("ada@example.org".to_string()),
            tokens: std::collections::BTreeMap::new(),
            extra: serde_json::Map::new(),
        };
        entry.tokens.insert(
            "t1".to_string(),
            crate::multi::users::TokenEntry {
                token_hash: "$sha256$x".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        );
        assert_eq!(
            ser(&UserView::from(&entry)),
            r#"{"admin":true,"fullName":"Ada Lovelace","email":"ada@example.org","tokens":{"t1":{"createdAt":"2026-01-01T00:00:00Z"}}}"#
        );

        // No profile: fullName/email serialize as null (the redacted view shape).
        let bare = UserEntry {
            password_hash: "$argon2id$x".to_string(),
            admin: false,
            full_name: None,
            email: None,
            tokens: std::collections::BTreeMap::new(),
            extra: serde_json::Map::new(),
        };
        assert_eq!(
            ser(&UserView::from(&bare)),
            r#"{"admin":false,"fullName":null,"email":null,"tokens":{}}"#
        );
    }
}
