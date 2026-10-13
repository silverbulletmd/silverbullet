use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryMode {
    Words,
    Natural,
    Phrase,
}

/// Which pages a query searches, by the page's own tags: Meta pages are
/// tagged `meta`, `meta/…` or `template`, Pages are all others.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchScope {
    Pages,
    Meta,
    #[default]
    All,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryRequest {
    pub query: String,
    #[serde(default)]
    pub mode: Option<QueryMode>,
    /// Pages, Meta or (the default) all pages; combines with `include` and
    /// `exclude`.
    #[serde(default)]
    pub scope: Option<SearchScope>,
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
        assert_eq!(req.scope, None);
        for (json, scope) in [
            ("pages", SearchScope::Pages),
            ("meta", SearchScope::Meta),
            ("all", SearchScope::All),
        ] {
            let req: QueryRequest =
                serde_json::from_str(&format!(r#"{{"query":"x","scope":"{json}"}}"#)).unwrap();
            assert_eq!(req.scope, Some(scope));
        }
        assert!(serde_json::from_str::<QueryRequest>(r#"{"query":"x","scope":"docs"}"#).is_err());
        assert!(serde_json::from_str::<QueryRequest>(r#"{"query":"x","scopes":"all"}"#).is_err());
    }

    #[test]
    fn status_serializes_flat_for_lua() {
        let status = StatusResponse {
            backend: Some("fulltext".into()),
            model: None,
            capabilities: Capabilities {
                modes: vec![QueryMode::Words, QueryMode::Phrase],
                related: false,
            },
            ready: true,
            progress: None,
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({
                "backend": "fulltext",
                "model": null,
                "capabilities": {"modes": ["words", "phrase"], "related": false},
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
