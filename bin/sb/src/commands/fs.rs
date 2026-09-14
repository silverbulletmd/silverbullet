use std::io::{self, IsTerminal, Read, Write};
use std::process::ExitCode;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::cli::GlobalFlags;
use crate::fs_api::{normalize_path, validate_revision, FsError, WritePolicy};
use crate::fs_cli::{FsCommand, EDIT_LIMIT};
use crate::{fs_edit, fs_listing};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Raw,
    Text,
    Json,
    Jsonl,
}

fn invalid(message: impl Into<String>) -> FsError {
    FsError::new("invalid_arguments", message, 2)
}

fn operational(error: impl std::fmt::Display) -> FsError {
    FsError::new("operation_failed", error.to_string(), 8)
}

fn mode(g: &GlobalFlags, read: bool, terminal: bool) -> Result<Mode, FsError> {
    if usize::from(g.json) + usize::from(g.text) + usize::from(g.output != "auto") > 1 {
        return Err(invalid(
            "Choose only one output selector: --text, --json, or -o",
        ));
    }
    if g.json {
        return Ok(Mode::Json);
    }
    if g.text {
        return Ok(if read { Mode::Raw } else { Mode::Text });
    }
    match g.output.as_str() {
        "auto" if read => Ok(Mode::Raw),
        "auto" if terminal => Ok(Mode::Text),
        "auto" | "json" => Ok(Mode::Json),
        "jsonl" => Ok(Mode::Jsonl),
        "text" => Ok(if read { Mode::Raw } else { Mode::Text }),
        _ => Err(invalid("fs output modes are text, json, and jsonl")),
    }
}

fn range(value: &str) -> Result<(usize, usize), FsError> {
    let (start, end) = value
        .split_once(':')
        .ok_or_else(|| invalid("Use --lines START:END, e.g. 30:80"))?;
    let start = start
        .parse::<usize>()
        .map_err(|_| invalid("Invalid start line"))?;
    let end = end
        .parse::<usize>()
        .map_err(|_| invalid("Invalid end line"))?;
    if start == 0 || end < start {
        return Err(invalid("Line bounds must be positive and ordered"));
    }
    Ok((start, end))
}

pub fn validate(g: &GlobalFlags, cmd: &FsCommand) -> Result<(), FsError> {
    let output = mode(
        g,
        matches!(cmd, FsCommand::Read { .. }),
        io::stdout().is_terminal(),
    )?;
    let (path, directory) = match cmd {
        FsCommand::Ls { path, glob, .. } => {
            fs_listing::patterns(glob)?;
            (path, true)
        }
        FsCommand::Read {
            path,
            lines,
            number,
            ..
        } => {
            if let Some(lines) = lines {
                range(lines)?;
            }
            if *number && matches!(output, Mode::Json | Mode::Jsonl) {
                return Err(invalid(
                    "--number cannot be combined with structured output",
                ));
            }
            (path, false)
        }
        FsCommand::Write {
            path,
            create,
            if_match,
            overwrite,
            ..
        } => {
            if usize::from(*create) + usize::from(if_match.is_some()) + usize::from(*overwrite) != 1
            {
                return Err(invalid("Choose --create, --if-match <revision>, or --overwrite; e.g. sb fs write Draft.md --create --file draft.md"));
            }
            if let Some(revision) = if_match {
                validate_revision(revision)?;
            }
            (path, false)
        }
        FsCommand::Edit {
            path,
            old,
            new,
            file,
            all,
            if_match,
            ..
        } => {
            if old.is_some() != new.is_some() {
                return Err(invalid("--old and --new must be supplied together"));
            }
            if old.is_some() && file.is_some() {
                return Err(invalid("Choose --old/--new or --file, not both"));
            }
            if *all && old.is_none() {
                return Err(invalid("--all requires --old and --new"));
            }
            if old
                .as_ref()
                .is_some_and(|s| s.is_empty() || s.contains('\0'))
                || new.as_ref().is_some_and(|s| s.contains('\0'))
            {
                return Err(invalid(
                    "Old text must be nonempty; edit text cannot contain NUL",
                ));
            }
            if let Some(revision) = if_match {
                validate_revision(revision)?;
            }
            (path, false)
        }
        FsCommand::Rm { path, if_match } => {
            if let Some(revision) = if_match {
                validate_revision(revision)?;
            }
            (path, false)
        }
        FsCommand::Stat { path } => (path, false),
    };
    normalize_path(path, directory)?;
    Ok(())
}

