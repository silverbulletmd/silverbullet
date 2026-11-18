import {
  Alert,
  Button,
  CheckboxField,
  Field,
  Input,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { adminApi, apiErrorText, getServerInfo } from "../api.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { dashboardUrl } from "../routes.ts";
import {
  mcpUnavailableReason,
  runtimeApiUnavailableReason,
} from "../runtime_availability.ts";
import { McpSetup } from "./McpSection.tsx";

type ApiSettings = {
  runtimeApi: boolean;
  runtimeIdleTimeout: number;
  mcp: boolean;
};

export function ApisView({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [saved, setSaved] = useState<ApiSettings | null>(null);
  const [runtimeApi, setRuntimeApi] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState("");
  const [mcp, setMcp] = useState(false);
  const [runtimeReason, setRuntimeReason] = useState<string | null>(null);
  const [mcpReason, setMcpReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const notify = useNotification("apis");

  function fail(cause: unknown) {
    const text = apiErrorText(cause, onUnauthorized);
    if (text !== null) setError(text);
  }

  function show(config: ApiSettings) {
    setSaved(config);
    setRuntimeApi(config.runtimeApi);
    setIdleTimeout(String(config.runtimeIdleTimeout));
    setMcp(config.mcp);
  }

  useEffect(() => {
    void getServerInfo()
      .then((info) => {
        setRuntimeReason(runtimeApiUnavailableReason(info.runtimeApi));
        setMcpReason(mcpUnavailableReason(info.mcp));
      })
      .catch(fail);
    void adminApi("GET", "server-config").then(show).catch(fail);
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    notify("");
    try {
      show(
        await adminApi("PUT", "server-config", {
          runtimeApi,
          runtimeIdleTimeout: Number(idleTimeout),
          mcp,
        }),
      );
      notify("API settings saved.");
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  const runtimeOff = !runtimeApi || runtimeReason !== null;
  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {!saved && !error && <p>Loading settings…</p>}
      {saved && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SaveConfirmation scope="apis" />
          <h2>Runtime API</h2>
          <CheckboxField
            label="Enable runtime API"
            checked={runtimeApi}
            disabled={runtimeReason !== null}
            onChange={(event) => setRuntimeApi(event.currentTarget.checked)}
          />
          {runtimeReason && <p class="sb-help-text">{runtimeReason}</p>}
          <Field
            label="Stop idle runtimes after (minutes)"
            hint="A runtime with no requests for this long is stopped and keeps its index; the next request starts it again. 0 keeps runtimes running."
          >
            <Input
              id="runtime-idle-timeout"
              type="number"
              min={0}
              max={7 * 24 * 60}
              step={1}
              required
              value={idleTimeout}
              disabled={runtimeReason !== null}
              onInput={(event) => setIdleTimeout(event.currentTarget.value)}
            />
          </Field>
          <h2>MCP</h2>
          <CheckboxField
            label="Enable MCP"
            checked={mcp}
            disabled={mcpReason !== null}
            onChange={(event) => setMcp(event.currentTarget.checked)}
          />
          {mcpReason && <p class="sb-help-text">{mcpReason}</p>}
          {mcp && runtimeOff && (
            <Alert variant="warning">
              The runtime API is off, so the <code>lua</code> and{" "}
              <code>screenshot</code> tools are unavailable.
            </Alert>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={saving || (runtimeReason !== null && mcpReason !== null)}
          >
            Save
          </Button>
        </form>
      )}
      {saved?.mcp && <McpSetup />}
      <p class="sb-help-text">
        Running runtimes are under{" "}
        <a href={dashboardUrl("/status?section=runtimes")}>Status → Runtimes</a>
        , connected apps under{" "}
        <a href={dashboardUrl("/status?section=apps")}>
          Status → Connected apps
        </a>
        .
      </p>
    </div>
  );
}
