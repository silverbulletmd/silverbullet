//! Output-mode resolution and value formatting.
//!
//! This is a pure library;
//! callers pass `is_tty` rather than probing the terminal themselves, so the
//! Desktop CLI can reuse the resolution logic unchanged.

use std::io::{self, Write};

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// Picks Text on a TTY, JSON otherwise.  Resolved away before `format`.
    Auto,
    /// Compact JSON + newline.
    Json,
    /// Human-friendly: strings verbatim, arrays/objects as table, else indented JSON.
    Text,
    /// Force table rendering.
    Table,
    /// One compact JSON value per line; arrays split element-per-line.
    Jsonl,
    /// YAML.
    Yaml,
}

/// Determine the output mode from the three flag inputs and stdout TTY state.
///
/// Precedence: `--json` > `--text` > `-o <output>` > TTY autodetect.
/// `output` values `"auto"` and `""` fall through to TTY autodetect.
/// Unknown `output` strings also fall through to TTY autodetect.
pub fn resolve_mode(json: bool, text: bool, output: &str, is_tty: bool) -> OutputMode {
    if json {
        return OutputMode::Json;
    }
    if text {
        return OutputMode::Text;
    }
    match output {
        "json" => return OutputMode::Json,
        "text" => return OutputMode::Text,
        "table" => return OutputMode::Table,
        "jsonl" => return OutputMode::Jsonl,
        "yaml" => return OutputMode::Yaml,
        "auto" | "" => {} // fall through to TTY autodetect
        _ => {}           // unknown → fall through
    }
    if is_tty {
        OutputMode::Text
    } else {
        OutputMode::Json
    }
}

/// Write `result` to `w` in the requested `mode`.
///
/// `Value::Null` writes nothing.  `OutputMode::Auto` is treated as indented
/// JSON (defensive fallback; callers should resolve it first).
pub fn format(w: &mut dyn Write, result: &Value, mode: OutputMode) -> io::Result<()> {
    if matches!(result, Value::Null) {
        return Ok(());
    }
    match mode {
        OutputMode::Json => write_json_compact(w, result),
        OutputMode::Jsonl => write_jsonl(w, result),
        OutputMode::Yaml => write_yaml(w, result),
        OutputMode::Table => write_table(w, result),
        OutputMode::Text => {
            if let Value::String(s) = result {
                return write_line(w, s);
            }
            match result {
                Value::Array(_) | Value::Object(_) => write_table(w, result),
                _ => write_json_indent(w, result),
            }
        }
        OutputMode::Auto => write_json_indent(w, result),
    }
}

fn write_line(w: &mut dyn Write, s: &str) -> io::Result<()> {
    if s.ends_with('\n') {
        write!(w, "{}", s)
    } else {
        writeln!(w, "{}", s)
    }
}

fn write_json_compact(w: &mut dyn Write, v: &Value) -> io::Result<()> {
    let s = serde_json::to_string(v).map_err(io::Error::other)?;
    writeln!(w, "{}", s)
}

fn write_json_indent(w: &mut dyn Write, v: &Value) -> io::Result<()> {
    let s = serde_json::to_string_pretty(v).map_err(io::Error::other)?;
    writeln!(w, "{}", s)
}

fn write_jsonl(w: &mut dyn Write, v: &Value) -> io::Result<()> {
    if let Value::Array(arr) = v {
        for item in arr {
            let s = serde_json::to_string(item).map_err(io::Error::other)?;
            writeln!(w, "{}", s)?;
        }
        Ok(())
    } else {
        write_json_compact(w, v)
    }
}

fn write_yaml(w: &mut dyn Write, v: &Value) -> io::Result<()> {
    let s =
        serde_yaml::to_string(v).map_err(|e| io::Error::other(format!("encoding YAML: {e}")))?;
    write!(w, "{}", s)
}

/// Preferred column order.  Columns not in this list come after, alphabetized.
const PREFERRED_COLUMNS: &[&str] = &[
    "tag",
    "ref",
    "name",
    "count",
    "done",
    "priority",
    "due",
    "page",
    "lastModified",
];

const MAX_TABLE_COLUMNS: usize = 8;
const MAX_CELL_WIDTH: usize = 40; // in runes (Unicode scalar values)

fn write_table(w: &mut dyn Write, v: &Value) -> io::Result<()> {
    match v {
        Value::Array(items) => write_table_list(w, items),
        Value::Object(obj) => write_table_object(w, obj),
        _ => write_json_indent(w, v),
    }
}

