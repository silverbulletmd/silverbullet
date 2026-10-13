use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryMode {
    Words,
    Natural,
    Phrase,
    Regex,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryRequest {
    pub query: String,
    #[serde(default)]
    pub mode: Option<QueryMode>,
    /// Exact page names (no `.md`) the result must be limited to.
    #[serde(default)]
    pub include: Option<Vec<String>>,
    /// Exact page names (no `.md`) to drop from the result.
    #[serde(default)]
    pub exclude: Option<Vec<String>>,
    /// Maximum number of pages; clamped by the backend.
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub page: String,
    /// UTF-16 offset of the match in the page's text.
    pub pos: u32,
    /// One-based line number of the passage.
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    pub excerpt: String,
    /// `[start, end)` UTF-16 offsets into `excerpt`.
    pub highlights: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub items: Vec<Match>,
    /// Matching pages before `limit` truncation.
    pub total: usize,
    pub partial: bool,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// The first mode is the default.
    pub modes: Vec<QueryMode>,
    pub related: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    /// `None` when no backend can serve this space.
    pub backend: Option<String>,
    pub model: Option<String>,
    pub capabilities: Capabilities,
    pub ready: bool,
    pub progress: Option<Progress>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawRequest {
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawResult {
    pub exit_code: i32,
    pub stdout_base64: String,
    pub stderr_base64: String,
    pub truncated: bool,
    pub timed_out: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_request_is_camel_case_and_rejects_unknown_fields() {
        let req: QueryRequest = serde_json::from_str(
            r#"{"query":"garden","mode":"phrase","exclude":["Index"],"limit":5}"#,
        )
        .unwrap();
        assert_eq!(req.mode, Some(QueryMode::Phrase));
        assert_eq!(req.exclude.as_deref(), Some(&["Index".to_string()][..]));
        assert!(serde_json::from_str::<QueryRequest>(r#"{"query":"x","scope":"all"}"#).is_err());
    }

    #[test]
    fn status_serializes_flat_for_lua() {
        let status = StatusResponse {
            backend: Some("ripgrep".into()),
            model: None,
            capabilities: Capabilities {
                modes: vec![QueryMode::Words, QueryMode::Phrase, QueryMode::Regex],
                related: false,
            },
            ready: true,
            progress: None,
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({
                "backend": "ripgrep",
                "model": null,
                "capabilities": {"modes": ["words", "phrase", "regex"], "related": false},
                "ready": true,
                "progress": null,
                "reason": null
            })
        );
    }

    #[test]
    fn match_omits_missing_heading() {
        let m = Match {
            page: "Notes/Garden".into(),
            pos: 12,
            line: 2,
            heading: None,
            excerpt: "basil".into(),
            highlights: vec![[0, 5]],
        };
        let v = serde_json::to_value(&m).unwrap();
        assert!(v.get("heading").is_none());
        assert_eq!(v["highlights"], serde_json::json!([[0, 5]]));
    }
}
