use std::collections::VecDeque;
use std::sync::Mutex;

use async_trait::async_trait;
use http::{HeaderMap, HeaderValue, Method, StatusCode};
use serde_json::{json, Value};

use space_tools::ops::{
    console_since, read_rendered, reload_after_write, run_lua, IndexStatus, LintProblem,
    ReloadReport, RunOptions, SpaceApi, SpaceRequest, SpaceResponse,
};

const STILL_USABLE: &str = "you can still use read, write, edit and search";

const OPTS: RunOptions = RunOptions {
    timeout_secs: 60,
    await_index: false,
};

#[derive(Clone)]
struct Sent {
    method: Method,
    path: String,
    body: String,
    headers: Vec<(String, String)>,
}

/// Replays queued responses in order and records every request.
#[derive(Default)]
struct FakeApi {
    responses: Mutex<VecDeque<SpaceResponse>>,
    log: Mutex<Vec<Sent>>,
}

impl FakeApi {
    fn with(responses: Vec<SpaceResponse>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            log: Mutex::default(),
        }
    }

    fn sent(&self) -> Vec<Sent> {
        self.log.lock().unwrap().clone()
    }

    fn paths(&self) -> Vec<String> {
        self.sent().into_iter().map(|s| s.path).collect()
    }
}

#[async_trait]
impl SpaceApi for FakeApi {
    async fn send(&self, req: SpaceRequest) -> Result<SpaceResponse, String> {
        self.log.lock().unwrap().push(Sent {
            method: req.method,
            path: req.path_and_query,
            body: String::from_utf8(req.body).unwrap(),
            headers: req
                .headers
                .iter()
                .map(|(k, v)| (k.as_str().to_owned(), v.clone()))
                .collect(),
        });
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| "no response queued".to_owned())
    }
}

fn respond(status: StatusCode, body: Value) -> SpaceResponse {
    SpaceResponse {
        status,
        headers: HeaderMap::new(),
        body: body.to_string().into_bytes(),
    }
}

fn result(value: Value) -> SpaceResponse {
    respond(StatusCode::OK, json!({ "result": value }))
}

fn script_error(message: &str) -> SpaceResponse {
    respond(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "code": "script_error", "error": message }),
    )
}

fn logs(entries: Value) -> SpaceResponse {
    respond(StatusCode::OK, json!({ "logs": entries }))
}

#[tokio::test]
async fn expression_parse_failure_retries_as_script_and_keeps_both_errors() {
    let api = FakeApi::with(vec![
        script_error("Parse error: unexpected symbol near ']'"),
        script_error("Parse error: unexpected symbol near 'q'"),
    ]);
    let run = run_lua(&api, "query[[x]]", OPTS, STILL_USABLE).await;
    assert_eq!(
        run.outcome.unwrap_err(),
        "Lua error: Parse error: unexpected symbol near 'q'\n(As an expression it failed with: \
         Lua error: Parse error: unexpected symbol near ']')"
    );
    let paths = api.paths();
    assert_eq!(paths[0], "/.runtime/lua");
    assert_eq!(paths[1], "/.runtime/lua_script");
}

#[tokio::test]
async fn runtime_error_mentioning_expected_is_not_retried() {
    let api = FakeApi::with(vec![script_error("table expected")]);
    let run = run_lua(&api, "string.len(nil)", OPTS, STILL_USABLE).await;
    assert_eq!(run.outcome.unwrap_err(), "Lua error: table expected");
    let paths = api.paths();
    assert_eq!(
        paths.iter().filter(|p| *p == "/.runtime/lua").count(),
        1,
        "{paths:?}"
    );
    assert!(
        !paths.iter().any(|p| p == "/.runtime/lua_script"),
        "{paths:?}"
    );
}

#[tokio::test]
async fn statement_keyword_goes_straight_to_script() {
    let api = FakeApi::with(vec![result(json!(2)), logs(json!([]))]);
    let run = run_lua(&api, "local x = 1\nreturn x + 1", OPTS, STILL_USABLE).await;
    assert_eq!(run.outcome.unwrap(), json!(2));
    let sent = api.sent();
    assert_eq!(sent[0].method, Method::POST);
    assert_eq!(sent[0].path, "/.runtime/lua_script");
    assert_eq!(sent[0].body, "local x = 1\nreturn x + 1");
    assert!(sent[0]
        .headers
        .contains(&("x-timeout".to_owned(), "60".to_owned())));
    assert!(
        sent[1].path.starts_with("/.runtime/logs?since="),
        "{}",
        sent[1].path
    );
}

#[tokio::test]
async fn await_index_sends_header_and_reads_status() {
    let mut response = result(json!(1));
    response
        .headers
        .insert("x-index-status", HeaderValue::from_static("behind"));
    let api = FakeApi::with(vec![response, logs(json!([]))]);
    let opts = RunOptions {
        timeout_secs: 60,
        await_index: true,
    };
    let run = run_lua(&api, "1", opts, STILL_USABLE).await;
    assert!(api.sent()[0]
        .headers
        .contains(&("x-await-index".to_owned(), "1".to_owned())));
    assert_eq!(run.index, IndexStatus::Behind);
    assert_eq!(
        run.index.note(),
        Some(
            "Note: recent file changes were still being indexed after 5s; results may miss the \
             latest edits."
        )
    );
}

