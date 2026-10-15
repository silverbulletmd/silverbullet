//! `sb search` and `sb related`: the server's search API, rendered for a
//! terminal. JSON output is the server's response unchanged.

use std::io::Write;

use serde_json::Value;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

/// The API calls semantic search `natural`; the UI and the CLI say semantic.
fn api_mode(mode: &str) -> &str {
    if mode == "semantic" {
        "natural"
    } else {
        mode
    }
}

fn display_mode(mode: &str) -> &str {
    if mode == "natural" {
        "semantic"
    } else {
        mode
    }
}

fn io_err(e: std::io::Error) -> String {
    e.to_string()
}

/// Collapse whitespace runs (excerpts span lines) into single spaces.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// One line per match: `Page:line  excerpt`.
pub fn format_match(item: &Value) -> String {
    let page = item.get("page").and_then(Value::as_str).unwrap_or("?");
    let location = match item.get("line").and_then(Value::as_u64) {
        Some(line) => format!("{page}:{line}"),
        None => page.to_string(),
    };
    let excerpt = one_line(item.get("excerpt").and_then(Value::as_str).unwrap_or(""));
    if excerpt.is_empty() {
        location
    } else {
        format!("{location}  {excerpt}")
    }
}

/// Write a query or related result. Text prints the matches on `out` and
/// the server's notice and any truncation on `err`, so stdout stays pure.
pub fn write_result(
    result: &Value,
    mode: OutputMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    let items = result
        .get("items")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    match mode {
        OutputMode::Json | OutputMode::Yaml | OutputMode::Auto => {
            return output::format(out, result, mode).map_err(io_err);
        }
        OutputMode::Jsonl => {
            return output::format(out, &Value::Array(items.to_vec()), mode).map_err(io_err);
        }
        OutputMode::Text | OutputMode::Table => {}
    }
    // One line per page: a page's first match is its best.
    let mut seen = std::collections::HashSet::new();
    let pages: Vec<&Value> = items
        .iter()
        .filter(|item| seen.insert(item.get("page").and_then(Value::as_str)))
        .collect();
    for item in &pages {
        writeln!(out, "{}", format_match(item)).map_err(io_err)?;
    }
    if let Some(notice) = result.get("notice").and_then(Value::as_str) {
        writeln!(err, "{notice}").map_err(io_err)?;
    }
    let total = result.get("total").and_then(Value::as_u64).unwrap_or(0);
    if total > pages.len() as u64 {
        writeln!(
            err,
            "Showing {} of {total} pages; use --limit for more.",
            pages.len()
        )
        .map_err(io_err)?;
    }
    if pages.is_empty() {
        writeln!(err, "No results.").map_err(io_err)?;
    }
    Ok(())
}

/// The index states and available modes, one fact per line.
pub fn format_status(status: &Value) -> String {
    let modes: Vec<&str> = status
        .pointer("/capabilities/modes")
        .and_then(Value::as_array)
        .map(|modes| {
            modes
                .iter()
                .filter_map(Value::as_str)
                .map(display_mode)
                .collect()
        })
        .unwrap_or_default();
    let reason = status.get("reason").and_then(Value::as_str);
    let ready = status
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let backend = status.get("backend").and_then(Value::as_str);
    let state = match (backend, ready) {
        (None, _) => format!(
            "unavailable{}",
            reason.map(|r| format!(": {r}")).unwrap_or_default()
        ),
        (Some(_), true) => "ready".to_string(),
        (Some(_), false) => match status.get("progress") {
            Some(p) if !p.is_null() => format!(
                "building ({} of {})",
                p.get("done").and_then(Value::as_u64).unwrap_or(0),
                p.get("total").and_then(Value::as_u64).unwrap_or(0)
            ),
            _ => format!(
                "not ready{}",
                reason.map(|r| format!(": {r}")).unwrap_or_default()
            ),
        },
    };
    let mut lines = vec![format!("Search index: {state}")];
    if let Some(backend) = backend {
        lines.push(format!("Backend: {backend}"));
    }
    if let Some(model) = status.get("model").and_then(Value::as_str) {
        lines.push(format!("Model: {model}"));
    }
    lines.push(format!(
        "Modes: {}",
        if modes.is_empty() {
            "none".to_string()
        } else {
            modes.join(", ")
        }
    ));
    lines.push(format!(
        "Semantic search: {}",
        if modes.contains(&"semantic") {
            "available"
        } else {
            "not available"
        }
    ));
    let related = status
        .pointer("/capabilities/related")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    lines.push(format!(
        "Related pages: {}",
        if related {
            "available"
        } else {
            "not available"
        }
    ));
    lines.join("\n")
}

