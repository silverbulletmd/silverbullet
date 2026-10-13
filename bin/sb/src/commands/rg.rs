use super::fs::operational;
use crate::conn::SpaceConnection;
use crate::fs_api::{FsError, RgResponse};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::{ErrorKind, IsTerminal, Read, Write};
use std::process::ExitCode;

const STDIN_CAP: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Decoded {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: u8,
    pub notice: Option<&'static str>,
}

/// Decodes a search response into rg output without any I/O.
pub fn decode(response: &RgResponse) -> Result<Decoded, FsError> {
    let decode = |text: &str| {
        STANDARD.decode(text).map_err(|e| {
            FsError::new(
                "invalid_response",
                format!("Server returned an invalid search response: {e}"),
                8,
            )
        })
    };
    let notice = if response.timed_out {
        Some("sb: search stopped at the server's time limit; output is incomplete")
    } else if response.truncated {
        Some("sb: search output reached the server's size limit; output is incomplete")
    } else {
        None
    };
    Ok(Decoded {
        stdout: decode(&response.stdout_base64)?,
        stderr: decode(&response.stderr_base64)?,
        // A negative code means rg was killed by a signal; report a generic failure.
        exit_code: u8::try_from(response.exit_code.min(255)).unwrap_or(2),
        notice,
    })
}

fn write_quietly(mut out: impl Write, data: &[u8]) -> Result<(), FsError> {
    match out.write_all(data).and_then(|()| out.flush()) {
        Err(e) if e.kind() != ErrorKind::BrokenPipe => Err(operational(e)),
        _ => Ok(()),
    }
}

pub fn run(conn: &SpaceConnection, args: &[String]) -> Result<ExitCode, FsError> {
    // Heuristic: only the plain spellings of "read patterns from stdin" are recognized.
    let reads_stdin = args
        .iter()
        .any(|a| a == "-" || a == "--file=-" || a == "-f-");
    let mut stdin_base64 = None;
    if reads_stdin && !std::io::stdin().is_terminal() {
        let mut input = Vec::new();
        std::io::stdin()
            .take(STDIN_CAP as u64 + 1)
            .read_to_end(&mut input)
            .map_err(operational)?;
        if input.len() > STDIN_CAP {
            return Err(operational("Search stdin exceeds 1 MiB"));
        }
        stdin_base64 = Some(STANDARD.encode(&input));
    }
    let decoded = decode(&conn.search_rg(args, stdin_base64)?)?;
    write_quietly(std::io::stdout().lock(), &decoded.stdout)?;
    write_quietly(std::io::stderr().lock(), &decoded.stderr)?;
    if let Some(notice) = decoded.notice {
        let _ = writeln!(std::io::stderr(), "{notice}");
    }
    Ok(ExitCode::from(decoded.exit_code))
}

#[cfg(test)]
mod tests {
    use super::{RgResponse, STANDARD};
    use crate::cli::{Cli, Command, CoreCommand};
    use crate::fs_cli::FsCommand;
    use base64::Engine;
    use clap::Parser;

    #[test]
    fn native_arguments_survive_cli_parsing() {
        let cli = Cli::try_parse_from([
            "sb",
            "fs",
            "rg",
            "--",
            "--json",
            "-ni",
            "--glob=*.md",
            "invoice",
            ".",
        ])
        .unwrap();
        let Some(Command::Core(CoreCommand::Fs(FsCommand::Rg { args }))) = cli.command else {
            panic!("Expected rg command");
        };
        assert_eq!(args, ["--json", "-ni", "--glob=*.md", "invoice", "."]);
    }

    fn response(exit_code: i32, timed_out: bool) -> RgResponse {
        RgResponse {
            exit_code,
            stdout_base64: STANDARD.encode("a\n"),
            stderr_base64: String::new(),
            truncated: false,
            timed_out,
        }
    }

    #[test]
    fn success_decodes_streams_and_clamps_exit_code() {
        let d = super::decode(&response(1, true)).unwrap();
        assert_eq!((d.stdout.as_slice(), d.exit_code), (&b"a\n"[..], 1));
        assert!(d.notice.unwrap().contains("time limit"));
        assert_eq!(super::decode(&response(999, false)).unwrap().exit_code, 255);
        assert_eq!(super::decode(&response(-1, false)).unwrap().exit_code, 2);
    }

    #[test]
    fn truncated_output_has_its_own_notice() {
        let mut r = response(0, false);
        r.truncated = true;
        assert!(super::decode(&r)
            .unwrap()
            .notice
            .unwrap()
            .contains("size limit"));
    }

    #[test]
    fn invalid_base64_is_an_invalid_response() {
        let mut r = response(0, false);
        r.stdout_base64 = "!!".into();
        assert_eq!(super::decode(&r).unwrap_err().code, "invalid_response");
    }
}
