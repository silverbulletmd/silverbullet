use clap::{Args, Parser, Subcommand};

pub const OVERVIEW: &str = r#"Command guide:
  Files: fs ls, read, stat, write, edit, rm — work on the space's files directly.
  Lua and queries: eval, script, query, logs, screenshot — run inside the connected space.
  Search: search, related — full-text and semantic search over the space's pages.
  Connections: space add, login, ls, rm.
  SilverBullet Desktop: open, or sb <path> — open a local folder or file.
  CLI maintenance: version, upgrade, upgrade-edge.

Getting started:
  sb space add
  sb space add https://notes.example.com --auth browser --no-browser   # no prompts
  sb --space notes fs ls
  sb fs read 'Projects/Launch.md'
  sb query 'from tags.page select name' --json
  sb search 'garden irrigation' --limit 5

Select a saved connection with --space (optional when only one exists), or use
--url and optionally --token to connect directly. Flags may appear before or
after the command. Space commands require a running server; folder spaces
are served by SilverBullet Desktop, which sb starts when needed.

Use sb <command> --help for examples and detailed rules; -h gives compact help.

Explore your space:
  These calls inspect the connected space, so results reflect its own tags,
  Space Lua functions and commands, including those its libraries add.

  Tags and their fields
    sb query 'from t = index.tags() select t.name'
    sb eval 'index.tagSchema("page")'
  Lua API
    sb eval 'table.keys(_G)'                           # global names, namespaces included
    sb eval 'spacelua.listFunctions()'                 # documented global functions
    sb eval 'spacelua.listFunctions("editor")'         # functions in a namespace
    sb eval 'spacelua.describe("editor.getText")'      # one function's signature and docs
    sb eval 'spacelua.renderApiDocumentation("index")' --text   # Markdown; --text prints it as is
    sb eval 'system.reboot()'                          # pick up edited Space Lua, styles and config
  Checking pages
    sb eval 'space.lint("Page")'                       # YAML, Lua and widget errors on a page
    sb eval 'space.lint()'                             # the same for every page
  Commands
    sb eval 'system.listCommands()'
  Query syntax
    sb fs read 'Library/Std/Docs/SLIQ Reference.md'"#;

/// Compact-help (`-h`) pointer to the explore section in the long help.
pub const COMPACT_HINT: &str =
    "Run sb --help to see how to explore your space's tags, Lua API and commands.";

#[derive(Parser)]
#[command(name = "sb", version = crate::VERSION, about = "SilverBullet CLI — work with your spaces", long_about = "SilverBullet CLI — read and edit remote files, run Lua, and query your space.", after_help = COMPACT_HINT, after_long_help = OVERVIEW)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalFlags,
    /// Local file or folder to open in SilverBullet Desktop.
    pub open_path: Option<String>,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Args, Clone, Debug)]
pub struct GlobalFlags {
    /// Select a saved space; automatically selected when only one exists.
    #[arg(short = 's', long, global = true, help_heading = "Connection")]
    pub space: Option<String>,
    /// Direct server URL (skips config lookup).
    #[arg(long, global = true, help_heading = "Connection")]
    pub url: Option<String>,
    /// Bearer token; overrides saved authentication when supplied.
    #[arg(long, global = true, help_heading = "Connection")]
    pub token: Option<String>,
    /// Request timeout in seconds.
    #[arg(
        short = 't',
        long,
        global = true,
        default_value_t = 30,
        help_heading = "Connection"
    )]
    pub timeout: u64,
    /// Shortcut for `-o json`.
    #[arg(long, global = true, help_heading = "Output", conflicts_with_all = ["text", "output"])]
    pub json: bool,
    /// Shortcut for `-o text`.
    #[arg(
        long,
        global = true,
        help_heading = "Output",
        conflicts_with = "output"
    )]
    pub text: bool,
    /// Result format; supported formats depend on the command (see --help).
    ///
    /// Auto uses text on a terminal and JSON when piped. fs read instead emits exact bytes.
    /// File commands accept auto, text, json and jsonl. eval, script and query also accept table and yaml. Logs, connection management, version and upgrades print their own text output. Select only one of --json, --text, or -o.
    #[arg(short = 'o', long, global = true, default_value = "auto", help_heading = "Output", hide_possible_values = true, value_parser = ["auto", "text", "table", "json", "jsonl", "yaml"])]
    pub output: String,
}

