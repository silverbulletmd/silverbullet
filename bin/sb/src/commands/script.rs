use std::io::Write;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

/// `script [code]` — execute a Lua script via `/.runtime/lua_script`.
pub fn run(
    conn: &SpaceConnection,
    code: &str,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let value = conn.eval_lua_script(code)?;
    output::format(out, &value, mode).map_err(|e| e.to_string())
}
