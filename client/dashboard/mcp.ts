export function mcpEndpointUrl(origin: string): string {
  return `${origin}/.mcp`;
}

export function mcpSetupSnippets(url: string): {
  codex: string;
  claudeCode: string;
  connector: string;
} {
  return {
    codex: `codex mcp add silverbullet --url ${url}\ncodex mcp login silverbullet`,
    claudeCode: `claude mcp add --transport http silverbullet ${url}`,
    connector: `In Claude.ai or ChatGPT, add a custom connector with the URL ${url}. The server must be reachable over HTTPS.`,
  };
}
