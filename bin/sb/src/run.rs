//! Top-level dispatch for the `sb` CLI.
//!
//! `run` is the single entry point called by `main`.  It resolves flags into
//! a [`SpaceConnection`] and [`OutputMode`], then delegates to the individual
//! command modules.
//!
//! Both `resolve_conn` and `resolve_out` are `pub` so a downstream binary (the
//! App's CLI) can call the same command functions with a connection it built
//! itself, without going through this dispatch layer.

use std::io::{IsTerminal, Read};
use std::process::ExitCode;

use crate::cli::{Cli, Command, GlobalFlags};
use crate::commands;
use crate::config::{self, Config};
use crate::conn::{self, SpaceConnection};
use crate::output::{self, OutputMode};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

fn dispatch(cli: Cli) -> Result<ExitCode, String> {
    let g = cli.global.clone();
    match cli.command {
        Command::Version => {
            let v = if crate::VERSION.is_empty() {
                "dev"
            } else {
                crate::VERSION
            };
            println!("{v}");
            Ok(ExitCode::SUCCESS)
        }

        Command::Eval { expression } | Command::Lua { expression } => {
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let mut out = std::io::stdout().lock();
            commands::eval::run(&conn, &expression, mode, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }

        Command::Script { code, file } => {
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let script = if let Some(f) = file {
                read_file(&f)?
            } else if let Some(c) = code {
                c
            } else {
                read_stdin()?
            };
            let mut out = std::io::stdout().lock();
            commands::script::run(&conn, &script, mode, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }

        Command::LuaScript { file } => {
            // Hidden, old behavior: positional arg is a FILE path (not inline code).
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let script = if let Some(f) = file {
                read_file(&f)?
            } else {
                read_stdin()?
            };
            let mut out = std::io::stdout().lock();
            commands::script::run(&conn, &script, mode, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }

        Command::Query { expression } => {
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let mut out = std::io::stdout().lock();
            commands::query::run(&conn, &expression, mode, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }

        Command::Get(args) => {
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let mut out = std::io::stdout().lock();
            Ok(commands::get::run(&conn, &args, mode, &mut out))
        }
        Command::Describe { type_ } => {
            let conn = resolve_conn(&g)?;
            let mode = resolve_out(&g);
            let mut out = std::io::stdout().lock();
            commands::describe::run(&conn, type_.as_deref(), mode, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Logs { lines, follow } => {
            let conn = resolve_conn(&g)?;
            let mut out = std::io::stdout().lock();
            commands::logs::run(&conn, lines, follow, &mut out)?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Space(sub) => {
            match sub {
                crate::cli::SpaceCmd::Add => commands::space::space_add_interactive(None)?,
                crate::cli::SpaceCmd::Ls => commands::space::space_ls()?,
                crate::cli::SpaceCmd::Rm { name } => commands::space::space_rm(&name)?,
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Repl => {
            let conn = resolve_conn(&g)?;
            commands::repl::run(conn)?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Upgrade => {
            commands::upgrade::run(false)?;
            Ok(ExitCode::SUCCESS)
        }
        Command::UpgradeEdge => {
            commands::upgrade::run(true)?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers — pub so the App CLI can reuse them
// ---------------------------------------------------------------------------

/// Resolve a connection from the shared flags.
///
/// Avoids reading `config.json` when `--url` is supplied (mirrors Go
/// `connFromFlags`).
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

/// Read a file from `path`, mapping IO errors to a user-friendly message.
fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("reading {path}: {e}"))
}

/// Read all of stdin, printing a hint to stderr when stdin is a terminal
/// (mirrors Go `readStdin`).
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Verify that resolve_out delegates correctly (pure, no IO).
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
        // We can't test is_terminal() portably, but we can at least confirm the
        // helper doesn't panic and returns the right mode for --json.
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
        // Should succeed even with no config file present.
        let conn = resolve_conn(&g).expect("resolve_conn with --url should not fail");
        assert_eq!(conn.base_url, "http://127.0.0.1:9999");
    }
}
