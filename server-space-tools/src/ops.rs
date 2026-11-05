//! Space operations shared by the MCP tools and the `sb` CLI, over a
//! transport that sends one HTTP-shaped request to one space.

pub mod pages;

use std::time::{Duration, Instant};

use async_trait::async_trait;
use http::{header, HeaderMap, HeaderName, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::html_text::compact_rendered;
use crate::lua_text::{
    is_parse_failure, lint_section, lua_string, render_script, runtime_failure,
    starts_with_statement, EvalMode,
};

pub struct SpaceRequest {
    pub method: Method,
    pub path_and_query: String,
    pub body: Vec<u8>,
    pub headers: Vec<(HeaderName, String)>,
}

pub struct SpaceResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

/// Sends one request to one space; `Err` when it could not be sent at all.
#[async_trait]
pub trait SpaceApi: Send + Sync {
    async fn send(&self, req: SpaceRequest) -> Result<SpaceResponse, String>;
}

pub const AWAIT_INDEX_HEADER: &str = "x-await-index";
pub const INDEX_STATUS_HEADER: &str = "x-index-status";

const BEHIND_NOTE: &str = "Note: recent file changes were still being indexed after 5s; results \
                           may miss the latest edits.";
const POLLING_NOTE: &str = "Note: this space polls for file changes, so edits made outside \
                            SilverBullet since the last poll may not be indexed yet.";

/// Whether the index had caught up with file changes when a runtime call
/// ran, as reported by a server that was asked to wait for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexStatus {
    CaughtUp,
    Behind,
    Polling,
    /// Not reported: the request did not ask, or the server predates the header.
    Unknown,
}

impl IndexStatus {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        match headers
            .get(INDEX_STATUS_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
        {
            Some("caught-up") => Self::CaughtUp,
            Some("behind") => Self::Behind,
            Some("polling") => Self::Polling,
            _ => Self::Unknown,
        }
    }

    /// The `X-Index-Status` value, as [`Self::from_headers`] reads it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CaughtUp => "caught-up",
            Self::Behind => "behind",
            Self::Polling => "polling",
            Self::Unknown => "unknown",
        }
    }

    pub fn note(&self) -> Option<&'static str> {
        match self {
            Self::Behind => Some(BEHIND_NOTE),
            Self::Polling => Some(POLLING_NOTE),
            Self::CaughtUp | Self::Unknown => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunOptions {
    pub timeout_secs: u64,
    /// Asks the server to let the index catch up with file changes first.
    pub await_index: bool,
}

/// A console entry, as `/.runtime/logs` returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConsoleEntry {
    pub level: String,
    pub text: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LuaRun {
    /// The JSON result, or actionable error text.
    pub outcome: Result<Value, String>,
    /// Console output logged while the code ran.
    pub console: Vec<ConsoleEntry>,
    pub index: IndexStatus,
}

/// A problem `space.lint` reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LintProblem {
    #[serde(default)]
    pub line: i64,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub source: String,
}

fn default_severity() -> String {
    "error".to_owned()
}

/// `problems` as the JSON values the lint section and tool results take.
pub fn lint_values(problems: &[LintProblem]) -> Vec<Value> {
    problems
        .iter()
        .map(|p| serde_json::to_value(p).unwrap_or_default())
        .collect()
}

