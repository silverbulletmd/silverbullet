//! The standalone SilverBullet server binary. Boots the embedded client bundle
//! against a folder space over HTTP. The actual server lives in the `silverbullet`
//! library crate (`src/lib.rs`); this is just the CLI entry point.

use clap::Parser;
use silverbullet::{server, VERSION};

#[derive(clap::Parser)]
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
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();
    match server::run(cli.hostname, cli.port, cli.folder).await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            std::process::ExitCode::FAILURE
        }
    }
}
