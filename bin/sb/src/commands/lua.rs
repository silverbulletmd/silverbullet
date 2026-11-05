//! `sb lua` (also `eval` and `script`) and `sb query`: Space Lua in the
//! connected space, through the operations the MCP `lua` tool uses.

use std::io::Write;

use serde_json::Value;
use server_space_tools::lua_text::console_section;
use server_space_tools::ops::{self, IndexStatus, LuaRun, RunOptions};

use crate::api::STILL_USABLE_CLI;
use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};
use crate::space_api::{block_on, HttpSpaceApi};

use super::query::wrap_query;

/// Options for a runtime call made by `sb`: wait for the index to catch up.
pub(crate) fn run_options(conn: &SpaceConnection) -> RunOptions {
    RunOptions {
        timeout_secs: conn.timeout.as_secs(),
        await_index: true,
    }
}

/// Runs `code`, a statement or an expression. The result goes to `out`;
/// the catch-up note and console output go to `err`.
pub fn run(
    conn: &SpaceConnection,
    code: &str,
    mode: OutputMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    let api = HttpSpaceApi::from_connection(conn)?;
    let run = block_on(ops::run_lua(
        &api,
        code,
        run_options(conn),
        STILL_USABLE_CLI,
    ));
    report(run, mode, out, err)
}

/// Runs a SLIQ query as `return query[[…]]`.
pub fn run_query(
    conn: &SpaceConnection,
    sliq: &str,
    mode: OutputMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    run(conn, &wrap_query(sliq), mode, out, err)
}