pub fn status(conn: &SpaceConnection, mode: OutputMode, out: &mut dyn Write) -> Result<(), String> {
    let status = conn.search_status()?;
    match mode {
        OutputMode::Text | OutputMode::Table => {
            writeln!(out, "{}", format_status(&status)).map_err(io_err)
        }
        _ => output::format(out, &status, mode).map_err(io_err),
    }
}

pub fn search(
    conn: &SpaceConnection,
    text: &str,
    search_mode: Option<&str>,
    limit: Option<usize>,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let result = conn.search_query(text, search_mode.map(api_mode), limit)?;
    write_result(&result, mode, out, &mut std::io::stderr())
}

pub fn related(
    conn: &SpaceConnection,
    page: &str,
    limit: Option<usize>,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let page = page.strip_suffix(".md").unwrap_or(page);
    let result = conn.search_related(page, limit)?;
    write_result(&result, mode, out, &mut std::io::stderr())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn render(result: &Value, mode: OutputMode) -> (String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        write_result(result, mode, &mut out, &mut err).unwrap();
        (
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    fn sample() -> Value {
        json!({
            "items": [
                {"page": "Notes/Garden", "pos": 4, "line": 3, "heading": "Herbs",
                 "excerpt": "Plant the basil\n  next to the   fern", "highlights": [[10, 15]]},
                {"page": "Notes/Garden", "pos": 90, "line": 9, "excerpt": "Water weekly", "highlights": []},
                {"page": "Index", "pos": 0, "line": 1, "excerpt": "", "highlights": []}
            ],
            "total": 5, "partial": false, "notice": "Showing meaning matches only"
        })
    }

    #[test]
    fn text_is_one_line_per_page_with_notices_on_stderr() {
        let (out, err) = render(&sample(), OutputMode::Text);
        assert_eq!(
            out,
            "Notes/Garden:3  Plant the basil next to the fern\nIndex:1\n"
        );
        assert!(err.contains("Showing meaning matches only"), "{err}");
        assert!(err.contains("Showing 2 of 5 pages"), "{err}");
    }

    #[test]
    fn empty_result_says_so_on_stderr_only() {
        let (out, err) = render(&json!({"items": [], "total": 0}), OutputMode::Text);
        assert_eq!(out, "");
        assert_eq!(err, "No results.\n");
    }

    #[test]
    fn json_is_the_servers_response_and_jsonl_one_match_per_line() {
        let (out, err) = render(&sample(), OutputMode::Json);
        assert_eq!(serde_json::from_str::<Value>(&out).unwrap(), sample());
        assert_eq!(err, "");
        let (out, _) = render(&sample(), OutputMode::Jsonl);
        assert_eq!(out.lines().count(), 2);
    }

    #[test]
    fn modes_use_the_ui_names() {
        assert_eq!(api_mode("semantic"), "natural");
        assert_eq!(api_mode("words"), "words");
        assert_eq!(display_mode("natural"), "semantic");
    }

    #[test]
    fn status_reports_states_and_semantic_availability() {
        let ready = json!({"backend": "hybrid", "model": "granite", "ready": true, "progress": null,
            "reason": null, "capabilities": {"modes": ["natural", "words", "phrase"], "related": true}});
        let text = format_status(&ready);
        assert!(text.contains("Search index: ready"), "{text}");
        assert!(text.contains("Modes: semantic, words, phrase"), "{text}");
        assert!(text.contains("Semantic search: available"), "{text}");
        assert!(text.contains("Related pages: available"), "{text}");

        let building = json!({"backend": "fulltext", "model": null, "ready": false,
            "progress": {"done": 12, "total": 40}, "reason": null,
            "capabilities": {"modes": ["words", "phrase"], "related": false}});
        let text = format_status(&building);
        assert!(text.contains("Search index: building (12 of 40)"), "{text}");
        assert!(text.contains("Semantic search: not available"), "{text}");

        let none = json!({"backend": null, "model": null, "ready": false, "progress": null,
            "reason": "Search isn't available to public visitors",
            "capabilities": {"modes": [], "related": false}});
        let text = format_status(&none);
        assert!(
            text.contains("unavailable: Search isn't available to public visitors"),
            "{text}"
        );
        assert!(text.contains("Modes: none"), "{text}");
    }
}
