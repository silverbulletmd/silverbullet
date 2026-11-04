use clap::Subcommand;

pub const OVERVIEW: &str =
    "Paths are space-relative filenames, including .md. Quote spaces; use / as the
separator. ls defaults to the space root. Operations use saved server bytes.

Examples:
  sb fs ls Projects --recursive --glob '*.md'
  sb fs read 'Projects/Launch.md' --lines 10:30 --number
  sb fs read 'Projects/Launch.md' --outline
  sb fs write Draft.md --create --file draft.md
  sb fs edit Draft.md --old draft --new ready --dry-run

Output: read defaults to exact bytes, including when piped. Other commands use
text on a terminal and JSON when piped. Supported formats: auto, text, json,
jsonl. Use --json explicitly for metadata/revisions alongside UTF-8 content.
Errors go to stderr. File commands work even when the server cannot run Lua.

File commands use these exit codes:
0 success; 2 invalid input; 3 missing target; 4 access denied;
5 revision conflict; 6 edit mismatch/ambiguity/overlap; 7 truncated listing;
8 operational failure; 9 written, but its Space Lua/Style has problems.
Inspect the file before retrying an uncertain mutation.
Run sb fs <command> --help for input rules and examples.";

pub const TRANSFER_LIMIT: u64 = 16 * 1024 * 1024;
pub const EDIT_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Subcommand, Debug)]
pub enum FsCommand {
    /// List files and directories in a space.
    #[command(
        visible_alias = "list",
        after_long_help = "Without --recursive, lists immediate children and synthetic directories. Patterns without / match basenames; patterns with / match full space-relative paths. Positive globs are ORed; ! excludes. Quote globs to prevent shell expansion. The entire inventory is downloaded before filtering. --limit truncation exits 7; an empty result succeeds.\n\nExamples:\n  sb fs ls\n  sb fs ls Projects -r --glob '*.md' --glob '!Projects/Archive/**'"
    )]
    Ls {
        /// Remote directory; . is the space root.
        #[arg(default_value = ".")]
        path: String,
        /// List all descendant files.
        #[arg(short = 'r', long)]
        recursive: bool,
        /// Filter paths with a quoted glob; prefix exclusions with !.
        #[arg(long)]
        glob: Vec<String>,
        /// Maximum entries; truncation is reported with exit code 7.
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Read exact file bytes, or a selected text view.
    #[command(
        after_long_help = "Raw output preserves every byte and adds no newline. Redirect binary attachments to a file. --json includes UTF-8 content, metadata and revision. --lines still downloads the whole file; --number cannot accompany JSON output. The default download cap is 16 MiB; failure emits no partial content.\n\n--offset N (first line, 1-based) and --limit N (line count) select numbered lines, as the MCP read tool does; they replace --lines. --outline lists headings, code blocks and Lua functions with line numbers; use it before reading a long page. --rendered (a .md page, needs the Lua runtime) shows the page as it displays, with directives evaluated and widgets reduced to their text, then its lint problems; --offset/--limit apply to the rendered lines.\n\nSeveral paths (up to 20) print one section each under === <path> (revision <rev>) ===. A failing path is reported inline and does not stop the others; the exit code is the first failure's. --json prints {\"files\": [...]}. Several paths cannot be combined with --lines, --offset, --limit, --number, --rendered or --outline.\n\nExamples:\n  sb fs read Draft.md > draft.md\n  sb fs read Draft.md --lines 10:30 --number\n  sb fs read Draft.md --offset 40 --limit 30\n  sb fs read Draft.md --outline\n  sb fs read Draft.md --rendered\n  sb fs read A.md B.md --json"
    )]
    Read {
        /// Space-relative filenames, including their extensions (1-20).
        #[arg(required = true, num_args = 1..)]
        paths: Vec<String>,
        /// One-based inclusive range, e.g. 30:80.
        #[arg(long, conflicts_with_all = ["offset", "limit", "outline", "rendered"])]
        lines: Option<String>,
        /// Prefix text lines with their original one-based line numbers.
        #[arg(short = 'n', long, conflicts_with_all = ["json", "outline"])]
        number: bool,
        /// Maximum downloaded bytes; 0 removes the CLI limit.
        #[arg(long, default_value_t = TRANSFER_LIMIT)]
        max_bytes: u64,
        /// First line to return (1-based), numbered like the MCP read tool.
        #[arg(long, conflicts_with = "outline")]
        offset: Option<usize>,
        /// Number of lines to return, numbered like the MCP read tool.
        #[arg(long, conflicts_with = "outline")]
        limit: Option<usize>,
        /// Show the page as it displays (directives evaluated), then its lint problems; needs the runtime.
        #[arg(long, conflicts_with = "outline")]
        rendered: bool,
        /// List headings, code blocks and Lua functions with line numbers.
        #[arg(long)]
        outline: bool,
    },
    /// Show file metadata and its revision.
    #[command(
        after_long_help = "Reports one file's metadata. --json includes its opaque quoted revision; preserve that string unchanged for --revision. Directories are not file targets.\n\nExample:\n  sb fs stat Draft.md --json"
    )]
    Stat {
        /// Space-relative filename, including its extension.
        path: String,
    },
    /// Write stdin or a local file; choose --create, --revision, or --overwrite.
    #[command(group(clap::ArgGroup::new("write_policy").required(true).args(["create", "revision", "overwrite"])), after_long_help = "Choose exactly one write policy. Input comes from --file or redirected stdin; there is no automatic input prompt. Writes preserve bytes, with a default 16 MiB input cap. Preserve the quoted revision from stat --json or read --json when using --revision (alias --if-match). Conflicts fail without retry.\n\nA write of a .md page that has (or had) space-lua or space-style blocks reloads the space's scripts, then reports this page's load errors and lint problems on stderr (in \"reload\" with --json). Problems exit 9: the file was written, but fix its scripts. --no-reload skips this.\n\nExamples:\n  sb fs write Draft.md --create --file draft.md\n  printf 'Status: ready\\n' | sb fs write Draft.md --overwrite")]
    Write {
        /// Space-relative destination filename, including its extension.
        path: String,
        /// Local input file; - reads stdin.
        #[arg(short = 'f', long)]
        file: Option<String>,
        /// Create only if the target does not exist.
        #[arg(long)]
        create: bool,
        /// Require the exact quoted revision returned by read/stat --json.
        #[arg(long = "revision", visible_alias = "if-match", value_name = "REVISION")]
        revision: Option<String>,
        /// Create or replace unconditionally.
        #[arg(long)]
        overwrite: bool,
        /// Maximum input bytes; 0 removes the CLI limit.
        #[arg(long, default_value_t = TRANSFER_LIMIT)]
        max_bytes: u64,
        /// Do not reload the page's Space Lua and Space Style after writing.
        #[arg(long)]
        no_reload: bool,
    },
    /// Replace exact text blocks in an existing file.
    #[command(
        after_long_help = r#"Supply --old and --new, or a JSON document via --file (or redirected stdin).
