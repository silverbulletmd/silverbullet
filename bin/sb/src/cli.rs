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
/// Factored into its own `Args` struct — the Rust analog of Core's Go
/// `AddSpaceFlags`/`AddOutputFlags` — so a downstream binary (the App's CLI)
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
    /// List indexed tags, list objects of a tag, or fetch one object (kubectl-style)
    #[command(
        long_about = "Retrieve indexed objects.

  sb get                 # list all used tag names
  sb get <tag>           # list all objects with this tag (paged, filtered)
  sb get <tag> <ref>     # fetch one object by its ref

OBJECTS AND TAGS

Each object has a \"ref\" field that uniquely identifies it within its tag.
For pages, the ref is the page name; for many others, it's typically \"PageName@PositionIndex\".

Run 'sb describe <tag>' to see the field schema for a tag (when defined).

FILTERING (--where, -l/--selector)

  -l, --selector field=value[,field=value]
      Comma-separated equality selectors. Quickest path for AND-of-equalities.

  --where <expr>   (repeatable)
      Full operator support. Syntax: 'field=value' (equality) or 'field:OP=value'.
      Multiple --where flags are AND-ed together.

  Operators:
      eq          equal to                       --where done=false
      ne          not equal                      --where status:ne=archived
      gt          numeric/string greater than    --where priority:gt=2
      gte         greater than or equal          --where due:gte=2026-01-01
      lt          less than                      --where lineCount:lt=100
      lte         less than or equal             --where due:lte=2026-06-01
      in          value in comma-separated list  --where status:in=open,pending
      contains    string contains substring      --where name:contains=meeting
      startsWith  string starts with prefix      --where name:startsWith=2026-

  Field paths use dotted notation for nested fields:
      --where meta.author=alice

VALUE TYPING

Values are auto-typed:
  42, -3.14    -> number
  true, false  -> boolean
  null         -> nil (matches missing or explicit-null fields)
  anything else -> string

Force a type with a prefix:
      --where zipCode=str:01234         # treat as string, not number
      --where count:gt=num:10           # explicit number
      --where active=bool:true          # explicit boolean

SORTING, PAGING, PROJECTION

  --sort-by field[:desc]    (repeatable) — multi-key sort
  --limit N                 default 100, max 1000
  --offset N                pagination offset
  --select f1,f2,...        project only these fields per result

OUTPUT (global -o, --output | --text | --json)

  auto    (default) Text on a TTY (table for object lists), JSON otherwise — for humans + pipes
  text    string-as-string; arrays of objects render as a kubectl-style table; fallback to pretty JSON
  table   force table rendering (up to 8 columns, 40-char cells)
  json    pretty-printed JSON
  jsonl   one JSON value per line — friendly to xargs / line-oriented tools
  yaml    YAML

--text and --json are shortcuts for -o text / -o json.

VERBOSE (-v)

  Adds the synthesized Lua query as an X-Equivalent-Lua response header
  and includes it in stderr. Useful for understanding what the server ran.

EXIT CODES

  0   success
  1   transport / connection error
  2   API error (non-2xx other than 404)
  3   not found (404) — when fetching a single object by ref

ALSO

  sb describe <tag>        show the field schema for a tag
  sb query '<lua>'         full Lua collection query (for things REST can't express)",
        after_help = "Examples:
  # List all known tag names
  sb get

  # List all tasks
  sb get task

  # Unfinished tasks, highest priority first, top 20
  sb get task -l done=false --sort-by priority:desc --limit 20"
    )]
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
