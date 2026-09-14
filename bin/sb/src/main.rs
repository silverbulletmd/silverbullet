use sb::cli::Cli;

fn main() -> std::process::ExitCode {
    match sb::fs_cli::parse::<Cli>() {
        Ok(cli) => sb::run::run(cli),
        Err(code) => code,
    }
}
