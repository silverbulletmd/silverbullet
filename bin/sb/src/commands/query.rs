use std::io::Write;

use crate::conn::SpaceConnection;
use crate::output::OutputMode;

use super::script;

/// Wrap a SLIQ expression in `return query[[...]]`.
pub fn wrap_query(sliq: &str) -> String {
    format!("return query[[{sliq}]]")
}

/// `query <sliq-expression>` — run a Space Lua Integrated Query.
///
/// Wraps `sliq` in `return query[[...]]` and delegates to [`script::run`].
pub fn run(
    conn: &SpaceConnection,
    sliq: &str,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    script::run(conn, &wrap_query(sliq), mode, out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_query_format() {
        let expr = r#"from t = index.tag "task" where not t.done"#;
        let wrapped = wrap_query(expr);
        assert_eq!(
            wrapped,
            format!("return query[[{expr}]]"),
            "wrap_query must produce `return query[[...]]`"
        );
    }

    #[test]
    fn wrap_query_empty_expression() {
        assert_eq!(wrap_query(""), "return query[[]]");
    }

    #[test]
    fn wrap_query_simple_expression() {
        assert_eq!(wrap_query("page"), "return query[[page]]");
    }
}
