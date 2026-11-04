import { expect, test } from "vitest";
import { mcpEndpointUrl, mcpSetupSnippets } from "./mcp.ts";

const ORIGIN = "https://notes.example.test";

test("the endpoint is /.mcp on the page origin", () => {
  expect(mcpEndpointUrl(ORIGIN)).toBe("https://notes.example.test/.mcp");
});

test("setup snippets point clients at the endpoint", () => {
  const url = mcpEndpointUrl(ORIGIN);
  expect(mcpSetupSnippets(url)).toEqual({
    codex: `codex mcp add silverbullet --url ${url}\ncodex mcp login silverbullet`,
    claudeCode: `claude mcp add --transport http silverbullet ${url}`,
    connector: `In Claude.ai or ChatGPT, add a custom connector with the URL ${url}. The server must be reachable over HTTPS.`,
  });
});