fn write_table_list(w: &mut dyn Write, items: &[Value]) -> io::Result<()> {
    if items.is_empty() {
        eprintln!("(no rows)");
        return Ok(());
    }

    let rows: Vec<&serde_json::Map<String, Value>> =
        items.iter().filter_map(|v| v.as_object()).collect();

    if rows.is_empty() {
        for item in items {
            let cell = format_cell(Some(item));
            writeln!(w, "{}", cell)?;
        }
        return Ok(());
    }

    let mut key_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for row in &rows {
        for k in row.keys() {
            key_set.insert(k.clone());
        }
    }
    let cols = pick_columns(&key_set);

    let mut widths: Vec<usize> = cols.iter().map(|c| char_count(c)).collect();
    for row in &rows {
        for (i, col) in cols.iter().enumerate() {
            let cell = format_cell(row.get(col));
            let w_cell = char_count(&cell);
            if w_cell > widths[i] {
                widths[i] = w_cell;
            }
        }
    }

    write_padded_row(w, &cols, &widths)?;
    for row in &rows {
        let cells: Vec<String> = cols.iter().map(|c| format_cell(row.get(c))).collect();
        write_padded_row(w, &cells, &widths)?;
    }

    Ok(())
}

fn write_table_object(w: &mut dyn Write, obj: &serde_json::Map<String, Value>) -> io::Result<()> {
    let mut keys: Vec<String> = obj.keys().cloned().collect();
    sort_keys_preferred(&mut keys);

    let key_width = keys.iter().map(|k| char_count(k)).max().unwrap_or(0);

    for k in &keys {
        let val = format_cell(obj.get(k));
        let padding = key_width - char_count(k) + 2;
        let pad_str = " ".repeat(padding);
        writeln!(w, "{}{}{}", k, pad_str, val)?;
    }

    Ok(())
}

/// Select up to `MAX_TABLE_COLUMNS` columns from `keys`:
/// preferred-order first (those present in the set), then remaining alphabetically.
fn pick_columns(keys: &std::collections::BTreeSet<String>) -> Vec<String> {
    let mut cols: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for &pref in PREFERRED_COLUMNS {
        if keys.contains(pref) && !seen.contains(pref) {
            cols.push(pref.to_string());
            seen.insert(pref.to_string());
        }
        if cols.len() >= MAX_TABLE_COLUMNS {
            return cols;
        }
    }

    for k in keys {
        if !seen.contains(k) {
            cols.push(k.clone());
            if cols.len() >= MAX_TABLE_COLUMNS {
                break;
            }
        }
    }

    cols
}

/// Sort `keys` in-place: preferred-order keys first (by their index in
/// `PREFERRED_COLUMNS`), then the rest alphabetically.
fn sort_keys_preferred(keys: &mut [String]) {
    let rank = |k: &str| -> Option<usize> { PREFERRED_COLUMNS.iter().position(|&p| p == k) };

    keys.sort_by(|a, b| match (rank(a), rank(b)) {
        (Some(ra), Some(rb)) => ra.cmp(&rb),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.cmp(b),
    });
}

/// Format a single table cell value.
///
/// - `None` / `Null` → `""`
/// - `String` → the string
/// - `Bool` / `Number` → display string
/// - `Array` / `Object` → compact JSON
///
/// Whitespace runs are collapsed to single spaces (split on whitespace, then
/// join with a single space).  If the result exceeds `MAX_CELL_WIDTH` runes it
/// is truncated to 39 runes + `"…"` (U+2026).
pub fn format_cell(v: Option<&Value>) -> String {
    let s = match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => {
            serde_json::to_string(v.unwrap()).unwrap_or_default()
        }
    };

    let collapsed: String = s.split_whitespace().collect::<Vec<&str>>().join(" ");

    let runes: Vec<char> = collapsed.chars().collect();
    if runes.len() > MAX_CELL_WIDTH {
        let mut truncated: String = runes[..MAX_CELL_WIDTH - 1].iter().collect();
        truncated.push('…');
        truncated
    } else {
        collapsed
    }
}

/// Count Unicode scalar values (chars) in a string.
#[inline]
fn char_count(s: &str) -> usize {
    s.chars().count()
}