fn parse_lint(value: &Value) -> Vec<LintProblem> {
    value
        .as_array()
        .map(|problems| {
            problems
                .iter()
                .filter_map(|p| serde_json::from_value(p.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// A page as it displays: directives evaluated, widgets reduced to their text.
#[derive(Debug, Clone, PartialEq)]
pub struct Rendered {
    pub text: String,
    /// Whether any widget HTML was reduced to text.
    pub had_html: bool,
    pub lint: Vec<LintProblem>,
    pub index: IndexStatus,
}

/// The outcome of reloading scripts after a write to a page that has them.
#[derive(Debug, Clone, PartialEq)]
pub enum ReloadReport {
    Clean,
    Problems {
        /// This page's "Error evaluating script" console lines.
        load_errors: Vec<String>,
        lint: Vec<LintProblem>,
    },
    /// The reload call itself failed.
    Failed,
    /// The runtime is disabled or not allowed for the caller.
    NoRuntime,
}

impl ReloadReport {
    /// The note for a write's result. Every surface says the same about the
    /// other outcomes; `failed` is its own sentence for [`Self::Failed`],
    /// since what happens after a failed reload differs by surface.
    pub fn note(&self, failed: &str) -> String {
        match self {
            Self::Clean => "Its Space Lua and Space Style were reloaded without errors.".to_owned(),
            Self::Problems { load_errors, lint } => {
                let mut out = vec!["Its Space Lua and Space Style were reloaded, but have \
                                    problems; fix them before going on."
                    .to_owned()];
                if !load_errors.is_empty() {
                    out.push("Load errors:".to_owned());
                    out.extend(load_errors.iter().map(|e| format!("- {e}")));
                }
                if !lint.is_empty() {
                    out.push(lint_section(&lint_values(lint)));
                }
                out.join("\n")
            }
            Self::Failed => failed.to_owned(),
            Self::NoRuntime => {
                "The page has Space Lua or Space Style; it takes effect when the space reloads."
                    .to_owned()
            }
        }
    }
}

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Headers for a `/.runtime/*` call made with `opts`.
pub fn runtime_headers(opts: RunOptions) -> Vec<(HeaderName, String)> {
    let mut headers = vec![
        (
            HeaderName::from_static("x-timeout"),
            opts.timeout_secs.to_string(),
        ),
        (header::CONTENT_TYPE, "text/plain".to_owned()),
    ];
    if opts.await_index {
        headers.push((HeaderName::from_static(AWAIT_INDEX_HEADER), "1".to_owned()));
    }
    headers
}

async fn post(
    api: &dyn SpaceApi,
    path: &str,
    code: &str,
    opts: RunOptions,
) -> Result<SpaceResponse, String> {
    api.send(SpaceRequest {
        method: Method::POST,
        path_and_query: path.to_owned(),
        body: code.as_bytes().to_vec(),
        headers: runtime_headers(opts),
    })
    .await
}

fn body_of(response: &SpaceResponse) -> Value {
    serde_json::from_slice(&response.body).unwrap_or_default()
}

/// Evaluates `code` and returns its JSON result, or actionable error text,
/// with the index status of the call that produced it.
pub async fn eval(
    api: &dyn SpaceApi,
    code: &str,
    mode: EvalMode,
    opts: RunOptions,
    still_usable: &str,
) -> (Result<Value, String>, IndexStatus) {
    let failure =
        |r: &SpaceResponse| runtime_failure(r.status, &r.body, opts.timeout_secs, still_usable);
    let first = match mode {
        EvalMode::Script => "/.runtime/lua_script",
        _ => "/.runtime/lua",
    };
    let mut response = match post(api, first, code, opts).await {
        Ok(response) => response,
        Err(e) => return (Err(e), IndexStatus::Unknown),
    };
    if mode == EvalMode::ExpressionOrScript
        && !response.status.is_success()
        && is_parse_failure(response.status, &response.body)
    {
        let as_expression = failure(&response);
        response = match post(api, "/.runtime/lua_script", code, opts).await {
            Ok(response) => response,
            Err(e) => return (Err(e), IndexStatus::Unknown),
        };
        if !response.status.is_success() {
            // Either error may point at the real cause.
            return (
                Err(format!(
                    "{}\n(As an expression it failed with: {as_expression})",
                    failure(&response)
                )),
                IndexStatus::from_headers(&response.headers),
            );
        }
    }
    let index = IndexStatus::from_headers(&response.headers);
    if !response.status.is_success() {
        return (Err(failure(&response)), index);
    }
    (Ok(body_of(&response)["result"].clone()), index)
}

/// Runs `code`: an expression, or a script when it starts with a statement
/// or does not parse as an expression. `still_usable` names what works
/// without the runtime on the caller's surface.
pub async fn run_lua(
    api: &dyn SpaceApi,
    code: &str,
    opts: RunOptions,
    still_usable: &str,
) -> LuaRun {
    let since = epoch_ms();
    let mode = if starts_with_statement(code) {
        EvalMode::Script
    } else {
        EvalMode::ExpressionOrScript
    };
    let (outcome, index) = eval(api, code, mode, opts, still_usable).await;
    let console = console_since(api, since, LOG_LIMIT).await;
    LuaRun {
        outcome,
        console,
        index,
    }
}

const LOG_LIMIT: usize = 50;
/// How long a reload's console lines may take to reach the server's log
/// buffer after `system.reboot()` returned.
const RELOAD_LOG_WAIT: Duration = Duration::from_secs(2);
const RELOAD_LOG_POLL: Duration = Duration::from_millis(100);
const CLIENT_LOG_PREFIX: &str = "[Client] ";

/// Console entries strictly newer than `since_ms`; none when the logs are
/// not available.
pub async fn console_since(api: &dyn SpaceApi, since_ms: i64, limit: usize) -> Vec<ConsoleEntry> {
    fetch_console(api, since_ms, limit)
        .await
        .unwrap_or_default()
}

/// Like [`console_since`], but `None` when the logs are not available.
async fn fetch_console(
    api: &dyn SpaceApi,
    since_ms: i64,
    limit: usize,
) -> Option<Vec<ConsoleEntry>> {
    let Ok(response) = api
        .send(SpaceRequest {
            method: Method::GET,
            path_and_query: format!("/.runtime/logs?since={since_ms}&limit={limit}"),
            body: Vec::new(),
            headers: Vec::new(),
        })
        .await
    else {
        return None;
    };
    if !response.status.is_success() {
        return None;
    }
    Some(
        body_of(&response)["logs"]
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|e| serde_json::from_value::<ConsoleEntry>(e.clone()).ok())
                    .filter(|e| e.timestamp > since_ms)
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// The line the client logs when it has (re)loaded its scripts.
fn ends_reload(text: &str) -> bool {
    text.contains("[Lua] Loaded ") || text.contains("Error reloading Lua scripts")
}

/// The console since `since_ms`, once it shows the end of a script reload.
/// The runtime forwards console lines to the server asynchronously, so they
/// can land after `system.reboot()` has returned; this waits up to
/// [`RELOAD_LOG_WAIT`] for them.
async fn reload_console(api: &dyn SpaceApi, since_ms: i64) -> Vec<ConsoleEntry> {
    let deadline = Instant::now() + RELOAD_LOG_WAIT;
    let mut seen = Vec::new();
    while let Some(entries) = fetch_console(api, since_ms, LOG_LIMIT).await {
        seen = entries;
        if seen.iter().any(|e| ends_reload(&e.text)) || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(RELOAD_LOG_POLL).await;
    }
    seen
}

/// Page `page_name` with its directives evaluated, and its lint problems.
pub async fn read_rendered(
    api: &dyn SpaceApi,
    page_name: &str,
    opts: RunOptions,
    still_usable: &str,
) -> Result<Rendered, String> {
    let (outcome, index) = eval(
        api,
        &render_script(page_name),
        EvalMode::Script,
        opts,
        still_usable,
    )
    .await;
    let result = outcome?;
    let (text, had_html) = compact_rendered(result["text"].as_str().unwrap_or_default());
    Ok(Rendered {
        text,
        had_html,
        lint: parse_lint(&result["lint"]),
        index,
    })
}

/// `page_name` as the client writes it in a script's location
/// (`encodeRef(parseToRef("<name>@<pos>"))`): without a leading `^` or `/`,
/// and with the whitespace after a `#` dropped, since the part after it
/// parses as a header.
fn script_ref(page_name: &str) -> String {
    let name = page_name.strip_prefix('^').unwrap_or(page_name);
    let name = name.strip_prefix('/').unwrap_or(name);
    match name.split_once('#') {
        Some((path, header)) => format!("{path}#{}", header.trim_start()),
        None => name.to_owned(),
    }
}

fn is_no_runtime(response: &SpaceResponse) -> bool {
    response.status == StatusCode::FORBIDDEN
        || (response.status == StatusCode::SERVICE_UNAVAILABLE
            && String::from_utf8_lossy(&response.body).contains("not enabled"))
}

/// After a write to page `page_name` with Space Lua or Space Style: reloads
/// them now, so an open editor does not run stale scripts, and reports this
/// page's load errors and lint problems.
pub async fn reload_after_write(
    api: &dyn SpaceApi,
    page_name: &str,
    opts: RunOptions,
) -> ReloadReport {
    let started_at = epoch_ms();
    match post(api, "/.runtime/lua", "system.reboot()", opts).await {
        Ok(response) if response.status.is_success() => {}
        Ok(response) if is_no_runtime(&response) => return ReloadReport::NoRuntime,
        _ => return ReloadReport::Failed,
    }
    // Widgets of other pages may log errors while scripts load; only this
    // page's own failures are its result. `since` is exclusive, and a reload
    // can log within the same millisecond.
    let marker = format!("[[{}@", script_ref(page_name));
    let load_errors: Vec<String> = reload_console(api, started_at - 1)
        .await
        .into_iter()
        // The client's logger prefixes every console line it writes.
        .map(|e| match e.text.strip_prefix(CLIENT_LOG_PREFIX) {
            Some(text) => text.to_owned(),
            None => e.text,
        })
        .filter(|t| t.starts_with("Error evaluating script") && t.contains(&marker))
        .collect();
    let lint = match eval(
        api,
        &format!("space.lint({})", lua_string(page_name)),
        EvalMode::Expression,
        opts,
        "",
    )
    .await
    .0
    {
        Ok(value) => parse_lint(&value),
        Err(_) => Vec::new(),
    };
    if load_errors.is_empty() && lint.is_empty() {
        ReloadReport::Clean
    } else {
        ReloadReport::Problems { load_errors, lint }
    }
}

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const NAVIGATE_WAIT: Duration = Duration::from_secs(5);
const RENDER_DELAY: Duration = Duration::from_millis(500);

/// Navigates the editor to `page` and waits for it to show, for a screenshot
/// of it. A page that never becomes current yields a note, not an error: the
/// capture is still useful.
pub async fn open_page(
    api: &dyn SpaceApi,
    page: &str,
    opts: RunOptions,
    still_usable: &str,
) -> Result<Option<String>, String> {
    let navigate = format!("editor.navigate({})", lua_string(page));
    eval(api, &navigate, EvalMode::Expression, opts, still_usable)
        .await
        .0?;
    // The navigation already waited for the index.
    let poll = RunOptions {
        await_index: false,
        ..opts
    };
    let started = Instant::now();
    let mut current = Value::Null;
    loop {
        if let Ok(value) = eval(
            api,
            "editor.getCurrentPage()",
            EvalMode::Expression,
            poll,
            still_usable,
        )
        .await
        .0
        {
            current = value;
        }
        if current == page {
            tokio::time::sleep(RENDER_DELAY).await;
            return Ok(None);
        }
        if started.elapsed() + POLL_INTERVAL > NAVIGATE_WAIT {
            tokio::time::sleep(RENDER_DELAY).await;
            return Ok(Some(format!(
                "Note: the editor did not show \"{page}\" within {}s (current page: {}); the \
                 capture may show a different page.",
                NAVIGATE_WAIT.as_secs(),
                current.as_str().unwrap_or("unknown")
            )));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}
