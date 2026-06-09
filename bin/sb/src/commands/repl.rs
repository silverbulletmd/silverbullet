//! Interactive Lua REPL for the `sb` CLI.
//!
//! Provides an interactive read-eval-print loop backed by `rustyline`.

use std::time::Duration;

use rustyline::error::ReadlineError;
use rustyline::DefaultEditor;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

// ---------------------------------------------------------------------------
// is_incomplete
// ---------------------------------------------------------------------------

/// Heuristic: returns `true` if `code` has unclosed Lua blocks/brackets.
///
/// Whitespace-split tokens that EXACTLY equal
/// `do`/`function`/`if`/`repeat` add depth; `end`/`until` subtract; then
/// every `(` `[` `{` char adds and `)` `]` `}` char subtracts.
/// `depth > 0` → incomplete.
///
/// Exact-token matching is intentional — `end)` is NOT counted as the `end`
/// keyword; only its `)` char counts.
pub fn is_incomplete(code: &str) -> bool {
    let mut depth: i32 = 0;

    // Pass 1: whole-word token scan (split on whitespace)
    for word in code.split_whitespace() {
        match word {
            "do" | "function" | "if" | "repeat" => depth += 1,
            "end" | "until" => depth -= 1,
            _ => {}
        }
    }

    // Pass 2: character scan for brackets
    for ch in code.chars() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            _ => {}
        }
    }

    depth > 0
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