/// Write a row of cells, padding each (except the last) to `width + 2` chars.
/// This replicates `text/tabwriter` with minwidth=0, tabwidth=4, padding=2.
fn write_padded_row(w: &mut dyn Write, cells: &[String], widths: &[usize]) -> io::Result<()> {
    let n = cells.len();
    for (i, cell) in cells.iter().enumerate() {
        if i == n - 1 {
            // Last column: no trailing padding.
            write!(w, "{}", cell)?;
        } else {
            let cell_chars = char_count(cell);
            let pad = widths[i].saturating_sub(cell_chars) + 2;
            write!(w, "{}{}", cell, " ".repeat(pad))?;
        }
    }
    writeln!(w)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_resolve_json_flag_wins() {
        assert_eq!(resolve_mode(true, true, "text", true), OutputMode::Json);
        assert_eq!(resolve_mode(true, false, "yaml", false), OutputMode::Json);
    }

    #[test]
    fn test_resolve_text_flag_over_output() {
        assert_eq!(resolve_mode(false, true, "json", true), OutputMode::Text);
        assert_eq!(resolve_mode(false, true, "yaml", false), OutputMode::Text);
    }

    #[test]
    fn test_resolve_output_flag_values() {
        assert_eq!(resolve_mode(false, false, "json", false), OutputMode::Json);
        assert_eq!(resolve_mode(false, false, "text", false), OutputMode::Text);
        assert_eq!(
            resolve_mode(false, false, "table", false),
            OutputMode::Table
        );
        assert_eq!(
            resolve_mode(false, false, "jsonl", false),
            OutputMode::Jsonl
        );
        assert_eq!(resolve_mode(false, false, "yaml", false), OutputMode::Yaml);
    }

    #[test]
    fn test_resolve_auto_tty() {
        assert_eq!(resolve_mode(false, false, "auto", true), OutputMode::Text);
        assert_eq!(resolve_mode(false, false, "auto", false), OutputMode::Json);
    }

    #[test]
    fn test_format_json_object() {
        let v = json!({"key": "value"});
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Json).unwrap();
        let s = String::from_utf8(buf).unwrap();
        assert!(s.ends_with('\n'));
        let trimmed = s.trim_end_matches('\n');
        let parsed: Value = serde_json::from_str(trimmed).unwrap();
        assert_eq!(parsed, v);
        assert_eq!(trimmed.lines().count(), 1);
    }

    #[test]
    fn test_format_null_writes_nothing() {
        let mut buf = Vec::new();
        format(&mut buf, &Value::Null, OutputMode::Json).unwrap();
        assert!(buf.is_empty());
    }

    #[test]
    fn test_format_jsonl_array() {
        let v = json!([{"a": 1}, {"b": 2}]);
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Jsonl).unwrap();
        let s = String::from_utf8(buf).unwrap();
        let lines: Vec<&str> = s.trim_end_matches('\n').lines().collect();
        assert_eq!(lines.len(), 2);
        let p0: Value = serde_json::from_str(lines[0]).unwrap();
        let p1: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(p0, json!({"a": 1}));
        assert_eq!(p1, json!({"b": 2}));
    }

    #[test]
    fn test_format_yaml_object() {
        let v = json!({"foo": "bar", "num": 42});
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Yaml).unwrap();
        let s = String::from_utf8(buf).unwrap();
        assert!(s.contains("foo: bar"), "got: {s}");
        assert!(s.contains("num: 42"), "got: {s}");
    }

    #[test]
    fn test_format_text_string() {
        let v = json!("hello");
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Text).unwrap();
        let s = String::from_utf8(buf).unwrap();
        assert_eq!(s, "hello\n");
    }

    #[test]
    fn test_format_table_array_of_objects_rows() {
        let v = json!([
            {"name": "Alice", "tag": "person"},
        ]);
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Table).unwrap();
        let s = String::from_utf8(buf).unwrap();
        let lines: Vec<&str> = s.lines().collect();
        assert_eq!(lines.len(), 2, "expected header + 1 row, got: {s}");
        assert!(lines[0].contains("tag"), "header should contain 'tag'");
        assert!(lines[1].contains("Alice"), "row should contain 'Alice'");
        assert!(lines[1].contains("person"), "row should contain 'person'");
    }

    #[test]
    fn test_format_text_array_of_objects_renders_table() {
        let v = json!([{"name": "Alice"}]);
        let mut buf = Vec::new();
        format(&mut buf, &v, OutputMode::Text).unwrap();
        let s = String::from_utf8(buf).unwrap();
        assert!(s.contains("name"), "table header should appear");
        assert!(s.contains("Alice"), "table row should appear");
    }

    #[test]
    fn test_format_cell_truncation() {
        let s: String = "a".repeat(41);
        let v = Value::String(s);
        let cell = format_cell(Some(&v));
        let chars: Vec<char> = cell.chars().collect();
        assert_eq!(chars.len(), 40, "should be 40 rune-chars (39 + ellipsis)");
        assert_eq!(*chars.last().unwrap(), '…');
    }
}
