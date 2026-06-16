//! The standalone SilverBullet server binary. Serves the embedded client bundle
//! against a folder space over HTTP. The actual server lives in the `silverbullet`
//! library crate (`src/lib.rs`), this is just the CLI entry point.

use clap::{Parser, Subcommand};
use silverbullet::{server, VERSION};
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
    /// The space folder to serve (env: SB_FOLDER)
    folder: Option<String>,
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
}

fn main() -> std::process::ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            // Default to `info`, but silence chromiumoxide's noisy `WARN`s. With
            // current Chrome it floods the log with "WS Invalid message: data did
            // not match any variant of untagged enum Message" for CDP events its
            // bundled protocol types don't recognize — harmless (command
            // responses still work), so keep only its errors. `RUST_LOG` overrides.
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,chromiumoxide=error".into()),
        )
        .init();

    let cli = Cli::parse();

    // Subcommands run synchronously and outside a Tokio runtime — the upgrade
    // variants self-replace this executable using `reqwest::blocking`, which
    // panics inside a runtime. Handle them before the server path builds one.
    if let Some(command) = cli.command {
        return run_subcommand(command);
    }

    // Server path: build a multi-threaded Tokio runtime and serve until shutdown.
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
        match server::run(cli.hostname, cli.port, cli.folder).await {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                tracing::error!("{e}");
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
