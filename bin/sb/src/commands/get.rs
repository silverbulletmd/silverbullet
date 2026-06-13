//! `sb get` — list indexed tags, list objects of a tag, or fetch one object.
//!
//! It owns its exit codes and prints its own
//! errors to stderr; the dispatch arm wraps the `ExitCode` in `Ok(...)`.

use std::io::Write;
use std::process::ExitCode;

use crate::cli::GetArgs;
use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

// ---------------------------------------------------------------------------
// Percent-encoding helper (RFC 3986 path-segment escaping)
// ---------------------------------------------------------------------------

/// Percent-encode a path segment, leaving only RFC 3986 unreserved characters
/// unencoded (`A-Z a-z 0-9 - _ . ~`).
pub fn encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == '~' {
            out.push(ch);
        } else {
            out.push('%');
            out.push(hex_digit(byte >> 4));
            out.push(hex_digit(byte & 0xf));
        }
    }
    out
}

#[inline]
fn hex_digit(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'A' + n - 10) as char,
    }
}

// ---------------------------------------------------------------------------
// Query-string builder — pure function (tested independently)
// ---------------------------------------------------------------------------

/// Build the query-string parameters for a tag-list request from `GetArgs`.
///
/// Returns `Err` with a user-facing message if any selector or where clause
/// is malformed.
pub fn build_query(args: &GetArgs) -> Result<Vec<(String, String)>, String> {
    let mut params: Vec<(String, String)> = Vec::new();

    // -l / --selector: comma-separated field=value pairs
    for s in &args.selector {
        for kv in s.split(',') {
            match kv.splitn(2, '=').collect::<Vec<_>>()[..] {
                [field, value] => {
                    params.push((format!("where[{field}]"), value.to_string()));
                }
                _ => {
                    return Err(format!("invalid -l value: {kv:?} (want field=value)"));
                }
            }
        }
    }

    // --where: field=val or field:op=val
    for w in &args.where_ {
        match w.splitn(2, '=').collect::<Vec<_>>()[..] {
            [key, val] => {
                if let Some(colon) = key.find(':') {
                    if colon > 0 {
                        let field = &key[..colon];
                        let op = &key[colon + 1..];
                        params.push((format!("where[{field}][{op}]"), val.to_string()));
                    } else {
                        // colon at position 0 is unusual; treat as plain key
                        params.push((format!("where[{key}]"), val.to_string()));
                    }
                } else {
                    params.push((format!("where[{key}]"), val.to_string()));
                }
            }
            _ => {
                return Err(format!(
                    "invalid --where: {w:?} (want field=val or field:op=val)"
                ));
            }
        }
    }

    // --sort-by
    for s in &args.sort_by {
        params.push(("order".to_string(), s.clone()));
    }

    // --limit (only if > 0)
    if let Some(n) = args.limit {
        if n > 0 {
            params.push(("limit".to_string(), n.to_string()));
        }
    }

    // --offset (only if > 0)
    if let Some(n) = args.offset {
        if n > 0 {
            params.push(("offset".to_string(), n.to_string()));
        }
    }

    // --select
    if let Some(s) = &args.select {
        if !s.is_empty() {
            params.push(("select".to_string(), s.clone()));
        }
    }

    // --verbose / -v
    if args.verbose {
        params.push(("debug".to_string(), "1".to_string()));
    }

    Ok(params)
}

// ---------------------------------------------------------------------------
// API error formatter
// ---------------------------------------------------------------------------

fn api_error_msg(status: reqwest::StatusCode, body: &[u8]) -> String {
    #[derive(serde::Deserialize)]
    struct ApiErr {
        #[serde(default)]
        error: String,
        #[serde(default)]
        code: String,
    }

    let (msg, code) = if let Ok(e) = serde_json::from_slice::<ApiErr>(body) {
        let msg = if e.error.is_empty() {
            String::from_utf8_lossy(body).into_owned()
        } else {
            e.error
        };
        (msg, e.code)
    } else {
        (String::from_utf8_lossy(body).into_owned(), String::new())
    };

    format!("API error (HTTP {}, code={code}): {msg}", status.as_u16())
}

// ---------------------------------------------------------------------------
// Shared response handler
// ---------------------------------------------------------------------------

/// Auth-check + output helper.  Returns `None` if the response was handled
/// (success or auth error), `Some(status, body)` if the caller should do
/// further status-specific handling (e.g. 404 → exit 3).
fn handle_response(
    result: Result<(reqwest::StatusCode, Vec<u8>), String>,
    mode: OutputMode,
    out: &mut dyn Write,
) -> ExitCode {
    handle_response_with_not_found(result, mode, out, false)
}

