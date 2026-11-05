use axum::http::{header, HeaderName, Method};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use super::args::{input_schema, Count, SPACE};
use super::reply::{Outcome, Reply};
use super::{annotations, Tools};
use server_space_tools::ops::{IndexStatus, AWAIT_INDEX_HEADER};

use crate::host::SpaceRequest;
use crate::tool::{Caller, ToolDef};

const MAX_LIMIT: usize = 50;
const DEFAULT_LIMIT: usize = 20;

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct SearchArgs {
    #[schemars(description = SPACE)]
    space: String,
    /// What to search for.
    text: String,
    mode: Option<Mode>,
    /// Maximum number of pages (default 20).
    #[schemars(range(max = MAX_LIMIT))]
    limit: Option<Count>,
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Words,
    Phrase,
    Semantic,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Words => "words",
            Mode::Phrase => "phrase",
            Mode::Semantic => "semantic",
        }
    }

    /// The backend calls semantic search `natural`.
    fn backend(self) -> &'static str {
        match self {
            Mode::Semantic => "natural",
            other => other.as_str(),
        }
    }
}

pub(super) fn definitions() -> Vec<ToolDef> {
    vec![ToolDef {
        name: "search",
        title: "Search pages",
        description: "Full-text search over a space's pages. Modes: \"words\" (default; all words, any \
            order), \"phrase\" (exact phrase) and \"semantic\" (by meaning, where the space has it). \
            Returns matching passages with their page, line and heading."
            .into(),
        input_schema: input_schema::<SearchArgs>(),
        annotations: annotations(true, false, true),
    }]
}

/// The query, asking the space to let its index catch up with file changes
/// first, so a search right after a write sees it.
fn query_request(body: &Value) -> SpaceRequest {
    SpaceRequest {
        method: Method::POST,
        path_and_query: "/.search/query".into(),
        body: body.to_string().into_bytes(),
        headers: vec![
            (header::CONTENT_TYPE, "application/json".to_owned()),
            (HeaderName::from_static(AWAIT_INDEX_HEADER), "1".to_owned()),
        ],
    }
}

/// Backend mode name to the tool's vocabulary.
fn tool_mode(backend_mode: &str) -> &str {
    if backend_mode == "natural" {
        "semantic"
    } else {
        backend_mode
    }
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn render(result: &Value) -> String {
    let items = result["items"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let mut lines: Vec<String> = items
        .iter()
        .map(|item| {
            format!(
                "{} — {}",
                item["page"].as_str().unwrap_or_default(),
                collapse(item["excerpt"].as_str().unwrap_or_default())
            )
        })
        .collect();
    if lines.is_empty() {
        lines.push("No matches.".into());
    }
    if let Some(total) = result["total"].as_u64() {
        if total as usize > items.len() {
            lines.push(format!(
                "({} of {total} matching pages shown; raise limit for more)",
                items.len()
            ));
        }
    }
    if result["partial"] == true {
        lines.push("(partial results: the search ran out of time)".into());
    }
    if let Some(notice) = result["notice"].as_str() {
        lines.push(notice.to_owned());
    }
    lines.join("\n")
}

impl Tools {
    pub(super) async fn search(&self, caller: &Caller, args: SearchArgs) -> Outcome {
        let SearchArgs {
            space,
            text,
            mode,
            limit,
        } = args;
        let limit = limit.map_or(DEFAULT_LIMIT, |Count(n)| n).min(MAX_LIMIT);
        if text.trim().is_empty() {
            return Err("\"text\" must not be empty".into());
        }
        let mut body = json!({ "query": text, "limit": limit });
        if let Some(mode) = mode {
            body["mode"] = json!(mode.backend());
        }

        let response = self
            .host
            .request(caller, &space, query_request(&body))
            .await
            .map_err(|e| e.to_string())?;
        if response.status.is_success() {
            let result: Value = serde_json::from_slice(&response.body)
                .map_err(|_| "search returned an unreadable response")?;
            let mut reply = Reply::text(render(&result));
            if let Some(note) = IndexStatus::from_headers(&response.headers).note() {
                reply.push_text(note);
            }
            return Ok(reply.with_structured(result));
        }

        let error: Value = serde_json::from_slice(&response.body).unwrap_or_default();
        let code = error["error"].as_str().unwrap_or_default();
        let message = error["message"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| String::from_utf8_lossy(&response.body).into_owned());
        // A backend refuses a mode it lacks with `invalid` (full-text), `unsupported` or
        // `unavailable` (semantic still building), so the status decides.
        let asked_for_mode = mode.is_some()
            && matches!(
                code,
                "invalid" | "unsupported" | "unavailable" | "mode_unavailable"
            );
        if asked_for_mode || matches!(code, "unavailable" | "mode_unavailable") {
            let modes = self.available_modes(caller, &space).await;
            if let (Some(mode), Some(modes)) = (mode.map(Mode::as_str), &modes) {
                if !modes.iter().any(|m| m == mode) {
                    return Err(format!(
                        "search mode \"{mode}\" is not available in this space. Available modes: {}.",
                        modes.join(", ")
                    )
                    .into());
                }
            }
            if matches!(code, "unavailable" | "mode_unavailable") {
                return Err(
                    format!("search is not available in this space right now: {message}").into(),
                );
            }
        }
        Err(format!("search failed: {message}").into())
    }

    async fn available_modes(&self, caller: &Caller, space: &str) -> Option<Vec<String>> {
        let request = SpaceRequest {
            method: Method::GET,
            path_and_query: "/.search/status".into(),
            body: Vec::new(),
            headers: Vec::<(HeaderName, String)>::new(),
        };
        let response = self.host.request(caller, space, request).await.ok()?;
        let status: Value = serde_json::from_slice(&response.body).ok()?;
        let modes = status["capabilities"]["modes"].as_array()?;
        Some(
            modes
                .iter()
                .filter_map(Value::as_str)
                .map(|m| tool_mode(m).to_owned())
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_lists_page_and_passage() {
        let text = render(&json!({
            "items": [{"page": "Garden/Ferns", "excerpt": "water the\n  ferns weekly"}],
            "total": 3, "partial": false,
        }));
        assert!(text.starts_with("Garden/Ferns — water the ferns weekly"));
        assert!(text.contains("1 of 3 matching pages shown"));
    }

    #[test]
    fn render_without_items() {
        assert_eq!(render(&json!({"items": [], "total": 0})), "No matches.");
    }
}
