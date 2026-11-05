//! `sb screenshot` — save a PNG of the runtime client's viewport, one element,
//! or (with --full-page) the whole page, optionally after opening a page.

use reqwest::Method;
use server_space_tools::lua_text::runtime_failure;
use server_space_tools::ops::{self, IndexStatus, SpaceApi, SpaceRequest};

use super::lua::{run_options, write_index_note};
use crate::api::STILL_USABLE_CLI;
use crate::conn::SpaceConnection;
use crate::output::OutputMode;
use crate::space_api::{block_on, HttpSpaceApi};

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || !png.starts_with(PNG_SIGNATURE) || &png[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes(png[16..20].try_into().ok()?),
        u32::from_be_bytes(png[20..24].try_into().ok()?),
    ))
}

pub fn write_result(
    png: &[u8],
    file: &str,
    mode: OutputMode,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let (width, height) =
        png_dimensions(png).ok_or_else(|| "server returned an invalid PNG".to_string())?;
    if file == "-" {
        return out.write_all(png).map_err(|e| e.to_string());
    }
    std::fs::write(file, png).map_err(|e| format!("writing {file}: {e}"))?;
    let line = match mode {
        OutputMode::Json | OutputMode::Jsonl => {
            serde_json::json!({"path": file, "width": width, "height": height}).to_string()
        }
        _ => file.to_string(),
    };
    writeln!(out, "{line}").map_err(|e| e.to_string())
}

pub const TRUNCATED_NOTE: &str =
    "note: the page is longer than a full-page screenshot can hold; the image stops before the end of the page";

/// What `sb screenshot` captures, and where it goes.
pub struct Shot<'a> {
    /// Output path, or `-` for stdout.
    pub file: &'a str,
    pub selector: Option<&'a str>,
    pub full_page: bool,
    /// Page to open before capturing.
    pub page: Option<&'a str>,
}

/// `sb screenshot`: the viewport, one element, or (with `full_page`) the
/// whole page, after the index catches up and, with `page`, after opening it.
/// Notes go to `err`.
pub fn run(
    conn: &SpaceConnection,
    shot: &Shot,
    mode: OutputMode,
    out: &mut dyn std::io::Write,
    err: &mut dyn std::io::Write,
) -> Result<(), String> {
    if shot.page.is_some_and(|p| p.trim().is_empty()) {
        return Err("--page must not be empty".into());
    }
    if shot.selector.is_some_and(|s| s.trim().is_empty()) {
        return Err("--selector must not be empty".into());
    }
    let api = HttpSpaceApi::from_connection(conn)?;
    let opts = run_options(conn);
    let (png, truncated, index, page_note) = block_on(async {
        let page_note = match shot.page {
            Some(page) => ops::open_page(&api, page, opts, STILL_USABLE_CLI).await?,
            None => None,
        };
        let response = api
            .send(SpaceRequest {
                method: Method::GET,
                path_and_query: screenshot_path(shot),
                body: Vec::new(),
                headers: ops::runtime_headers(opts),
            })
            .await?;
        if !response.status.is_success() {
            return Err(runtime_failure(
                response.status,
                &response.body,
                opts.timeout_secs,
                STILL_USABLE_CLI,
            ));
        }
        let truncated = response
            .headers
            .get("x-screenshot-truncated")
            .is_some_and(|v| v.as_bytes() == b"true");
        Ok((
            response.body,
            truncated,
            IndexStatus::from_headers(&response.headers),
            page_note,
        ))
    })?;
    write_index_note(index, err)?;
    let notes = page_note
        .into_iter()
        .chain(truncated.then(|| TRUNCATED_NOTE.to_owned()));
    for note in notes {
        writeln!(err, "{note}").map_err(|e| e.to_string())?;
    }
    write_result(&png, shot.file, mode, out)
}