#[tokio::test]
async fn missing_status_header_is_unknown() {
    let api = FakeApi::with(vec![result(json!(1)), logs(json!([]))]);
    let run = run_lua(&api, "1", OPTS, STILL_USABLE).await;
    assert!(!api.sent()[0]
        .headers
        .iter()
        .any(|(k, _)| k == "x-await-index"));
    assert_eq!(run.index, IndexStatus::Unknown);
    assert_eq!(run.index.note(), None);
    let mut headers = HeaderMap::new();
    headers.insert("x-index-status", HeaderValue::from_static("polling"));
    assert_eq!(IndexStatus::from_headers(&headers), IndexStatus::Polling);
    assert!(IndexStatus::Polling
        .note()
        .unwrap()
        .contains("polls for file changes"));
    headers.insert("x-index-status", HeaderValue::from_static("caught-up"));
    assert_eq!(IndexStatus::from_headers(&headers), IndexStatus::CaughtUp);
    assert_eq!(IndexStatus::CaughtUp.note(), None);
}

#[tokio::test]
async fn console_since_filters_by_start() {
    let api = FakeApi::with(vec![logs(json!([
        {"level": "log", "text": "before", "timestamp": 999},
        {"level": "log", "text": "at", "timestamp": 1000},
        {"level": "warn", "text": "after", "timestamp": 1001},
    ]))]);
    let entries = console_since(&api, 1000, 50).await;
    assert_eq!(api.paths(), ["/.runtime/logs?since=1000&limit=50"]);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].level, "warn");
    assert_eq!(entries[0].text, "after");
    assert_eq!(entries[0].timestamp, 1001);

    let failing = FakeApi::with(vec![respond(StatusCode::FORBIDDEN, json!({}))]);
    assert!(console_since(&failing, 0, 50).await.is_empty());
}

#[tokio::test]
async fn reload_waits_for_console_lines_that_arrive_late() {
    let later = i64::MAX - 1;
    let api = FakeApi::with(vec![
        result(Value::Null),
        logs(json!([])),
        logs(json!([
            {"level": "error", "text": "Error evaluating script: boom at [[Tools@3]]", "timestamp": later},
        ])),
        logs(json!([
            {"level": "error", "text": "Error evaluating script: boom at [[Tools@3]]", "timestamp": later},
            {"level": "error", "text": "[Client] Error evaluating script: bang at [[Tools@9]]", "timestamp": later},
            {"level": "info", "text": "[Client] [Lua] Loaded 3 scripts in 4ms", "timestamp": later},
        ])),
        result(json!([])),
    ]);
    let report = reload_after_write(&api, "Tools", OPTS).await;
    assert_eq!(
        report,
        ReloadReport::Problems {
            load_errors: vec![
                "Error evaluating script: boom at [[Tools@3]]".to_owned(),
                "Error evaluating script: bang at [[Tools@9]]".to_owned(),
            ],
            lint: Vec::new(),
        }
    );
    let paths = api.paths();
    assert_eq!(paths.len(), 5, "{paths:?}");
    assert!(
        paths[1..4].iter().all(|p| p.starts_with("/.runtime/logs?")),
        "{paths:?}"
    );
    assert_eq!(api.sent()[4].body, "space.lint(\"Tools\")");
}

#[tokio::test]
async fn reload_stops_waiting_when_the_console_is_unavailable() {
    let api = FakeApi::with(vec![
        result(Value::Null),
        respond(StatusCode::FORBIDDEN, json!({})),
        result(json!([])),
    ]);
    assert_eq!(
        reload_after_write(&api, "Tools", OPTS).await,
        ReloadReport::Clean
    );
    assert_eq!(api.paths().len(), 3);
}

