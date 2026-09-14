use clap::Subcommand;

pub const OVERVIEW: &str =
    "Paths are space-relative filenames, including .md. Quote spaces; use / as the
separator. ls defaults to the space root. Operations use saved server bytes.

Examples:
  sb fs ls Projects --recursive --glob '*.md'
  sb fs read 'Projects/Launch.md' --lines 10:30 --number
  sb fs write Draft.md --create --file draft.md
  sb fs edit Draft.md --old draft --new ready --dry-run

Output: read defaults to exact bytes, including when piped. Other commands use
text on a terminal and JSON when piped. Supported formats: auto, text, json,
jsonl. Use --json explicitly for metadata/revisions alongside UTF-8 content.
Errors go to stderr. File commands require HTTP access but no Runtime API.

Exit codes: 0 success; 2 invalid input; 3 missing target; 4 access denied;
5 revision conflict; 6 edit mismatch/ambiguity/overlap; 7 truncated listing;
8 operational failure. Inspect the file before retrying an uncertain mutation.
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
        after_long_help = "Raw output preserves every byte and adds no newline. Redirect binary attachments to a file. --json includes UTF-8 content, metadata and revision. --lines still downloads the whole file; --number cannot accompany JSON output. The default download cap is 16 MiB; failure emits no partial content.\n\nExamples:\n  sb fs read Draft.md > draft.md\n  sb fs read Draft.md --lines 10:30 --number\n  sb fs read Draft.md --json"
    )]
    Read {
        /// Space-relative filename, including its extension.
        path: String,
        /// One-based inclusive range, e.g. 30:80.
        #[arg(long)]
        lines: Option<String>,
        /// Prefix text lines with their original one-based line numbers.
        #[arg(short = 'n', long, conflicts_with = "json")]
        number: bool,
        /// Maximum downloaded bytes; 0 removes the CLI limit.
        #[arg(long, default_value_t = TRANSFER_LIMIT)]
        max_bytes: u64,
    },
    /// Show file metadata and its revision.
    #[command(
        after_long_help = "Reports one file's metadata. --json includes its opaque quoted revision; preserve that string unchanged for --if-match. Directories are not file targets.\n\nExample:\n  sb fs stat Draft.md --json"
    )]
    Stat {
        /// Space-relative filename, including its extension.
        path: String,
    },
    /// Write stdin or a local file; choose --create, --if-match, or --overwrite.
    #[command(group(clap::ArgGroup::new("write_policy").required(true).args(["create", "if_match", "overwrite"])), after_long_help = "Choose exactly one write policy. Input comes from --file or redirected stdin; there is no automatic input prompt. Writes preserve bytes, with a default 16 MiB input cap. Preserve the quoted revision from stat --json or read --json when using --if-match. Conflicts fail without retry.\n\nExamples:\n  sb fs write Draft.md --create --file draft.md\n  printf 'Status: ready\\n' | sb fs write Draft.md --overwrite")]
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
        #[arg(long, value_name = "REVISION")]
        if_match: Option<String>,
        /// Create or replace unconditionally.
        #[arg(long)]
        overwrite: bool,
        /// Maximum input bytes; 0 removes the CLI limit.
        #[arg(long, default_value_t = TRANSFER_LIMIT)]
        max_bytes: u64,
    },
    /// Replace exact text blocks in an existing file.
    #[command(
        after_long_help = r#"Supply --old and --new, or a JSON document via --file (or redirected stdin).
Each old block must match exactly once, including whitespace and line endings.
Empty new deletes a block; old cannot be empty. --all is only for --old/--new.
Batch edits refer to the original file and must not overlap; all are validated
before one conditional write. A failed batch leaves the file untouched.

Edits require UTF-8 without NUL; original and result are limited to 8 MiB.
Every edit checks the revision read at its start. --if-match additionally checks
a revision from an earlier inspection. Conflicts fail without retry or merging.
--dry-run emits a unified diff without writing (a JSON result with --json).

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
        #[arg(long, value_name = "REVISION")]
        if_match: Option<String>,
        /// Preview the diff without writing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Delete one file.
    #[command(
        visible_alias = "delete",
        after_long_help = "Deletes a single file, unconditionally unless --if-match is supplied. Directories and recursive deletion are unsupported. A revision conflict leaves the file untouched.\n\nExample:\n  sb fs rm Draft.md"
    )]
    Rm {
        /// Space-relative filename to delete.
        path: String,
        /// Require the exact quoted revision returned by read/stat --json.
        #[arg(long, value_name = "REVISION")]
        if_match: Option<String>,
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
