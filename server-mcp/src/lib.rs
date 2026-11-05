//! MCP (Model Context Protocol) layer without sessions: JSON-RPC dispatch
//! over a single `/.mcp` endpoint. Tools and authentication are supplied by
//! the embedder through [`ToolSet`] and [`Authenticate`]. The only state kept
//! between calls is [`Tools`]' list of script reloads to retry.

mod host;
mod instructions;
mod multi_host;
mod protocol;
mod tool;
mod tools;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;

pub use host::{
    forward, HostError, Located, McpHost, PathLocator, SpaceInfo, SpaceRequest, SpaceResponse,
    FORWARDED_HEADERS,
};
pub use instructions::instructions;
pub use multi_host::MultiHost;
pub use protocol::{AuthFailure, Authenticate};
pub use server_space_tools::ops::IndexStatus;
pub use server_space_tools::paths::{is_page_name, page_to_path, path_to_page, MAX_RESULT_BYTES};
pub use server_space_tools::skills::{bundled_skills, parse_skill, Skill, SkillSource};
pub use tool::{
    error_result, image_result, image_result_with_mime, json_result, text_result, Caller,
    CallerCredential, ExtraTool, ToolDef, ToolResult, ToolSet,
};

pub use tools::{parse_tool_args, tool_input_schema, Tools, PAGE_DESCRIPTION, SPACE_DESCRIPTION};

const BODY_LIMIT: usize = 16 * 1024 * 1024;

/// Router that mounts the MCP endpoint at `/.mcp`.
pub fn mcp_router(tools: Arc<dyn ToolSet>, auth: Arc<dyn Authenticate>) -> Router {
    let state = protocol::McpState { tools, auth };
    Router::new()
        .route("/.mcp", any(protocol::handle))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

/// Like [`mcp_router`], but answers 404 whenever `enabled` returns false, so
/// a toggle flipped at runtime takes effect on the next request.
pub fn mcp_router_gated(
    tools: Arc<dyn ToolSet>,
    auth: Arc<dyn Authenticate>,
    enabled: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Router {
    mcp_router(tools, auth).layer(axum::middleware::from_fn(
        move |req: axum::extract::Request, next: axum::middleware::Next| {
            let enabled = enabled.clone();
            async move {
                if enabled() {
                    next.run(req).await
                } else {
                    axum::http::StatusCode::NOT_FOUND.into_response()
                }
            }
        },
    ))
}