#[derive(Subcommand)]
pub enum Command {
    /// Open a local file or folder in SilverBullet Desktop.
    #[command(
        after_long_help = "Requires SilverBullet Desktop. Omit the path to just start it.\n\nExamples:\n  sb open ./notes\n  sb .          # same as sb open ."
    )]
    Open {
        /// Local file or folder; omit to start SilverBullet Desktop.
        path: Option<String>,
    },
    /// Manage saved space connections.
    #[command(
        subcommand,
        after_long_help = "Examples:\n  sb space add\n  sb space add ./notes\n  sb space add https://notes.example.com\n  sb space add https://notes.example.com --name work --auth token < token.txt\n  sb space ls\n  sb space login notes\n  sb space rm notes\n\nRemoving a saved connection does not delete its files."
    )]
    Space(SpaceCmd),
    /// Print the version.
    #[command(
        after_long_help = "Prints the installed CLI version without connecting to a space.\n\nExample: sb version"
    )]
    Version,
    #[command(flatten)]
    Core(CoreCommand),
}

#[derive(Subcommand)]
pub enum CoreCommand {
    /// Read and modify remote space files directly.
    #[command(subcommand, after_long_help = crate::fs_cli::OVERVIEW)]
    Fs(crate::fs_cli::FsCommand),
    /// Evaluate a Lua expression.
    #[command(
        after_long_help = "Runs in the connected space and prints the expression result.\n\nExamples:\n  sb eval '1 + 1'\n  sb eval 'space.readPage(\"index\")' --json\n  sb eval 'system.reboot()'   # pick up edited Space Lua, styles and config\n\nExplore the Lua API and commands:\n  sb eval 'table.keys(_G)'\n  sb eval 'spacelua.listFunctions()'\n  sb eval 'spacelua.listFunctions(\"editor\")'\n  sb eval 'spacelua.describe(\"editor.getText\")'\n  sb eval 'spacelua.renderApiDocumentation(\"index\")' --text\n  sb eval 'system.listCommands()'"
    )]
    Eval {
        /// Lua expression to evaluate (quote it for your shell).
        expression: String,
    },
    /// (hidden) alias of eval.
    #[command(hide = true)]
    Lua { expression: String },
    /// Run a Lua script (from arg, --file, or stdin).
    #[command(
        after_long_help = "Runs in the connected space. Supply inline code or --file; omit both to read stdin. Return a value to print a result.\n\nExamples:\n  sb script 'return 40 + 2'\n  sb script --file sample.lua\n  printf 'return 42\\n' | sb script"
    )]
    Script {
        /// Inline Lua code; omit to read stdin.
        code: Option<String>,
        /// Local Lua source file (not a remote space path).
        #[arg(short = 'f', long, conflicts_with = "code")]
        file: Option<String>,
    },
    /// (hidden) old file-arg form of script.
    #[command(hide = true, name = "lua-script")]
    LuaScript { file: Option<String> },
    /// Run a SLIQ query.
    #[command(
        after_long_help = "Runs in the connected space.\n\nExample:\n  sb query 'from tags.page select name' --json\n\nQuoting: wrap the query in single quotes and use double quotes inside it:\n  sb query 'from p = index.pages(\"book\") where p.status == \"reading\" select {name=p.name}'\nIf the query itself contains a single quote, pass it through a quoted heredoc:\n  sb query \"$(cat <<'EOF'\nfrom p = index.pages() where p.name == \"Bob's Notes\" select p.name\nEOF\n)\"\n\nExplore tags, their fields and the query syntax:\n  sb query 'from t = index.tags() select t.name'\n  sb eval 'index.tagSchema(\"page\")'\n  sb fs read 'Library/Std/Docs/SLIQ Reference.md'"
    )]
    Query {
        /// SLIQ query expression, quoted for your shell.
        expression: String,
    },
    /// Search the space's pages.
    #[command(
        after_long_help = "Calls the server's search API directly: no Lua runtime or headless browser is needed. Prints one line per page, `Page:line  excerpt`, best match first. --json prints the server's response.\n\nModes: words (all words, any order), phrase (exact phrase) and semantic (by meaning, in spaces with semantic search). Without --mode, search starts in semantic when the space offers it and in words otherwise, like the search box. Public visitors get only the modes the server allows them.\n\n--status shows the search index state and which modes are available instead of searching. It is a flag, so `sb search status` searches for the word status.\n\nExamples:\n  sb search 'garden irrigation'\n  sb search 'garden irrigation' --mode phrase --limit 5 --json\n  sb search --status"
    )]
    Search {
        /// Text to search for (quote it for your shell).
        #[arg(required_unless_present = "status")]
        query: Option<String>,
        /// How to match: words, phrase or semantic (default: what the space offers best).
        #[arg(long, value_parser = ["words", "phrase", "semantic"], conflicts_with = "status")]
        mode: Option<String>,
        /// Maximum number of pages.
        #[arg(short = 'n', long, value_parser = clap::value_parser!(u32).range(1..), conflicts_with = "status")]
        limit: Option<u32>,
        /// Show the search index state and available modes instead of searching.
        #[arg(long)]
        status: bool,
    },
    /// List pages related to a page.
    #[command(
        after_long_help = "Finds the pages most similar in meaning to a page, using semantic search. Prints one line per page, `Page:line  excerpt`; --json prints the server's response. Needs a space with semantic search, and is not available to public visitors; `sb search --status` shows whether it is.\n\nExamples:\n  sb related 'Projects/Launch'\n  sb related Launch --limit 5 --json"
    )]
    Related {
        /// Page name, without .md.
        page: String,
        /// Maximum number of pages.
        #[arg(short = 'n', long, value_parser = clap::value_parser!(u32).range(1..))]
        limit: Option<u32>,
    },
    /// Show server console logs.
    #[command(
        after_long_help = "Shows the connected space's client console logs as text regardless of output flags. --follow continues streaming until interrupted.\n\nExamples:\n  sb logs --lines 20\n  sb logs --follow"
    )]
    Logs {
        /// Number of recent log entries.
        #[arg(short = 'n', long, default_value_t = 100)]
        lines: usize,
        /// Stream new entries until interrupted.
        #[arg(short = 'f', long)]
        follow: bool,
    },
    /// Capture a PNG screenshot of the runtime client.
    #[command(
        after_long_help = "Captures the connected space's current client viewport, or one element with --selector. --full-page captures the whole current page, not just the first screen: it scrolls the editor one screen at a time, waits for each screen to render, and stitches the screens into one PNG (the top bar appears once, at the top). Very long pages stop after about 12000 pixels and print a note on stderr. Navigate first with eval, then wait until the page has finished rendering its widgets and queries. On SilverBullet Desktop this captures the space's visible editor window.\n\nExamples:\n  sb eval 'editor.navigate(\"index\")'\n  sb eval 'editor.awaitRender()'\n  sb screenshot\n  sb screenshot page.png --full-page\n  sb screenshot widget.png --selector '#sb-main .sb-lua-top-widget'\n  sb screenshot - > page.png"
    )]
    Screenshot {
        /// Output PNG path, or - for stdout.
        #[arg(default_value = "screenshot.png")]
        file: String,
        /// CSS selector of the element to capture.
        #[arg(long, conflicts_with = "full_page")]
        selector: Option<String>,
        /// Capture the whole page by scrolling, stitched into one PNG.
        #[arg(long)]
        full_page: bool,
    },
    /// Upgrade to the latest release.
    #[command(
        after_long_help = "Downloads and replaces this CLI executable. No space connection is needed.\n\nExample: sb upgrade"
    )]
    Upgrade,
    /// Upgrade to the edge release.
    #[command(
        name = "upgrade-edge",
        after_long_help = "Downloads and replaces this CLI executable with the edge build. No space connection is needed.\n\nExample: sb upgrade-edge"
    )]
    UpgradeEdge,
}

