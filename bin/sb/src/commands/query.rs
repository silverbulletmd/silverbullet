//! `sb query`: SLIQ wrapped as Space Lua; [`super::lua::run_query`] runs it.

/// Wrap a SLIQ expression in `return query[[...]]`.
pub fn wrap_query(sliq: &str) -> String {
    format!("return query[[{sliq}]]")
}

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