#[tokio::test]
async fn reload_reports_page_load_errors_and_lint() {
    let later = i64::MAX - 1;
    let api = FakeApi::with(vec![
        result(Value::Null),
        logs(json!([
            {"level": "error", "text": "Error evaluating script: boom at [[Tools@3]]", "timestamp": later},
            {"level": "error", "text": "Error evaluating script: other at [[Other@1]]", "timestamp": later},
            {"level": "error", "text": "Lua widget error on index", "timestamp": later},
            {"level": "info", "text": "[Lua] Loaded 3 scripts in 4ms", "timestamp": later},
        ])),
        result(
            json!([{"page": "Tools", "line": 2, "column": 5, "severity": "error",
            "message": "unexpected symbol", "source": "lua"}]),
        ),
    ]);
    let report = reload_after_write(&api, "Tools", OPTS).await;
    let lint = vec![LintProblem {
        line: 2,
        severity: "error".to_owned(),
        message: "unexpected symbol".to_owned(),
        source: "lua".to_owned(),
    }];
    assert_eq!(
        report,
        ReloadReport::Problems {
            load_errors: vec!["Error evaluating script: boom at [[Tools@3]]".to_owned()],
            lint,
        }
    );
    let sent = api.sent();
    assert_eq!(sent[0].body, "system.reboot()");
    assert_eq!(sent[2].body, "space.lint(\"Tools\")");
    assert_eq!(
        report.note("reload failed"),
        "Its Space Lua and Space Style were reloaded, but have problems; fix them before going \
         on.\nLoad errors:\n- Error evaluating script: boom at [[Tools@3]]\nLint: 1 problem(s).\n\
         - line 2: [error] unexpected symbol (lua)"
    );

    let clean = FakeApi::with(vec![
        result(Value::Null),
        logs(
            json!([{"level": "info", "text": "[Lua] Loaded 3 scripts in 4ms", "timestamp": later}]),
        ),
        result(json!([])),
    ]);
    let report = reload_after_write(&clean, "Tools", OPTS).await;
    assert_eq!(report, ReloadReport::Clean);
    assert_eq!(
        report.note("reload failed"),
        "Its Space Lua and Space Style were reloaded without errors."
    );

    let failed = FakeApi::with(vec![respond(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({"code": "timeout", "error": "timed out"}),
    )]);
    assert_eq!(
        reload_after_write(&failed, "Tools", OPTS).await,
        ReloadReport::Failed
    );
}

#[tokio::test]
async fn reload_without_runtime_is_no_runtime() {
    let api = FakeApi::with(vec![SpaceResponse {
        status: StatusCode::SERVICE_UNAVAILABLE,
        headers: HeaderMap::new(),
        body: b"Runtime API is not enabled".to_vec(),
    }]);
    let report = reload_after_write(&api, "Tools", OPTS).await;
    assert_eq!(report, ReloadReport::NoRuntime);
    assert_eq!(
        report.note("reload failed"),
        "The page has Space Lua or Space Style; it takes effect when the space reloads."
    );
    assert_eq!(api.paths().len(), 1);
}

#[tokio::test]
async fn rendered_read_compacts_html_and_returns_lint() {
    let api = FakeApi::with(vec![result(json!({
        "text": "# Standings\n<div class=\"sb-lua-directive\"><b>Blue</b> 3</div>",
        "lint": [{"page": "Standings", "line": 3, "column": 1, "severity": "warning",
                  "message": "unexpected symbol", "source": "widget"}],
    }))]);
    let rendered = read_rendered(&api, "Standings", OPTS, STILL_USABLE)
        .await
        .unwrap();
    assert!(rendered.had_html);
    assert!(
        rendered.text.starts_with("# Standings"),
        "{}",
        rendered.text
    );
    assert!(!rendered.text.contains("<div"), "{}", rendered.text);
    assert!(rendered.text.contains("Blue"), "{}", rendered.text);
    assert_eq!(rendered.lint.len(), 1);
    assert_eq!(rendered.lint[0].severity, "warning");
    assert_eq!(rendered.index, IndexStatus::Unknown);
    let sent = api.sent();
    assert_eq!(sent[0].path, "/.runtime/lua_script");
    assert!(sent[0].body.contains("markdown.expandMarkdown"));
    assert!(sent[0].body.contains("\"Standings\""));

    let failing = FakeApi::with(vec![script_error("page not found")]);
    assert_eq!(
        read_rendered(&failing, "Gone", OPTS, STILL_USABLE)
            .await
            .unwrap_err(),
        "Lua error: page not found"
    );
}

#[test]
fn index_status_as_str_round_trips_through_from_headers() {
    for status in [
        IndexStatus::CaughtUp,
        IndexStatus::Behind,
        IndexStatus::Polling,
        IndexStatus::Unknown,
    ] {
        let mut headers = HeaderMap::new();
        headers.insert("x-index-status", HeaderValue::from_static(status.as_str()));
        assert_eq!(IndexStatus::from_headers(&headers), status);
    }
}

#[tokio::test]
async fn reload_matches_load_errors_by_the_clients_ref_of_the_page() {
    let later = i64::MAX - 1;
    // The client parses "Plans# Q3@40" as a header ref and writes it back
    // without the space after the `#`.
    let api = FakeApi::with(vec![
        result(Value::Null),
        logs(json!([
            {"level": "error", "text": "[Client] Error evaluating script: boom at [[Plans#Q3@40]]", "timestamp": later},
            {"level": "info", "text": "[Lua] Loaded 1 scripts in 2ms", "timestamp": later},
        ])),
        result(json!([])),
    ]);
    let report = reload_after_write(&api, "Plans# Q3", OPTS).await;
    assert_eq!(
        report,
        ReloadReport::Problems {
            load_errors: vec!["Error evaluating script: boom at [[Plans#Q3@40]]".to_owned()],
            lint: Vec::new(),
        }
    );
}
