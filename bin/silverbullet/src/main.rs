//! The standalone SilverBullet server binary. Serves the embedded client bundle
//! against a folder space over HTTP. The actual server lives in the `silverbullet`
//! library crate (`src/lib.rs`), this is just the CLI entry point.

use clap::{Parser, Subcommand};
use silverbullet::{server, VERSION};
use silverbullet_server::multi::setup::{run_setup, FirstSpace, SetupRequest};
use silverbullet_server_common::upgrade::{self, UpgradeSpec, EDGE_URL_PREFIX, STABLE_URL_PREFIX};

/// The server binary ships as `silverbullet-server-<os>-<arch>.zip`; the
/// executable inside the zip is `silverbullet`.
const UPGRADE_SPEC: UpgradeSpec = UpgradeSpec {
    asset: "silverbullet-server",
    binary: "silverbullet",
};

#[derive(Parser)]
#[command(name = "silverbullet", version = VERSION, about = "Run the SilverBullet server")]
struct Cli {
    /// Host or address to listen on (env: SB_HOSTNAME)
    #[arg(short = 'L', long, env = "SB_HOSTNAME")]
    hostname: Option<String>,
    /// Port to listen on (env: SB_PORT)
    #[arg(short = 'p', long, env = "SB_PORT")]
    port: Option<u16>,
    /// The data folder to serve (env: SB_FOLDER)
    folder: Option<String>,
    /// Removed: fails with a pointer to the migration
    #[arg(long, hide = true)]
    single: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Print the version.
    Version,
    /// Upgrade to the latest stable release
    Upgrade,
    /// Upgrade to the latest edge release
    #[command(name = "upgrade-edge")]
    UpgradeEdge,
    /// Provision a fresh data folder non-interactively, the scriptable twin of the /.setup wizard
    Setup {
        /// The data folder to provision
        folder: String,
        /// Admin credentials in user:pass form
        #[arg(long)]
        admin: String,
        /// Name of the first space (omit to create no space)
        #[arg(long)]
        space: Option<String>,
        /// URL prefix for the first space ("/" = whole server)
        #[arg(long, default_value = "/")]
        at: String,
        /// Folder for the first space (defaults to spaces/<id> under the data folder)
        #[arg(long, default_value = "")]
        space_folder: String,
    },
    /// Serve one folder as a public, read-only site without accounts; writes nothing to disk
    Publish {
        /// The folder to publish (env: SB_FOLDER; default: the current directory)
        folder: Option<String>,
        /// Host or address to listen on (env: SB_HOSTNAME)
        #[arg(short = 'L', long)]
        hostname: Option<String>,
        /// Port to listen on (env: SB_PORT)
        #[arg(short = 'p', long)]
        port: Option<u16>,
    },
}

fn main() -> std::process::ExitCode {
    // Before any runtime or thread starts.
    silverbullet_server_search::semantic::inference::limit_candle_threads();
    tracing_subscriber::fmt()
        .with_env_filter(
            // Chromiumoxide warns on unrecognized CDP events even when commands
            // succeed, and tantivy logs every index commit and merge at info.
            // Suppress that noise unless RUST_LOG overrides the filter.
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,chromiumoxide=error,tantivy=warn".into()),
        )
        .init();
    // Debug builds: offer the e2e harness's tiny model when it wrote one.
    #[cfg(debug_assertions)]
    silverbullet_server_search::semantic::e2e::install();

    let cli = Cli::parse();

    // Upgrade uses reqwest::blocking, which panics inside a Tokio runtime.
    // Publish is a server, so it runs inside the runtime below.
    let publish = match cli.command {
        Some(Command::Publish {
            folder,
            hostname,
            port,
        }) => {
            if let Some(stray) = &cli.folder {
                eprintln!(
                    "Error: the folder goes after the subcommand: \
                     `silverbullet publish <FOLDER>` (got {stray} before it)"
                );
                return std::process::ExitCode::FAILURE;
            }
            if cli.single {
                eprintln!("Error: --single does not apply to `silverbullet publish`");
                return std::process::ExitCode::FAILURE;
            }
            Some((folder, hostname.or(cli.hostname.clone()), port.or(cli.port)))
        }
        Some(command) => return run_subcommand(command),
        None => None,
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!("failed to build Tokio runtime: {e}");
            return std::process::ExitCode::FAILURE;
        }
    };

    runtime.block_on(async {
        let result = match publish {
            Some((folder, hostname, port)) => server::run_publish(hostname, port, folder).await,
            None => server::run(cli.hostname, cli.port, cli.folder, cli.single).await,
        };
        match result {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                // The tracing subscriber writes to stdout; fatal CLI errors also need stderr.
                tracing::error!("{e}");
                eprintln!("Error: {e}");
                std::process::ExitCode::FAILURE
            }
        }
    })
}

/// Run a non-server subcommand and map the result to a process exit code.
fn run_subcommand(command: Command) -> std::process::ExitCode {
    let url_prefix = match command {
        Command::Version => {
            let v = if VERSION.is_empty() { "dev" } else { VERSION };
            println!("{v}");
            return std::process::ExitCode::SUCCESS;
        }
        Command::Setup {
            folder,
            admin,
            space,
            at,
            space_folder,
        } => return run_setup_subcommand(folder, admin, space, at, space_folder),
        Command::Publish { .. } => unreachable!("publish runs inside the Tokio runtime"),
        Command::Upgrade => {
            println!("Upgrading silverbullet...");
            STABLE_URL_PREFIX
        }
        Command::UpgradeEdge => {
            println!("Upgrading silverbullet to edge...");
            EDGE_URL_PREFIX
        }
    };
    match upgrade::upgrade(&UPGRADE_SPEC, url_prefix) {
        Ok(()) => {
            println!("Restart your server to run the new version.");
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run_setup_subcommand(
    folder: String,
    admin: String,
    space: Option<String>,
    at: String,
    space_folder: String,
) -> std::process::ExitCode {
    let Some((username, password)) = admin.split_once(':') else {
        eprintln!("Error: --admin must be in \"user:pass\" form (missing ':')");
        return std::process::ExitCode::FAILURE;
    };

    let root = std::path::Path::new(&folder);
    if let Err(e) = std::fs::create_dir_all(root) {
        eprintln!("Error: could not create folder {}: {e}", root.display());
        return std::process::ExitCode::FAILURE;
    }

    let req = SetupRequest {
        primary_url: None,
        admin_username: username.to_string(),
        admin_password: password.to_string(),
        admin_full_name: String::new(),
        admin_email: String::new(),
        space: space.map(|name| FirstSpace {
            host: None,
            name,
            prefix: at,
            folder: space_folder,
            revisions: silverbullet_server_common::RevisionsMode::Managed,
            starter: None,
        }),
    };

    match run_setup(root, &req) {
        Ok(()) => {
            println!("Setup complete: admin \"{username}\" created");
            if let Some(space) = &req.space {
                println!("Space \"{}\" created at \"{}\"", space.name, space.prefix);
            }
            std::process::ExitCode::SUCCESS
        }
        Err(errors) => {
            for e in &errors {
                if e.field.is_empty() {
                    eprintln!("Error: {}", e.message);
                } else {
                    eprintln!("Error: {}: {}", e.field, e.message);
                }
            }
            std::process::ExitCode::FAILURE
        }
    }
}
