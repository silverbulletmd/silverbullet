//! Top-level dispatch for the `sb` CLI.
//!
//! `run` is the single entry point called by `main`.  It resolves flags into
//! a [`SpaceConnection`] and [`OutputMode`], then delegates to the individual
//! command modules.
//!
//! Both `resolve_conn` and `resolve_out` are `pub` so a downstream binary (the
//! Desktop CLI) can call the same command functions with a connection it built
//! itself, without going through this dispatch layer.

use std::io::{IsTerminal, Read};
use std::process::ExitCode;

use crate::cli::{Cli, Command, CoreCommand, GlobalFlags, SpaceCmd};
use crate::commands;
use crate::config::{self, Config};
use crate::conn::{self, SpaceConnection};
use crate::local;
use crate::output::{self, OutputMode};

/// Top-level entry: dispatch and map errors to an exit code.  `main` calls this.
pub fn run(cli: Cli) -> ExitCode {
    match dispatch(cli) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn dispatch(cli: Cli) -> Result<ExitCode, String> {
    let mut g = cli.global.clone();
    if cli.open_path.is_some() && cli.command.is_some() {
        let message = "An open path cannot be combined with a subcommand";
        if matches!(&cli.command, Some(Command::Core(CoreCommand::Fs(_)))) {
            return Ok(commands::fs::report_error(
                &g,
                crate::fs_api::FsError::new("invalid_arguments", message, 2),
            ));
        }
        return Err(message.into());
    }
    match cli.command {
        None => match cli.open_path {
            Some(path) if !std::path::Path::new(&path).exists() => Err(format!(
                "unrecognized subcommand or missing path '{path}'; run sb --help for commands"
            )),
            Some(path) => open(Some(&path)),
            None => {
                // Without Desktop, a bare `sb` keeps showing help.
                if local::desktop_host(&config::config_dir()).is_ok() {
                    open(None)
                } else {
                    use clap::CommandFactory;
                    Cli::command()
                        .print_help()
                        .map_err(|e| format!("printing help: {e}"))?;
                    Ok(ExitCode::SUCCESS)
                }
            }
        },
        Some(Command::Open { path }) => open(path.as_deref()),
        Some(Command::Version) => {
            let v = if crate::VERSION.is_empty() {
                "dev"
            } else {
                crate::VERSION
            };
            println!("{v}");
            Ok(ExitCode::SUCCESS)
        }
        Some(Command::Space(sub)) => {
            match sub {
                SpaceCmd::Add {
                    path_or_url,
                    name,
                    auth,
                    username,
                    no_browser,
                } => match path_or_url {
                    Some(folder)
                        if !folder.starts_with("http://") && !folder.starts_with("https://") =>
                    {
                        commands::space::space_add_folder(&folder)?
                    }
                    url => commands::space::space_add_remote(commands::space::AddOptions {
                        url,
                        name,
                        auth,
                        username,
                        no_browser,
                    })?,
                },
                SpaceCmd::Login { name, no_browser } => {
                    commands::space::space_login(&name, no_browser)?
                }
                SpaceCmd::Ls { all } => commands::space::space_ls(all)?,
                SpaceCmd::Rm { name } => commands::space::space_rm(&name)?,
            }
            Ok(ExitCode::SUCCESS)
        }
        Some(Command::Core(CoreCommand::Fs(cmd))) => {
            let prepared = commands::fs::validate(&g, &cmd).and_then(|()| {
                local::prepare(&mut g, false).map_err(|error| {
                    crate::fs_api::FsError::new(
                        if error.authentication {
                            "authentication_required"
                        } else {
                            "connection_failed"
                        },
                        error.message,
                        if error.authentication { 4 } else { 8 },
                    )
                })
            });
            if let Err(error) = prepared {
                return Ok(commands::fs::report_error(&g, error));
            }
            Ok(commands::fs::run(&g, cmd))
        }
        Some(Command::Core(cmd)) => {
            if cmd.needs_connection() {
                local::prepare(&mut g, true).map_err(|error| error.message)?;
            }
            run_core_command(&g, cmd)
        }
    }
}

/// Start SilverBullet Desktop, opening `path` when given.
fn open(path: Option<&str>) -> Result<ExitCode, String> {
    let host = local::desktop_host(&config::config_dir()).map_err(|error| error.message)?;
    local::launch(&host, path.map(std::path::Path::new))?;
    Ok(ExitCode::SUCCESS)
}

/// Dispatch one of the [`CoreCommand`]s shared with the Desktop CLI. The
/// connection and output mode are resolved lazily from `g` — the upgrade
/// variants never need one (check `CoreCommand::needs_connection`).
pub fn run_core_command(g: &GlobalFlags, cmd: CoreCommand) -> Result<ExitCode, String> {
    match cmd {
        CoreCommand::Fs(command) => Ok(commands::fs::run(g, command)),
        CoreCommand::Upgrade => {
            commands::upgrade::run(false)?;
            Ok(ExitCode::SUCCESS)
        }
        CoreCommand::UpgradeEdge => {
            commands::upgrade::run(true)?;
            Ok(ExitCode::SUCCESS)
        }
        cmd => {
            let conn = resolve_conn(g)?;
            let mode = resolve_out(g);
            let mut out = std::io::stdout().lock();
            match cmd {
                CoreCommand::Eval { expression } | CoreCommand::Lua { expression } => {
                    commands::eval::run(&conn, &expression, mode, &mut out)?
                }
                CoreCommand::Script { code, file } => {
                    let script = if let Some(f) = file {
                        read_file(&f)?
                    } else if let Some(c) = code {
                        c
                    } else {
                        read_stdin()?
                    };
                    commands::script::run(&conn, &script, mode, &mut out)?
                }
                CoreCommand::LuaScript { file } => {
                    // This alias interprets its positional argument as a file path.
                    let script = if let Some(f) = file {
                        read_file(&f)?
                    } else {
                        read_stdin()?
                    };
                    commands::script::run(&conn, &script, mode, &mut out)?
                }
                CoreCommand::Query { expression } => {
                    commands::query::run(&conn, &expression, mode, &mut out)?
                }
                CoreCommand::Logs { lines, follow } => {
                    commands::logs::run(&conn, lines, follow, &mut out)?
                }
                CoreCommand::Screenshot {
                    file,
                    selector,
                    full_page,
                } => {
                    if full_page {
                        commands::screenshot::run_full_page(&conn, &file, mode, &mut out)?
                    } else {
                        commands::screenshot::run(
                            &conn,
                            &file,
                            selector.as_deref(),
                            mode,
                            &mut out,
                        )?
                    }
                }
                CoreCommand::Fs(_) | CoreCommand::Upgrade | CoreCommand::UpgradeEdge => {
                    unreachable!("handled above")
                }
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}

/// Resolve a connection from the shared flags.
///
/// Avoids reading `config.json` when `--url` is supplied.
pub fn resolve_conn(g: &GlobalFlags) -> Result<SpaceConnection, String> {
    let cfg: Config = if g.url.is_some() {
        Config::default()
    } else {
        config::load()?
    };
    conn::resolve(g, &cfg)
}

/// Resolve the output mode from the shared flags + stdout TTY state.
pub fn resolve_out(g: &GlobalFlags) -> OutputMode {
    output::resolve_mode(g.json, g.text, &g.output, std::io::stdout().is_terminal())
}

fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("reading {path}: {e}"))
}

/// Read all of stdin, printing a hint to stderr when stdin is a terminal.
fn read_stdin() -> Result<String, String> {
    if std::io::stdin().is_terminal() {
        eprintln!("Reading from stdin, press Ctrl-D when done.");
    }
    let mut s = String::new();
    std::io::stdin()
        .read_to_string(&mut s)
        .map_err(|e| format!("reading stdin: {e}"))?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_out_json_flag() {
        let g = GlobalFlags {
            space: None,
            url: None,
            token: None,
            timeout: 30,
            json: true,
            text: false,
            output: "auto".to_string(),
        };
        let mode = output::resolve_mode(g.json, g.text, &g.output, false);
        assert_eq!(mode, OutputMode::Json);
    }

    #[test]
    fn resolve_out_text_flag() {
        let g = GlobalFlags {
            space: None,
            url: None,
            token: None,
            timeout: 30,
            json: false,
            text: true,
            output: "auto".to_string(),
        };
        let mode = output::resolve_mode(g.json, g.text, &g.output, false);
        assert_eq!(mode, OutputMode::Text);
    }

    #[test]
    fn unknown_words_are_not_opened_as_paths() {
        use clap::Parser;
        for word in ["describe", "lint", "get"] {
            let cli = Cli::try_parse_from(["sb", word]).unwrap();
            let err = dispatch(cli).unwrap_err();
            assert!(err.contains("unrecognized subcommand"), "{word}: {err}");
        }
    }

    #[test]
    fn open_path_cannot_be_combined_with_a_subcommand() {
        use clap::Parser;
        let cli = Cli::try_parse_from(["sb", "./notes", "eval", "1"]).unwrap();
        assert_eq!(
            dispatch(cli).unwrap_err(),
            "An open path cannot be combined with a subcommand"
        );
    }

    /// resolve_conn with --url set should NOT try to load config.json
    /// (so it works even in an environment with no config file).
    #[test]
    fn resolve_conn_url_skips_config() {
        let g = GlobalFlags {
            space: None,
            url: Some("http://127.0.0.1:9999".to_string()),
            token: Some("tok".to_string()),
            timeout: 5,
            json: false,
            text: false,
            output: "auto".to_string(),
        };
        let conn = resolve_conn(&g).expect("resolve_conn with --url should not fail");
        assert_eq!(conn.base_url, "http://127.0.0.1:9999");
    }
}