pub fn report_error(g: &GlobalFlags, error: FsError) -> ExitCode {
    let structured = g.json
        || matches!(g.output.as_str(), "json" | "jsonl")
        || (!g.text && g.output == "auto" && !io::stdout().is_terminal());
    if structured {
        let mut value = json!({"code": error.code, "message": error.message});
        if let Some(path) = error.path {
            value["path"] = json!(path);
        }
        if let Some(revision) = error.expected_revision {
            value["expectedRevision"] = json!(revision);
        }
        if let Some(revision) = error.current_revision {
            value["currentRevision"] = json!(revision);
        }
        eprintln!("{}", json!({"error": value}));
    } else {
        eprintln!("Error: {}", error.message);
    }
    ExitCode::from(error.exit_code)
}

pub fn run(g: &GlobalFlags, cmd: FsCommand) -> ExitCode {
    let result = validate(g, &cmd).and_then(|()| execute(g, cmd));
    match result {
        Ok(code) => ExitCode::from(code),
        Err(error) => report_error(g, error),
    }
}

fn input(file: Option<&str>, max_bytes: u64) -> Result<Vec<u8>, FsError> {
    if file.is_none() && io::stdin().is_terminal() {
        return Err(invalid("Supply --file <local-path> or pipe input to stdin"));
    }
    let source: Box<dyn Read> = match file {
        Some(path) if path != "-" => Box::new(std::fs::File::open(path).map_err(operational)?),
        _ => Box::new(io::stdin().lock()),
    };
    let mut bytes = Vec::new();
    source
        .take(if max_bytes == 0 {
            u64::MAX
        } else {
            max_bytes.saturating_add(1)
        })
        .read_to_end(&mut bytes)
        .map_err(operational)?;
    if max_bytes != 0 && bytes.len() as u64 > max_bytes {
        return Err(FsError::new(
            "too_large",
            format!("Input exceeds {max_bytes} bytes; raise --max-bytes for a larger transfer"),
            8,
        ));
    }
    Ok(bytes)
}

fn connection(g: &GlobalFlags) -> Result<crate::conn::SpaceConnection, FsError> {
    let cfg = if g.url.is_some() {
        crate::config::Config::default()
    } else {
        crate::config::load().map_err(operational)?
    };
    crate::conn::resolve_typed(g, &cfg).map_err(|error| {
        if error.authentication {
            FsError::new("authentication_required", error.message, 4)
        } else {
            operational(error.message)
        }
    })
}

fn emit(output: &mut dyn Write, value: &Value, text: &str, mode: Mode) -> Result<(), FsError> {
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        serde_json::to_writer(&mut *output, value).map_err(operational)?;
        writeln!(output).map_err(operational)
    } else {
        output.write_all(text.as_bytes()).map_err(operational)
    }
}

fn text(bytes: &[u8]) -> Result<&str, FsError> {
    if bytes.contains(&0) {
        return Err(invalid(
            "Binary content requires a raw read redirected to a file",
        ));
    }
    std::str::from_utf8(bytes)
        .map_err(|_| invalid("Content is not UTF-8; use a raw read redirected to a file"))
}

