//! `describe` command — show available query types and tag schemas.

use std::collections::HashMap;
use std::io::Write;

use serde::Deserialize;

use crate::conn::SpaceConnection;
use crate::output::{self, OutputMode};

// ---------------------------------------------------------------------------
// Lua scripts — call the index.* schema introspection API (single source of
// truth in Core); whitespace-significant, do not reformat.
// ---------------------------------------------------------------------------

/// "describe all": raw JSON Schemas from the API plus the SLIQ reference syntax block.
const DESCRIBE_ALL_SCRIPT: &str = "
local page = space.readPage(\"Library/Std/Docs/SLIQ Reference\")
local parsed = index.extractFrontmatter(page, {removeFrontMatterSection = true})
return { schemas = index.describeSchema(), syntax = parsed.text }
";

/// "describe tag": one tag's raw JSON Schema (or nil). Exactly one `%s` for the tag name.
const DESCRIBE_TAG_BODY: &str = "
return index.tagSchema(\"%s\")
";

fn describe_all_script() -> String {
    DESCRIBE_ALL_SCRIPT.to_string()
}

fn describe_tag_script(tag: &str) -> String {
    DESCRIBE_TAG_BODY.replacen("%s", tag, 1)
}

// ---------------------------------------------------------------------------
// Typed shapes matching the Lua return values
// ---------------------------------------------------------------------------

/// Deserialized result of `describe all`: a map of tag name → JSON Schema plus
/// the SLIQ reference syntax text.
#[derive(Debug, Deserialize)]
struct DescribeAllResult {
    #[serde(default)]
    schemas: HashMap<String, serde_json::Value>,
    #[serde(default)]
    syntax: String,
}

// ---------------------------------------------------------------------------
// Internal property struct for text rendering (not from Lua)
// ---------------------------------------------------------------------------

/// A single property extracted from a JSON Schema `properties` object.
#[derive(Debug)]
struct TagProperty {
    name: String,
    type_: String,
    read_only: bool,
    nullable: bool,
    enum_values: Vec<String>,
}

// ---------------------------------------------------------------------------
// Presentation-layer extraction: JSON Schema → Vec<TagProperty>
// ---------------------------------------------------------------------------

/// Walk a JSON Schema object and extract its `properties` into a sorted Vec of
/// `TagProperty`. This is the flattening logic that used to live in
/// `schema_introspection.ts`.
fn extract_properties_from_schema(schema: &serde_json::Value) -> Vec<TagProperty> {
    let mut props = Vec::new();
    if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
        for (name, pdef) in properties {
            let type_str = match pdef.get("type") {
                Some(serde_json::Value::String(t)) => t.clone(),
                Some(_) => "mixed".to_string(),
                None => "any".to_string(),
            };
            let read_only = pdef
                .get("readOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let nullable = pdef
                .get("nullable")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let enum_values: Vec<String> = pdef
                .get("enum")
                .and_then(|e| e.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            props.push(TagProperty {
                name: name.clone(),
                type_: type_str,
                read_only,
                nullable,
                enum_values,
            });
        }
        props.sort_by(|a, b| a.name.cmp(&b.name));
    }
    props
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

    let mut tag_names: Vec<&String> = result.schemas.keys().collect();
    tag_names.sort();

    for tag_name in &tag_names {
        let schema = &result.schemas[*tag_name];
        let props = extract_properties_from_schema(schema);
        let summary = summarize_props(&props);
        writeln!(out, "  {:<18} {}", tag_name, summary).map_err(|e| e.to_string())?;
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

    if raw.is_null() {
        return Err(format!("Unknown tag: {tag}"));
    }

    if mode == OutputMode::Json {
        return output::format(out, &raw, OutputMode::Json).map_err(|e| e.to_string());
    }

    // `raw` is a raw JSON Schema value.
    let additional_properties = raw
        .get("additionalProperties")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    writeln!(out, "Type: {}", tag).map_err(|e| e.to_string())?;
    if additional_properties {
        writeln!(
            out,
            "Accepts additional properties (e.g. frontmatter fields)"
        )
        .map_err(|e| e.to_string())?;
    }
    writeln!(out).map_err(|e| e.to_string())?;

    let props = extract_properties_from_schema(&raw);

    if props.is_empty() {
        writeln!(out, "No schema defined.").map_err(|e| e.to_string())?;
        return Ok(());
    }

    writeln!(out, "Properties:").map_err(|e| e.to_string())?;
    for prop in &props {
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

fn summarize_props(props: &[TagProperty]) -> String {
    if props.is_empty() {
        return String::new();
    }
    let names: Vec<&str> = props.iter().map(|p| p.name.as_str()).collect();
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
    fn describe_tag_script_calls_api() {
        let script = describe_tag_script("task");
        assert!(
            script.contains("index.tagSchema(\"task\")"),
            "should call index.tagSchema with the substituted tag name"
        );
        assert!(!script.contains("%s"), "no remaining %s placeholder");
    }

    // -----------------------------------------------------------------------
    // describe_all_script
    // -----------------------------------------------------------------------

    #[test]
    fn describe_all_script_calls_api() {
        let script = describe_all_script();
        assert!(
            script.contains("index.describeSchema()"),
            "should call index.describeSchema()"
        );
        assert!(
            script.contains("return { schemas = index.describeSchema(), syntax = parsed.text }"),
            "should return schemas + syntax"
        );
    }

    // -----------------------------------------------------------------------
    // extract_properties_from_schema
    // -----------------------------------------------------------------------

    #[test]
    fn extract_properties_sorts_by_name() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "properties": {
                "z_prop": { "type": "string" },
                "a_prop": { "type": "boolean" },
                "m_prop": { "type": "number" }
            }
        });
        let props = extract_properties_from_schema(&schema);
        let names: Vec<&str> = props.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["a_prop", "m_prop", "z_prop"]);
    }

    #[test]
    fn extract_properties_handles_readonly_nullable_enum() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "properties": {
                "perm": { "type": "string", "readOnly": true, "enum": ["ro", "rw"] },
                "itags": { "type": "array", "nullable": true }
            }
        });
        let props = extract_properties_from_schema(&schema);
        let perm = props.iter().find(|p| p.name == "perm").unwrap();
        assert!(perm.read_only);
        assert_eq!(perm.enum_values, vec!["ro", "rw"]);
        let itags = props.iter().find(|p| p.name == "itags").unwrap();
        assert!(itags.nullable);
    }

    #[test]
    fn extract_properties_missing_type_is_any() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "properties": {
                "deadline": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
            }
        });
        let props = extract_properties_from_schema(&schema);
        assert_eq!(props[0].type_, "any");
    }

    #[test]
    fn extract_properties_non_string_type_is_mixed() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "properties": {
                "complex": { "type": ["string", "null"] }
            }
        });
        let props = extract_properties_from_schema(&schema);
        assert_eq!(props[0].type_, "mixed");
    }

    #[test]
    fn extract_properties_empty_schema_returns_empty() {
        let schema: Value = serde_json::json!({ "type": "object" });
        let props = extract_properties_from_schema(&schema);
        assert!(props.is_empty());
    }

    // -----------------------------------------------------------------------
    // summarize_props
    // -----------------------------------------------------------------------

    fn make_props(names: &[&str]) -> Vec<TagProperty> {
        names
            .iter()
            .map(|n| TagProperty {
                name: n.to_string(),
                type_: "string".to_string(),
                read_only: false,
                nullable: false,
                enum_values: vec![],
            })
            .collect()
    }

    #[test]
    fn summarize_empty_returns_empty_string() {
        assert_eq!(summarize_props(&[]), "");
    }

    #[test]
    fn summarize_three_props() {
        let props = make_props(&["a", "b", "c"]);
        assert_eq!(summarize_props(&props), "a, b, c");
    }

    #[test]
    fn summarize_seven_props_truncates_to_five() {
        let props = make_props(&["a", "b", "c", "d", "e", "f", "g"]);
        let result = summarize_props(&props);
        assert_eq!(result, "a, b, c, d, e, ...");
        assert!(result.ends_with(", ..."));
    }

    // -----------------------------------------------------------------------
    // describe_all text rendering (new schema-map shape)
    // -----------------------------------------------------------------------

    #[test]
    fn describe_all_text_renders_header_and_tags() {
        let raw: Value = serde_json::json!({
            "schemas": {
                "task": {
                    "type": "object",
                    "additionalProperties": true,
                    "properties": {
                        "done": { "type": "boolean" },
                        "due": { "type": "string" }
                    }
                },
                "page": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    }
                }
            },
            "syntax": ""
        });

        // Exercise the text rendering path directly via serde parse + render
        let result: DescribeAllResult = serde_json::from_value(raw).unwrap();
        let mut buf: Vec<u8> = Vec::new();

        writeln!(buf, "SilverBullet Query Reference").unwrap();
        writeln!(buf).unwrap();
        writeln!(buf, "Available object types:").unwrap();
        let mut tag_names: Vec<&String> = result.schemas.keys().collect();
        tag_names.sort();
        for tag_name in &tag_names {
            let schema = &result.schemas[*tag_name];
            let props = extract_properties_from_schema(schema);
            let summary = summarize_props(&props);
            writeln!(buf, "  {:<18} {}", tag_name, summary).unwrap();
        }
        writeln!(buf).unwrap();
        writeln!(buf, "Run 'sb describe <type>' for full schema.").unwrap();

        let out = String::from_utf8(buf).unwrap();
        assert!(out.contains("SilverBullet Query Reference"));
        assert!(out.contains("Available object types:"));
        assert!(out.contains("task"));
        assert!(out.contains("done, due"));
        assert!(out.contains("page"));
        assert!(out.contains("name"));
        assert!(out.contains("Run 'sb describe <type>' for full schema."));
    }

    // -----------------------------------------------------------------------
    // describe_tag text rendering (new raw-schema shape)
    // -----------------------------------------------------------------------

    #[test]
    fn describe_tag_text_renders_properties() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "done": { "type": "boolean", "readOnly": false, "nullable": false },
                "priority": { "type": "number", "readOnly": true, "nullable": false },
                "status": {
                    "type": "string",
                    "readOnly": false,
                    "nullable": true,
                    "enum": ["open", "closed"]
                }
            }
        });

        let additional_properties = schema
            .get("additionalProperties")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let props = extract_properties_from_schema(&schema);

        let mut buf: Vec<u8> = Vec::new();
        writeln!(buf, "Type: task").unwrap();
        if additional_properties {
            writeln!(
                buf,
                "Accepts additional properties (e.g. frontmatter fields)"
            )
            .unwrap();
        }
        writeln!(buf).unwrap();
        writeln!(buf, "Properties:").unwrap();
        for prop in &props {
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
    // Deserialization contract for the new API shape
    // -----------------------------------------------------------------------

    #[test]
    fn deserializes_describe_schema_payload_as_schema_map() {
        // Shape returned by `return { schemas = index.describeSchema(), syntax = "..." }`
        let raw: Value = serde_json::json!({
            "schemas": {
                "task": {
                    "type": "object",
                    "additionalProperties": true,
                    "properties": {
                        "done": { "type": "boolean", "readOnly": true },
                        "state": { "type": "string", "readOnly": true }
                    }
                }
            },
            "syntax": ""
        });
        let result: DescribeAllResult = serde_json::from_value(raw).unwrap();
        assert!(result.schemas.contains_key("task"));
        let task_schema = &result.schemas["task"];
        let props = extract_properties_from_schema(task_schema);
        let done = props
            .iter()
            .find(|p| p.name == "done")
            .expect("task has a 'done' property");
        assert_eq!(done.type_, "boolean");
        assert!(done.read_only);
    }

    #[test]
    fn deserializes_tag_schema_as_raw_json_value() {
        // Shape returned by `return index.tagSchema("task")`
        let raw: Value = serde_json::json!({
            "type": "object",
            "additionalProperties": true,
            "properties": {
                "done": { "type": "boolean", "readOnly": true, "nullable": false }
            }
        });
        // Not null, so we proceed to render
        assert!(!raw.is_null());
        let props = extract_properties_from_schema(&raw);
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].name, "done");
        assert_eq!(props[0].type_, "boolean");
        assert!(props[0].read_only);
    }
}