Each old block must match exactly once, including whitespace. In a CRLF file, a
line break (\n) in old or new stands for CRLF; the file keeps its endings.
Empty new deletes a block; old cannot be empty. --all is only for --old/--new.
Batch edits refer to the original file and must not overlap; all are validated
before one conditional write. A failed batch leaves the file untouched.

Edits require UTF-8 without NUL; original and result are limited to 8 MiB.
Every edit checks the revision read at its start. --revision (alias --if-match)
additionally checks a revision from an earlier inspection. Conflicts fail
without retry or merging. --dry-run emits a unified diff without writing (a
JSON result with --json).

An edit of a .md page that has (or had) space-lua or space-style blocks reloads
the space's scripts and reports this page's load errors and lint problems, as
write does; problems exit 9 after a successful edit. --no-reload skips this.

Examples:
  sb fs edit Draft.md --old 'Status: draft' --new 'Status: ready' --dry-run
sb fs edit Draft.md --file - <<'JSON'
{"edits":[{"old":"Status: draft","new":"Status: ready"}]}
JSON"#
    )]
    Edit {
        /// Space-relative filename, including its extension.
        path: String,
        /// Exact text to replace; requires --new.
        #[arg(long, requires = "new", conflicts_with = "file")]
        old: Option<String>,
        /// Replacement text; an empty string deletes the old block.
        #[arg(long, requires = "old")]
        new: Option<String>,
        /// Local JSON edit document; - reads stdin.
        #[arg(short = 'f', long)]
        file: Option<String>,
        /// Replace every non-overlapping occurrence of --old.
        #[arg(long, requires = "old")]
        all: bool,
        /// Require the exact quoted revision returned by read/stat --json.
        #[arg(long = "revision", visible_alias = "if-match", value_name = "REVISION")]
        revision: Option<String>,
        /// Preview the diff without writing.
        #[arg(long)]
        dry_run: bool,
        /// Do not reload the page's Space Lua and Space Style after editing.
        #[arg(long)]
        no_reload: bool,
    },
    /// Delete one file.
    #[command(
        visible_alias = "delete",
        after_long_help = "Deletes a single file, unconditionally unless --revision is supplied. Directories and recursive deletion are unsupported. A revision conflict leaves the file untouched.\n\nExample:\n  sb fs rm Draft.md"
    )]
    Rm {
        /// Space-relative filename to delete.
        path: String,
        /// Require the exact quoted revision returned by read/stat --json.
        #[arg(long = "revision", visible_alias = "if-match", value_name = "REVISION")]
        revision: Option<String>,
    },
}