fn read_output(
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EditDocument {
    edits: Vec<fs_edit::Edit>,
}

fn revision(metadata: &Value) -> Result<&str, FsError> {
    metadata["revision"].as_str().ok_or_else(|| {
        FsError::new(
            "unsupported_feature",
            "The server did not supply a revision; conditional editing requires ETags",
            8,
        )
    })
}

fn execute(g: &GlobalFlags, cmd: FsCommand) -> Result<u8, FsError> {
    let terminal = io::stdout().is_terminal();
    let output = mode(g, matches!(&cmd, FsCommand::Read { .. }), terminal)?;
    let mut out = io::stdout().lock();
    match cmd {
        FsCommand::Ls {
            path,
            recursive,
            glob,
            limit,
        } => {
            let path = normalize_path(&path, true)?;
            let files = connection(g)?.fs_list()?;
            let result = fs_listing::listing(&files, &path, recursive, &glob, limit)?;
            let entries = result["entries"].as_array().unwrap();
            if output == Mode::Jsonl {
                for entry in entries {
                    emit(
                        &mut out,
                        &json!({"type": "entry", "entry": entry}),
                        "",
                        output,
                    )?;
                }
                emit(
                    &mut out,
                    &json!({"type": "summary", "count": entries.len(), "truncated": result["truncated"]}),
                    "",
                    output,
                )?;
            } else {
                let text: String = entries
                    .iter()
                    .map(|entry| format!("{}\n", entry["path"].as_str().unwrap()))
                    .collect();
                emit(&mut out, &result, &text, output)?;
            }
            if result["truncated"] == true {
                if output == Mode::Text {
                    eprintln!("Listing truncated by --limit");
                }
                return Ok(7);
            }
        }
        FsCommand::Read {
            path,
            lines,
            number,
            max_bytes,
        } => {
            let path = normalize_path(&path, false)?;
            let file = connection(g)?.fs_read(&path, max_bytes)?;
            read_output(file, lines.as_deref(), number, output, terminal, &mut out)?;
        }
        FsCommand::Stat { path } => {
            let path = normalize_path(&path, false)?;
            let meta = connection(g)?.fs_stat(&path)?;
            let pretty = serde_json::to_string_pretty(&meta).map_err(operational)?;
            emit(&mut out, &meta, &format!("{pretty}\n"), output)?;
        }
        FsCommand::Write {
            path,
            file,
            create,
            if_match,
            max_bytes,
            ..
        } => {
            let path = normalize_path(&path, false)?;
            let bytes = input(file.as_deref(), max_bytes)?;
            let policy = if create {
                WritePolicy::Create
            } else if let Some(rev) = &if_match {
                WritePolicy::Match(rev)
            } else {
                WritePolicy::Overwrite
            };
            let mut result = connection(g)?.fs_write(&path, bytes, policy)?;
            result["operation"] = json!("write");
            emit(&mut out, &result, &format!("Wrote {path}\n"), output)?;
        }
        FsCommand::Rm { path, if_match } => {
            let path = normalize_path(&path, false)?;
            connection(g)?.fs_delete(&path, if_match.as_deref())?;
            emit(
                &mut out,
                &json!({"path": path, "operation": "delete"}),
                &format!("Deleted {path}\n"),
                output,
            )?;
        }
        FsCommand::Edit {
            path,
            old,
            new,
            file,
            all,
            if_match,
            dry_run,
        } => {
            let path = normalize_path(&path, false)?;
            let edits = if let (Some(old), Some(new)) = (old, new) {
                vec![fs_edit::Edit { old, new }]
            } else {
                let bytes = input(file.as_deref(), EDIT_LIMIT)?;
                let document: EditDocument = serde_json::from_slice(&bytes)
                    .map_err(|e| invalid(format!("Invalid edit JSON: {e}")))?;
                document.edits
            };
            if edits.is_empty()
                || edits
                    .iter()
                    .any(|e| e.old.is_empty() || e.old.contains('\0') || e.new.contains('\0'))
            {
                return Err(invalid(
                    "Supply at least one edit with nonempty old text and no NUL characters",
                ));
            }
            let conn = connection(g)?;
            let original = conn.fs_read(&path, EDIT_LIMIT)?;
            let base_revision = revision(&original.metadata)?;
            validate_revision(base_revision)?;
            if if_match
                .as_deref()
                .is_some_and(|expected| expected != base_revision)
            {
                let mut error = FsError::new(
                    "revision_conflict",
                    "File changed; read it again before retrying",
                    5,
                )
                .with_path(&path);
                error.expected_revision = if_match;
                error.current_revision = Some(base_revision.into());
                return Err(error);
            }
            let old = text(&original.bytes)?;
            let result = fs_edit::apply(old, &edits, all)
                .map_err(|e| FsError::new(e.code, e.message, e.exit_code).with_path(&path))?;
            let changed = old != result.content;
            let mut response = json!({"path": path, "operation": "edit", "replacements": result.replacements, "changed": changed, "dryRun": dry_run, "baseRevision": base_revision});
            let message = if dry_run {
                let diff = fs_edit::diff(&path, old, &result.content);
                response["diff"] = json!(diff);
                diff
            } else {
                let current = if changed {
                    conn.fs_write(
                        &path,
                        result.content.into_bytes(),
                        WritePolicy::Match(base_revision),
                    )?
                } else {
                    original.metadata
                };
                response["revision"] = current["revision"].clone();
                format!(
                    "{} replacement(s) in {path}{}\n",
                    result.replacements,
                    if changed { "" } else { " (unchanged)" }
                )
            };
            emit(&mut out, &response, &message, output)?;
        }
    }
    Ok(0)
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
}