fn screenshot_path(shot: &Shot) -> String {
    let mut url = reqwest::Url::parse("http://localhost/.runtime/screenshot").expect("valid URL");
    if let Some(selector) = shot.selector {
        url.query_pairs_mut().append_pair("selector", selector);
    }
    if shot.full_page {
        url.query_pairs_mut().append_pair("fullPage", "1");
    }
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conn::Auth;
    use crate::space_api::test_server::{connection, json, response, serve, Recorded};

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn reads_png_dimensions() {
        assert_eq!(png_dimensions(&png(800, 600)), Some((800, 600)));
        assert_eq!(png_dimensions(b"not a png"), None);
    }

    #[test]
    fn writes_file_and_prints_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        let path = path.to_str().unwrap();
        let mut out = Vec::new();
        write_result(&png(2, 3), path, OutputMode::Text, &mut out).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), png(2, 3));
        assert_eq!(String::from_utf8(out).unwrap(), format!("{path}\n"));
    }

    #[test]
    fn json_mode_prints_path_and_dimensions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        let path = path.to_str().unwrap();
        let mut out = Vec::new();
        write_result(&png(2, 3), path, OutputMode::Json, &mut out).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"path": path, "width": 2, "height": 3})
        );
    }

    #[test]
    fn dash_writes_only_png_bytes() {
        let mut out = Vec::new();
        write_result(&png(2, 3), "-", OutputMode::Json, &mut out).unwrap();
        assert_eq!(out, png(2, 3));
    }

    fn capture(
        responses: Vec<Vec<u8>>,
        shot: &Shot,
    ) -> (Result<(), String>, String, Vec<Recorded>) {
        let (base, handle) = serve(responses);
        let conn = connection(&base, Auth::None);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let result = run(&conn, shot, OutputMode::Text, &mut out, &mut err);
        (
            result,
            String::from_utf8(err).unwrap(),
            handle.join().unwrap(),
        )
    }

    fn png_response(headers: &[(&str, &str)]) -> Vec<u8> {
        let mut all = vec![("Content-Type", "image/png")];
        all.extend_from_slice(headers);
        response("200 OK", &all, &png(2, 3))
    }

    #[test]
    fn screenshot_catches_up_and_prints_notes_on_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        let (result, stderr, requests) = capture(
            vec![png_response(&[
                ("X-Index-Status", "behind"),
                ("X-Screenshot-Truncated", "true"),
            ])],
            &Shot {
                file: path.to_str().unwrap(),
                selector: None,
                full_page: true,
                page: None,
            },
        );
        result.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), png(2, 3));
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, "/.runtime/screenshot?fullPage=1");
        assert_eq!(requests[0].header("x-await-index"), Some("1"));
        assert_eq!(requests[0].header("x-timeout"), Some("30"));
        assert!(
            stderr.contains("Note: recent file changes were still being indexed"),
            "{stderr}"
        );
        assert!(stderr.contains(TRUNCATED_NOTE), "{stderr}");
    }

    #[test]
    fn page_is_opened_and_shown_before_capturing() {
        let (result, stderr, requests) = capture(
            vec![
                json("200 OK", &[], r#"{"result":null}"#),
                json("200 OK", &[], r#"{"result":"Projects/Launch"}"#),
                png_response(&[]),
            ],
            &Shot {
                file: "-",
                selector: Some("#sb-top"),
                full_page: false,
                page: Some("Projects/Launch"),
            },
        );
        result.unwrap();
        assert_eq!(stderr, "");
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].path, "/.runtime/lua");
        assert_eq!(requests[0].body, r#"editor.navigate("Projects/Launch")"#);
        assert_eq!(requests[0].header("x-await-index"), Some("1"));
        assert_eq!(requests[1].body, "editor.getCurrentPage()");
        assert_eq!(requests[1].header("x-await-index"), None);
        assert_eq!(requests[2].path, "/.runtime/screenshot?selector=%23sb-top");
        assert_eq!(requests[2].header("x-await-index"), Some("1"));
    }

    #[test]
    fn plain_screenshot_sends_no_query() {
        let (result, _, requests) = capture(
            vec![png_response(&[])],
            &Shot {
                file: "-",
                selector: None,
                full_page: false,
                page: None,
            },
        );
        result.unwrap();
        assert_eq!(requests[0].path, "/.runtime/screenshot");
    }

    #[test]
    fn screenshot_error_gets_the_mcp_hint() {
        let (result, _, _) = capture(
            vec![json(
                "404 Not Found",
                &[],
                r#"{"error":"no visible element matches the selector","code":"selector_not_found"}"#,
            )],
            &Shot {
                file: "-",
                selector: Some(".x"),
                full_page: false,
                page: None,
            },
        );
        assert_eq!(
            result.unwrap_err(),
            "No element matches the selector: no visible element matches the selector"
        );
    }

    #[test]
    fn empty_page_is_refused() {
        let conn = connection("http://127.0.0.1:9", Auth::None);
        let shot = Shot {
            file: "-",
            selector: None,
            full_page: false,
            page: Some(" "),
        };
        let err = run(
            &conn,
            &shot,
            OutputMode::Text,
            &mut Vec::new(),
            &mut Vec::new(),
        );
        assert_eq!(err.unwrap_err(), "--page must not be empty");
    }

    #[test]
    fn empty_selector_is_refused() {
        let conn = connection("http://127.0.0.1:9", Auth::None);
        let shot = Shot {
            file: "-",
            selector: Some(""),
            full_page: false,
            page: None,
        };
        let err = run(
            &conn,
            &shot,
            OutputMode::Text,
            &mut Vec::new(),
            &mut Vec::new(),
        );
        assert_eq!(err.unwrap_err(), "--selector must not be empty");
    }

    #[test]
    fn rejects_non_png() {
        let mut out = Vec::new();
        assert!(write_result(b"<html>", "-", OutputMode::Text, &mut out).is_err());
        assert!(out.is_empty());
    }
}
