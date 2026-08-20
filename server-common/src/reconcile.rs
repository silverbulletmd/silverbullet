//! Wire types for the three-way reconcile endpoint.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileRequest {
    pub base_hash: String,
    pub base_text: String,
    pub proposed_hash: String,
    pub proposed_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileRevision {
    pub algorithm: String,
    pub hash: String,
    pub size: i64,
    pub last_modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ReconcileResponse {
    #[serde(rename = "applied")]
    Applied {
        revision: ReconcileRevision,
        text: String,
    },
    #[serde(rename = "merged")]
    Merged {
        revision: ReconcileRevision,
        text: String,
    },
    #[serde(rename = "conflicted")]
    Conflicted {
        revision: ReconcileRevision,
        text: String,
    },
    #[serde(rename = "retry")]
    Retry { revision: ReconcileRevision },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_camel_case() {
        let req = ReconcileRequest {
            base_hash: "ab".into(),
            base_text: "base".into(),
            proposed_hash: "cd".into(),
            proposed_text: "proposed".into(),
            source: Some("agent".into()),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(
            json,
            r#"{"baseHash":"ab","baseText":"base","proposedHash":"cd","proposedText":"proposed","source":"agent"}"#
        );
        let back: ReconcileRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.base_hash, "ab");
    }

    #[test]
    fn request_omits_source_when_none() {
        let req = ReconcileRequest {
            base_hash: "ab".into(),
            base_text: "base".into(),
            proposed_hash: "cd".into(),
            proposed_text: "proposed".into(),
            source: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("source"), "got: {json}");
    }

    #[test]
    fn applied_serializes_exactly() {
        let resp = ReconcileResponse::Applied {
            revision: ReconcileRevision {
                algorithm: "sha256".into(),
                hash: "ab".into(),
                size: 3,
                last_modified: 9,
            },
            text: "x".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert_eq!(
            json,
            r#"{"status":"applied","revision":{"algorithm":"sha256","hash":"ab","size":3,"lastModified":9},"text":"x"}"#
        );
    }

    #[test]
    fn status_strings_round_trip() {
        for (json, expected_status) in [
            (
                r#"{"status":"applied","revision":{"algorithm":"sha256","hash":"a","size":1,"lastModified":1},"text":"t"}"#,
                "applied",
            ),
            (
                r#"{"status":"merged","revision":{"algorithm":"sha256","hash":"a","size":1,"lastModified":1},"text":"t"}"#,
                "merged",
            ),
            (
                r#"{"status":"conflicted","revision":{"algorithm":"sha256","hash":"a","size":1,"lastModified":1},"text":"t"}"#,
                "conflicted",
            ),
            (
                r#"{"status":"retry","revision":{"algorithm":"sha256","hash":"a","size":1,"lastModified":1}}"#,
                "retry",
            ),
        ] {
            let resp: ReconcileResponse = serde_json::from_str(json).unwrap();
            let status = match &resp {
                ReconcileResponse::Applied { .. } => "applied",
                ReconcileResponse::Merged { .. } => "merged",
                ReconcileResponse::Conflicted { .. } => "conflicted",
                ReconcileResponse::Retry { .. } => "retry",
            };
            assert_eq!(status, expected_status);
            let round = serde_json::to_string(&resp).unwrap();
            assert_eq!(round, json);
        }
    }
}
