import { assert, assertEquals, assertExists } from "@std/assert";
import { TestServerManager } from "./test_server_manager.ts";

/**
 * Integration tests for SilverBullet's embedded MCP server
 * These tests verify the MCP HTTP transport and JSON-RPC protocol implementation
 */

interface McpInfo {
  mcp?: {
    enabled: boolean;
  };
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

class McpTestClient {
  constructor(private baseUrl: string) {}

  async checkMcpInfo(): Promise<McpInfo> {
    const response = await fetch(`${this.baseUrl}/.mcp`);
    assertEquals(response.ok, true, `MCP info endpoint should be accessible, got ${response.status}`);
    
    const text = await response.text();
    const info = JSON.parse(text) as McpInfo;
    assertExists(info, "MCP info response should be valid JSON");
    
    return info;
  }

  async sendJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request)
    });

    assertEquals(response.ok, true, `JSON-RPC request should succeed, got ${response.status}`);
    
    const result = await response.json() as JsonRpcResponse;
    assertEquals(result.jsonrpc, "2.0", "Response should be valid JSON-RPC 2.0");
    assertEquals(result.id, request.id, "Response ID should match request ID");
    
    return result;
  }
}

Deno.test("MCP HTTP Transport Integration", async () => {
  const testServer = new TestServerManager();

  try {
    // Start test server with MCP enabled
    await testServer.start({
      enableMcp: true,
      mcpAuthMode: "none"
    });

    const client = new McpTestClient(testServer.getBaseUrl());

    // Test 1: Check if MCP is enabled
    const info = await client.checkMcpInfo();
    assert(info.mcp?.enabled === true, "MCP should be enabled in test server");

    // Test 2: Send initialize request
    const initRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {
          roots: {
            listChanged: false
          }
        },
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      }
    };

    const initResponse = await client.sendJsonRpcRequest(initRequest);
    assertExists(initResponse.result, "Initialize should return a result");
    assertEquals(initResponse.error, undefined, "Initialize should not return an error");

    // Test 3: List available tools
    const toolsRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    };

    const toolsResponse = await client.sendJsonRpcRequest(toolsRequest);
    assertExists(toolsResponse.result, "Tools list should return a result");
    assertEquals(toolsResponse.error, undefined, "Tools list should not return an error");

    // Test 4: List available resources
    const resourcesRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list"
    };

    const resourcesResponse = await client.sendJsonRpcRequest(resourcesRequest);
    assertExists(resourcesResponse.result, "Resources list should return a result");  
    assertEquals(resourcesResponse.error, undefined, "Resources list should not return an error");
  } finally {
    await testServer.stop();
  }
});