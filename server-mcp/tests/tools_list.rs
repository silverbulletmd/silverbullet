//! The tool definitions clients see in `tools/list`, pinned: names, titles,
//! descriptions, annotations and every input schema.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use silverbullet_server_mcp::{
    Caller, HostError, McpHost, SpaceInfo, SpaceRequest, SpaceResponse, ToolSet, Tools,
};

struct NoSpaces;

#[async_trait]
impl McpHost for NoSpaces {
    fn spaces(&self, _caller: &Caller) -> Vec<SpaceInfo> {
        Vec::new()
    }
    async fn request(
        &self,
        _caller: &Caller,
        space: &str,
        _req: SpaceRequest,
    ) -> Result<SpaceResponse, HostError> {
        Err(HostError::NotAvailable(space.to_owned()))
    }
}

fn tools_list() -> Value {
    let tools = Tools::new(Arc::new(NoSpaces), "2.12.1");
    let defs: Vec<Value> = tools
        .tools()
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
                "inputSchema": t.input_schema,
                "annotations": t.annotations,
            })
        })
        .collect();
    json!({ "tools": defs })
}

#[test]
fn tools_list_matches_the_snapshot() {
    let expected: Value = serde_json::from_str(include_str!("fixtures/tools_list.json")).unwrap();
    let actual = tools_list();
    if std::env::var_os("UPDATE_TOOLS_LIST").is_some() {
        let pretty = serde_json::to_string_pretty(&actual).unwrap();
        std::fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/tools_list.json"
            ),
            pretty + "\n",
        )
        .unwrap();
        return;
    }
    // Key order within a schema may differ from the snapshot's; clients
    // don't depend on it.
    assert!(
        actual == expected,
        "tools/list changed:\n{}",
        serde_json::to_string_pretty(&actual).unwrap()
    );
}
