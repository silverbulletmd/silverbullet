//! Tool arguments: each tool's are a struct that serde parses and schemars
//! describes, so the schema clients see and the parser cannot drift apart.

use std::borrow::Cow;

use schemars::generate::SchemaSettings;
use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::de::{DeserializeOwned, Error as _};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use super::reply::ToolError;

/// Shared by every tool that takes a space.
pub const SPACE: &str = "Space name or id, as listed by `help`.";

/// `T`'s JSON Schema as a tool's `inputSchema`: inlined, without the
/// meta-schema and title, and with optional fields typed as their value (a
/// `null` is accepted, but not advertised).
pub(super) fn input_schema<T: JsonSchema>() -> Value {
    let mut settings = SchemaSettings::draft2020_12();
    settings.inline_subschemas = true;
    settings.meta_schema = None;
    let mut schema = settings
        .into_generator()
        .into_root_schema_for::<T>()
        .to_value();
    tidy(&mut schema);
    let Value::Object(mut root) = schema else {
        unreachable!("an argument struct's schema is an object");
    };
    let mut ordered = Map::new();
    for key in ["type", "properties", "required", "additionalProperties"] {
        if let Some(value) = root.remove(key) {
            ordered.insert(key.to_owned(), value);
        }
    }
    Value::Object(ordered)
}

/// Drops the `null` that `Option` adds to a type or an enum, in a schema and
/// the schemas of its properties and items.
fn tidy(schema: &mut Value) {
    let Value::Object(object) = schema else {
        return;
    };
    if let Some(Value::Array(types)) = object.get_mut("type") {
        types.retain(|t| t != "null");
        if let [only] = types.as_slice() {
            let only = only.clone();
            object.insert("type".to_owned(), only);
        }
    }
    if let Some(Value::Array(values)) = object.get_mut("enum") {
        values.retain(|v| !v.is_null());
    }
    if let Some(Value::Object(properties)) = object.get_mut("properties") {
        properties.values_mut().for_each(tidy);
    }
    if let Some(items) = object.get_mut("items") {
        tidy(items);
    }
}

/// A count of at least 1, such as a line or result limit.
#[derive(Clone, Copy)]
pub(super) struct Count(pub usize);

impl<'de> Deserialize<'de> for Count {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match u64::deserialize(deserializer) {
            Ok(n) if n >= 1 => Ok(Count(usize::try_from(n).unwrap_or(usize::MAX))),
            _ => Err(D::Error::custom("expected an integer of at least 1")),
        }
    }
}

impl JsonSchema for Count {
    fn schema_name() -> Cow<'static, str> {
        "Count".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "integer", "minimum": 1 })
    }
}

/// Parses a tool's arguments; the error names the argument at fault, and an
/// argument the schema doesn't list is refused (a misspelled `dryRun` must
/// not write).
pub(super) fn parse<T: DeserializeOwned>(args: Value) -> Result<T, ToolError> {
    serde_path_to_error::deserialize(args).map_err(|e| {
        let path = e.path().to_string();
        let inner = e.into_inner();
        ToolError::new(if path == "." {
            format!("invalid arguments: {inner}")
        } else {
            format!("invalid argument \"{path}\": {inner}")
        })
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[derive(Deserialize, JsonSchema)]
    #[serde(rename_all = "camelCase")]
    #[serde(deny_unknown_fields)]
    #[allow(dead_code)]
    struct Example {
        /// Where.
        space: String,
        first_line: Option<Count>,
        kind: Option<Kind>,
        /// Output format.
        format: Option<String>,
    }

    #[derive(Deserialize, JsonSchema)]
    #[serde(rename_all = "lowercase")]
    enum Kind {
        One,
        Two,
    }

    #[test]
    fn schema_is_plain_and_optional_fields_are_not_nullable() {
        assert_eq!(
            input_schema::<Example>(),
            json!({
                "type": "object",
                "properties": {
                    "space": { "type": "string", "description": "Where." },
                    "firstLine": { "type": "integer", "minimum": 1 },
                    "kind": { "type": "string", "enum": ["one", "two"] },
                    "format": { "type": "string", "description": "Output format." },
                },
                "required": ["space"],
                "additionalProperties": false,
            })
        );
    }

    #[test]
    fn errors_name_the_argument() {
        let missing = parse::<Example>(json!({})).err().unwrap();
        assert_eq!(
            missing.message(),
            "invalid arguments: missing field `space`"
        );
        let zero = parse::<Example>(json!({"space": "s", "firstLine": 0}))
            .err()
            .unwrap();
        assert_eq!(
            zero.message(),
            "invalid argument \"firstLine\": expected an integer of at least 1"
        );
        let extra = parse::<Example>(json!({"space": "s", "first_line": 1}))
            .err()
            .unwrap();
        assert!(
            extra.message().contains("unknown field `first_line`"),
            "{}",
            extra.message()
        );
    }
}
