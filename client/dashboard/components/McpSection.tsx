import {
  Alert,
  Button,
  CheckboxField,
  CopyButton,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { adminApi, apiErrorText, getServerInfo } from "../api.ts";
import { mcpEndpointUrl, mcpSetupSnippets } from "../mcp.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { mcpUnavailableReason } from "../runtime_availability.ts";
import { ConnectedApps } from "./ConnectedApps.tsx";

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

export function McpSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [mcp, setMcp] = useState<boolean | null>(null);
  const [runtimeApi, setRuntimeApi] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [runtimeBlocked, setRuntimeBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const notify = useNotification("mcp");
  const url = mcpEndpointUrl(location.origin);
  const snippets = mcpSetupSnippets(url);

  function fail(cause: unknown) {
    const text = apiErrorText(cause, onUnauthorized);
    if (text !== null) setError(text);
  }

  useEffect(() => {
    void getServerInfo()
      .then((info) => {
        setReason(mcpUnavailableReason(info.mcp));
        setRuntimeBlocked(info.runtimeApi.status !== "available");
      })
      .catch(fail);
    void adminApi("GET", "server-config")
      .then((config) => {
        setMcp(config.mcp);
        setRuntimeApi(config.runtimeApi);
      })
      .catch(fail);
  }, []);

  async function save() {
    if (mcp === null) return;
    setSaving(true);
    setError("");
    notify("");
    try {
      const config = await adminApi("PUT", "server-config", { mcp });
      setMcp(config.mcp);
      notify("MCP setting saved.");
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>MCP</h2>
      {error && <Alert variant="error">{error}</Alert>}
      {mcp === null && !error && <p>Loading settings…</p>}
      {mcp !== null && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <SaveConfirmation scope="mcp" />
            <CheckboxField
              label="Enable MCP"
              checked={mcp}
              disabled={reason !== null}
              onChange={(event) => setMcp(event.currentTarget.checked)}
            />
            {reason && <p class="sb-help-text">{reason}</p>}
            <Button
              type="submit"
              variant="primary"
              disabled={saving || reason !== null}
            >
              Save
            </Button>
          </form>
          {mcp && (
            <>
              {(!runtimeApi || runtimeBlocked) && (
                <Alert variant="warning">
                  The runtime API is off, so the <code>lua</code> and{" "}
                  <code>screenshot</code> tools are unavailable.
                </Alert>
              )}
              <p class="sb-help-text">
                Connect MCP clients through OAuth, using the client's "add
                server" flow. API tokens do not work at this endpoint.
              </p>
              <CopyBlock label="Endpoint URL" text={url} />
              <CopyBlock label="Codex" text={snippets.codex} />
              <CopyBlock label="Claude Code" text={snippets.claudeCode} />
              <CopyBlock
                label="Claude.ai or ChatGPT"
                text={snippets.connector}
              />
              <h3>Connected apps</h3>
              <ConnectedApps mode="admin" onUnauthorized={onUnauthorized} />
            </>
          )}
        </>
      )}
    </section>
  );
}
