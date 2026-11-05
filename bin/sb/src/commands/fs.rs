use std::io::{self, IsTerminal, Read, Write};
use std::process::ExitCode;

use serde_json::{json, Value};
use server_space_tools::edit::{self, unified_diff, Edit, EditOpts};

use crate::cli::GlobalFlags;
use crate::conn::SpaceConnection;
use crate::fs_api::{conflict_text, normalize_path, validate_revision, FsError, WritePolicy};
use crate::fs_cli::{FsCommand, EDIT_LIMIT};
use crate::fs_listing;

mod read;
mod write;

use read::{offset_output, outline_output, read_output, read_rendered_page, read_several};
use write::{
    edit_error, edit_line, previous_text, reload_into, report_reload, revision, write_line,
    EditDocument,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Raw,
    Text,
    Json,
    Jsonl,
}

const MAX_READ_PATHS: usize = 20;

fn invalid(message: impl Into<String>) -> FsError {
    FsError::new("invalid_arguments", message, 2)
}

pub(super) fn operational(error: impl std::fmt::Display) -> FsError {
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
            paths,
            lines,
            number,
            offset,
            limit,
            rendered,
            outline,
            ..
        } => {
            if paths.len() > MAX_READ_PATHS {
                return Err(invalid(format!(
                    "Read at most {MAX_READ_PATHS} paths per call"
                )));
            }
            if paths.len() > 1 {
                let combined = [
                    ("--lines", lines.is_some()),
                    ("--offset", offset.is_some()),
                    ("--limit", limit.is_some()),
                    ("--number", *number),
                    ("--rendered", *rendered),
                    ("--outline", *outline),
                ];
                if let Some((flag, _)) = combined.iter().find(|(_, set)| *set) {
                    return Err(invalid(format!(
                        "Several paths cannot be combined with {flag}; read one path at a time"
                    )));
                }
            }
            if let Some(lines) = lines {
                range(lines)?;
            }
            if *offset == Some(0) {
                return Err(invalid("--offset starts at 1"));
            }
            if *limit == Some(0) {
                return Err(invalid("--limit must be at least 1"));
            }
            if *number && matches!(output, Mode::Json | Mode::Jsonl) {
                return Err(invalid(
                    "--number cannot be combined with structured output",
                ));
            }
            for path in &paths[1..] {
                normalize_path(path, false)?;
            }
            if *rendered && !paths[0].ends_with(".md") {
                return Err(invalid("--rendered needs a page: pass a .md path"));
            }
            (&paths[0], false)
        }
        FsCommand::Write {
            path,
            create,
            revision,
            overwrite,
            ..
        } => {
            if usize::from(*create) + usize::from(revision.is_some()) + usize::from(*overwrite) != 1
            {
                return Err(invalid("Choose --create, --revision <revision>, or --overwrite; e.g. sb fs write Draft.md --create --file draft.md"));
            }
            if let Some(revision) = revision {
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
            revision,
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
            if let Some(revision) = revision {
                validate_revision(revision)?;
            }
            (path, false)
        }
        FsCommand::Rm { path, revision } => {
            if let Some(revision) = revision {
                validate_revision(revision)?;
            }
            (path, false)
        }
        FsCommand::Stat { path } => (path, false),
    };
    normalize_path(path, directory)?;
    Ok(())
}

