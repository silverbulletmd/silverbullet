import { CopyButton } from "@silverbulletmd/silverbullet/ui";
import { useState } from "preact/hooks";
import { mcpEndpointUrl, mcpSetupSnippets } from "../mcp.ts";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <h4>{label}</h4>
      <div class="sb-copy-field">
        <pre>{text}</pre>
        <CopyButton
          copied={copied}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        />
      </div>
    </div>
  );
}

/** How to connect an MCP client, shown once MCP is on. */
export function McpSetup() {
  const url = mcpEndpointUrl(location.origin);
  const snippets = mcpSetupSnippets(url);
  return (
    <section>
      <h3>Connect a client</h3>
      <p class="sb-help-text">
        Connect MCP clients through OAuth, using the client's "add server" flow.
        API tokens do not work at this endpoint.
      </p>
      <CopyBlock label="Endpoint URL" text={url} />
      <CopyBlock label="Codex" text={snippets.codex} />
      <CopyBlock label="Claude Code" text={snippets.claudeCode} />
      <CopyBlock label="Claude.ai or ChatGPT" text={snippets.connector} />
    </section>
  );
}
