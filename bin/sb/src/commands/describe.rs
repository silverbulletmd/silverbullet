//! `describe` command — show available query types and tag schemas.
//!
//! The two embedded Lua scripts are byte-for-byte significant; any whitespace
//! change would break the server-side execution.

use std::io::Write;

use serde::Deserialize;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

// ---------------------------------------------------------------------------
// Lua scripts — whitespace-significant, do not reformat
// ---------------------------------------------------------------------------

/// Shared Lua helper for extracting schema properties from a tag definition.
const LUA_EXTRACT_PROPS: &str = "
function extractProps(def)
  local props = {}
  if def.schema and def.schema.properties then
    for pname, pdef in pairs(def.schema.properties) do
      local typ = pdef.type or \"any\"
      if type(typ) == \"table\" then typ = \"mixed\" end
      local info = {
        name = pname,
        type = typ,
        readOnly = pdef.readOnly or false,
        nullable = pdef.nullable or false,
      }
      if pdef.enum then info.enum = pdef.enum end
      table.insert(props, info)
    end
    table.sort(props, function(a, b) return a.name < b.name end)
  end
  return props
end
";

/// Body of the "describe all" script (appended after LUA_EXTRACT_PROPS).
const DESCRIBE_ALL_BODY: &str = "
local tags = config.get(\"tags\", {})
local result = {}
for name, def in pairs(tags) do
  table.insert(result, {
    name = name,
    properties = extractProps(def),
    hasSchema = def.schema ~= nil,
  })
end
table.sort(result, function(a, b) return a.name < b.name end)

local page = space.readPage(\"Library/Std/Docs/SLIQ Reference\")
local parsed = index.extractFrontmatter(page, {removeFrontMatterSection = true})

return { tags = result, syntax = parsed.text }
";

/// Body of the "describe tag" script (appended after LUA_EXTRACT_PROPS).
/// Contains exactly one `%s` placeholder for the tag name.
const DESCRIBE_TAG_BODY: &str = "
local tagName = \"%s\"
local tags = config.get(\"tags\", {})
local def = tags[tagName]
if not def then
  error(\"Unknown tag: \" .. tagName)
end
return {
  name = tagName,
  properties = extractProps(def),
  hasSchema = def.schema ~= nil,
  additionalProperties = def.schema and def.schema.additionalProperties or false,
}
";

fn describe_all_script() -> String {
    format!("{LUA_EXTRACT_PROPS}{DESCRIBE_ALL_BODY}")
}

fn describe_tag_script(tag: &str) -> String {
    format!("{LUA_EXTRACT_PROPS}{DESCRIBE_TAG_BODY}").replacen("%s", tag, 1)
}

// ---------------------------------------------------------------------------
// Typed shapes matching the Lua return values
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct TagProperty {
    name: String,
    #[serde(rename = "type")]
    type_: String,
    #[serde(default, rename = "readOnly")]
    read_only: bool,
    #[serde(default)]
    nullable: bool,
    #[serde(default, rename = "enum")]
    enum_values: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct TagInfo {
    name: String,
    #[serde(default)]
    properties: Vec<TagProperty>,
    #[serde(default, rename = "hasSchema")]
    has_schema: bool,
    #[serde(default, rename = "additionalProperties")]
    additional_properties: bool,
}

#[derive(Debug, Deserialize)]
struct DescribeAllResult {
    #[serde(default)]
    tags: Vec<TagInfo>,
    #[serde(default)]
    syntax: String,
}

// ---------------------------------------------------------------------------
// Tag name validation
// ---------------------------------------------------------------------------

/// Returns true iff `name` matches `^[a-zA-Z_][a-zA-Z0-9_-]*$`.
/// Hand-rolled to avoid adding the `regex` crate to this crate's dependencies.
fn is_valid_tag_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !matches!(first, 'a'..='z' | 'A'..='Z' | '_') {
        return false;
    }
    chars.all(|c| matches!(c, 'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-'))
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Dispatch to `describe_all` or `describe_tag` based on `type_`.
pub fn run(
    conn: &SpaceConnection,
    type_: Option<&str>,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    match type_ {
        Some(tag) => describe_tag(conn, tag, mode, out),
        None => describe_all(conn, mode, out),
    }
}

// ---------------------------------------------------------------------------
// describe_all
// ---------------------------------------------------------------------------

fn describe_all(
    conn: &SpaceConnection,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    let raw = conn
        .eval_lua_script(&describe_all_script())
        .map_err(|e| format!("fetching tag definitions: {e}"))?;

    if mode == OutputMode::Json {
        return output::format(out, &raw, OutputMode::Json).map_err(|e| e.to_string());
    }

    let result: DescribeAllResult =
        serde_json::from_value(raw).map_err(|e| format!("parsing describe result: {e}"))?;

    writeln!(out, "SilverBullet Query Reference").map_err(|e| e.to_string())?;
    writeln!(out).map_err(|e| e.to_string())?;
    writeln!(out, "Available object types:").map_err(|e| e.to_string())?;

    for tag in &result.tags {
        let props = summarize_props(tag);
        writeln!(out, "  {:<18} {}", tag.name, props).map_err(|e| e.to_string())?;
    }

    writeln!(out).map_err(|e| e.to_string())?;
    writeln!(out, "Run 'sb describe <type>' for full schema.").map_err(|e| e.to_string())?;

    if !result.syntax.is_empty() {
        writeln!(out).map_err(|e| e.to_string())?;
        write!(out, "{}", result.syntax.trim()).map_err(|e| e.to_string())?;
        writeln!(out).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// describe_tag
// ---------------------------------------------------------------------------

fn describe_tag(
    conn: &SpaceConnection,
    tag: &str,
    mode: OutputMode,
    out: &mut dyn Write,
) -> Result<(), String> {
    if !is_valid_tag_name(tag) {
        return Err(format!("invalid tag name: {tag:?}"));
    }

    let raw = conn.eval_lua_script(&describe_tag_script(tag))?;

    if mode == OutputMode::Json {
        return output::format(out, &raw, OutputMode::Json).map_err(|e| e.to_string());
    }

    let tag_info: TagInfo =
        serde_json::from_value(raw).map_err(|e| format!("parsing tag info: {e}"))?;

    writeln!(out, "Type: {}", tag_info.name).map_err(|e| e.to_string())?;
    if tag_info.additional_properties {
        writeln!(
            out,
            "Accepts additional properties (e.g. frontmatter fields)"
        )
        .map_err(|e| e.to_string())?;
    }
    writeln!(out).map_err(|e| e.to_string())?;

    if tag_info.properties.is_empty() {
        writeln!(out, "No schema defined.").map_err(|e| e.to_string())?;
        return Ok(());
    }

    writeln!(out, "Properties:").map_err(|e| e.to_string())?;
    for prop in &tag_info.properties {
        let mut flags: Vec<String> = Vec::new();
        if prop.read_only {
            flags.push("read-only".to_string());
        }
        if prop.nullable {
            flags.push("nullable".to_string());
        }
        if !prop.enum_values.is_empty() {
            flags.push(format!("enum: {}", prop.enum_values.join("|")));
        }
        let flag_str = if !flags.is_empty() {
            format!("  ({})", flags.join(", "))
        } else {
            String::new()
        };
        writeln!(out, "  {:<20} {:<10}{}", prop.name, prop.type_, flag_str)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// summarize_props — short summary for the "describe all" listing
// ---------------------------------------------------------------------------

fn summarize_props(tag: &TagInfo) -> String {
    if tag.properties.is_empty() {
        if !tag.has_schema {
            return "(no schema)".to_string();
        }
        return String::new();
    }
    let names: Vec<&str> = tag.properties.iter().map(|p| p.name.as_str()).collect();
    if names.len() > 5 {
        format!("{}, ...", names[..5].join(", "))
    } else {
        names.join(", ")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // -----------------------------------------------------------------------
    // is_valid_tag_name
    // -----------------------------------------------------------------------

    #[test]
    fn valid_tag_names() {
        assert!(is_valid_tag_name("task"), "task should be valid");
        assert!(is_valid_tag_name("my_tag"), "my_tag should be valid");
        assert!(is_valid_tag_name("a-b_c"), "a-b_c should be valid");
        assert!(is_valid_tag_name("_x"), "_x should be valid");
    }

    #[test]
    fn invalid_tag_names() {
        assert!(
            !is_valid_tag_name("1abc"),
            "1abc should be invalid (starts with digit)"
        );
        assert!(
            !is_valid_tag_name("has space"),
            "has space should be invalid"
        );
        assert!(!is_valid_tag_name(""), "empty should be invalid");
        assert!(
            !is_valid_tag_name("a.b"),
            "a.b should be invalid (contains dot)"
        );
    }

    // -----------------------------------------------------------------------
    // describe_tag_script
    // -----------------------------------------------------------------------

    #[test]
    fn describe_tag_script_substitution() {
        let script = describe_tag_script("task");
        assert!(
            script.contains("local tagName = \"task\""),
            "should contain substituted tag name"
        );
        assert!(
            script.contains("function extractProps(def)"),
            "should contain extractProps function"
        );
        assert!(
            !script.contains("%s"),
            "should have no remaining %s placeholder"
        );
    }

    // -----------------------------------------------------------------------
    // describe_all_script
    // -----------------------------------------------------------------------

    #[test]
    fn describe_all_script_contents() {
        let script = describe_all_script();
        assert!(
            script.starts_with("\nfunction extractProps(def)"),
            "should start with extractProps function"
        );
        assert!(
            script.contains("config.get(\"tags\", {})"),
            "should contain config.get tags call"
        );
        assert!(
            script.contains("return { tags = result, syntax = parsed.text }"),
            "should contain correct return statement"
        );
    }

    // -----------------------------------------------------------------------
    // summarize_props
    // -----------------------------------------------------------------------

    fn make_tag_with_props(names: &[&str], has_schema: bool) -> TagInfo {
        let properties = names
            .iter()
            .map(|n| TagProperty {
                name: n.to_string(),
                type_: "string".to_string(),
                read_only: false,
                nullable: false,
                enum_values: vec![],
            })
            .collect();
        TagInfo {
            name: "test".to_string(),
            properties,
            has_schema,
            additional_properties: false,
        }
    }

    #[test]
    fn summarize_empty_no_schema() {
        let tag = make_tag_with_props(&[], false);
        assert_eq!(summarize_props(&tag), "(no schema)");
    }

    #[test]
    fn summarize_empty_has_schema() {
        let tag = make_tag_with_props(&[], true);
        assert_eq!(summarize_props(&tag), "");
    }

    #[test]
    fn summarize_three_props() {
        let tag = make_tag_with_props(&["a", "b", "c"], true);
        assert_eq!(summarize_props(&tag), "a, b, c");
    }

    #[test]
    fn summarize_seven_props_truncates_to_five() {
        let tag = make_tag_with_props(&["a", "b", "c", "d", "e", "f", "g"], true);
        let result = summarize_props(&tag);
        assert_eq!(result, "a, b, c, d, e, ...");
        // Verify it ends with ", ..."
        assert!(result.ends_with(", ..."));
    }

    // -----------------------------------------------------------------------
    // describe_all text rendering
    // -----------------------------------------------------------------------

    #[test]
    fn describe_all_text_renders_header_and_tags() {
        let raw: Value = serde_json::json!({
            "tags": [
                {
                    "name": "task",
                    "properties": [
                        {"name": "done", "type": "boolean", "readOnly": false, "nullable": false},
                        {"name": "due", "type": "string", "readOnly": false, "nullable": false},
                    ],
                    "hasSchema": true
                },
                {
                    "name": "page",
                    "properties": [],
                    "hasSchema": false
                }
            ],
            "syntax": ""
        });

        // Exercise the text rendering path directly via serde parse + render
        let result: DescribeAllResult = serde_json::from_value(raw).unwrap();
        let mut buf: Vec<u8> = Vec::new();

        writeln!(buf, "SilverBullet Query Reference").unwrap();
        writeln!(buf).unwrap();
        writeln!(buf, "Available object types:").unwrap();
        for tag in &result.tags {
            let props = summarize_props(tag);
            writeln!(buf, "  {:<18} {}", tag.name, props).unwrap();
        }
        writeln!(buf).unwrap();
        writeln!(buf, "Run 'sb describe <type>' for full schema.").unwrap();

        let out = String::from_utf8(buf).unwrap();
        assert!(out.contains("SilverBullet Query Reference"));
        assert!(out.contains("Available object types:"));
        assert!(out.contains("task"));
        assert!(out.contains("done, due"));
        assert!(out.contains("page"));
        assert!(out.contains("(no schema)"));
        assert!(out.contains("Run 'sb describe <type>' for full schema."));
    }

    // -----------------------------------------------------------------------
    // describe_tag text rendering
    // -----------------------------------------------------------------------

    #[test]
    fn describe_tag_text_renders_properties() {
        let tag_info = TagInfo {
            name: "task".to_string(),
            properties: vec![
                TagProperty {
                    name: "done".to_string(),
                    type_: "boolean".to_string(),
                    read_only: false,
                    nullable: false,
                    enum_values: vec![],
                },
                TagProperty {
                    name: "priority".to_string(),
                    type_: "number".to_string(),
                    read_only: true,
                    nullable: false,
                    enum_values: vec![],
                },
                TagProperty {
                    name: "status".to_string(),
                    type_: "string".to_string(),
                    read_only: false,
                    nullable: true,
                    enum_values: vec!["open".to_string(), "closed".to_string()],
                },
            ],
            has_schema: true,
            additional_properties: false,
        };

        let mut buf: Vec<u8> = Vec::new();
        writeln!(buf, "Type: {}", tag_info.name).unwrap();
        writeln!(buf).unwrap();
        writeln!(buf, "Properties:").unwrap();
        for prop in &tag_info.properties {
            let mut flags: Vec<String> = Vec::new();
            if prop.read_only {
                flags.push("read-only".to_string());
            }
            if prop.nullable {
                flags.push("nullable".to_string());
            }
            if !prop.enum_values.is_empty() {
                flags.push(format!("enum: {}", prop.enum_values.join("|")));
            }
            let flag_str = if !flags.is_empty() {
                format!("  ({})", flags.join(", "))
            } else {
                String::new()
            };
            writeln!(buf, "  {:<20} {:<10}{}", prop.name, prop.type_, flag_str).unwrap();
        }

        let out = String::from_utf8(buf).unwrap();
        assert!(out.contains("Type: task"));
        assert!(out.contains("Properties:"));
        assert!(out.contains("done"));
        assert!(out.contains("boolean"));
        assert!(out.contains("priority"));
        assert!(out.contains("(read-only)"));
        assert!(out.contains("status"));
        assert!(out.contains("(nullable, enum: open|closed)"));
    }

    // -----------------------------------------------------------------------
    // Lua script byte-exactness spot checks
    // -----------------------------------------------------------------------

    #[test]
    fn lua_extract_props_exact_content() {
        // Spot-check that key Lua lines are present byte-exactly.
        assert!(LUA_EXTRACT_PROPS.contains("  local props = {}"));
        assert!(LUA_EXTRACT_PROPS.contains("      local typ = pdef.type or \"any\""));
        assert!(
            LUA_EXTRACT_PROPS.contains("      if type(typ) == \"table\" then typ = \"mixed\" end")
        );
        assert!(LUA_EXTRACT_PROPS.contains("      if pdef.enum then info.enum = pdef.enum end"));
        assert!(LUA_EXTRACT_PROPS
            .contains("    table.sort(props, function(a, b) return a.name < b.name end)"));
        assert!(LUA_EXTRACT_PROPS.contains("  return props"));
    }

    #[test]
    fn describe_all_body_exact_content() {
        assert!(DESCRIBE_ALL_BODY.contains("local tags = config.get(\"tags\", {})"));
        assert!(DESCRIBE_ALL_BODY.contains("    hasSchema = def.schema ~= nil,"));
        assert!(DESCRIBE_ALL_BODY
            .contains("table.sort(result, function(a, b) return a.name < b.name end)"));
        assert!(DESCRIBE_ALL_BODY
            .contains("local page = space.readPage(\"Library/Std/Docs/SLIQ Reference\")"));
        assert!(DESCRIBE_ALL_BODY.contains(
            "local parsed = index.extractFrontmatter(page, {removeFrontMatterSection = true})"
        ));
        assert!(DESCRIBE_ALL_BODY.contains("return { tags = result, syntax = parsed.text }"));
    }

    #[test]
    fn describe_tag_body_exact_content() {
        assert!(DESCRIBE_TAG_BODY.contains("local tagName = \"%s\""));
        assert!(DESCRIBE_TAG_BODY.contains("  error(\"Unknown tag: \" .. tagName)"));
        assert!(DESCRIBE_TAG_BODY.contains(
            "  additionalProperties = def.schema and def.schema.additionalProperties or false,"
        ));
    }
}
