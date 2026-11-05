//! Space Lua through the runtime API (`/.runtime/*`): building the code to
//! run, and turning its responses into text for an agent.

use http::StatusCode;
use serde_json::{json, Value};

use crate::page_text::truncate_to_boundary;
use crate::paths::MAX_RESULT_BYTES;

/// Lint problems listed with a rendered read; the count says how many more.
const MAX_LINT_PROBLEMS: usize = 20;

/// The expression endpoint wraps code as `return <code>`, so only an
/// expression fits it; a chunk with statements needs the script endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalMode {
    Expression,
    Script,
    /// An expression, or a script when it does not parse as one.
    ExpressionOrScript,
}

/// Keywords that can only start a statement, never an expression.
pub const STATEMENT_KEYWORDS: &[&str] = &[
    "return", "local", "for", "if", "while", "repeat", "function", "do", "goto", "break",
];

/// Code that starts with a statement keyword, so it can only run as a script.
pub fn starts_with_statement(code: &str) -> bool {
    let word: String = code
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    STATEMENT_KEYWORDS.contains(&word.as_str())
}

/// A Lua double-quoted string literal for `text`.
pub fn lua_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() => out.push_str(&format!("\\{:03}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Space Lua that renders page `name` as it displays and lints it.
pub fn render_script(name: &str) -> String {
    format!(
        "local name = {}\nreturn {{text = markdown.expandMarkdown(space.readPage(name), \
         {{pageName = name}}), lint = space.lint(name)}}",
        lua_string(name)
    )
}

pub fn lint_section(problems: &[Value]) -> String {
    if problems.is_empty() {
        return "Lint: no problems.".to_owned();
    }
    let mut lines = vec![format!("Lint: {} problem(s).", problems.len())];
    lines.extend(problems.iter().take(MAX_LINT_PROBLEMS).map(|p| {
        format!(
            "- line {}: [{}] {} ({})",
            p["line"],
            p["severity"].as_str().unwrap_or("error"),
            p["message"].as_str().unwrap_or_default(),
            p["source"].as_str().unwrap_or_default()
        )
    }));
    if problems.len() > MAX_LINT_PROBLEMS {
        lines.push(format!(
            "- ... {} more; run `space.lint(page)` with `lua` for all.",
            problems.len() - MAX_LINT_PROBLEMS
        ));
    }
    lines.join("\n")
}

fn error_text(json: &Value, body: &[u8]) -> String {
    json["error"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| String::from_utf8_lossy(body).into_owned())
}

/// A Lua statement fails to parse as an expression; the script endpoint takes it.
pub fn is_parse_failure(_status: StatusCode, body: &[u8]) -> bool {
    let json: Value = serde_json::from_slice(body).unwrap_or_default();
    if json["code"] != "script_error" {
        return false;
    }
    let message = error_text(&json, body).to_lowercase();
    // Not a bare "expected": runtime errors say that too, and re-running code
    // that already executed would repeat its side effects.
    ["parse error", "unexpected symbol", "' expected near"]
        .iter()
        .any(|marker| message.contains(marker))
}

/// Actionable text for a failed `/.runtime/*` response. `timeout_secs` is the
/// timeout the call ran with; `still_usable` names what works without the
/// runtime on the caller's surface.
pub fn runtime_failure(
    status: StatusCode,
    body: &[u8],
    timeout_secs: u64,
    still_usable: &str,
) -> String {
    let json: Value = serde_json::from_slice(body).unwrap_or_default();
    let message = error_text(&json, body);
    let code = json["code"].as_str().unwrap_or_default();
    match (status, code) {
        (_, "bridge_unavailable") => {
            "The runtime is starting or unavailable; retry shortly.".to_owned()
        }
        (StatusCode::SERVICE_UNAVAILABLE, _) if message.contains("not enabled") => {
            format!("The runtime API is disabled for this space; {still_usable}.")
        }
        (StatusCode::FORBIDDEN, _) => {
            format!("Your account may not use the runtime in this space; {still_usable}.")
        }
        (_, "timeout") => {
            format!("The call timed out after {timeout_secs}s; narrow the query or add a limit.")
        }
        (_, "script_error") => format!("Lua error: {message}"),
        (_, "selector_not_found") => format!("No element matches the selector: {message}"),
        (_, "invalid_selector") => format!("Invalid selector: {message}"),
        (_, "invalid_request") => message,
        _ => format!(
            "The runtime request failed: HTTP {} {message}",
            status.as_u16()
        ),
    }
}

pub fn console_section(entries: &[Value]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    let lines: Vec<String> = entries
        .iter()
        .map(|e| {
            format!(
                "[{}] {}",
                e["level"].as_str().unwrap_or("log"),
                e["text"].as_str().unwrap_or_default()
            )
        })
        .collect();
    Some(format!(
        "Console output during this call:\n{}",
        lines.join("\n")
    ))
}

pub fn value_section(value: Value, structured: &mut Value) -> String {
    let pretty = serde_json::to_string_pretty(&value).unwrap_or_default();
    if pretty.len() > MAX_RESULT_BYTES {
        structured["truncated"] = json!(true);
        return format!(
            "{}\n\n[Result truncated at {MAX_RESULT_BYTES} bytes. Add a limit or select fewer \
             fields to return less.]",
            truncate_to_boundary(&pretty, MAX_RESULT_BYTES)
        );
    }
    structured["result"] = value;
    pretty
}

/// Rows left out by the runtime, which cuts a returned query collection at
/// 1000 rows and appends a `<truncated: N more rows; ...>` marker.
fn rows_cut_by_runtime(rows: &[Value]) -> Option<usize> {
    rows.last()?
        .as_str()?
        .strip_prefix("<truncated: ")?
        .split_once(" more rows")?
        .0
        .parse()
        .ok()
}

/// How many leading rows fit in [`MAX_RESULT_BYTES`] as pretty JSON.
fn rows_that_fit(rows: &[Value]) -> usize {
    let fits = |k: usize| {
        serde_json::to_string_pretty(&rows[..k]).is_ok_and(|s| s.len() <= MAX_RESULT_BYTES)
    };
    // Every pretty-printed row takes at least 4 bytes, which bounds the search.
    let (mut lo, mut hi) = (0, rows.len().min(MAX_RESULT_BYTES / 4));
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    lo
}

/// A list result, headed by its count so a "find all" knows whether it got
/// everything; when it does not fit, whole leading rows are shown.
pub fn list_section(mut rows: Vec<Value>, structured: &mut Value) -> String {
    let count = match rows_cut_by_runtime(&rows) {
        Some(rest) => {
            rows.pop();
            rows.len() + rest
        }
        None => rows.len(),
    };
    structured["count"] = json!(count);
    let shown = rows_that_fit(&rows);
    if shown == 0 && !rows.is_empty() {
        structured["truncated"] = json!(true);
        let pretty = serde_json::to_string_pretty(&rows).unwrap_or_default();
        return format!(
            "{count} results; the first alone exceeds {MAX_RESULT_BYTES} bytes, so it is cut; \
             select fewer fields.\n\n{}",
            truncate_to_boundary(&pretty, MAX_RESULT_BYTES)
        );
    }
    let header = if shown == count {
        format!("{count} result{}", if count == 1 { "" } else { "s" })
    } else {
        structured["truncated"] = json!(true);
        structured["shown"] = json!(shown);
        format!("Showing the first {shown} of {count} results; narrow the query or add a limit.")
    };
    rows.truncate(shown);
    let pretty = serde_json::to_string_pretty(&rows).unwrap_or_default();
    if shown == count {
        structured["result"] = Value::Array(rows);
    }
    format!("{header}\n\n{pretty}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const STILL_USABLE: &str = "you can still use read, write, edit and search";

    fn body(value: Value) -> Vec<u8> {
        value.to_string().into_bytes()
    }

    fn status(code: u16) -> StatusCode {
        StatusCode::from_u16(code).unwrap()
    }

    #[test]
    fn lua_string_escapes() {
        assert_eq!(lua_string("a\"b\\c\nd"), "\"a\\\"b\\\\c\\010d\"");
        assert_eq!(lua_string("Café/Menü"), "\"Café/Menü\"");
    }

    #[test]
    fn statements_are_recognised_by_their_first_word() {
        for code in [
            "return 1",
            "  local x = 1",
            "for i = 1, 3 do end",
            "if x then end",
        ] {
            assert!(starts_with_statement(code), "{code}");
        }
        for code in [
            "1 + 1",
            "query[[from p = index.pages()]]",
            "returned",
            "x = 1",
            "doc.name",
        ] {
            assert!(!starts_with_statement(code), "{code}");
        }
    }

    #[test]
    fn failures_are_actionable() {
        let cases = [
            (
                503,
                json!({"error": "x", "code": "bridge_unavailable"}),
                "starting or unavailable",
            ),
            (
                503,
                json!({"error": "Runtime API is not enabled"}),
                "disabled for this space; you can still use read",
            ),
            (
                403,
                json!({"error": "x", "code": "forbidden"}),
                "may not use the runtime",
            ),
            (
                504,
                json!({"error": "x", "code": "timeout"}),
                "timed out after 60s",
            ),
            (
                500,
                json!({"error": "boom", "code": "script_error"}),
                "Lua error: boom",
            ),
        ];
        for (code, json, expected) in cases {
            let text = runtime_failure(status(code), &body(json), 60, STILL_USABLE);
            assert!(text.contains(expected), "{text}");
        }
    }

    #[test]
    fn parse_failures_are_detected() {
        let parse = |msg: &str| {
            is_parse_failure(
                status(500),
                &body(json!({"error": msg, "code": "script_error"})),
            )
        };
        assert!(parse("Parse error: unexpected symbol near '='"));
        assert!(!parse("attempt to call a nil value"));
        assert!(!parse("Expected table"));
        assert!(parse("Parse error at pos 3"));
        assert!(parse("'end' expected near '<eof>'"));
        assert!(!is_parse_failure(
            status(504),
            &body(json!({"error": "parse", "code": "timeout"}))
        ));
    }
}
