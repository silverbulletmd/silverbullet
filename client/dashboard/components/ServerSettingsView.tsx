import { runtimeApiUnavailableReason } from "../runtime_availability.ts";
import {
  Alert,
  Button,
  CheckboxField,
  Input,
  Field,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { adminApi, formatApiError, getServerInfo } from "../api.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { updateServerName } from "../server_name.ts";

export function ServerSettingsView({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [config, setConfig] = useState<{
    primaryUrl: string | null;
    serverName: string;
  }>();
  const [runtimeApi, setRuntimeApi] = useState(true);
  const [runtimeReason, setRuntimeReason] = useState<string | null>(null);
  const [serverName, setServerName] = useState("SilverBullet");
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const notify = useNotification("server");

  function handleError(error: any) {
    if (error.unauthorized) onUnauthorized();
    else setError(formatApiError(error));
  }

  useEffect(() => {
    void getServerInfo()
      .then((info) =>
        setRuntimeReason(runtimeApiUnavailableReason(info.runtimeApi)),
      )
      .catch(handleError);
    void adminApi("GET", "server-config")
      .then((value) => {
        setConfig(value);
        setRuntimeApi(value.runtimeApi);
        setServerName(value.serverName ?? "SilverBullet");
        setPrimaryUrl(value.primaryUrl ?? location.origin);
      })
      .catch(handleError);
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    notify("");
    try {
      const value = await adminApi("PUT", "server-config", {
        primaryUrl: primaryUrl.trim(),
        serverName: serverName.trim(),
        runtimeApi,
      });
      setConfig(value);
      setRuntimeApi(value.runtimeApi);
      setServerName(value.serverName);
      updateServerName(value.serverName);
      setPrimaryUrl(value.primaryUrl);
      notify("Server settings saved.");
      if (new URL(value.primaryUrl).origin !== location.origin) {
        location.href = `${value.primaryUrl}/.dashboard/admin?section=server`;
      }
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {!config && !error && <p>Loading…</p>}
      {config && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SaveConfirmation scope="server" />
          <Field label="Server Name">
            <Input
              id="server-name"
              required
              maxLength={100}
              value={serverName}
              onInput={(event) => setServerName(event.currentTarget.value)}
            />
          </Field>
          <Field
            label="Primary URL"
            hint="The address for server management and sign-in."
          >
            <Input
              id="server-primary-url"
              type="url"
              required
              value={primaryUrl}
              onInput={(event) => {
                setPrimaryUrl(event.currentTarget.value);
              }}
            />
          </Field>

          <CheckboxField
            label="Enable runtime API"
            checked={runtimeApi}
            disabled={runtimeReason !== null}
            onChange={(event) => setRuntimeApi(event.currentTarget.checked)}
          />

          {runtimeReason && <p class="sb-help-text">{runtimeReason}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </form>
      )}
    </div>
  );
}
