//! What a tool returns, typed until [`into_result`] turns it into the MCP
//! `CallToolResult` at the edge.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};

use crate::tool::{error_result, ToolResult};

pub(super) enum Content {
    Text(String),
    Image { bytes: Vec<u8>, mime: &'static str },
}

pub(super) struct Reply {
    pub content: Vec<Content>,
    pub structured: Option<Value>,
    /// Whether `structured` gets the text content as its `text` field.
    echo_text: bool,
}

/// A tool error: its text, returned with `isError`.
#[derive(Debug)]
pub(super) struct ToolError(String);

pub(super) type Outcome = Result<Reply, ToolError>;

impl ToolError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }
}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

impl From<&str> for ToolError {
    fn from(message: &str) -> Self {
        Self(message.to_owned())
    }
}

impl Reply {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            content: vec![Content::Text(text.into())],
            structured: None,
            echo_text: false,
        }
    }

    pub fn image(bytes: Vec<u8>, mime: &'static str) -> Self {
        Self {
            content: vec![Content::Image { bytes, mime }],
            structured: None,
            echo_text: false,
        }
    }

    pub fn with_structured(mut self, structured: impl Serialize) -> Self {
        self.structured =
            Some(serde_json::to_value(structured).expect("structured content serialises"));
        self
    }

    /// Like [`Self::with_structured`] for metadata that leaves out what the
    /// text says: the final text content is added to it as `text`. Some
    /// clients (Claude Code among them) show only `structuredContent` when it
    /// is present.
    pub fn with_meta(mut self, meta: impl Serialize) -> Self {
        self = self.with_structured(meta);
        self.echo_text = true;
        self
    }

    pub fn push_text(&mut self, text: impl Into<String>) {
        self.content.push(Content::Text(text.into()));
    }

    /// Puts `header` and a blank line before the first content item, when
    /// that is text.
    pub fn prepend(mut self, header: &str) -> Self {
        if let Some(Content::Text(text)) = self.content.first_mut() {
            *text = format!("{header}\n\n{text}");
        }
        self
    }

    /// Puts a blank line and `text` after the last text item, if any.
    pub fn append(mut self, text: &str) -> Self {
        let last = self.content.iter_mut().rev().find_map(|item| match item {
            Content::Text(last) => Some(last),
            Content::Image { .. } => None,
        });
        if let Some(last) = last {
            *last = format!("{last}\n\n{text}");
        }
        self
    }
}

pub(super) fn into_result(outcome: Outcome) -> ToolResult {
    let reply = match outcome {
        Ok(reply) => reply,
        Err(ToolError(message)) => return error_result(message),
    };
    let echoed = reply.echo_text.then(|| {
        reply
            .content
            .iter()
            .filter_map(|item| match item {
                Content::Text(text) => Some(text.as_str()),
                Content::Image { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    });
    let content: Vec<Value> = reply
        .content
        .into_iter()
        .map(|item| match item {
            Content::Text(text) => json!({ "type": "text", "text": text }),
            Content::Image { bytes, mime } => json!({
                "type": "image",
                "data": STANDARD.encode(bytes),
                "mimeType": mime,
            }),
        })
        .collect();
    let mut result = json!({ "content": content });
    if let Some(mut structured) = reply.structured {
        if let Some(text) = echoed {
            structured["text"] = json!(text);
        }
        result["structuredContent"] = structured;
    }
    result
}