/// Whether `cmd` needs the space's Lua runtime, not just its files. A write
/// reloads scripts only after it succeeded, and connects to the runtime then.
pub fn needs_runtime(cmd: &FsCommand) -> bool {
    matches!(cmd, FsCommand::Read { rendered: true, .. })
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
    let result = validate(g, &cmd).and_then(|()| execute(g, cmd).map(ExitCode::from));
    match result {
        Ok(code) => code,
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

fn connection(g: &GlobalFlags) -> Result<SpaceConnection, FsError> {
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
            paths,
            lines,
            number,
            max_bytes,
            offset,
            limit,
            rendered,
            outline,
        } => {
            if paths.len() > 1 {
                return read_several(g, &paths, max_bytes, output, &mut out);
            }
            let path = normalize_path(&paths[0], false)?;
            if rendered {
                let offset = offset.or(number.then_some(1));
                return read_rendered_page(g, &path, offset, limit, output, &mut out).map(|()| 0);
            }
            let file = connection(g)?.fs_read(&path, max_bytes)?;
            if outline {
                outline_output(file, &path, output, &mut out)?;
            } else if offset.is_some() || limit.is_some() {
                offset_output(file, offset, limit, output, &mut out)?;
            } else {
                read_output(file, lines.as_deref(), number, output, terminal, &mut out)?;
            }
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
            revision,
            max_bytes,
            no_reload,
            ..
        } => {
            let path = normalize_path(&path, false)?;
            let bytes = input(file.as_deref(), max_bytes)?;
            let policy = if create {
                WritePolicy::Create
            } else if let Some(rev) = &revision {
                WritePolicy::Match(rev)
            } else {
                WritePolicy::Overwrite
            };
            let conn = connection(g)?;
            let old = if create {
                None
            } else {
                previous_text(&conn, &path, no_reload)
            };
            let new = String::from_utf8_lossy(&bytes).into_owned();
            let mut result = conn.fs_write(&path, bytes, policy)?;
            result["operation"] = json!("write");
            let report = reload_into(g, &path, no_reload, old.as_deref(), &new, &mut result);
            emit(&mut out, &result, &write_line(&path, &result), output)?;
            if let Some(report) = report {
                return report_reload(&path, &report, output, &mut io::stderr());
            }
        }
        FsCommand::Rm { path, revision } => {
            let path = normalize_path(&path, false)?;
            connection(g)?.fs_delete(&path, revision.as_deref())?;
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
            revision: expected,
            dry_run,
            no_reload,
        } => {
            let path = normalize_path(&path, false)?;
            let edits = if let (Some(old), Some(new)) = (old, new) {
                vec![Edit { old, new }]
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
            if expected
                .as_deref()
                .is_some_and(|expected| expected != base_revision)
            {
                let mut error = FsError::new(
                    "revision_conflict",
                    conflict_text(&path, expected.as_deref(), Some(base_revision)),
                    5,
                )
                .with_path(&path);
                error.expected_revision = expected;
                error.current_revision = Some(base_revision.into());
                return Err(error);
            }
            let old = text(&original.bytes)?;
            let opts = EditOpts {
                all,
                old_text: "old text",
            };
            let result =
                edit::apply(old, &edits, opts).map_err(|e| edit_error(e).with_path(&path))?;
            let changed = old != result.content;
            let mut response = json!({"path": path, "operation": "edit", "replacements": result.replacements, "changed": changed, "dryRun": dry_run, "baseRevision": base_revision});
            let mut report = None;
            let message = if dry_run {
                let diff = unified_diff(old, &result.content, &path, &path);
                response["diff"] = json!(diff);
                diff
            } else {
                let current = if changed {
                    conn.fs_write(
                        &path,
                        result.content.clone().into_bytes(),
                        WritePolicy::Match(base_revision),
                    )?
                } else {
                    original.metadata.clone()
                };
                response["revision"] = current["revision"].clone();
                if changed {
                    report = reload_into(
                        g,
                        &path,
                        no_reload,
                        Some(old),
                        &result.content,
                        &mut response,
                    );
                }
                edit_line(&path, result.replacements, changed, &response["revision"])
            };
            emit(&mut out, &response, &message, output)?;
            if let Some(report) = report {
                return report_reload(&path, &report, output, &mut io::stderr());
            }
        }
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_rendered_reads_need_the_runtime() {
        let read = |rendered| FsCommand::Read {
            paths: vec!["A.md".into()],
            lines: None,
            number: false,
            max_bytes: 0,
            offset: None,
            limit: None,
            rendered,
            outline: false,
        };
        assert!(needs_runtime(&read(true)));
        assert!(!needs_runtime(&read(false)));
    }
}
