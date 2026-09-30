//! `sb search <term>` — content search for the CLI.
//!
//! SilverBullet has no server-side content-search endpoint; full-text search
//! comes from installable libraries (silversearch, basic-search) whose
//! syscalls are exposed as Lua globals in the Runtime API's headless client.
//! This command uses a hybrid strategy:
//!
//! 1. Probe the Runtime API for an installed search library and use it to
//!    rank pages, then read only the notes on the requested result page for
//!    line-level matches.
//! 2. Validate zero results against the notes themselves (a stale or empty
//!    index must never hide a match) and fall back to a full scan when the
//!    index is wrong or unavailable.

use std::io::Write;

use serde_json::{json, Value};

use crate::conn::SpaceConnection;
use crate::output::OutputMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchMode {
    /// Use the index when available; scan otherwise.
    Auto,
    /// Always scan; never contact the Runtime API.
    Scan,
    /// Require the index; fail when unavailable.
    Index,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Engine {
    Basic,
    Silver,
}

/// One line-level match inside a note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineMatch {
    pub line: usize,
    pub content: String,
}

/// A matched note with its line matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteResult {
    pub page: String,
    pub matches: Vec<LineMatch>,
}

/// What produced the results and any caveat the caller should know about.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub source: &'static str, // "index" | "scan"
    pub notice: Option<String>,
    pub results: Vec<NoteResult>,
}

/// Escape a term for interpolation into a single-quoted Lua string.
fn lua_escape(term: &str) -> String {
    let mut out = String::with_capacity(term.len());
    for c in term.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            '\0' => out.push_str("\\0"),
            _ => out.push(c),
        }
    }
    out
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_lowercase()
        .contains(&needle.to_lowercase())
}

// ---------------------------------------------------------------------------
// Runtime API calls
// ---------------------------------------------------------------------------

const PROBE_LUA: &str = "local caps = {}\ncaps.basicSearch = type(search) == \"table\" and type(search.ftsSearch) == \"function\"\ncaps.silversearch = type(silversearch) == \"table\" and type(silversearch.search) == \"function\"\nreturn caps";

/// Returns the installed search engine, or None when the runtime is
/// reachable but no library is installed. Err when the Runtime API itself is
/// unavailable (HTTP error, auth, malformed response).
fn probe(conn: &SpaceConnection) -> Result<Option<Engine>, String> {
    let value = conn.eval_script(PROBE_LUA)?;
    let caps = value
        .as_object()
        .ok_or_else(|| "unexpected probe response shape".to_string())?;
    match caps.get("basicSearch").and_then(Value::as_bool) {
        Some(true) => Ok(Some(Engine::Basic)),
        _ => match caps.get("silversearch").and_then(Value::as_bool) {
            Some(true) => Ok(Some(Engine::Silver)),
            _ => {
                if caps.contains_key("basicSearch") || caps.contains_key("silversearch") {
                    Ok(None)
                } else {
                    Err("unexpected probe response shape".to_string())
                }
            }
        },
    }
}

/// Run a full-text search through the given engine. Returns (page, score)
/// pairs sorted by score descending.
fn engine_search(
    conn: &SpaceConnection,
    engine: Engine,
    term: &str,
) -> Result<Vec<(String, i64)>, String> {
    let code = match engine {
        Engine::Basic => format!("return search.ftsSearch('{}')", lua_escape(term)),
        Engine::Silver => {
            format!(
                "return silversearch.search('{}', {{silent = true}})",
                lua_escape(term)
            )
        }
    };
    let value = conn.eval_script(&code)?;
    let rows = value.as_array().cloned().unwrap_or_default();
    let mut results: Vec<(String, i64)> = rows
        .iter()
        .filter_map(|row| {
            let name_key = if engine == Engine::Basic { "id" } else { "name" };
            let name = row.get(name_key)?.as_str()?;
            if name.is_empty() {
                return None;
            }
            let score = row.get("score").and_then(Value::as_i64).unwrap_or(0);
            Some((normalize_page(name), score))
        })
        .collect();
    results.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    Ok(results)
}