fn handle_response_with_not_found(
    result: Result<(reqwest::StatusCode, Vec<u8>), String>,
    mode: OutputMode,
    out: &mut dyn Write,
    single_object: bool,
) -> ExitCode {
    const AUTH_ERR: &str =
        "authentication required; use --token, or configure a space with 'space add'";

    let (status, body) = match result {
        Err(e) => {
            eprintln!("Error: {e}");
            return ExitCode::from(1);
        }
        Ok(pair) => pair,
    };

    if status == reqwest::StatusCode::UNAUTHORIZED
        || (status.as_u16() >= 300 && status.as_u16() < 400 && status.as_u16() != 304)
    {
        eprintln!("Error: {AUTH_ERR}");
        return ExitCode::from(1);
    }

    if single_object && status == reqwest::StatusCode::NOT_FOUND {
        eprintln!("Not found");
        return ExitCode::from(3);
    }

    if status == reqwest::StatusCode::OK {
        if let Err(e) = output::format_bytes(out, &body, mode) {
            eprintln!("Error: writing output: {e}");
            return ExitCode::from(1);
        }
        return ExitCode::SUCCESS;
    }

    eprintln!("Error: {}", api_error_msg(status, &body));
    ExitCode::from(2)
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

/// Run the `get` command.  Returns an `ExitCode` directly; prints errors to
/// stderr itself (so the dispatch arm wraps this in `Ok(...)`).
///
/// Exit codes:
/// - 0  success
/// - 1  transport / connection (or auth) error
/// - 2  API error (non-2xx, except single-object 404)
/// - 3  not found (404 on single-object fetch)
pub fn run(
    conn: &SpaceConnection,
    args: &GetArgs,
    mode: OutputMode,
    out: &mut dyn Write,
) -> ExitCode {
    match (&args.tag, &args.ref_) {
        // ---- Case 1: no tag — list known tag names --------------------------
        (None, _) => handle_response(conn.objects_raw("", &[]), mode, out),

        // ---- Case 2: tag + ref — single-object fetch ------------------------
        (Some(tag), Some(ref_)) => {
            let path = format!(
                "/{}/{}",
                encode_path_segment(tag),
                encode_path_segment(ref_)
            );
            handle_response_with_not_found(conn.objects_raw(&path, &[]), mode, out, true)
        }

        // ---- Case 3: tag only — list objects --------------------------------
        (Some(tag), None) => {
            let params = match build_query(args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("Error: {e}");
                    return ExitCode::from(1);
                }
            };
            let path = format!("/{}", encode_path_segment(tag));
            handle_response(conn.objects_raw(&path, &params), mode, out)
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::GetArgs;

    // -----------------------------------------------------------------------
    // Helper to build a default GetArgs with all fields empty/None/false
    // -----------------------------------------------------------------------

    fn default_args() -> GetArgs {
        GetArgs {
            tag: None,
            ref_: None,
            selector: vec![],
            where_: vec![],
            sort_by: vec![],
            limit: None,
            offset: None,
            select: None,
            verbose: false,
        }
    }

    fn find_param<'a>(params: &'a [(String, String)], key: &str) -> Option<&'a str> {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn find_all_params<'a>(params: &'a [(String, String)], key: &str) -> Vec<&'a str> {
        params
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .collect()
    }

    // -----------------------------------------------------------------------
    // build_query — selector (-l)
    // -----------------------------------------------------------------------

    #[test]
    fn selector_single_comma_separated() {
        let args = GetArgs {
            selector: vec!["done=false,priority=1".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "where[done]"), Some("false"));
        assert_eq!(find_param(&params, "where[priority]"), Some("1"));
    }

    #[test]
    fn selector_multiple_values() {
        let args = GetArgs {
            selector: vec!["status=open".to_string(), "priority=1".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "where[status]"), Some("open"));
        assert_eq!(find_param(&params, "where[priority]"), Some("1"));
    }

    #[test]
    fn selector_invalid_no_equals() {
        let args = GetArgs {
            selector: vec!["nope".to_string()],
            ..default_args()
        };
        let err = build_query(&args).unwrap_err();
        assert!(
            err.contains("invalid -l value"),
            "expected 'invalid -l value' in: {err}"
        );
        assert!(
            err.contains("nope"),
            "expected the offending value in: {err}"
        );
    }

    // -----------------------------------------------------------------------
    // build_query — where
    // -----------------------------------------------------------------------

    #[test]
    fn where_with_op() {
        let args = GetArgs {
            where_: vec!["status:ne=archived".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(
            find_param(&params, "where[status][ne]"),
            Some("archived"),
            "params: {params:?}"
        );
    }

    #[test]
    fn where_plain_equality() {
        let args = GetArgs {
            where_: vec!["done=false".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "where[done]"), Some("false"));
    }

    #[test]
    fn where_invalid_no_equals() {
        let args = GetArgs {
            where_: vec!["nope".to_string()],
            ..default_args()
        };
        let err = build_query(&args).unwrap_err();
        assert!(
            err.contains("invalid --where"),
            "expected 'invalid --where' in: {err}"
        );
    }

    #[test]
    fn where_value_contains_equals() {
        // field=str:01234 — the value part contains no further split on '='
        let args = GetArgs {
            where_: vec!["zipCode=str:01234".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "where[zipCode]"), Some("str:01234"));
    }

    #[test]
    fn where_dotted_field() {
        let args = GetArgs {
            where_: vec!["meta.author=alice".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "where[meta.author]"), Some("alice"));
    }

    // -----------------------------------------------------------------------
    // build_query — sort_by
    // -----------------------------------------------------------------------

    #[test]
    fn sort_by_appended_as_order() {
        let args = GetArgs {
            sort_by: vec!["priority:desc".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_all_params(&params, "order"), vec!["priority:desc"]);
    }

    #[test]
    fn sort_by_multiple() {
        let args = GetArgs {
            sort_by: vec!["priority:desc".to_string(), "name".to_string()],
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        let orders = find_all_params(&params, "order");
        assert_eq!(orders, vec!["priority:desc", "name"]);
    }

    // -----------------------------------------------------------------------
    // build_query — limit / offset / select / verbose
    // -----------------------------------------------------------------------

    #[test]
    fn limit_positive_included() {
        let args = GetArgs {
            limit: Some(20),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "limit"), Some("20"));
    }

    #[test]
    fn limit_zero_excluded() {
        let args = GetArgs {
            limit: Some(0),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert!(find_param(&params, "limit").is_none());
    }

    #[test]
    fn limit_none_excluded() {
        let args = default_args();
        let params = build_query(&args).unwrap();
        assert!(find_param(&params, "limit").is_none());
    }

    #[test]
    fn offset_positive_included() {
        let args = GetArgs {
            offset: Some(10),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "offset"), Some("10"));
    }

    #[test]
    fn offset_zero_excluded() {
        let args = GetArgs {
            offset: Some(0),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert!(find_param(&params, "offset").is_none());
    }

    #[test]
    fn select_non_empty_included() {
        let args = GetArgs {
            select: Some("name,priority".to_string()),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "select"), Some("name,priority"));
    }

    #[test]
    fn select_empty_excluded() {
        let args = GetArgs {
            select: Some(String::new()),
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert!(find_param(&params, "select").is_none());
    }

    #[test]
    fn verbose_adds_debug_1() {
        let args = GetArgs {
            verbose: true,
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        assert_eq!(find_param(&params, "debug"), Some("1"));
    }

    #[test]
    fn verbose_false_no_debug() {
        let args = default_args();
        let params = build_query(&args).unwrap();
        assert!(find_param(&params, "debug").is_none());
    }

    // -----------------------------------------------------------------------
    // build_query — order of parameters (selector, wheres, sort, limit,
    // offset, select, debug)
    // -----------------------------------------------------------------------

    #[test]
    fn param_order_is_stable() {
        let args = GetArgs {
            selector: vec!["tag=task".to_string()],
            where_: vec!["done=false".to_string()],
            sort_by: vec!["priority:desc".to_string()],
            limit: Some(10),
            offset: Some(5),
            select: Some("name,ref".to_string()),
            verbose: true,
            ..default_args()
        };
        let params = build_query(&args).unwrap();
        let keys: Vec<&str> = params.iter().map(|(k, _)| k.as_str()).collect();
        // selector first, then where, then order, then limit, offset, select, debug
        let sel_idx = keys.iter().position(|&k| k == "where[tag]").unwrap();
        let whe_idx = keys.iter().position(|&k| k == "where[done]").unwrap();
        let ord_idx = keys.iter().position(|&k| k == "order").unwrap();
        let lim_idx = keys.iter().position(|&k| k == "limit").unwrap();
        let off_idx = keys.iter().position(|&k| k == "offset").unwrap();
        let sel2_idx = keys.iter().position(|&k| k == "select").unwrap();
        let dbg_idx = keys.iter().position(|&k| k == "debug").unwrap();
        assert!(sel_idx < whe_idx);
        assert!(whe_idx < ord_idx);
        assert!(ord_idx < lim_idx);
        assert!(lim_idx < off_idx);
        assert!(off_idx < sel2_idx);
        assert!(sel2_idx < dbg_idx);
    }

    // -----------------------------------------------------------------------
    // encode_path_segment
    // -----------------------------------------------------------------------

    #[test]
    fn encode_space() {
        assert_eq!(encode_path_segment("my page"), "my%20page");
    }

    #[test]
    fn encode_at_sign() {
        assert_eq!(encode_path_segment("Foo@3"), "Foo%403");
    }

    #[test]
    fn encode_unreserved_unchanged() {
        let s = "abcXYZ0123-_.~";
        assert_eq!(encode_path_segment(s), s);
    }

    #[test]
    fn encode_slash() {
        assert_eq!(encode_path_segment("a/b"), "a%2Fb");
    }

    #[test]
    fn encode_colon() {
        assert_eq!(encode_path_segment("page:1"), "page%3A1");
    }

    // -----------------------------------------------------------------------
    // Mock-server integration tests
    // -----------------------------------------------------------------------

    use crate::conn::{Auth, SpaceConnection};
    use reqwest::blocking::Client;
    use std::{
        io::{BufRead, BufReader, Write as IoWrite},
        net::TcpListener,
        thread,
        time::Duration,
    };

    fn mock_server_once(response: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        let base_url = format!("http://127.0.0.1:{port}");

        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut writer = stream;

            // Read and discard the HTTP request.
            let mut request_line = String::new();
            reader.read_line(&mut request_line).unwrap();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
            }

            writer.write_all(response.as_bytes()).unwrap();
            request_line.trim().to_string()
        });

        (base_url, handle)
    }

    fn test_conn(base_url: &str) -> SpaceConnection {
        SpaceConnection {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base_url: base_url.trim_end_matches('/').to_string(),
            auth: Auth::Bearer("tok".to_string()),
            timeout: Duration::from_secs(5),
        }
    }

    #[test]
    fn single_object_404_returns_exit_3() {
        let response = concat!(
            "HTTP/1.1 404 Not Found\r\n",
            "Content-Length: 0\r\n",
            "\r\n",
        );
        let (base_url, handle) = mock_server_once(response);
        let conn = test_conn(&base_url);

        let args = GetArgs {
            tag: Some("task".to_string()),
            ref_: Some("MyPage@0".to_string()),
            ..default_args()
        };
        let mut buf: Vec<u8> = Vec::new();
        let code = run(&conn, &args, OutputMode::Json, &mut buf);
        let _ = handle.join();
        assert_eq!(
            code,
            ExitCode::from(3),
            "404 on single-object should return exit code 3"
        );
        assert!(buf.is_empty(), "nothing written to stdout on 404");
    }

    #[test]
    fn list_200_returns_exit_0_with_output() {
        let body = r#"[{"tag":"task","ref":"MyPage@0"}]"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server_once(response);
        let conn = test_conn(&base_url);

        let args = GetArgs {
            tag: Some("task".to_string()),
            ..default_args()
        };
        let mut buf: Vec<u8> = Vec::new();
        let code = run(&conn, &args, OutputMode::Json, &mut buf);
        let _ = handle.join();
        assert_eq!(
            code,
            ExitCode::SUCCESS,
            "200 list should return exit code 0"
        );
        assert!(!buf.is_empty(), "stdout should have output on 200");
        let s = String::from_utf8(buf).unwrap();
        assert!(s.contains("task"), "output should contain tag name");
    }

    #[test]
    fn no_tag_200_returns_exit_0() {
        let body = r#"["task","page"]"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server_once(response);
        let conn = test_conn(&base_url);

        let args = default_args();
        let mut buf: Vec<u8> = Vec::new();
        let code = run(&conn, &args, OutputMode::Json, &mut buf);
        let _ = handle.join();
        assert_eq!(
            code,
            ExitCode::SUCCESS,
            "200 list-tags should return exit code 0"
        );
        assert!(!buf.is_empty(), "stdout should have output");
    }

    #[test]
    fn api_error_non_200_returns_exit_2() {
        let body = r#"{"error":"something went wrong","code":"BAD_REQUEST"}"#;
        let response = format!(
            "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server_once(response);
        let conn = test_conn(&base_url);

        let args = GetArgs {
            tag: Some("task".to_string()),
            ..default_args()
        };
        let mut buf: Vec<u8> = Vec::new();
        let code = run(&conn, &args, OutputMode::Json, &mut buf);
        let _ = handle.join();
        assert_eq!(code, ExitCode::from(2), "400 should return exit code 2");
    }
}
