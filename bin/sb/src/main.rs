use clap::Parser;
use sb::cli::Cli;

fn main() -> std::process::ExitCode {
    sb::run::run(Cli::parse())
}