impl CoreCommand {
    /// Whether dispatching this command needs a resolved space connection.
    /// Lets wrappers skip connection setup (e.g. cold-starting a local
    /// space server) for commands that never talk to a space.
    pub fn needs_connection(&self) -> bool {
        !matches!(self, CoreCommand::Upgrade | CoreCommand::UpgradeEdge)
    }
}

#[derive(Subcommand)]
pub enum SpaceCmd {
    /// Create a new folder space for SilverBullet Desktop.
    #[command(
        after_long_help = "Creates the folder if it does not exist and registers it as a space. The folder must be missing or empty; use 'sb space add' for a folder that already holds a space. New spaces start with the shell off and managed revisions, like spaces created in SilverBullet Desktop.

The name defaults to the folder name.

Examples:
  sb space create ~/Notes/harbor
  sb space create ./atlas --name atlas-notes --json"
    )]
    Create {
        /// Folder for the new space.
        folder: String,
        /// Name for the space (default: derived from the folder name).
        #[arg(long)]
        name: Option<String>,
    },
    /// Add a space connection.
    #[command(
        after_long_help = "With a folder path, registers an existing folder as a space served by SilverBullet Desktop; the folder must exist (use 'sb space create' for a new one). With a URL or no argument, sets up a remote connection; interactive setup prompts for connection details and authentication. Browser sign-in may require completing login outside the terminal.\n\nThe name defaults to the URL's last path segment (sb.example.com/notes becomes notes), or else the first part of its host (notes.example.com becomes notes). When stdin is not a terminal, nothing is prompted: give the URL, plus --name or --auth to override the defaults. Tokens and passwords are then read as one line each from stdin.\n\nExamples:\n  sb space add ./notes\n  sb space add https://notes.example.com\n  sb space add https://notes.example.com --name work --auth browser --no-browser\n  echo \"$TOKEN\" | sb space add https://notes.example.com --auth token"
    )]
    Add {
        /// Local folder or remote server URL; omit for interactive setup.
        path_or_url: Option<String>,
        /// Name for the connection (default: derived from the URL).
        #[arg(long)]
        name: Option<String>,
        /// Authentication method, used when the server requires it.
        #[arg(long, value_parser = ["browser", "token", "password"])]
        auth: Option<String>,
        /// Username for password authentication.
        #[arg(long)]
        username: Option<String>,
        /// Print the sign-in URL without opening a browser.
        #[arg(long)]
        no_browser: bool,
    },
    /// Sign in again to a saved remote space.
    #[command(
        after_long_help = "Refreshes browser sign-in credentials for a saved remote connection.\n\nExample: sb space login notes --no-browser"
    )]
    Login {
        /// Saved connection name.
        name: String,
        /// Print the sign-in URL without opening a browser.
        #[arg(long)]
        no_browser: bool,
    },
    /// List saved spaces.
    #[command(
        visible_alias = "list",
        after_long_help = "Lists saved connections. Single-file spaces opened in SilverBullet Desktop are hidden unless --all is given. With --json, prints one object per space: id, name, url or folderPath, auth, runningPort, syncEnabled, hidden.\n\nExamples:\n  sb space ls\n  sb space ls --json"
    )]
    Ls {
        /// Include single-file spaces opened in SilverBullet Desktop.
        #[arg(long)]
        all: bool,
    },
    /// Rename a saved space.
    #[command(
        after_long_help = "Changes the name used with --space; the space's files, id and settings are unchanged.\n\nExample: sb space rename notes notes-archive"
    )]
    Rename {
        /// Current name.
        name: String,
        /// New name.
        new_name: String,
    },
    /// Move a folder space and its files to a new path.
    #[command(
        visible_alias = "move",
        after_long_help = "Renames the space's folder and updates the saved path; the space keeps its name, id and settings. The target must not exist and must be on the same disk. Refused while SilverBullet Desktop has the space open, and for spaces that overlap another registered folder.\n\nExamples:\n  sb space mv notes ~/Documents/notes --dry-run\n  sb space mv notes ~/Documents/notes --json"
    )]
    Mv {
        /// Saved space name (or its current folder path).
        name: String,
        /// New folder path; must not exist yet.
        target: String,
        /// Report what would change without changing anything.
        #[arg(long)]
        dry_run: bool,
    },
    /// Point a folder space at a folder that was already moved.
    #[command(
        visible_alias = "set-path",
        after_long_help = "Updates the saved folder path only; no files are touched. Use it after moving the same folder intact by other means. For a space that syncs, after restoring from a backup or older copy, turn sync off and on again in SilverBullet Desktop so the first sync compares both sides. The new folder must exist. If the old folder still exists, pass --force.\n\nExample: sb space relocate notes ~/Documents/notes"
    )]
    Relocate {
        /// Saved space name (or its current folder path).
        name: String,
        /// Existing folder that now holds the space.
        path: String,
        /// Allow it even though the old folder still exists.
        #[arg(long)]
        force: bool,
        /// Report what would change without changing anything.
        #[arg(long)]
        dry_run: bool,
    },
    /// Remove a saved space.
    #[command(
        visible_alias = "remove",
        after_long_help = "Removes the local connection entry; the space itself is preserved.\n\nExample: sb space rm notes"
    )]
    Rm {
        /// Saved connection to remove; remote files are not deleted.
        name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_examples_parse() {
        for args in [
            vec!["sb", "space", "add"],
            vec![
                "sb",
                "space",
                "create",
                "./atlas",
                "--name",
                "atlas-notes",
                "--json",
            ],
            vec!["sb", "space", "rename", "notes", "notes-archive"],
            vec!["sb", "space", "mv", "notes", "/tmp/n", "--dry-run"],
            vec!["sb", "space", "set-path", "notes", "/tmp/n", "--force"],
            vec!["sb", "space", "ls", "--json"],
            vec!["sb", "--space", "notes", "fs", "ls"],
            vec![
                "sb",
                "fs",
                "ls",
                "Projects",
                "-r",
                "--glob",
                "*.md",
                "--glob",
                "!Projects/Archive/**",
            ],
            vec![
                "sb",
                "fs",
                "read",
                "Projects/Launch.md",
                "--lines",
                "10:30",
                "--number",
            ],
            vec!["sb", "fs", "stat", "Draft.md", "--json"],
            vec![
                "sb", "fs", "write", "Draft.md", "--create", "--file", "draft.md",
            ],
            vec![
                "sb",
                "fs",
                "edit",
                "Draft.md",
                "--old",
                "Status: draft",
                "--new",
                "Status: ready",
                "--dry-run",
            ],
            vec!["sb", "fs", "edit", "Draft.md", "--file", "-"],
            vec!["sb", "fs", "rm", "Draft.md"],
            vec!["sb", "eval", "1 + 1"],
            vec!["sb", "script", "--file", "sample.lua"],
            vec!["sb", "query", "from tags.page select name", "--json"],
            vec!["sb", "logs", "--follow"],
            vec!["sb", "search", "garden irrigation", "--mode", "phrase"],
            vec!["sb", "search", "garden", "--limit", "5", "--json"],
            vec!["sb", "search", "--status", "--json"],
            vec!["sb", "related", "Projects/Launch", "--limit", "5"],
        ] {
            assert!(Cli::try_parse_from(&args).is_ok(), "{args:?}");
        }
    }

    #[test]
    fn search_status_is_a_flag_and_the_word_status_is_searched() {
        let parsed = |args: &[&str]| match Cli::try_parse_from(args).unwrap().command {
            Some(Command::Core(CoreCommand::Search { query, status, .. })) => (query, status),
            _ => panic!("not a search: {args:?}"),
        };
        assert_eq!(
            parsed(&["sb", "search", "status"]),
            (Some("status".into()), false)
        );
        assert_eq!(parsed(&["sb", "search", "--status"]), (None, true));
        assert_eq!(
            parsed(&["sb", "--json", "search", "--status"]),
            (None, true)
        );
    }

    #[test]
    fn search_arguments_are_validated_before_connecting() {
        for args in [
            vec!["sb", "search"],
            vec!["sb", "search", "x", "--mode", "natural"],
            vec!["sb", "search", "x", "--limit", "0"],
            vec!["sb", "search", "--status", "--mode", "words"],
            vec!["sb", "search", "--status", "--limit", "3"],
            vec!["sb", "related"],
            vec!["sb", "related", "Page", "--limit", "0"],
        ] {
            assert!(Cli::try_parse_from(&args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn help_contracts_validate_before_connection() {
        for args in [
            vec!["sb", "eval", "1", "-o", "bogus"],
            vec!["sb", "eval", "1", "--json", "--text"],
            vec!["sb", "script", "return 1", "--file", "sample.lua"],
            vec!["sb", "fs", "write", "Draft.md"],
            vec!["sb", "fs", "edit", "Draft.md", "--old", "x"],
            vec![
                "sb",
                "fs",
                "edit",
                "Draft.md",
                "--file",
                "edits.json",
                "--all",
            ],
        ] {
            assert!(Cli::try_parse_from(&args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn long_help_explains_edit_input_and_connection() {
        let help = Cli::try_parse_from(["sb", "fs", "edit", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(help.contains("\"edits\""), "{help}");
        assert!(help.contains("8 MiB"), "{help}");
        assert!(help.contains("Connection:"), "{help}");
        let root = Cli::try_parse_from(["sb", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(!root.contains("Factored into"), "{root}");
        assert!(root.contains("sb fs read"), "{root}");
    }

    #[test]
    fn browser_auth_commands_accept_no_browser() {
        assert!(Cli::try_parse_from(["sb", "space", "add", "--no-browser"]).is_ok());
        assert!(Cli::try_parse_from(["sb", "space", "login", "notes", "--no-browser"]).is_ok());
    }

    #[test]
    fn repl_is_not_a_supported_subcommand() {
        let cli = Cli::try_parse_from(["sb", "repl"]).unwrap();
        assert!(cli.command.is_none());
        assert_eq!(cli.open_path.as_deref(), Some("repl"));
        assert!(Cli::try_parse_from(["sb", "repl", "--plain"]).is_err());
    }

    #[test]
    fn desktop_open_forms_parse() {
        let bare = Cli::try_parse_from(["sb"]).unwrap();
        assert!(bare.command.is_none() && bare.open_path.is_none());
        assert_eq!(
            Cli::try_parse_from(["sb", "."])
                .unwrap()
                .open_path
                .as_deref(),
            Some(".")
        );
        assert!(matches!(
            Cli::try_parse_from(["sb", "open", "./notes"])
                .unwrap()
                .command,
            Some(Command::Open { path: Some(_) })
        ));
    }

    #[test]
    fn space_add_accepts_a_folder_or_url_and_ls_accepts_all() {
        for (args, expected) in [
            (vec!["sb", "space", "add", "./notes"], Some("./notes")),
            (
                vec![
                    "sb",
                    "space",
                    "add",
                    "https://notes.example.com",
                    "--no-browser",
                ],
                Some("https://notes.example.com"),
            ),
            (vec!["sb", "space", "add"], None),
        ] {
            match Cli::try_parse_from(&args).unwrap().command {
                Some(Command::Space(SpaceCmd::Add { path_or_url, .. })) => {
                    assert_eq!(path_or_url.as_deref(), expected)
                }
                _ => panic!("{args:?}"),
            }
        }
        assert!(matches!(
            Cli::try_parse_from(["sb", "space", "ls", "--all"])
                .unwrap()
                .command,
            Some(Command::Space(SpaceCmd::Ls { all: true }))
        ));
    }

    #[test]
    fn space_add_takes_name_and_auth_flags() {
        match Cli::try_parse_from([
            "sb",
            "space",
            "add",
            "https://hermes.example.com",
            "--name",
            "work",
            "--auth",
            "password",
            "--username",
            "alice",
        ])
        .unwrap()
        .command
        {
            Some(Command::Space(SpaceCmd::Add {
                name,
                auth,
                username,
                ..
            })) => {
                assert_eq!(name.as_deref(), Some("work"));
                assert_eq!(auth.as_deref(), Some("password"));
                assert_eq!(username.as_deref(), Some("alice"));
            }
            _ => panic!(),
        }
        assert!(Cli::try_parse_from(["sb", "space", "add", "--auth", "magic"]).is_err());
    }

    #[test]
    fn lua_and_logs_remain_supported() {
        assert!(matches!(
            Cli::try_parse_from(["sb", "lua", "1 + 1"]).unwrap().command,
            Some(Command::Core(CoreCommand::Lua { .. }))
        ));
        assert!(matches!(
            Cli::try_parse_from(["sb", "logs", "--follow"])
                .unwrap()
                .command,
            Some(Command::Core(CoreCommand::Logs { follow: true, .. }))
        ));
    }

    #[test]
    fn screenshot_defaults_file_and_accepts_selector() {
        let cli = Cli::try_parse_from(["sb", "screenshot", "--selector", "#sb-top"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(Command::Core(CoreCommand::Screenshot { ref file, selector: Some(ref s), full_page: false }))
                if file == "screenshot.png" && s == "#sb-top"
        ));
    }

    #[test]
    fn screenshot_accepts_full_page() {
        let cli = Cli::try_parse_from(["sb", "screenshot", "out.png", "--full-page"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(Command::Core(CoreCommand::Screenshot { ref file, selector: None, full_page: true }))
                if file == "out.png"
        ));
    }

    #[test]
    fn screenshot_full_page_conflicts_with_selector() {
        let err = Cli::try_parse_from(["sb", "screenshot", "--full-page", "--selector", "#x"])
            .err()
            .unwrap();
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn screenshot_help_mentions_full_page() {
        let help = Cli::try_parse_from(["sb", "screenshot", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(help.contains("--full-page"), "{help}");
        assert!(
            help.contains("sb screenshot page.png --full-page"),
            "{help}"
        );
    }

    #[test]
    fn long_help_lists_explore_calls() {
        let root = Cli::try_parse_from(["sb", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(root.contains("Explore your space:"), "{root}");
        for call in [
            "index.tags()",
            "index.tagSchema(\"page\")",
            "table.keys(_G)",
            "spacelua.listFunctions(\"editor\")",
            "spacelua.describe(\"editor.getText\")",
            "spacelua.renderApiDocumentation(\"index\")",
            "system.listCommands()",
            "Library/Std/Docs/SLIQ Reference.md",
        ] {
            assert!(root.contains(call), "missing {call}: {root}");
        }
        assert!(!root.contains("sb describe"), "{root}");
        assert!(!root.contains("Runtime API"), "{root}");
        assert!(!root.contains(COMPACT_HINT), "{root}");
    }

    #[test]
    fn help_shows_reboot_after_editing_lua_styles_and_config() {
        let line = "sb eval 'system.reboot()'";
        let root = Cli::try_parse_from(["sb", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(root.contains(line), "{root}");
        assert!(
            root.contains("# pick up edited Space Lua, styles and config"),
            "{root}"
        );
        let eval = Cli::try_parse_from(["sb", "eval", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(eval.contains(line), "{eval}");
    }

    #[test]
    fn query_help_shows_shell_safe_quoting() {
        let help = Cli::try_parse_from(["sb", "query", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(
            help.contains(r#"sb query 'from p = index.pages("book") where p.status == "reading""#),
            "{help}"
        );
        assert!(help.contains("sb query \"$(cat <<'EOF'"), "{help}");
        assert!(help.contains("\nEOF\n)\""), "{help}");
    }

    #[test]
    fn screenshot_help_waits_for_rendering_after_navigating() {
        let help = Cli::try_parse_from(["sb", "screenshot", "--help"])
            .err()
            .unwrap()
            .to_string();
        let navigate = help.find("editor.navigate(").expect(&help);
        let wait = help.find("editor.awaitRender()").expect(&help);
        let capture = help.find("\n  sb screenshot\n").expect(&help);
        assert!(navigate < wait && wait < capture, "{help}");
    }

    #[test]
    fn compact_help_points_to_explore_section() {
        let compact = Cli::try_parse_from(["sb", "-h"]).err().unwrap().to_string();
        assert!(compact.contains(COMPACT_HINT), "{compact}");
        assert!(!compact.contains("Explore your space:"), "{compact}");
    }

    #[test]
    fn command_help_has_no_runtime_api_wording() {
        for cmd in ["eval", "script", "query", "logs", "screenshot", "fs"] {
            let help = Cli::try_parse_from(["sb", cmd, "--help"])
                .err()
                .unwrap()
                .to_string();
            assert!(!help.contains("Runtime API"), "{cmd}: {help}");
            assert!(!help.contains("sb describe"), "{cmd}: {help}");
        }
        let eval = Cli::try_parse_from(["sb", "eval", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(eval.contains("system.listCommands()"), "{eval}");
        let query = Cli::try_parse_from(["sb", "query", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(query.contains("index.tags()"), "{query}");
        assert!(query.contains("SLIQ Reference.md"), "{query}");
    }

    #[test]
    fn describe_is_not_a_supported_subcommand() {
        assert!(Cli::try_parse_from(["sb", "describe", "page", "--json"]).is_err());
    }

    #[test]
    fn lint_is_an_eval_call_not_a_subcommand() {
        let root = Cli::try_parse_from(["sb", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(root.contains("sb eval 'space.lint(\"Page\")'"), "{root}");
        assert!(root.contains("sb eval 'space.lint()'"), "{root}");
    }
}
