//! `sb fs read`: whole files, line ranges, outlines, rendered pages and
//! several files at once.

use std::io::{self, Write};

use serde_json::{json, Value};
use space_tools::page_text::{line_range, slice_lines};

use super::{connection, emit, invalid, operational, range, text, Mode};
use crate::cli::GlobalFlags;
use crate::fs_api::{normalize_path, FsError};

pub(super) fn read_output(
    mut file: crate::fs_api::FsFile,
    lines: Option<&str>,
    number: bool,
    mode: Mode,
    terminal: bool,
    out: &mut dyn Write,
) -> Result<(), FsError> {
    if mode == Mode::Raw && lines.is_none() && !number {
        if terminal {
            text(&file.bytes)?;
        }
        return out.write_all(&file.bytes).map_err(operational);
    }
    let content = text(&file.bytes)?;
    let chunks: Vec<_> = content.split_inclusive('\n').collect();
    let (start, end) = lines.map(range).transpose()?.unwrap_or((1, chunks.len()));
    let selection: Vec<_> = chunks
        .iter()
        .enumerate()
        .skip(start - 1)
        .take(end.saturating_sub(start).saturating_add(1))
        .collect();
    let selected: String = selection.iter().map(|(_, line)| **line).collect();
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        file.metadata["content"] = json!(selected);
        if lines.is_some() {
            file.metadata["startLine"] = json!(start);
            file.metadata["endLine"] = selection.last().map_or(Value::Null, |(i, _)| json!(i + 1));
            file.metadata["totalLines"] = json!(chunks.len());
        }
        emit(out, &file.metadata, "", mode)
    } else if number {
        for (index, line) in selection {
            write!(out, "{}\t{}", index + 1, line).map_err(operational)?;
        }
        Ok(())
    } else {
        out.write_all(selected.as_bytes()).map_err(operational)
    }
}

pub(super) fn offset_output(
    mut file: crate::fs_api::FsFile,
    offset: Option<usize>,
    limit: Option<usize>,
    mode: Mode,
    out: &mut dyn Write,
) -> Result<(), FsError> {
    let content = text(&file.bytes)?;
    let lines: Vec<&str> = content.lines().collect();
    let (start, end) = line_range(lines.len(), offset, limit, "file").map_err(invalid)?;
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        let selected: String = content
            .split_inclusive('\n')
            .skip(start - 1)
            .take(end.saturating_sub(start - 1))
            .collect();
        file.metadata["content"] = json!(selected);
        file.metadata["startLine"] = json!(start);
        file.metadata["endLine"] = if end >= start {
            json!(end)
        } else {
            Value::Null
        };
        file.metadata["totalLines"] = json!(lines.len());
        emit(out, &file.metadata, "", mode)
    } else {
        let body = slice_lines(&lines, (start, end), true, usize::MAX).text;
        writeln!(out, "{body}").map_err(operational)
    }
}

pub(super) fn outline_output(
    file: crate::fs_api::FsFile,
    path: &str,
    mode: Mode,
    out: &mut dyn Write,
) -> Result<(), FsError> {
    let content = text(&file.bytes)?;
    let lines: Vec<&str> = content.lines().collect();
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        let entries: Vec<Value> = space_tools::page_text::outline_entries(&lines)
            .into_iter()
            .map(|(line, text)| json!({"line": line, "text": text}))
            .collect();
        let value = json!({
            "path": path,
            "revision": file.metadata["revision"],
            "lines": lines.len(),
            "outline": entries,
        });
        emit(out, &value, "", mode)
    } else {
        let body = space_tools::page_text::outline(&lines)
            .replace("with offset and limit.", "with --offset and --limit.");
        writeln!(out, "{body}").map_err(operational)
    }
}

pub(super) fn read_rendered_page(
    g: &GlobalFlags,
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    mode: Mode,
    out: &mut dyn Write,
) -> Result<(), FsError> {
    let conn = connection(g)?;
    let api = crate::space_api::HttpSpaceApi::from_connection(&conn).map_err(operational)?;
    let rendered = crate::space_api::block_on(space_tools::ops::read_rendered(
        &api,
        &space_tools::paths::path_to_page(path),
        super::super::lua::run_options(&conn),
        crate::api::STILL_USABLE_CLI,
    ))
    .map_err(|error| match conn.fs_stat(path) {
        // The Lua error for a missing page says nothing useful; report it as missing.
        Err(missing) if missing.exit_code == 3 => missing,
        _ => operational(error).with_path(path),
    })?;
    super::super::lua::write_index_note(rendered.index, &mut io::stderr()).map_err(operational)?;
    let lines: Vec<&str> = rendered.text.lines().collect();
    let selection = line_range(lines.len(), offset, limit, "rendered page").map_err(invalid)?;
    let problems = space_tools::ops::lint_values(&rendered.lint);
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        let content = if offset.is_some() || limit.is_some() {
            lines[selection.0 - 1..selection.1].join("\n")
        } else {
            rendered.text.clone()
        };
        let value = json!({
            "path": path,
            "rendered": true,
            "content": content,
            "lines": lines.len(),
            "lint": problems,
        });
        return emit(out, &value, "", mode);
    }
    let body = if offset.is_some() || limit.is_some() {
        slice_lines(&lines, selection, true, usize::MAX).text
    } else {
        rendered.text.clone()
    };
    let mut sections = vec![body];
    if rendered.had_html {
        sections.push(
            "Widgets are shown as their text; use sb screenshot to see how they look.".to_owned(),
        );
    }
    sections.push(space_tools::lua_text::lint_section(&problems));
    writeln!(out, "{}", sections.join("\n\n")).map_err(operational)
}

