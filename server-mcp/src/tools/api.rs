//! The space operations' transport for the MCP: requests go in-process
//! through the host, as the caller.

use async_trait::async_trait;

use space_tools::ops::{SpaceApi, SpaceRequest, SpaceResponse};

use crate::host::McpHost;
use crate::tool::Caller;

pub(super) struct HostApi<'a> {
    pub host: &'a dyn McpHost,
    pub caller: &'a Caller,
    pub space: &'a str,
}

#[async_trait]
impl SpaceApi for HostApi<'_> {
    async fn send(&self, req: SpaceRequest) -> Result<SpaceResponse, String> {
        self.host
            .request(self.caller, self.space, req)
            .await
            .map_err(|e| e.to_string())
    }
}