pub fn parse<T: clap::Parser>() -> Result<T, std::process::ExitCode> {
    let args: Vec<_> = std::env::args_os().collect();
    T::try_parse_from(&args).map_err(|error| {
        let mut before_command = args.iter().skip(1);
        let fs_usage = loop {
            let Some(arg) = before_command.next() else { break false };
            let arg = arg.to_string_lossy();
            if matches!(arg.as_ref(), "--space" | "-s" | "--url" | "--token" | "--timeout" | "-t" | "--output" | "-o") {
                before_command.next();
            } else if arg == "--" {
                break false;
            } else if !arg.starts_with('-') {
                break arg == "fs";
            }
        };
        let args: Vec<_> = args.iter().skip(1).take_while(|arg| *arg != "--").map(|arg| arg.to_string_lossy()).collect();
        let json = args.iter().any(|arg| matches!(arg.as_ref(), "--json" | "--output=json" | "--output=jsonl" | "-ojson" | "-ojsonl"))
            || args.windows(2).any(|pair| matches!(pair[0].as_ref(), "-o" | "--output") && matches!(pair[1].as_ref(), "json" | "jsonl"));
        let explicit_text = args.iter().any(|arg| matches!(arg.as_ref(), "--text" | "--output=text" | "-otext"))
            || args.windows(2).any(|pair| matches!(pair[0].as_ref(), "-o" | "--output") && pair[1] == "text");
        if error.use_stderr() && fs_usage && (json || (!explicit_text && !std::io::IsTerminal::is_terminal(&std::io::stdout()))) {
            eprintln!("{}", serde_json::json!({"error":{"code":"invalid_arguments","message":error.to_string()}}));
        } else {
            let _ = error.print();
        }
        std::process::ExitCode::from(error.exit_code() as u8)
    })
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::FsCommand;
    use crate::cli::{Cli, Command, CoreCommand};

    fn fs(args: &[&str]) -> FsCommand {
        let cli = Cli::try_parse_from(["sb", "fs"].iter().chain(args))
            .unwrap_or_else(|e| panic!("{args:?}: {e}"));
        match cli.command {
            Some(Command::Core(CoreCommand::Fs(cmd))) => cmd,
            _ => panic!("not an fs command: {args:?}"),
        }
    }

    #[test]
    fn revision_and_if_match_are_the_same_flag() {
        for flag in ["--revision", "--if-match"] {
            match fs(&["write", "Draft.md", flag, "\"r1\""]) {
                FsCommand::Write { revision, .. } => {
                    assert_eq!(revision.as_deref(), Some("\"r1\""))
                }
                other => panic!("{other:?}"),
            }
            match fs(&[
                "edit", "Draft.md", "--old", "a", "--new", "b", flag, "\"r1\"",
            ]) {
                FsCommand::Edit { revision, .. } => assert_eq!(revision.as_deref(), Some("\"r1\"")),
                other => panic!("{other:?}"),
            }
            match fs(&["rm", "Draft.md", flag, "\"r1\""]) {
                FsCommand::Rm { revision, .. } => assert_eq!(revision.as_deref(), Some("\"r1\"")),
                other => panic!("{other:?}"),
            }
        }
        assert!(Cli::try_parse_from([
            "sb",
            "fs",
            "write",
            "Draft.md",
            "--revision",
            "\"r1\"",
            "--if-match",
            "\"r1\""
        ])
        .is_err());
    }

    #[test]
    fn write_policy_accepts_revision() {
        assert!(matches!(
            fs(&["write", "Draft.md", "--revision", "\"r1\""]),
            FsCommand::Write {
                create: false,
                overwrite: false,
                revision: Some(_),
                no_reload: false,
                ..
            }
        ));
        assert!(matches!(
            fs(&["write", "Draft.md", "--create", "--no-reload"]),
            FsCommand::Write {
                create: true,
                no_reload: true,
                ..
            }
        ));
        for args in [
            vec!["sb", "fs", "write", "Draft.md"],
            vec![
                "sb",
                "fs",
                "write",
                "Draft.md",
                "--create",
                "--revision",
                "\"r1\"",
            ],
            vec![
                "sb",
                "fs",
                "write",
                "Draft.md",
                "--overwrite",
                "--if-match",
                "\"r1\"",
            ],
        ] {
            assert!(Cli::try_parse_from(&args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn help_documents_revision_reload_and_exit_9() {
        let help = |args: &[&str]| {
            Cli::try_parse_from(["sb", "fs"].iter().chain(args))
                .err()
                .unwrap()
                .to_string()
        };
        let write = help(&["write", "--help"]);
        assert!(write.contains("--revision <REVISION>"), "{write}");
        assert!(write.contains("--if-match"), "{write}");
        assert!(write.contains("--no-reload"), "{write}");
        assert!(help(&["edit", "--help"]).contains("--no-reload"));
        assert!(super::OVERVIEW.contains("9 written, but its Space Lua/Style has problems"));
    }
}