/// Writes the catch-up note for `index`, if any, to `err`.
pub(crate) fn write_index_note(index: IndexStatus, err: &mut dyn Write) -> Result<(), String> {
    match index.note() {
        Some(note) => writeln!(err, "{note}").map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

fn report(
    run: LuaRun,
    mode: OutputMode,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    write_index_note(run.index, err)?;
    let console: Vec<Value> = run
        .console
        .iter()
        .map(|e| serde_json::to_value(e).unwrap_or_default())
        .collect();
    if let Some(section) = console_section(&console) {
        writeln!(err, "{section}").map_err(|e| e.to_string())?;
    }
    let value = run.outcome?;
    output::format(out, &value, mode).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conn::Auth;
    use crate::space_api::test_server::{connection, json, serve, Recorded};

    const LATER: i64 = 9_999_999_999_999;

    fn logs(entries: &[(&str, &str)]) -> Vec<u8> {
        let logs: Vec<Value> = entries
            .iter()
            .map(|(level, text)| serde_json::json!({"level": level, "text": text, "timestamp": LATER}))
            .collect();
        json(
            "200 OK",
            &[],
            &serde_json::json!({ "logs": logs }).to_string(),
        )
    }

    struct Ran {
        result: Result<(), String>,
        stdout: String,
        stderr: String,
        requests: Vec<Recorded>,
    }

    fn lua(
        responses: Vec<Vec<u8>>,
        call: impl FnOnce(&SpaceConnection, &mut Vec<u8>, &mut Vec<u8>) -> Result<(), String>,
    ) -> Ran {
        let (base, handle) = serve(responses);
        let conn = connection(&base, Auth::None);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let result = call(&conn, &mut out, &mut err);
        Ran {
            result,
            stdout: String::from_utf8(out).unwrap(),
            stderr: String::from_utf8(err).unwrap(),
            requests: handle.join().unwrap(),
        }
    }

    fn run_code(responses: Vec<Vec<u8>>, code: &str, mode: OutputMode) -> Ran {
        lua(responses, |conn, out, err| run(conn, code, mode, out, err))
    }

    #[test]
    fn lua_json_stdout_is_only_the_value() {
        let ran = run_code(
            vec![
                json("200 OK", &[("X-Index-Status", "behind")], r#"{"result":2}"#),
                logs(&[("log", "first"), ("warn", "second")]),
            ],
            "1 + 1",
            OutputMode::Json,
        );
        ran.result.unwrap();
        assert_eq!(ran.stdout, "2\n");
        assert!(
            ran.stderr.contains(
                "Note: recent file changes were still being indexed after 5s; results may miss \
                 the latest edits."
            ),
            "{}",
            ran.stderr
        );
        assert!(
            ran.stderr
                .contains("Console output during this call:\n[log] first\n[warn] second"),
            "{}",
            ran.stderr
        );
        assert_eq!(ran.requests[0].path, "/.runtime/lua");
        assert_eq!(ran.requests[0].header("x-await-index"), Some("1"));
        assert_eq!(ran.requests[0].header("x-timeout"), Some("30"));
    }

    #[test]
    fn missing_index_status_header_prints_no_note() {
        let ran = run_code(
            vec![json("200 OK", &[], r#"{"result":"hi"}"#), logs(&[])],
            "'hi'",
            OutputMode::Text,
        );
        ran.result.unwrap();
        assert_eq!(ran.stdout, "hi\n");
        assert_eq!(ran.stderr, "");
    }

    #[test]
    fn polling_status_prints_the_polling_note() {
        let ran = run_code(
            vec![
                json(
                    "200 OK",
                    &[("X-Index-Status", "polling")],
                    r#"{"result":1}"#,
                ),
                logs(&[]),
            ],
            "1",
            OutputMode::Json,
        );
        ran.result.unwrap();
        assert!(
            ran.stderr.starts_with("Note: this space polls"),
            "{}",
            ran.stderr
        );
    }

    #[test]
    fn both_errors_are_reported_when_expression_and_script_fail() {
        let ran = run_code(
            vec![
                json(
                    "500 Internal Server Error",
                    &[],
                    r#"{"error":"parse error at line 1","code":"script_error"}"#,
                ),
                json(
                    "500 Internal Server Error",
                    &[],
                    r#"{"error":"attempt to call a nil value","code":"script_error"}"#,
                ),
                logs(&[]),
            ],
            "x = = 1",
            OutputMode::Json,
        );
        let error = ran.result.unwrap_err();
        assert_eq!(
            error,
            "Lua error: attempt to call a nil value\n(As an expression it failed with: Lua \
             error: parse error at line 1)"
        );
        assert_eq!(ran.stdout, "");
        assert_eq!(ran.requests[0].path, "/.runtime/lua");
        assert_eq!(ran.requests[1].path, "/.runtime/lua_script");
    }

    #[test]
    fn statement_runs_once_as_a_script() {
        let ran = run_code(
            vec![json("200 OK", &[], r#"{"result":42}"#), logs(&[])],
            "return 40 + 2",
            OutputMode::Json,
        );
        ran.result.unwrap();
        assert_eq!(ran.stdout, "42\n");
        assert_eq!(ran.requests[0].path, "/.runtime/lua_script");
        assert_eq!(ran.requests[0].body, "return 40 + 2");
    }

    #[test]
    fn query_sends_await_index_and_wraps_return_query() {
        let sliq = "from p = index.pages() select p.name limit 10";
        let ran = lua(
            vec![json("200 OK", &[], r#"{"result":["index"]}"#), logs(&[])],
            |conn, out, err| run_query(conn, sliq, OutputMode::Json, out, err),
        );
        ran.result.unwrap();
        assert_eq!(ran.stdout, "[\"index\"]\n");
        let request = &ran.requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/.runtime/lua_script");
        assert_eq!(request.body, format!("return query[[{sliq}]]"));
        assert_eq!(request.header("x-await-index"), Some("1"));
    }

    #[test]
    fn bridge_unavailable_gets_the_mcp_hint() {
        let ran = run_code(
            vec![
                json(
                    "503 Service Unavailable",
                    &[],
                    r#"{"error":"runtime not ready","code":"bridge_unavailable"}"#,
                ),
                logs(&[]),
            ],
            "1",
            OutputMode::Json,
        );
        assert_eq!(
            ran.result.unwrap_err(),
            "The runtime is starting or unavailable; retry shortly."
        );
    }

    #[test]
    fn disabled_runtime_names_the_cli_commands_that_still_work() {
        let ran = run_code(
            vec![
                json(
                    "503 Service Unavailable",
                    &[],
                    r#"{"error":"Runtime API is not enabled"}"#,
                ),
                json(
                    "503 Service Unavailable",
                    &[],
                    r#"{"error":"Runtime API is not enabled"}"#,
                ),
            ],
            "1",
            OutputMode::Json,
        );
        assert_eq!(
            ran.result.unwrap_err(),
            "The runtime API is disabled for this space; you can still use sb fs and sb search."
        );
    }
}
