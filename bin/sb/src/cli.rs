use clap::{Args, Parser, Subcommand};

#[derive(Parser)]
#[command(name = "sb", version = crate::VERSION, about = "SilverBullet CLI")]
pub struct Cli {
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
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Manage saved space connections.
    #[command(subcommand)]
    Space(SpaceCmd),
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
    /// Retrieve indexed objects (kubectl-style).
    Get(GetArgs),
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
    /// Capture a screenshot of the headless page.
    Screenshot { file: Option<String> },
    /// Interactive Lua REPL.
    Repl,
    /// Print the version.
    Version,
    /// Upgrade to the latest release.
    Upgrade,
    /// Upgrade to the edge release.
    #[command(name = "upgrade-edge")]
    UpgradeEdge,
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

#[derive(Args)]
pub struct GetArgs {
    pub tag: Option<String>,
    #[arg(name = "ref")]
    pub ref_: Option<String>,
    #[arg(short = 'l', long)]
    pub selector: Vec<String>,
    #[arg(long = "where")]
    pub where_: Vec<String>,
    #[arg(long = "sort-by")]
    pub sort_by: Vec<String>,
    #[arg(long)]
    pub limit: Option<i64>,
    #[arg(long)]
    pub offset: Option<i64>,
    #[arg(long)]
    pub select: Option<String>,
    #[arg(short = 'v', long)]
    pub verbose: bool,
}
