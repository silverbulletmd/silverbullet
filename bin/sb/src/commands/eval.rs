use std::io::Write;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

/// `eval <expr>` — evaluate a Lua expression via `/.runtime/lua`.
pub fn run(
    conn: &SpaceConnection,
    expr: &str,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let value = conn.eval_lua(expr)?;
    output::format(out, &value, mode).map_err(|e| e.to_string())
}
