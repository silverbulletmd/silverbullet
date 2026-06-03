use clap::Parser;
use sb::cli::{Cli, Command};

fn main() {
    let cli = Cli::parse();
    let code = match run(cli) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("Error: {e}");
            1
        }
    };
    std::process::exit(code);
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Version => {
            println!(
                "{}",
                if sb::VERSION.is_empty() {
                    "dev"
                } else {
                    sb::VERSION
                }
            );
            Ok(())
        }
        _ => Err("not yet implemented".into()),
    }
}
