//! `sb fs write` and `sb fs edit`: their output, and the script reload
//! after a write.

use std::io::Write;

use serde::Deserialize;
use serde_json::{json, Value};
use server_space_tools::edit::{Edit, EditError, EditErrorKind};
use server_space_tools::ops::ReloadReport;
use server_space_tools::page_text::needs_reload;

use super::{connection, operational, Mode};
use crate::cli::GlobalFlags;
use crate::conn::SpaceConnection;
use crate::fs_api::FsError;
use crate::fs_cli::TRANSFER_LIMIT;
use crate::{config, local};

/// What a write says when its script reload failed: sb does not retry it.
const RELOAD_FAILED: &str =
    "The scripts could not be reloaded; run sb lua 'system.reboot()' to retry.";

/// `error` with the exit code `sb fs edit` reports it with.
pub(super) fn edit_error(error: EditError) -> FsError {
    let exit_code = match error.kind {
        EditErrorKind::Mismatch | EditErrorKind::Ambiguous | EditErrorKind::Overlap => 6,
        EditErrorKind::Invalid | EditErrorKind::TooLarge => 2,
    };
    FsError::new(error.code(), error.message, exit_code)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EditDocument {
    pub(super) edits: Vec<Edit>,
}

pub(super) fn revision(metadata: &Value) -> Result<&str, FsError> {
    metadata["revision"].as_str().ok_or_else(|| {
        FsError::new(
            "unsupported_feature",
            "The server did not supply a revision; conditional editing requires ETags",
            8,
        )
    })
}

pub(super) fn write_line(path: &str, metadata: &Value) -> String {
    match metadata["revision"].as_str() {
        Some(revision) => format!("Wrote {path} (revision {revision})\n"),
        None => format!("Wrote {path}\n"),
    }
}

pub(super) fn edit_line(
    path: &str,
    replacements: usize,
    changed: bool,
    revision: &Value,
) -> String {
    let unchanged = if changed { "" } else { "unchanged; " };
    match revision.as_str() {
        Some(revision) => {
            format!("{replacements} replacement(s) in {path} ({unchanged}revision {revision})\n")
        }
        None if changed => format!("{replacements} replacement(s) in {path}\n"),
        None => format!("{replacements} replacement(s) in {path} (unchanged)\n"),
    }
}

/// Whether a write of `path` from `old` (`None` when it did not exist) to
/// `new` changes what the space's scripts load.
pub(super) fn wants_reload(path: &str, no_reload: bool, old: Option<&str>, new: &str) -> bool {
    !no_reload && needs_reload(path, old, new)
}

/// The page's text before a write, when it may matter for the reload.
pub(super) fn previous_text(conn: &SpaceConnection, path: &str, no_reload: bool) -> Option<String> {
    if no_reload || !path.ends_with(".md") {
        return None;
    }
    // Best effort: a page that cannot be read is judged by its new text only.
    let file = conn.fs_read(path, TRANSFER_LIMIT).ok()?;
    Some(String::from_utf8_lossy(&file.bytes).into_owned())
}

/// `g` as the reload needs it. A Desktop folder space's server can answer
/// while its runtime is still booting (or was started for the write alone),
/// so wait for the runtime the way `sb lua` does.
fn runtime_flags(g: &GlobalFlags) -> Option<GlobalFlags> {
    let prepared_for_desktop = || -> Option<bool> {
        let url = g.url.as_deref()?;
        let cfg = config::load().ok()?;
        let space = config::resolve_space(&cfg, g.space.as_deref()).ok()?;
        if !space.url.is_empty() || space.folder_path.is_empty() {
            return Some(false);
        }
        let host = local::desktop_host(&config::config_dir()).ok()?;
        let (origin, _) = local::runtime_connection(&host, &space.id).ok()?;
        Some(origin == url)
    };
    let mut flags = g.clone();
    if prepared_for_desktop() == Some(true) {
        flags.url = None;
        flags.token = None;
        local::prepare(&mut flags, local::Need::Runtime).ok()?;
    }
    Some(flags)
}

fn reload(g: &GlobalFlags, path: &str) -> ReloadReport {
    let Some(flags) = runtime_flags(g) else {
        return ReloadReport::NoRuntime;
    };
    match connection(&flags) {
        Ok(conn) => reload_with(&conn, path),
        Err(_) => ReloadReport::Failed,
    }
}

fn reload_with(conn: &SpaceConnection, path: &str) -> ReloadReport {
    let Ok(api) = crate::space_api::HttpSpaceApi::from_connection(conn) else {
        return ReloadReport::Failed;
    };
    crate::space_api::block_on(server_space_tools::ops::reload_after_write(
        &api,
        &server_space_tools::paths::path_to_page(path),
        super::super::lua::run_options(conn),
    ))
}

fn reload_value(report: &ReloadReport) -> Value {
    let (status, load_errors, lint) = match report {
        ReloadReport::Clean => ("clean", &[][..], &[][..]),
        ReloadReport::Problems { load_errors, lint } => {
            ("problems", load_errors.as_slice(), lint.as_slice())
        }
        ReloadReport::Failed => ("failed", &[][..], &[][..]),
        ReloadReport::NoRuntime => ("no_runtime", &[][..], &[][..]),
    };
    json!({
        "status": status,
        "loadErrors": load_errors,
        "lint": server_space_tools::ops::lint_values(lint),
    })
}

/// Reports the reload on `err` and returns the exit code: 9 when the page's
/// scripts have problems, which never means the write failed.
pub(super) fn report_reload(
    path: &str,
    report: &ReloadReport,
    mode: Mode,
    err: &mut dyn Write,
) -> Result<u8, FsError> {
    let problems = matches!(report, ReloadReport::Problems { .. });
    let summary = format!("{path} was written, but its Space Lua/Style has problems");
    if matches!(mode, Mode::Json | Mode::Jsonl) {
        if problems {
            let error = json!({"error": {
                "code": "script_problems",
                "message": format!("{summary}; see \"reload\" in the result."),
                "path": path,
                "written": true,
            }});
            writeln!(err, "{error}").map_err(operational)?;
        }
    } else {
        let note = report.note(RELOAD_FAILED);
        writeln!(err, "{note}").map_err(operational)?;
        if problems {
            writeln!(err, "Exit code 9: {summary}.").map_err(operational)?;
        }
    }
    Ok(if problems { 9 } else { 0 })
}

/// After a successful write: reloads the page's scripts when `old` or `new`
/// has some, and adds the outcome to `result`.
pub(super) fn reload_into(
    g: &GlobalFlags,
    path: &str,
    no_reload: bool,
    old: Option<&str>,
    new: &str,
    result: &mut Value,
) -> Option<ReloadReport> {
    if !wants_reload(path, no_reload, old, new) {
        return None;
    }
    let report = reload(g, path);
    result["reload"] = reload_value(&report);
    Some(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_errors_exit_6_when_the_text_does_not_fit_and_2_when_invalid() {
        use server_space_tools::edit::{apply, EditOpts};
        let opts = EditOpts {
            all: false,
            old_text: "old text",
        };
        let edit = |old: &str| Edit {
            old: old.into(),
            new: "x".into(),
        };
        for (text, old, code, exit) in [
            ("a", "b", "edit_mismatch", 6),
            ("a a", "a", "edit_ambiguous", 6),
            ("aaa", "aa", "edit_overlap", 6),
            ("a\0", "a", "invalid_edit", 2),
        ] {
            let error = edit_error(apply(text, &[edit(old)], opts).unwrap_err());
            assert_eq!((error.code, error.exit_code), (code, exit), "{text:?}");
        }
    }

    #[test]
    fn write_text_line_includes_revision() {
        assert_eq!(
            write_line("Draft.md", &json!({"revision": "\"sha256:abc\""})),
            "Wrote Draft.md (revision \"sha256:abc\")\n"
        );
        assert_eq!(write_line("Draft.md", &json!({})), "Wrote Draft.md\n");
        assert_eq!(
            edit_line("Draft.md", 1, true, &json!("\"sha256:abc\"")),
            "1 replacement(s) in Draft.md (revision \"sha256:abc\")\n"
        );
        assert_eq!(
            edit_line("Draft.md", 1, false, &json!("\"sha256:abc\"")),
            "1 replacement(s) in Draft.md (unchanged; revision \"sha256:abc\")\n"
        );
    }

    fn problems() -> ReloadReport {
        ReloadReport::Problems {
            load_errors: vec!["Error evaluating script: [[Tools@1]] boom".into()],
            lint: Vec::new(),
        }
    }

    #[test]
    fn reload_problems_exit_9_and_say_the_write_succeeded() {
        let mut err = Vec::new();
        let code = report_reload("Tools.md", &problems(), Mode::Text, &mut err).unwrap();
        assert_eq!(code, 9);
        let err = String::from_utf8(err).unwrap();
        assert!(
            err.starts_with("Its Space Lua and Space Style were reloaded, but have problems"),
            "{err}"
        );
        assert!(
            err.contains("Load errors:\n- Error evaluating script: [[Tools@1]] boom\n"),
            "{err}"
        );
        assert!(
            err.ends_with(
                "Exit code 9: Tools.md was written, but its Space Lua/Style has problems.\n"
            ),
            "{err}"
        );

        let mut err = Vec::new();
        let code = report_reload("Tools.md", &problems(), Mode::Json, &mut err).unwrap();
        assert_eq!(code, 9);
        let value: Value = serde_json::from_slice(&err).unwrap();
        assert_eq!(value["error"]["code"], "script_problems");
        assert_eq!(value["error"]["path"], "Tools.md");
        assert_eq!(value["error"]["written"], true);
        assert!(value["error"]["message"]
            .as_str()
            .unwrap()
            .contains("was written"));

        assert_eq!(
            reload_value(&problems()),
            json!({"status": "problems", "loadErrors": ["Error evaluating script: [[Tools@1]] boom"], "lint": []})
        );
    }

    #[test]
    fn other_reload_outcomes_exit_0() {
        for (report, status, note) in [
            (
                ReloadReport::Clean,
                "clean",
                "Its Space Lua and Space Style were reloaded without errors.\n",
            ),
            (
                ReloadReport::NoRuntime,
                "no_runtime",
                "The page has Space Lua or Space Style; it takes effect when the space reloads.\n",
            ),
            (
                ReloadReport::Failed,
                "failed",
                "The scripts could not be reloaded; run sb lua 'system.reboot()' to retry.\n",
            ),
        ] {
            let mut err = Vec::new();
            assert_eq!(
                report_reload("Tools.md", &report, Mode::Text, &mut err).unwrap(),
                0
            );
            assert_eq!(String::from_utf8(err).unwrap(), note);
            let mut err = Vec::new();
            assert_eq!(
                report_reload("Tools.md", &report, Mode::Json, &mut err).unwrap(),
                0
            );
            assert!(err.is_empty());
            assert_eq!(
                reload_value(&report),
                json!({"status": status, "loadErrors": [], "lint": []})
            );
        }
    }

    #[test]
    fn reload_runs_only_for_pages_with_scripts() {
        let lua = "```space-lua\nx = 1\n```\n";
        assert!(wants_reload("Library/Tools.md", false, None, lua));
        assert!(wants_reload("Library/Tools.md", false, Some(lua), "plain"));
        assert!(!wants_reload(
            "Library/Tools.md",
            false,
            Some("plain"),
            "plain"
        ));
        assert!(!wants_reload("Library/Tools.md", true, Some(lua), lua));
        assert!(!wants_reload("Library/tools.lua", false, None, lua));
        assert!(!wants_reload("Tools.md", false, None, lua));
    }

    #[test]
    fn reload_over_http_reports_this_pages_load_errors() {
        use crate::conn::Auth;
        use crate::space_api::test_server::{connection, json as reply, serve};
        let logs = r#"{"logs":[{"level":"error","text":"Error evaluating script: [[Tools@3]] unexpected symbol","timestamp":99999999999999},{"level":"error","text":"Error evaluating script: [[Other@1]] x","timestamp":99999999999999},{"level":"info","text":"[Client] [Lua] Loaded 2 scripts in 3ms","timestamp":99999999999999}]}"#;
        let (base, handle) = serve(vec![
            reply("200 OK", &[], r#"{"result":null}"#),
            reply("200 OK", &[], logs),
            reply("200 OK", &[], r#"{"result":[]}"#),
        ]);
        let report = reload_with(&connection(&base, Auth::None), "Tools.md");
        let requests = handle.join().unwrap();
        assert_eq!(requests[0].body, "system.reboot()");
        assert_eq!(
            report,
            ReloadReport::Problems {
                load_errors: vec!["Error evaluating script: [[Tools@3]] unexpected symbol".into()],
                lint: Vec::new(),
            }
        );
    }
}
