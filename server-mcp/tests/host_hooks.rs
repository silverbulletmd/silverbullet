//! The hooks a host adds to the tools: a path locator, a help note, and
//! tools of its own.

use std::sync::Arc;

use async_trait::async_trait;
use axum::http::{HeaderMap, StatusCode};
use serde_json::{json, Value};
use silverbullet_server_mcp::{
    text_result, Caller, ExtraTool, HostError, Located, McpHost, PathLocator, SpaceInfo,
    SpaceRequest, SpaceResponse, ToolDef, ToolResult, ToolSet, Tools,
};
use space_tools::help::{HelpData, Outline};

/// One space, `notes`, whose folder is `/work/notes`.
struct FolderHost {
    locates: bool,
}

impl PathLocator for FolderHost {
    fn locate(&self, _: &Caller, path: &str) -> Result<Located, String> {
        match path.strip_prefix("/work/notes/") {
            Some(file) => Ok(Located {
                space: "notes".into(),
                page: file.strip_suffix(".md").map(str::to_owned),
            }),
            None => Err(format!("`{path}` is not inside any space's folder.")),
        }
    }
}

#[async_trait]
impl McpHost for FolderHost {
    fn spaces(&self, _: &Caller) -> Vec<SpaceInfo> {
        vec![SpaceInfo {
            id: "notes".into(),
            name: "Notes".into(),
            runtime: true,
        }]
    }

    async fn request(
        &self,
        _: &Caller,
        _: &str,
        _: SpaceRequest,
    ) -> Result<SpaceResponse, HostError> {
        let data = HelpData {
            version: 1,
            runtime: true,
            scanning: false,
            skills: Vec::new(),
            outline: Outline {
                folders: Vec::new(),
                pages: Vec::new(),
                page_count: 0,
                agents: false,
                tags: Vec::new(),
            },
        };
        Ok(SpaceResponse {
            status: StatusCode::OK,
            headers: HeaderMap::new(),
            body: serde_json::to_vec(&data).unwrap(),
        })
    }

    fn locator(&self) -> Option<&dyn PathLocator> {
        self.locates.then_some(self)
    }

    fn help_note(&self, _: &Caller, space: Option<&str>) -> Option<String> {
        Some(format!(
            "Folder note for {}.",
            space.unwrap_or("all spaces")
        ))
    }
}

struct Ping(&'static str);

#[async_trait]
impl ExtraTool for Ping {
    fn def(&self) -> ToolDef {
        ToolDef {
            name: self.0,
            title: "Ping",
            description: "Answers pong.".into(),
            input_schema: json!({"type": "object"}),
            annotations: json!({}),
        }
    }

    async fn call(&self, _: &Caller, _: Value) -> ToolResult {
        text_result("pong")
    }
}

fn tools(locates: bool) -> Tools {
    Tools::new(Arc::new(FolderHost { locates }), "2.12.1")
}

fn caller() -> Caller {
    Caller::local("ada")
}

fn text(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap()
}

fn help_properties(tools: &Tools) -> Vec<String> {
    let help = tools
        .tools()
        .into_iter()
        .find(|t| t.name == "help")
        .unwrap();
    help.input_schema["properties"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

#[tokio::test]
async fn a_locator_gives_help_a_path_argument_and_a_host_note() {
    let tools = tools(true);
    assert!(help_properties(&tools).contains(&"path".to_owned()));
    let result = tools
        .call(&caller(), "help", json!({"path": "/work/notes/Plan.md"}))
        .await;
    let answer = text(&result);
    assert!(
        answer.starts_with("`/work/notes/Plan.md` is in space"),
        "{answer}"
    );
    assert!(answer.contains("Plan"), "{answer}");
    assert!(answer.ends_with("Folder note for notes."), "{answer}");

    let outside = tools
        .call(&caller(), "help", json!({"path": "/elsewhere/x.md"}))
        .await;
    assert_eq!(outside["isError"], true);
    assert!(text(&outside).contains("is not inside any space's folder"));
}

#[tokio::test]
async fn without_a_locator_help_refuses_path() {
    let tools = tools(false);
    assert!(!help_properties(&tools).contains(&"path".to_owned()));
    let result = tools
        .call(&caller(), "help", json!({"path": "/work/notes/Plan.md"}))
        .await;
    assert_eq!(result["isError"], true);
    assert!(text(&result).contains("path"), "{}", text(&result));
}

#[tokio::test]
async fn an_extra_tool_is_listed_last_and_called_with_its_arguments() {
    let tools = tools(false).with_tool(Arc::new(Ping("ping")));
    let names: Vec<_> = tools.tools().into_iter().map(|t| t.name).collect();
    assert_eq!(names.last(), Some(&"ping"));
    let result = tools.call(&caller(), "ping", json!({})).await;
    assert_eq!(text(&result), "pong");
}

#[test]
#[should_panic(expected = "already defined")]
fn an_extra_tool_cannot_reuse_a_built_in_name() {
    let _ = tools(false).with_tool(Arc::new(Ping("read")));
}
