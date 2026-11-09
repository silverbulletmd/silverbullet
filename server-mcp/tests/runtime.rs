mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{body::Body, http::Request};
use tower::ServiceExt;

use serde_json::{json, Value};
use silverbullet_server::runtime::RuntimeError;
use silverbullet_server_mcp::{Caller, ToolSet, Tools, MAX_RESULT_BYTES};
use support::{now_ms, Fixture, Script};

struct Env {
    fixture: Fixture,
    script: Arc<Script>,
    tools: Tools,
    space: String,
    ready: tokio::sync::OnceCell<()>,
}

fn env(script: Script) -> Env {
    let script = Arc::new(script);
    let fixture = Fixture::with_runtime(script.clone());
    let space = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({
            "writer-one": {"role": "write"},
            "runtime-off": {"role": "write", "runtimeApi": false},
        }),
    );
    let tools = Tools::new(fixture.host.clone(), "2.12.1");
    Env {
        fixture,
        script,
        tools,
        space,
        ready: tokio::sync::OnceCell::new(),
    }
}

impl Env {
    fn caller(&self, name: &str) -> Caller {
        self.fixture.caller(name)
    }

    async fn call_as(&self, user: &str, tool: &str, mut args: Value) -> Value {
        self.ready
            .get_or_init(|| async {
                let router = self
                    .fixture
                    .manager
                    .instance(&self.space)
                    .unwrap()
                    .router
                    .clone()
                    .unwrap();
                let deadline = Instant::now() + Duration::from_secs(30);
                loop {
                    let response = router
                        .clone()
                        .oneshot(
                            Request::builder()
                                .method("POST")
                                .uri("/.search/query")
                                .header(
                                    "authorization",
                                    format!("Bearer {}", self.fixture.tokens["keeper"]),
                                )
                                .header("content-type", "application/json")
                                .header("x-await-index", "1")
                                .body(Body::from(r#"{"query":"watcher-readiness-probe"}"#))
                                .unwrap(),
                        )
                        .await
                        .unwrap();
                    assert!(response.status().is_success(), "{}", response.status());
                    if response
                        .headers()
                        .get("x-index-status")
                        .is_some_and(|value| value == "caught-up")
                    {
                        break;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "native watcher did not become ready"
                    );
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await;
        args["space"] = json!(self.space);
        self.tools.call(&self.caller(user), tool, args).await
    }

    async fn call(&self, tool: &str, args: Value) -> Value {
        self.call_as("writer-one", tool, args).await
    }

    async fn lua(&self, code: &str) -> Value {
        self.call("lua", json!({"code": code})).await
    }
}

fn text(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap()
}

fn is_error(result: &Value) -> bool {
    result["isError"] == true
}

fn ok(value: Value) -> Result<Value, RuntimeError> {
    Ok(value)
}

#[tokio::test]
async fn lua_expression_uses_lua_endpoint() {
    let env = env(Script::new(|_, _, _| ok(json!(2))));
    let r = env.lua("1 + 1").await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(text(&r), "2");
    assert_eq!(r["structuredContent"]["result"], 2);
    assert_eq!(
        env.script.calls.lock().unwrap().as_slice(),
        &[("sbRuntime.evalLua".to_owned(), "1 + 1".to_owned())]
    );
}

#[tokio::test]
async fn lua_statement_falls_back_to_script() {
    let env = env(Script::new(|_, name, _| {
        if name == "sbRuntime.evalLua" {
            Err(RuntimeError::Eval(
                "Parse error: unexpected symbol near '='".into(),
            ))
        } else {
            ok(json!("done"))
        }
    }));
    let r = env.lua("x = 1").await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(text(&r), "\"done\"");
    let names: Vec<String> = env
        .script
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.0.clone())
        .collect();
    assert_eq!(names, ["sbRuntime.evalLua", "sbRuntime.evalLuaScript"]);
}

#[tokio::test]
async fn lua_failing_both_ways_reports_both_errors() {
    let env = env(Script::new(|_, name, _| {
        Err(RuntimeError::Eval(if name == "sbRuntime.evalLua" {
            "Parse error: unexpected symbol near ']'".into()
        } else {
            "Parse error: unexpected symbol near 'q'".into()
        }))
    }));
    let r = env
        .lua("query[[from p = index.pages() select {a = p.name]]")
        .await;
    assert!(is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("near 'q'"), "{t}");
    assert!(
        t.contains(
            "As an expression it failed with: Lua error: Parse error: unexpected symbol near ']'"
        ),
        "{t}"
    );
}

#[tokio::test]
async fn lua_statement_keyword_goes_straight_to_script() {
    let env = env(Script::new(|_, _, _| ok(json!(2))));
    let r = env.lua("local x = 1\nreturn x + 1").await;
    assert!(!is_error(&r), "{r}");
    let names: Vec<String> = env
        .script
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.0.clone())
        .collect();
    assert_eq!(names, ["sbRuntime.evalLuaScript"]);
}

#[tokio::test]
async fn lua_bare_expected_error_does_not_rerun_as_script() {
    let env = env(Script::new(|_, _, _| {
        Err(RuntimeError::Eval("Expected table".into()))
    }));
    let r = env.lua("save()").await;
    assert!(is_error(&r));
    assert_eq!(env.script.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn lua_runtime_error_is_reported_without_fallback() {
    let env = env(Script::new(|_, _, _| {
        Err(RuntimeError::Eval("attempt to call a nil value".into()))
    }));
    let r = env.lua("nothing()").await;
    assert!(is_error(&r));
    assert_eq!(text(&r), "Lua error: attempt to call a nil value");
    assert_eq!(env.script.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn lua_appends_console_output_since_call_start() {
    let env = env(Script::new(|script, _, _| {
        std::thread::sleep(Duration::from_millis(3));
        script.push_log("during the call", now_ms());
        ok(json!(1))
    }));
    env.script.push_log("before the call", 1);
    let r = env.lua("print('x') return 1").await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("Console output during this call:\n[log] during the call"));
    assert!(!t.contains("before the call"));
    assert_eq!(
        r["structuredContent"]["console"][0]["text"],
        "during the call"
    );
}

#[tokio::test]
async fn lua_runtime_disabled_is_actionable_error() {
    let env = env(Script::new(|_, _, _| ok(json!(1))));
    for (tool, args) in [("lua", json!({"code": "1"})), ("screenshot", json!({}))] {
        let r = env.call_as("runtime-off", tool, args).await;
        assert!(is_error(&r), "{r}");
        assert!(text(&r).contains("not available for you in this space"));
        assert!(text(&r).contains("read, write, edit and search"));
    }
    assert!(env.script.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn lua_maps_runtime_failures_to_actionable_text() {
    for (error, expected) in [
        (
            RuntimeError::NotReady,
            "runtime is starting or unavailable; retry shortly",
        ),
        (
            RuntimeError::Timeout,
            "timed out after 60s; narrow the query or add a limit",
        ),
    ] {
        let error = std::sync::Mutex::new(Some(error));
        let env = env(Script::new(move |_, _, _| {
            Err(error.lock().unwrap().take().unwrap())
        }));
        let r = env.lua("1").await;
        assert!(is_error(&r));
        assert!(
            text(&r).to_lowercase().contains(expected),
            "{} / {expected}",
            text(&r)
        );
    }
}

#[tokio::test]
async fn lua_result_truncated() {
    let env = env(Script::new(|_, _, _| {
        ok(json!("x".repeat(MAX_RESULT_BYTES + 500)))
    }));
    let r = env.lua("return big()").await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("Result truncated"));
    assert!(t.contains("limit"));
    assert!(t.len() < MAX_RESULT_BYTES + 500);
    assert_eq!(r["structuredContent"]["truncated"], true);
}

#[tokio::test]
async fn lua_list_result_starts_with_its_count() {
    let env = env(Script::new(|_, _, _| {
        ok(json!([{"name": "A"}, {"name": "B"}, {"name": "C"}]))
    }));
    let r = env.lua("query[[from p = index.pages()]]").await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    let (header, body) = t.split_once("\n\n").unwrap();
    assert_eq!(header, "3 results");
    assert_eq!(
        serde_json::from_str::<Value>(body)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(r["structuredContent"]["count"], 3);
    assert_eq!(r["structuredContent"]["result"][2]["name"], "C");

    let env = env_with(json!([{"name": "A"}]));
    assert!(text(&env.lua("x()").await).starts_with("1 result\n\n["));
    let env = env_with(json!([]));
    assert_eq!(text(&env.lua("x()").await), "0 results\n\n[]");
}

fn env_with(value: Value) -> Env {
    env(Script::new(move |_, _, _| ok(value.clone())))
}

#[tokio::test]
async fn lua_truncated_list_says_how_many_rows_it_shows() {
    let rows: Vec<Value> = (0..2000)
        .map(|i| json!({"name": format!("Page {i}"), "text": "y".repeat(80)}))
        .collect();
    let env = env_with(json!(rows));
    let r = env.lua("query[[from p = index.pages()]]").await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    let (header, body) = t.split_once("\n\n").unwrap();
    let shown = serde_json::from_str::<Value>(body).unwrap();
    let k = shown.as_array().unwrap().len();
    assert!(k > 0 && k < 2000, "{k}");
    assert_eq!(
        header,
        format!("Showing the first {k} of 2000 results; narrow the query or add a limit.")
    );
    assert!(body.len() <= MAX_RESULT_BYTES);
    assert_eq!(shown[k - 1]["name"], format!("Page {}", k - 1));
    assert_eq!(r["structuredContent"]["truncated"], true);
    assert_eq!(r["structuredContent"]["count"], 2000);
    assert_eq!(r["structuredContent"]["shown"], k);
}

#[tokio::test]
async fn lua_list_cut_by_the_runtime_counts_the_rows_it_left_out() {
    let mut rows: Vec<Value> = (0..1000).map(|i| json!(i)).collect();
    rows.push(json!(
        "<truncated: 500 more rows; use sb query with where/limit>"
    ));
    let env = env_with(json!(rows));
    let r = env.lua("query[[from p = index.pages()]]").await;
    let t = text(&r);
    let (header, body) = t.split_once("\n\n").unwrap();
    assert_eq!(
        header,
        "Showing the first 1000 of 1500 results; narrow the query or add a limit."
    );
    assert!(!body.contains("<truncated"), "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(body)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1000
    );
    assert_eq!(r["structuredContent"]["count"], 1500);
    assert_eq!(r["structuredContent"]["shown"], 1000);
    assert_eq!(r["structuredContent"]["truncated"], true);
}

#[tokio::test]
async fn lua_non_list_result_has_no_count() {
    for value in [json!({"a": 1}), json!("text"), json!(2), json!(null)] {
        let env = env_with(value.clone());
        let r = env.lua("x()").await;
        assert_eq!(text(&r), serde_json::to_string_pretty(&value).unwrap());
        assert!(r["structuredContent"].get("count").is_none(), "{r}");
    }
}

const AWAIT_INDEX: &str = "index.awaitPendingChanges()";

/// Answers the index wait with `wait` and anything else with "user result",
/// counting the waits.
fn index_script(
    waits: Arc<AtomicUsize>,
    wait: impl Fn(usize) -> Result<Value, RuntimeError> + Send + Sync + 'static,
) -> Script {
    Script::new(move |_, _, code| {
        if code.contains(AWAIT_INDEX) {
            return wait(waits.fetch_add(1, Ordering::SeqCst) + 1);
        }
        ok(json!("user result"))
    })
}

#[tokio::test]
async fn lua_leaves_index_catch_up_to_the_server() {
    let waits = Arc::new(AtomicUsize::new(0));
    let env = env(index_script(waits.clone(), |_| ok(Value::Null)));
    let w = env
        .call("write", json!({"page": "Notes/Today", "content": "hi"}))
        .await;
    assert!(!is_error(&w), "{w}");

    let r = env.lua("return 'x'").await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(text(&r), "\"user result\"");
    assert_eq!(env.script.codes(), ["return 'x'"]);
    assert_eq!(waits.load(Ordering::SeqCst), 0);
    assert!(env.script.catch_ups.load(Ordering::SeqCst) >= 1);
}

#[tokio::test]
async fn lua_sends_await_index_and_appends_behind_note() {
    let env = env(Script::new(|_, _, _| ok(json!("user result"))));
    env.script.catch_up_fails.store(true, Ordering::SeqCst);
    let r = env.lua("return 'x'").await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(
        text(&r),
        "\"user result\"\n\nNote: recent file changes were still being indexed after 5s; \
         results may miss the latest edits."
    );
    assert_eq!(env.script.catch_ups.load(Ordering::SeqCst), 1);

    // A failed catch-up is retried by the next call.
    env.script.catch_up_fails.store(false, Ordering::SeqCst);
    let r = env.lua("return 'x'").await;
    assert_eq!(text(&r), "\"user result\"", "{r}");
    assert_eq!(env.script.catch_ups.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_failed_reload_is_retried_before_the_next_runtime_call() {
    let reboots = Arc::new(AtomicUsize::new(0));
    let counted = reboots.clone();
    let env = env(Script::new(move |_, _, code| {
        if code == "system.reboot()" && counted.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(RuntimeError::Timeout);
        }
        ok(Value::Null)
    }));
    let w = env
        .call(
            "write",
            json!({"page": "Library/Mine", "content": "```space-lua\nx = 1\n```"}),
        )
        .await;
    assert!(text(&w).contains("reloading it failed"), "{w}");

    let r = env.lua("return x").await;
    assert!(!is_error(&r), "{r}");
    assert!(!text(&r).contains("Note:"), "{r}");
    assert_eq!(
        env.script.codes(),
        ["system.reboot()", "system.reboot()", "return x"]
    );
    env.lua("return x").await;
    assert_eq!(reboots.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_failed_reload_is_retried_only_for_its_writer_and_space() {
    let reboots = Arc::new(AtomicUsize::new(0));
    let counted = reboots.clone();
    let script = Arc::new(Script::new(move |_, _, code| {
        if code == "system.reboot()" && counted.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(RuntimeError::Timeout);
        }
        ok(Value::Null)
    }));
    let fixture = Fixture::with_runtime(script.clone());
    let writers = json!({"writer-one": {"role": "write"}, "reader": {"role": "write"}});
    let alpha = fixture.space("Alpha", "/alpha", "none", writers.clone());
    let beta = fixture.space("Beta", "/beta", "none", writers);
    let tools = Tools::new(fixture.host.clone(), "2.12.1");
    let call = |user: &str, space: &str, tool: &str, mut args: Value| {
        args["space"] = json!(space);
        let caller = fixture.caller(user);
        let tools = &tools;
        let tool = tool.to_owned();
        async move { tools.call(&caller, &tool, args).await }
    };
    let lua = json!({"code": "return 1"});

    let w = call(
        "writer-one",
        &alpha,
        "write",
        json!({"page": "Library/Mine", "content": "```space-lua\nx = 1\n```"}),
    )
    .await;
    assert!(text(&w).contains("reloading it failed"), "{w}");
    call("reader", &alpha, "lua", lua.clone()).await;
    call("writer-one", &beta, "lua", lua.clone()).await;
    assert_eq!(reboots.load(Ordering::SeqCst), 1, "{:?}", script.codes());
    call("writer-one", &alpha, "lua", lua).await;
    assert_eq!(reboots.load(Ordering::SeqCst), 2, "{:?}", script.codes());
}

#[tokio::test]
async fn writing_away_a_script_block_reloads_too() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    let created = env
        .call(
            "write",
            json!({"page": "Library/Mine", "content": "```space-lua\nx = 1\n```"}),
        )
        .await;
    let w = env
        .call(
            "write",
            json!({"page": "Library/Mine", "content": "no scripts",
                   "ifRevision": created["structuredContent"]["revision"]}),
        )
        .await;
    assert!(text(&w).contains("were reloaded without errors"), "{w}");
    let codes = env.script.codes();
    assert_eq!(codes.iter().filter(|c| *c == "system.reboot()").count(), 2);

    // A page that never had scripts is not reloaded.
    let w = env
        .call("write", json!({"page": "Notes/Plain", "content": "hi"}))
        .await;
    assert!(!text(&w).contains("reloaded"), "{w}");
    assert_eq!(env.script.codes().len(), codes.len());
}

#[tokio::test]
async fn writing_a_script_page_reloads_it_at_once() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    let w = env
        .call(
            "write",
            json!({"page": "Library/Mine", "content": "```space-lua\nx = 1\n```"}),
        )
        .await;
    assert!(text(&w).contains("were reloaded without errors"), "{w}");
    // Reloaded at once, so the next call has nothing to wait for
    let reload = ["system.reboot()", "space.lint(\"Library/Mine\")"];
    assert_eq!(env.script.codes(), reload);
    env.lua("return x").await;
    assert_eq!(env.script.codes(), [reload[0], reload[1], "return x"]);

    // Pages without scripts only wait for the index, which the server
    // catches up at the next call
    env.call("write", json!({"page": "Notes/Plain", "content": "hi"}))
        .await;
    env.lua("return 1").await;
    let codes = env.script.codes();
    assert_eq!(codes.iter().filter(|c| *c == "system.reboot()").count(), 1);
    assert!(!codes.iter().any(|c| c == AWAIT_INDEX), "{codes:?}");
    assert!(env.script.catch_ups.load(Ordering::SeqCst) >= 1);
}

#[tokio::test]
async fn a_script_that_fails_to_load_is_reported_by_the_write() {
    let env = env(Script::new(|script, _, code| {
        if code == "system.reboot()" {
            script.push_log(
                "Lua widget error on index: attempt to index a nil value",
                now_ms(),
            );
            script.push_log(
                "Error evaluating script: unexpected symbol near 'd' at [[Library/Mine@12]]",
                now_ms(),
            );
            return ok(Value::Null);
        }
        if code.starts_with("space.lint") {
            return ok(json!([{"page": "Library/Mine", "line": 2, "column": 5,
                "severity": "error", "message": "unexpected symbol near 'd'", "source": "lua"}]));
        }
        ok(Value::Null)
    }));
    let w = env
        .call(
            "write",
            json!({"page": "Library/Mine", "content": "```space-lua\nx = d d\n```"}),
        )
        .await;
    assert!(!is_error(&w), "{w}");
    let t = text(&w);
    assert!(t.contains("reloaded, but have problems"), "{t}");
    assert!(
        t.contains("- Error evaluating script: unexpected symbol near 'd' at [[Library/Mine@12]]"),
        "{t}"
    );
    assert!(
        t.contains("- line 2: [error] unexpected symbol near 'd' (lua)"),
        "{t}"
    );
    // Other pages' widget errors during the reload are not this write's problem
    assert!(!t.contains("Lua widget error"), "{t}");
}

#[tokio::test]
async fn lua_does_not_wait_without_recent_writes() {
    let waits = Arc::new(AtomicUsize::new(0));
    let env = env(index_script(waits.clone(), |_| ok(Value::Null)));
    env.lua("return 'x'").await;
    assert_eq!(waits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rendered_read_evaluates_the_page_and_lists_lint_problems() {
    let env = env(Script::new(|_, _, code| {
        assert!(code.contains("markdown.expandMarkdown"), "{code}");
        assert!(code.contains("space.lint(name)"), "{code}");
        assert!(code.contains("\"Broken Standings\""), "{code}");
        ok(json!({
            "text": "| Team | Wins |\n| --- | --- |\n| Blue | 3 |",
            "lint": [{"page": "Broken Standings", "line": 3, "column": 1,
                      "severity": "error", "message": "unexpected symbol", "source": "widget"}],
        }))
    }));
    let r = env
        .call(
            "read",
            json!({"page": "Broken Standings", "rendered": true}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.starts_with("| Team | Wins |"), "{t}");
    assert!(
        t.contains("Lint: 1 problem(s).\n- line 3: [error] unexpected symbol (widget)"),
        "{t}"
    );
    assert_eq!(r["structuredContent"]["problems"], 1);
    // Structured-only clients see the rendered page and its problems too.
    assert_eq!(r["structuredContent"]["text"], t);
    assert_eq!(
        env.script.calls.lock().unwrap()[0].0,
        "sbRuntime.evalLuaScript"
    );

    let r = env
        .call_as(
            "runtime-off",
            "read",
            json!({"page": "X", "rendered": true}),
        )
        .await;
    assert!(is_error(&r), "{r}");
    let r = env
        .call(
            "read",
            json!({"page": "Broken Standings", "rendered": true, "offset": 3, "limit": 1}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    assert!(text(&r).starts_with("    3\t| Blue | 3 |"), "{}", text(&r));
}

#[tokio::test]
async fn screenshot_navigates_then_returns_png() {
    let current = Arc::new(AtomicUsize::new(0));
    let env = env(Script::new(move |_, _, code| {
        if code.starts_with("editor.getCurrentPage") {
            let n = current.fetch_add(1, Ordering::SeqCst);
            return ok(json!(if n >= 1 { "Notes/Today" } else { "index" }));
        }
        ok(Value::Null)
    }));
    let started = std::time::Instant::now();
    let r = env.call("screenshot", json!({"page": "Notes/Today"})).await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(r["content"][0]["type"], "image");
    assert_eq!(r["content"][0]["mimeType"], "image/png");
    assert!(r["content"][0]["data"]
        .as_str()
        .unwrap()
        .starts_with("iVBOR"));
    assert_eq!(r["content"].as_array().unwrap().len(), 1);
    assert!(started.elapsed() >= Duration::from_millis(500));

    let codes = env.script.codes();
    assert_eq!(codes[0], "editor.navigate(\"Notes/Today\")");
    assert!(codes[1..].iter().all(|c| c == "editor.getCurrentPage()"));
    assert_eq!(codes.len(), 3);
    assert_eq!(
        env.script.screenshots.lock().unwrap().as_slice(),
        &[(None, false)]
    );
}

#[tokio::test]
async fn screenshot_of_a_heading_waits_for_its_page() {
    let env = env(Script::new(|_, _, code| {
        if code.starts_with("editor.getCurrentPage") {
            return ok(json!("Notes/Today"));
        }
        ok(Value::Null)
    }));
    let r = env
        .call("screenshot", json!({"page": "Notes/Today#Plan"}))
        .await;
    assert!(!is_error(&r), "{r}");
    // No "did not show" note: the heading's page counts as shown.
    assert_eq!(r["content"].as_array().unwrap().len(), 1, "{r}");
    assert_eq!(
        env.script.codes()[0],
        "editor.navigate(\"Notes/Today#Plan\")"
    );
}

#[tokio::test]
async fn screenshot_passes_selector_and_full_page_and_reports_truncation() {
    let mut script = Script::new(|_, _, _| ok(Value::Null));
    script.truncated = true;
    let env = env(script);

    let r = env
        .call("screenshot", json!({"selector": "#sb-main .cm-content"}))
        .await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(
        env.script.screenshots.lock().unwrap().as_slice(),
        &[(Some("#sb-main .cm-content".to_owned()), false)]
    );
    assert!(env.script.calls.lock().unwrap().is_empty());

    let r = env.call("screenshot", json!({"fullPage": true})).await;
    assert_eq!(r["content"][0]["type"], "image");
    assert_eq!(r["content"][1]["type"], "text");
    assert!(r["content"][1]["text"]
        .as_str()
        .unwrap()
        .contains("truncated"));

    let r = env
        .call("screenshot", json!({"fullPage": true, "selector": "#x"}))
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("cannot be combined"));
}

/// A blank RGBA PNG of this size.
fn blank_png(width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer
        .write_image_data(&vec![255; (width * height * 4) as usize])
        .unwrap();
    writer.finish().unwrap();
    out
}

#[tokio::test]
async fn full_page_screenshot_comes_in_readable_parts() {
    let mut script = Script::new(|_, _, _| ok(Value::Null));
    script.png = blank_png(10, 40);
    let env = env(script);
    let r = env.call("screenshot", json!({"fullPage": true})).await;
    assert!(!is_error(&r), "{r}");
    let content = r["content"].as_array().unwrap();
    let images = content.iter().filter(|c| c["type"] == "image").count();
    assert_eq!(images, 3, "{r}");
    assert!(content.last().unwrap()["text"]
        .as_str()
        .unwrap()
        .contains("3 parts"));

    // A viewport capture stays one image.
    let r = env.call("screenshot", json!({})).await;
    assert_eq!(r["content"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn search_semantic_maps_to_natural() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    let r = env
        .call("search", json!({"text": "ferns", "mode": "semantic"}))
        .await;
    assert!(is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("\"semantic\" is not available"), "{t}");
    assert!(t.contains("words"), "{t}");
    assert!(!t.contains("natural"));
}

#[tokio::test]
async fn search_returns_page_and_passage() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    env.call(
        "write",
        json!({"page": "Garden/Ferns", "content": "# Ferns\n\nWater the ferns weekly.\n"}),
    )
    .await;
    // The index catches up on its own schedule.
    let mut found = Value::Null;
    for _ in 0..40 {
        let r = env.call("search", json!({"text": "ferns weekly"})).await;
        assert!(!is_error(&r), "{r}");
        if r["structuredContent"]["items"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
        {
            found = r;
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert!(!found.is_null(), "page never became searchable");
    assert!(text(&found).contains("Garden/Ferns — "));
    assert_eq!(
        found["structuredContent"]["items"][0]["page"],
        "Garden/Ferns"
    );
}

/// Search asks the space to let its index catch up first, so it sees a
/// write made just before, with no retrying.
#[tokio::test(flavor = "multi_thread")]
async fn search_right_after_a_write_sees_it() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    let mut revision = Value::Null;
    for word in ["fiddlehead", "bracken", "maidenhair"] {
        let content = format!("# Ferns\n\nWater the {word} weekly.\n");
        let mut args = json!({"page": "Garden/Ferns", "content": content});
        if !revision.is_null() {
            args["ifRevision"] = revision;
        }
        let r = env.call("write", args).await;
        assert!(!is_error(&r), "{r}");
        revision = r["structuredContent"]["revision"].clone();
        let r = env.call("search", json!({"text": word})).await;
        assert!(!is_error(&r), "{r}");
        assert_eq!(
            r["structuredContent"]["items"][0]["page"], "Garden/Ferns",
            "{word}: {r}"
        );
        assert_eq!(r["content"].as_array().unwrap().len(), 1, "a note: {r}");
    }
}

#[tokio::test]
async fn search_rejects_bad_arguments() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    for args in [
        json!({}),
        json!({"text": "  "}),
        json!({"text": "a", "mode": "fuzzy"}),
        json!({"text": "a", "limit": 0}),
    ] {
        let r = env.call("search", args.clone()).await;
        assert!(is_error(&r), "{args}");
    }
}

#[tokio::test]
async fn tool_list_includes_search_lua_and_screenshot() {
    let env = env(Script::new(|_, _, _| ok(Value::Null)));
    let names: Vec<&str> = env.tools.tools().iter().map(|t| t.name).collect();
    assert_eq!(&names[names.len() - 3..], ["search", "lua", "screenshot"]);
    let tools = env.tools.tools();
    let annotation = |name: &str| {
        tools
            .iter()
            .find(|t| t.name == name)
            .unwrap()
            .annotations
            .clone()
    };
    assert_eq!(annotation("search")["readOnlyHint"], true);
    assert_eq!(annotation("screenshot")["readOnlyHint"], true);
    assert_eq!(annotation("lua")["destructiveHint"], true);
}