pub(super) fn read_several(
    g: &GlobalFlags,
    paths: &[String],
    max_bytes: u64,
    mode: Mode,
    out: &mut dyn Write,
) -> Result<u8, FsError> {
    let conn = connection(g)?;
    let structured = matches!(mode, Mode::Json | Mode::Jsonl);
    let mut first_failure = 0;
    let mut files = Vec::new();
    let mut sections = Vec::new();
    for path in paths {
        let result = normalize_path(path, false)
            .and_then(|path| conn.fs_read(&path, max_bytes))
            .and_then(|mut file| {
                let content = text(&file.bytes)?.to_owned();
                file.metadata["content"] = json!(content);
                Ok((file.metadata, content))
            });
        match result {
            Ok((metadata, content)) => {
                let revision = metadata["revision"].as_str().unwrap_or("unknown");
                let mut section = format!("=== {path} (revision {revision}) ===\n{content}");
                if !content.ends_with('\n') {
                    section.push('\n');
                }
                sections.push(section);
                files.push(metadata);
            }
            Err(error) => {
                if first_failure == 0 {
                    first_failure = error.exit_code;
                }
                sections.push(format!("=== {path} (error) ===\n{}\n", error.message));
                files.push(json!({
                    "path": path,
                    "error": {"code": error.code, "message": error.message},
                }));
            }
        }
    }
    if structured {
        emit(out, &json!({"files": files}), "", mode)?;
    } else {
        out.write_all(sections.join("\n").as_bytes())
            .map_err(operational)?;
    }
    Ok(first_failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranged_reads_preserve_crlf_and_original_line_numbers() {
        let file = crate::fs_api::FsFile {
            bytes: b"one\r\ntwo\r\nthree".to_vec(),
            metadata: json!({"revision": "\"abc\""}),
        };
        let mut out = Vec::new();
        read_output(file, Some("2:3"), true, Mode::Raw, false, &mut out).unwrap();
        assert_eq!(out, b"2\ttwo\r\n3\tthree");
    }

    #[test]
    fn raw_reads_preserve_binary_without_final_newline() {
        let file = crate::fs_api::FsFile {
            bytes: vec![0, 255, 2],
            metadata: json!({}),
        };
        let mut out = Vec::new();
        read_output(file, None, false, Mode::Raw, false, &mut out).unwrap();
        assert_eq!(out, [0, 255, 2]);
    }

    #[test]
    fn past_eof_read_retains_full_revision_and_has_no_end_line() {
        let file = crate::fs_api::FsFile {
            bytes: b"one\n".to_vec(),
            metadata: json!({"revision": "\"abc\"", "size": 4}),
        };
        let mut out = Vec::new();
        read_output(file, Some("2:3"), false, Mode::Json, false, &mut out).unwrap();
        let value: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            value,
            json!({"revision": "\"abc\"", "size": 4, "content": "", "startLine": 2, "endLine": null, "totalLines": 1})
        );
    }

    #[test]
    fn offset_limit_number_lines_like_the_mcp() {
        let file = crate::fs_api::FsFile {
            bytes: b"a\nb\nc\n".to_vec(),
            metadata: json!({}),
        };
        let mut out = Vec::new();
        offset_output(file, Some(2), Some(2), Mode::Raw, &mut out).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "    2\tb\n    3\tc\n");
    }

    #[test]
    fn offset_past_end_is_invalid_input() {
        let file = crate::fs_api::FsFile {
            bytes: b"a\nb\n".to_vec(),
            metadata: json!({}),
        };
        let error = offset_output(file, Some(5), None, Mode::Raw, &mut Vec::new()).unwrap_err();
        assert_eq!(error.exit_code, 2);
        assert_eq!(
            error.message,
            "offset 5 is beyond the end of the file (2 lines)"
        );
    }

    #[test]
    fn outline_text_and_json() {
        let bytes = b"# Title\ntext\n```space-lua\nfunction f()\nend\n```\n".to_vec();
        let file = || crate::fs_api::FsFile {
            bytes: bytes.clone(),
            metadata: json!({"revision": "\"r1\""}),
        };
        let mut out = Vec::new();
        outline_output(file(), "Page.md", Mode::Raw, &mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("    1\t# Title\n    3\t```space-lua\n    4\tfunction f()\n"));
        assert!(text.ends_with("6 lines in all; read a part with --offset and --limit.\n"));

        let mut out = Vec::new();
        outline_output(file(), "Page.md", Mode::Json, &mut out).unwrap();
        let value: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(value["path"], "Page.md");
        assert_eq!(value["revision"], "\"r1\"");
        assert_eq!(value["lines"], 6);
        assert_eq!(value["outline"][0], json!({"line": 1, "text": "# Title"}));
        assert_eq!(value["outline"].as_array().unwrap().len(), 3);
    }
}
