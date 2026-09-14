use clap::{Args, Parser, Subcommand};

pub const OVERVIEW: &str = "Command guide:
  Files: fs ls, read, stat, write, edit, rm — HTTP only; no Runtime API needed.
  Lua and queries: eval, script, query, describe, logs — require the Runtime API.
  Connections: space add, login, ls, rm.
  CLI maintenance: version, upgrade, upgrade-edge.

Getting started:
  sb space add
  sb --space notes fs ls
  sb fs read 'Projects/Launch.md'
  sb query 'from tags.page select name' --json

Select a saved connection with --space (optional when only one exists), or use
--url and optionally --token to connect directly. Flags may appear before or
after the command. Core requires a running server.

Use sb <command> --help for examples and detailed rules; -h gives compact help.
Use sb describe to inspect the connected space's query schemas and SLIQ syntax.";

#[derive(Parser)]
#[command(name = "sb", version = crate::VERSION, about = "SilverBullet CLI — work with your spaces", long_about = "SilverBullet CLI — read and edit remote files, run Lua, and query your space.", after_long_help = OVERVIEW)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalFlags,
    #[command(subcommand)]
    pub command: Command,
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
    /// File commands accept auto, text, json and jsonl. eval, script and query also accept table and yaml. describe uses JSON for json/auto-piped, otherwise text. Logs, connection management, version and upgrades print their own text output. Select only one of --json, --text, or -o.
    #[arg(short = 'o', long, global = true, default_value = "auto", help_heading = "Output", hide_possible_values = true, value_parser = ["auto", "text", "table", "json", "jsonl", "yaml"])]
    pub output: String,
}

#[derive(Subcommand)]
pub enum Command {
    /// Manage saved space connections.
    #[command(
        subcommand,
        after_long_help = "Examples:\n  sb space add\n  sb space ls\n  sb space login notes\n  sb space rm notes\n\nRemoving a saved connection does not delete its remote files."
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
    /// Read and modify remote space files without the Runtime API.
    #[command(subcommand, after_long_help = crate::fs_cli::OVERVIEW)]
    Fs(crate::fs_cli::FsCommand),
    /// Evaluate a Lua expression.
    #[command(
        after_long_help = "Requires a connected space and the Runtime API. Prints the expression result.\n\nExamples:\n  sb eval '1 + 1'\n  sb eval 'space.readPage(\"index\")' --json"
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
        after_long_help = "Requires the Runtime API. Supply inline code or --file; omit both to read stdin. Return a value to print a result.\n\nExamples:\n  sb script 'return 40 + 2'\n  sb script --file sample.lua\n  printf 'return 42\\n' | sb script"
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
        after_long_help = "Requires the Runtime API. Use sb describe to discover the connected space's types and SLIQ syntax.\n\nExample:\n  sb query 'from tags.page select name' --json"
    )]
    Query {
        /// SLIQ query expression, quoted for your shell.
        expression: String,
    },
    /// Describe query types / a tag's schema.
    #[command(
        after_long_help = "Inspects live query schemas, not CLI commands. Requires a connected space and the Runtime API. Omit TYPE for all types and query syntax; --json returns the schemas as JSON.\n\nExamples:\n  sb describe\n  sb describe page --json"
    )]
    Describe {
        /// Tag whose schema to inspect; omit to list all query types.
        #[arg(name = "type")]
        type_: Option<String>,
    },
    /// Show server console logs.
    #[command(
        after_long_help = "Requires the Runtime API. Shows its headless client console logs as text regardless of output flags. --follow continues streaming until interrupted.\n\nExamples:\n  sb logs --lines 20\n  sb logs --follow"
    )]
    Logs {
        /// Number of recent log entries.
        #[arg(short = 'n', long, default_value_t = 100)]
        lines: usize,
        /// Stream new entries until interrupted.
        #[arg(short = 'f', long)]
        follow: bool,
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
    /// Add a space connection interactively.
    #[command(
        after_long_help = "Interactive setup prompts for connection details and authentication. Browser sign-in may require completing login outside the terminal.\n\nExample: sb space add"
    )]
    Add {
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
        after_long_help = "Lists saved connections.\n\nExample: sb space ls"
    )]
    Ls,
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
            vec!["sb", "describe", "page", "--json"],
            vec!["sb", "logs", "--follow"],
        ] {
            assert!(Cli::try_parse_from(&args).is_ok(), "{args:?}");
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
        assert!(Cli::try_parse_from(["sb", "repl"]).is_err());
        assert!(Cli::try_parse_from(["sb", "repl", "--plain"]).is_err());
    }

    #[test]
    fn lua_and_logs_remain_supported() {
        assert!(matches!(
            Cli::try_parse_from(["sb", "lua", "1 + 1"]).unwrap().command,
            Command::Core(CoreCommand::Lua { .. })
        ));
        assert!(matches!(
            Cli::try_parse_from(["sb", "logs", "--follow"])
                .unwrap()
                .command,
            Command::Core(CoreCommand::Logs { follow: true, .. })
        ));
    }

    #[test]
    fn get_is_not_a_supported_subcommand() {
        assert!(Cli::try_parse_from(["sb", "get"]).is_err());
    }
}
