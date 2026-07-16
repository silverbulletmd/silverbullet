use clap::{Args, Parser, Subcommand};

#[derive(Parser)]
#[command(name = "sb", version = crate::VERSION, about = "SilverBullet CLI")]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalFlags,
    #[command(subcommand)]
    pub command: Command,
}

/// The shared connection + output flags (`--space`, `--url`, `--token`,
/// `--timeout`, `--json`, `--text`, `-o`).
///
/// Factored into its own `Args` struct so a downstream binary (the App's CLI)
/// can `#[command(flatten)]` it into its own `clap` `Parser` and reuse
/// [`crate::conn::resolve`] / the output-mode resolution unchanged. All fields
/// are `global = true`, so they may appear before or after the subcommand.
#[derive(Args, Clone, Debug)]
pub struct GlobalFlags {
    /// Named space from config.
    #[arg(short = 's', long, global = true)]
    pub space: Option<String>,
    /// Direct server URL (skips config lookup).
    #[arg(long, global = true)]
    pub url: Option<String>,
    /// Direct bearer token.
    #[arg(long, global = true)]
    pub token: Option<String>,
    /// Request timeout in seconds.
    #[arg(short = 't', long, global = true, default_value_t = 30)]
    pub timeout: u64,
    /// Shortcut for `-o json`.
    #[arg(long, global = true)]
    pub json: bool,
    /// Shortcut for `-o text`.
    #[arg(long, global = true)]
    pub text: bool,
    /// Output mode: auto|text|table|json|jsonl|yaml.
    #[arg(short = 'o', long, global = true, default_value = "auto")]
    pub output: String,
}

#[derive(Subcommand)]
pub enum Command {
    /// Manage saved space connections.
    #[command(subcommand)]
    Space(SpaceCmd),
    /// Print the version.
    Version,
    #[command(flatten)]
    Core(CoreCommand),
}

#[derive(Subcommand)]
pub enum CoreCommand {
    /// Evaluate a Lua expression.
    Eval { expression: String },
    /// (hidden) alias of eval.
    #[command(hide = true)]
    Lua { expression: String },
    /// Run a Lua script (from arg, --file, or stdin).
    Script {
        code: Option<String>,
        #[arg(short = 'f', long)]
        file: Option<String>,
    },
    /// (hidden) old file-arg form of script.
    #[command(hide = true, name = "lua-script")]
    LuaScript { file: Option<String> },
    /// Run a SLIQ query.
    Query { expression: String },
    /// Describe query types / a tag's schema.
    Describe {
        #[arg(name = "type")]
        type_: Option<String>,
    },
    /// Show server console logs.
    Logs {
        #[arg(short = 'n', long, default_value_t = 100)]
        lines: usize,
        #[arg(short = 'f', long)]
        follow: bool,
    },
    /// Interactive Lua REPL.
    Repl,
    /// Upgrade to the latest release.
    Upgrade,
    /// Upgrade to the edge release.
    #[command(name = "upgrade-edge")]
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
    Add,
    /// List saved spaces.
    #[command(alias = "list")]
    Ls,
    /// Remove a saved space.
    #[command(alias = "remove")]
    Rm { name: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_is_not_a_supported_subcommand() {
        assert!(Cli::try_parse_from(["sb", "get"]).is_err());
    }
}