/// Start an interactive Lua REPL on the given [`SpaceConnection`].
///
/// The connection is taken by value (owned + mut) because `.timeout` may be
/// mutated by the `.timeout <n>` meta-command, which also rebuilds the
/// underlying reqwest client.
pub fn run(mut conn: SpaceConnection) -> Result<(), String> {
    let mut rl = DefaultEditor::new().map_err(|e| e.to_string())?;

    println!("SilverBullet Lua REPL. Type .exit or Ctrl-D to quit.");

    let mut prompt = String::from("lua> ");
    let mut script_mode = false;
    let mut script_buffer = String::new();
    let mut multi_line_buffer = String::new();

    loop {
        let readline = rl.readline(&prompt);
        match readline {
            Err(ReadlineError::Interrupted) => {
                // Ctrl-C: cancel current accumulation or exit
                if !multi_line_buffer.is_empty() || script_mode {
                    multi_line_buffer.clear();
                    script_mode = false;
                    script_buffer.clear();
                    prompt = "lua> ".into();
                    continue;
                }
                break;
            }
            Err(ReadlineError::Eof) => {
                // Ctrl-D: exit
                break;
            }
            Err(e) => {
                return Err(e.to_string());
            }
            Ok(line) => {
                let trimmed = line.trim().to_string();

                if trimmed == ".exit" {
                    break;
                }

                if trimmed == ".script" {
                    script_mode = true;
                    script_buffer.clear();
                    println!("Entering script mode. Type .end to execute.");
                    prompt = "...> ".into();
                    continue;
                }

                if script_mode {
                    if trimmed == ".end" {
                        script_mode = false;
                        prompt = "lua> ".into();
                        if !script_buffer.trim().is_empty() {
                            match conn.eval_lua_script(&script_buffer) {
                                Ok(v) => {
                                    let _ = output::format(
                                        &mut std::io::stdout().lock(),
                                        &v,
                                        OutputMode::Text,
                                    );
                                }
                                Err(e) => eprintln!("Error: {e}"),
                            }
                        }
                        continue;
                    }
                    // Append RAW line (not trimmed) + newline.
                    script_buffer.push_str(&line);
                    script_buffer.push('\n');
                    continue;
                }

                // .timeout <n> meta-command
                if let Some(rest) = trimmed.strip_prefix(".timeout ") {
                    let val: Result<i64, _> = rest.split_whitespace().next().unwrap_or("").parse();
                    match val {
                        Ok(n) if n > 0 => {
                            let secs = n as u64;
                            conn.timeout = Duration::from_secs(secs);
                            conn.client = crate::conn::new_client(conn.timeout)?;
                            println!("Timeout set to {n}s");
                        }
                        _ => eprintln!("Invalid timeout value"),
                    }
                    continue;
                }

                // Accumulate into multi-line buffer
                if multi_line_buffer.is_empty() {
                    multi_line_buffer = line.clone();
                } else {
                    multi_line_buffer.push('\n');
                    multi_line_buffer.push_str(&line);
                }

                if is_incomplete(&multi_line_buffer) {
                    prompt = "...> ".into();
                    continue;
                }

                // Complete expression — evaluate it
                let code = std::mem::take(&mut multi_line_buffer);
                prompt = "lua> ".into();

                if code.trim().is_empty() {
                    continue;
                }

                let is_multi = code.contains('\n');
                let result = if is_multi {
                    conn.eval_lua_script(&code)
                } else {
                    conn.eval_lua(&code)
                };

                match result {
                    Ok(v) => {
                        let _ = output::format(&mut std::io::stdout().lock(), &v, OutputMode::Text);
                    }
                    Err(e) => eprintln!("Error: {e}"),
                }
            }
        }
    }

    println!();
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests — is_incomplete (pure function, exhaustive)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::is_incomplete;

    #[test]
    fn if_then_is_incomplete() {
        assert!(is_incomplete("if x then"));
    }

    #[test]
    fn if_then_end_is_complete() {
        assert!(!is_incomplete("if x then end"));
    }

    #[test]
    fn print_call_is_complete() {
        assert!(!is_incomplete("print(1)"));
    }

    #[test]
    fn open_paren_is_incomplete() {
        assert!(is_incomplete("print("));
    }

    #[test]
    fn open_brace_is_incomplete() {
        assert!(is_incomplete("x = {"));
    }

    #[test]
    fn closed_braces_is_complete() {
        assert!(!is_incomplete("x = {}"));
    }

    #[test]
    fn for_do_is_incomplete() {
        // The `do` token triggers depth +1
        assert!(is_incomplete("for i = 1, 3 do"));
    }

    #[test]
    fn for_do_end_is_complete() {
        assert!(!is_incomplete("for i = 1, 3 do end"));
    }

    #[test]
    fn function_with_body_is_incomplete() {
        assert!(is_incomplete("function f()"));
    }

    #[test]
    fn function_full_definition_is_complete() {
        assert!(!is_incomplete("function f() end"));
    }

    #[test]
    fn repeat_alone_is_incomplete() {
        assert!(is_incomplete("repeat"));
    }

    #[test]
    fn repeat_until_is_complete() {
        assert!(!is_incomplete("repeat until x"));
    }

    #[test]
    fn empty_string_is_complete() {
        assert!(!is_incomplete(""));
    }

    #[test]
    fn simple_expression_is_complete() {
        assert!(!is_incomplete("1 + 1"));
    }

    /// Exact-token edge case: `end)` is NOT the `end` keyword (it's a different
    /// token), so depth comes only from the `)` char → depth == -1 → not >0 →
    /// false.  Documents the exact-token heuristic.
    #[test]
    fn end_paren_not_keyword() {
        assert!(!is_incomplete("end)"));
    }

    /// Similar: `endif` is not the `end` keyword.
    #[test]
    fn endif_not_end_keyword() {
        // `endif` won't decrement depth, but also nothing increments it.
        assert!(!is_incomplete("endif"));
    }

    /// Nested: `if … do … end` — should leave one unclosed `if`.
    #[test]
    fn nested_if_do_partial() {
        assert!(is_incomplete("if x then\n  for i = 1, 3 do\n  end"));
        // ^ if+1, do+1, end-1 = net +1 → incomplete
    }

    /// Balanced nested structures are complete.
    #[test]
    fn nested_balanced_complete() {
        assert!(!is_incomplete("if x then\n  for i = 1, 3 do\n  end\nend"));
    }
}