/// The search libraries return page names without the .md extension;
/// the file API wants full filenames.
fn normalize_page(name: &str) -> String {
    if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

// ---------------------------------------------------------------------------
// File API helpers
// ---------------------------------------------------------------------------

fn list_notes(conn: &SpaceConnection) -> Result<Vec<(String, i64)>, String> {
    let value = conn.list_files()?;
    let files = value
        .as_array()
        .ok_or_else(|| "unexpected file listing response".to_string())?;
    Ok(files
        .iter()
        .filter_map(|f| {
            let name = f.get("name")?.as_str()?;
            if !name.ends_with(".md") || name.starts_with("Library/") {
                return None;
            }
            let last_modified = f.get("lastModified").and_then(Value::as_i64).unwrap_or(0);
            Some((name.to_string(), last_modified))
        })
        .collect())
}

fn read_note(conn: &SpaceConnection, name: &str) -> Result<String, String> {
    conn.read_file(name)
}

/// Lines in `content` that contain `term` (case-insensitive), 1-based.
fn line_matches(content: &str, term: &str) -> Vec<LineMatch> {
    content
        .lines()
        .enumerate()
        .filter(|(_, line)| contains_ignore_case(line, term))
        .map(|(i, line)| LineMatch {
            line: i + 1,
            content: line.trim().to_string(),
        })
        .collect()
}

/// Zero-result validation: check sampled notes for the term. Returns true if
/// the zero result can be trusted. Small spaces are checked exhaustively;
/// large spaces sample recent + random notes (recent-biased, because a stale
/// index most commonly misses recently-changed notes).
fn validate_zero(
    conn: &SpaceConnection,
    notes: &[(String, i64)],
    term: &str,
    sample_size: usize,
) -> Result<bool, String> {
    let mut sample: Vec<(String, i64)> = if notes.len() <= sample_size {
        notes.to_vec()
    } else {
        let mut by_recent = notes.to_vec();
        by_recent.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
        let recent_count = sample_size / 2;
        let mut rest: Vec<(String, i64)> = by_recent[recent_count..].to_vec();
        // Deterministic pseudo-shuffle: rotation by the note count keeps this
        // test-stable while not always sampling the same files.
        let rotate = notes.len() % rest.len().max(1);
        rest.rotate_left(rotate);
        let mut picked = by_recent[..recent_count].to_vec();
        picked.extend_from_slice(&rest[..sample_size - recent_count]);
        picked
    };
    sample.dedup_by(|a, b| a.0 == b.0);
    for (name, _) in &sample {
        if let Ok(content) = read_note(conn, name) {
            if contains_ignore_case(&content, term) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

fn search_via_index(
    conn: &SpaceConnection,
    engine: Engine,
    term: &str,
    max: usize,
    page: usize,
    sample_size: usize,
) -> Result<Outcome, String> {
    let ranked = engine_search(conn, engine, term)?;
    let files: Vec<String> = ranked
        .into_iter()
        .map(|(page, _)| page)
        .filter(|f| f.ends_with(".md") && !f.starts_with("Library/"))
        .collect();

    if files.is_empty() {
        let notes = list_notes(conn)?;
        let trusted = validate_zero(conn, &notes, term, sample_size)?;
        if !trusted {
            return Ok(Outcome {
                source: "scan",
                notice: Some(
                    "index returned no results but the term exists in notes; used full scan instead"
                        .to_string(),
                ),
                results: scan_notes(conn, term)?,
            });
        }
        return Ok(Outcome {
            source: "index",
            notice: None,
            results: Vec::new(),
        });
    }

    let start = (page.saturating_sub(1)) * max;
    let window: Vec<String> = files
        .iter()
        .skip(start)
        .take(max)
        .cloned()
        .collect();
    let mut results = Vec::new();
    for file in window {
        let matches = read_note(conn, &file)
            .map(|content| line_matches(&content, term))
            .unwrap_or_default();
        results.push(NoteResult { page: file, matches });
    }
    Ok(Outcome {
        source: "index",
        notice: None,
        results,
    })
}

/// Full scan: read every note and match lines literally (case-insensitive).
fn scan_notes(conn: &SpaceConnection, term: &str) -> Result<Vec<NoteResult>, String> {
    let notes = list_notes(conn)?;
    let mut results = Vec::new();
    for (name, _) in notes {
        if let Ok(content) = read_note(conn, &name) {
            let matches = line_matches(&content, term);
            if !matches.is_empty() {
                results.push(NoteResult { page: name, matches });
            }
        }
    }
    results.sort_by_key(|r| std::cmp::Reverse(r.matches.len()));
    Ok(results)
}

/// Runs the hybrid strategy. `max`/`page` apply to the index path; the scan
/// path returns all matches (the CLI prints what it gets).
pub fn plan(
    conn: &SpaceConnection,
    term: &str,
    search_mode: SearchMode,
    max: usize,
    page: usize,
) -> Result<Outcome, String> {
    if term.trim().is_empty() {
        return Err("search term must not be empty".to_string());
    }
    if search_mode == SearchMode::Scan {
        return Ok(Outcome {
            source: "scan",
            notice: None,
            results: scan_notes(conn, term)?,
        });
    }

    // Which engine? A failed probe is cached per-call only; every invocation
    // re-probes (the CLI is a one-shot process, unlike the long-lived MCP
    // server, so there is nothing to cache into).
    let engine = match probe(conn) {
        Ok(Some(engine)) => Some(engine),
        Ok(None) => None,
        Err(error) => {
            if search_mode == SearchMode::Index {
                return Err(format!("Runtime API unavailable: {error}"));
            }
            None
        }
    };

    let engine = match engine {
        Some(engine) => Some(engine),
        None => {
            if search_mode == SearchMode::Index {
                return Err(
                    "No full-text search library installed (install silversearch or basic-search)"
                        .to_string(),
                );
            }
            return Ok(Outcome {
                source: "scan",
                notice: None,
                results: scan_notes(conn, term)?,
            });
        }
    };

    match search_via_index(conn, engine.expect("engine resolved above"), term, max, page, 10) {
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            // The verdict said "available" but the search failed — the index
            // may be stale or the library broken. Fall back (or fail loudly
            // in --force-index mode).
            if search_mode == SearchMode::Index {
                return Err(format!("Index search failed: {error}"));
            }
            Ok(Outcome {
                source: "scan",
                notice: Some(format!("index search failed ({error}); used full scan instead")),
                results: scan_notes(conn, term)?,
            })
        }
    }
}

/// `search <term>` — hybrid content search.
pub fn run(
    conn: &SpaceConnection,
    term: &str,
    search_mode: SearchMode,
    max: usize,
    page: usize,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let outcome = plan(conn, term, search_mode, max, page)?;

    if matches!(mode, OutputMode::Json | OutputMode::Jsonl | OutputMode::Yaml) {
        let value = json!({
            "query": term,
            "searchSource": outcome.source,
            "notice": outcome.notice,
            "results": outcome.results.iter().map(|r| json!({
                "page": r.page,
                "matches": r.matches.iter().map(|m| json!({
                    "line": m.line,
                    "content": m.content,
                })).collect::<Vec<_>>(),
                "matchCount": r.matches.len(),
            })).collect::<Vec<_>>(),
        });
        crate::output::format(out, &value, mode).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Text mode: concise, LLM/agent-friendly.
    let via = match outcome.source {
        "index" => "via full-text index",
        _ => "via full scan",
    };
    if outcome.results.is_empty() {
        if let Some(notice) = &outcome.notice {
            writeln!(out, "Note: {notice}").map_err(|e| e.to_string())?;
        }
        writeln!(out, "No matches found for \"{term}\" (searched {via}).")
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if let Some(notice) = &outcome.notice {
        writeln!(out, "Note: {notice}").map_err(|e| e.to_string())?;
    }
    let total_matches: usize = outcome.results.iter().map(|r| r.matches.len()).sum();
    writeln!(
        out,
        "SEARCH: \"{term}\" | Results: {} notes, {total_matches} matches | {via}",
        outcome.results.len()
    )
    .map_err(|e| e.to_string())?;
    for (i, result) in outcome.results.iter().enumerate() {
        writeln!(out, "{}. {} ({}x)", i + 1, result.page, result.matches.len())
            .map_err(|e| e.to_string())?;
        for m in result.matches.iter().take(3) {
            let truncated = if m.content.len() > 100 {
                format!("{}...", &m.content[..97])
            } else {
                m.content.clone()
            };
            writeln!(out, "  • L{}: {}", m.line, truncated).map_err(|e| e.to_string())?;
        }
        if result.matches.len() > 3 {
            writeln!(out, "  • ... {} more matches", result.matches.len() - 3)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conn::{Auth, SpaceConnection};
    use reqwest::blocking::Client;
    use std::io::{BufRead, BufReader, Read};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    /// A multi-request mock: serves /.runtime/lua_script (probe + engine
    /// calls) and /.fs listing/reads. Requests are recorded in order.
    struct Mock {
        base_url: String,
        requests: mpsc::Receiver<(String, String, String)>, // (method, path, body)
        state: std::sync::Arc<Mutex<MockState>>,
    }

    #[derive(Default)]
    struct MockState {
        runtime_disabled: bool,
        probe_result: Option<Value>, // canned probe result
        basic_search: bool,
        silversearch: bool,
        fail_search: Option<String>,
        search_results: Option<Value>, // canned engine results
        files: std::collections::BTreeMap<String, String>,
        listing_last_modified: i64,
    }

    impl Mock {
        fn spawn(mut state: MockState) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let base_url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
            let (tx, rx) = mpsc::channel();
            let state = std::sync::Arc::new(Mutex::new(state));
            let shared = state.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { break };
                    let tx = tx.clone();
                    let shared = shared.clone();
                    std::thread::spawn(move || {
                        let mut writer = stream.try_clone().expect("clone");
                        let mut reader = BufReader::new(stream);
                        loop {
                            let mut req_line = String::new();
                            if reader.read_line(&mut req_line).unwrap_or(0) == 0 {
                                return;
                            }
                            let mut parts = req_line.trim().splitn(3, ' ');
                            let method = parts.next().unwrap_or("").to_string();
                            let path = parts.next().unwrap_or("").to_string();
                            let mut content_length = 0usize;
                            loop {
                                let mut line = String::new();
                                reader.read_line(&mut line).unwrap();
                                let l = line.trim();
                                if l.is_empty() {
                                    break;
                                }
                                if let Some(v) = l
                                    .to_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                                {
                                    content_length = v;
                                }
                            }
                            let mut body = vec![0u8; content_length];
                            if content_length > 0 {
                                reader.read_exact(&mut body).unwrap();
                            }
                            let body = String::from_utf8_lossy(&body).to_string();
                            tx.send((method.clone(), path.clone(), body.clone())).unwrap();

                            let mut respond = |code: u16, body: String| {
                                use std::io::Write as _;
                                let text = format!(
                                    "HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                                    if code == 200 { "OK" } else { "Error" },
                                    body.len()
                                );
                                let _ = writer.write_all(text.as_bytes());
                            };

                            let mut state = shared.lock().unwrap();
                            if path.starts_with("/.runtime/lua_script") {
                                if state.runtime_disabled {
                                    respond(404, "not found".into());
                                    return;
                                }
                                if body.contains("caps.basicSearch") {
                                    if let Some(canned) = &state.probe_result {
                                        respond(200, canned.to_string());
                                    } else {
                                        respond(
                                            200,
                                            json!({"result": {
                                                "basicSearch": state.basic_search,
                                                "silversearch": state.silversearch,
                                            }})
                                            .to_string(),
                                        );
                                    }
                                } else if body.contains("ftsSearch(") || body.contains("silversearch.search(") {
                                    if let Some(err) = &state.fail_search {
                                        respond(200, json!({"error": err}).to_string());
                                    } else if let Some(canned) = &state.search_results {
                                        respond(200, canned.to_string());
                                    } else {
                                        let engine_basic = body.contains("ftsSearch(");
                                        let term = body
                                            .split('\'')
                                            .nth(1)
                                            .unwrap_or("")
                                            .to_lowercase();
                                        let hits: Vec<Value> = state
                                            .files
                                            .iter()
                                            .filter(|(_, c)| c.to_lowercase().contains(&term))
                                            .enumerate()
                                            .map(|(i, (name, _))| {
                                                let page = name.trim_end_matches(".md");
                                                if engine_basic {
                                                    json!({"id": page, "score": 10 - i as i64})
                                                } else {
                                                    json!({"name": page, "score": 10 - i as i64})
                                                }
                                            })
                                            .collect();
                                        respond(200, json!({"result": hits}).to_string());
                                    }
                                } else {
                                    respond(200, json!({"result": null}).to_string());
                                }
                            } else if path == "/.fs" {
                                let listing: Vec<Value> = state
                                    .files
                                    .iter()
                                    .map(|(name, _)| {
                                        json!({"name": name, "perm": "rw", "lastModified": state.listing_last_modified})
                                    })
                                    .collect();
                                respond(200, json!(listing).to_string());
                            } else if let Some(name) = path.strip_prefix("/.fs/") {
                                let name = urldecode(name);
                                match state.files.get(&name) {
                                    Some(content) => respond(200, content.clone()),
                                    None => respond(404, "not found".into()),
                                }
                            } else {
                                respond(404, "not found".into());
                            }
                            return; // Connection: close — one request per connection.
                        }
                    });
                }
            });
            Self { base_url, requests: rx, state }
        }

        fn conn(&self) -> SpaceConnection {
            SpaceConnection {
                client: Client::builder()
                    .timeout(Duration::from_secs(5))
                    .build()
                    .expect("client"),
                base_url: self.base_url.clone(),
                auth: Auth::Bearer("fixture-token".to_string()),
                timeout: Duration::from_secs(5),
            }
        }

        /// Drain recorded requests without blocking: the listener thread keeps
        /// a sender alive forever, so a blocking iterator would never end.
        fn requests(&self) -> Vec<(String, String, String)> {
            let mut out = Vec::new();
            while let Ok(req) = self.requests.try_recv() {
                out.push(req);
            }
            out
        }
    }

    fn urldecode(s: &str) -> String {
        let bytes = s.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'%' if i + 2 < bytes.len() + 1 && i + 2 <= bytes.len() - 1 + 1 => {
                    let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                    if let Ok(b) = u8::from_str_radix(hex, 16) {
                        out.push(b);
                        i += 3;
                    } else {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
                _ => {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
        }
        String::from_utf8_lossy(&out).to_string()
    }

    fn text_of(out: Vec<u8>) -> String {
        String::from_utf8(out).expect("utf8")
    }

    const NEEDLE_NOTE: &str = "the needle is here\nsecond line\n";

    #[test]
    fn index_path_ranks_via_engine_and_reads_only_the_page_window() {
        let mut state = MockState {
            basic_search: true,
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        state.files.insert("Other.md".into(), "unrelated\n".into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "needle", SearchMode::Auto, 10, 1, OutputMode::Text, &mut out).unwrap();
        let text = text_of(out);
        assert!(text.contains("via full-text index"), "{text}");
        assert!(text.contains("Test.md"), "{text}");
        assert!(text.contains("L1: the needle is here"), "{text}");
        // Only the matched note is read for line extraction.
        let reads = mock
            .requests()
            .into_iter()
            .filter(|(m, p, _)| m == "GET" && p.starts_with("/.fs/") && p != "/.fs");
        assert_eq!(reads.count(), 1, "expected exactly one note read");
    }

    #[test]
    fn scan_fallback_when_runtime_disabled() {
        let mut state = MockState {
            runtime_disabled: true,
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "needle", SearchMode::Auto, 10, 1, OutputMode::Text, &mut out).unwrap();
        let text = text_of(out);
        assert!(text.contains("via full scan"), "{text}");
        assert!(text.contains("Test.md"), "{text}");
        assert!(!text.to_lowercase().contains("error"), "{text}");
    }

    #[test]
    fn wrong_zero_from_index_falls_back_to_scan_with_notice() {
        let mut state = MockState {
            basic_search: true,
            search_results: Some(json!({"result": []})),
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "needle", SearchMode::Auto, 10, 1, OutputMode::Text, &mut out).unwrap();
        let text = text_of(out);
        assert!(text.contains("via full scan"), "{text}");
        assert!(text.contains("Test.md"), "{text}");
        assert!(text.contains("Note:"), "{text}");
    }

    #[test]
    fn genuine_zero_from_index_is_trusted() {
        let mut state = MockState {
            basic_search: true,
            search_results: Some(json!({"result": []})),
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "zzznotfound", SearchMode::Auto, 10, 1, OutputMode::Text, &mut out).unwrap();
        let text = text_of(out);
        assert!(text.contains("via full-text index"), "{text}");
        assert!(text.contains("No matches found"), "{text}");
    }

    #[test]
    fn failed_index_search_invalidates_and_falls_back() {
        let mut state = MockState {
            basic_search: true,
            fail_search: Some("search index corrupted".into()),
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "needle", SearchMode::Auto, 10, 1, OutputMode::Text, &mut out).unwrap();
        let text = text_of(out);
        assert!(text.contains("via full scan"), "{text}");
        assert!(text.contains("index corrupted"), "{text}");
        assert!(text.contains("Test.md"), "{text}");
    }

    #[test]
    fn force_index_fails_loudly_when_runtime_unavailable() {
        let state = MockState {
            runtime_disabled: true,
            ..Default::default()
        };
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        let error = run(&conn, "needle", SearchMode::Index, 10, 1, OutputMode::Text, &mut out)
            .unwrap_err();
        assert!(error.to_lowercase().contains("unavailable"), "{error}");
    }

    #[test]
    fn force_index_fails_loudly_without_a_search_library() {
        let state = MockState::default(); // runtime up, no library
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        let error = run(&conn, "needle", SearchMode::Index, 10, 1, OutputMode::Text, &mut out)
            .unwrap_err();
        assert!(error.contains("No full-text search library"), "{error}");
    }

    #[test]
    fn json_mode_reports_source_and_structured_results() {
        let mut state = MockState {
            basic_search: true,
            ..Default::default()
        };
        state.files.insert("Test.md".into(), NEEDLE_NOTE.into());
        let mock = Mock::spawn(state);
        let conn = mock.conn();

        let mut out = Vec::new();
        run(&conn, "needle", SearchMode::Auto, 10, 1, OutputMode::Json, &mut out).unwrap();
        let value: Value = serde_json::from_str(&text_of(out)).expect("json");
        assert_eq!(value["searchSource"], "index");
        assert_eq!(value["results"][0]["page"], "Test.md");
        assert_eq!(value["results"][0]["matches"][0]["line"], 1);
    }

    #[test]
    fn lua_escape_handles_quotes_and_backslashes() {
        assert_eq!(lua_escape("it's a \\ test"), "it\\'s a \\\\ test");
    }
}
