use std::collections::BTreeSet;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

/// Always an MCP `CallToolResult` object.
pub type ToolResult = Value;

/// The authenticated party behind an MCP request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub username: String,
    pub credential: CallerCredential,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallerCredential {
    /// The owner of the machine the host runs on, who needs no credential:
    /// Desktop's local user. A multi-space server never yields one: its
    /// `/.mcp` takes OAuth grants only, and it gives such a caller no spaces.
    Local,
    /// An OAuth grant: the spaces the user consented to, and the credential
    /// version the grant was made under.
    Grant {
        grant_id: String,
        spaces: BTreeSet<String>,
        credential_version: Option<String>,
    },
}

impl Caller {
    pub fn local(username: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            credential: CallerCredential::Local,
        }
    }
}

pub struct ToolDef {
    pub name: &'static str,
    pub title: &'static str,
    pub description: String,
    pub input_schema: Value,
    pub annotations: Value,
}

#[async_trait]
pub trait ToolSet: Send + Sync {
    fn tools(&self) -> Vec<ToolDef>;
    fn instructions(&self) -> String;
    /// Build version reported as `serverInfo.version`.
    fn version(&self) -> String;
    async fn call(&self, caller: &Caller, name: &str, args: Value) -> ToolResult;
}

/// A tool an embedder adds to [`crate::Tools`], listed after the built-in
/// ones. It gets the arguments as sent.
#[async_trait]
pub trait ExtraTool: Send + Sync {
    fn def(&self) -> ToolDef;
    async fn call(&self, caller: &Caller, args: Value) -> ToolResult;
}

pub fn text_result(text: impl Into<String>) -> ToolResult {
    json!({ "content": [{ "type": "text", "text": text.into() }] })
}

/// Pretty JSON as text content for clients that ignore `structuredContent`.
pub fn json_result(value: Value) -> ToolResult {
    let text = serde_json::to_string_pretty(&value).unwrap_or_default();
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
    })
}

pub fn error_result(message: impl Into<String>) -> ToolResult {
    json!({
        "content": [{ "type": "text", "text": message.into() }],
        "isError": true,
    })
}

pub fn image_result(png: &[u8]) -> ToolResult {
    image_result_with_mime(png, "image/png")
}

pub fn image_result_with_mime(bytes: &[u8], mime: &str) -> ToolResult {
    json!({
        "content": [{
            "type": "image",
            "data": STANDARD.encode(bytes),
            "mimeType": mime,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_result_has_text_and_structured_content() {
        let r = json_result(json!({"a": 1}));
        assert_eq!(r["structuredContent"]["a"], 1);
        assert!(r["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"a\": 1"));
        assert!(r.get("isError").is_none());
    }

    #[test]
    fn error_and_image_results() {
        assert_eq!(error_result("boom")["isError"], true);
        let img = image_result(&[1, 2, 3]);
        assert_eq!(img["content"][0]["type"], "image");
        assert_eq!(img["content"][0]["data"], "AQID");
        assert_eq!(img["content"][0]["mimeType"], "image/png");
        let jpeg = image_result_with_mime(&[1, 2, 3], "image/jpeg");
        assert_eq!(jpeg["content"][0]["mimeType"], "image/jpeg");
    }
}
