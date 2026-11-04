import { Alert, Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import {
  type McpGrant,
  apiErrorText,
  listAllGrants,
  listMyGrants,
  revokeGrant,
  revokeMyGrant,
} from "../api.ts";

function when(value: string | null): string {
  return value === null ? "Never" : new Date(value).toLocaleString();
}

function origin(grant: McpGrant): string {
  return grant.clientKind === "cimd" && grant.verifiedHost
    ? `verified by ${grant.verifiedHost}`
    : `self-registered → ${grant.redirectHost ?? "unknown host"}`;
}

export function ConnectedApps({
  mode,
  onUnauthorized,
}: {
  mode: "user" | "admin";
  onUnauthorized: () => void;
}) {
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  async function load() {
    try {
      setGrants(await (mode === "admin" ? listAllGrants() : listMyGrants()));
      setError("");
    } catch (cause) {
      const text = apiErrorText(cause, onUnauthorized);
      if (text !== null) setError(text);
    }
  }

  useEffect(() => {
    void load();
  }, [mode]);

  async function revoke(grant: McpGrant) {
    if (
      !window.confirm(
        `Revoke ${grant.clientName}? It will lose access until it is connected again.`,
      )
    ) {
      return;
    }
    setPending(grant.id);
    try {
      await (mode === "admin"
        ? revokeGrant(grant.id)
        : revokeMyGrant(grant.id));
      await load();
    } catch (cause) {
      const text = apiErrorText(cause, onUnauthorized);
      if (text !== null) setError(text);
    } finally {
      setPending("");
    }
  }

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {grants === null && !error && <p>Loading…</p>}
      {grants?.length === 0 && <p>No apps are connected.</p>}
      {grants && grants.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table class="sb-user-table">
            <thead>
              <tr>
                <th>App</th>
                {mode === "admin" && <th>User</th>}
                <th>Spaces</th>
                <th>Last used</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    {grant.clientName}
                    <div class="sb-help-text">{origin(grant)}</div>
                  </td>
                  {mode === "admin" && <td>{grant.username}</td>}
                  <td>{grant.spaces.map((space) => space.name).join(", ")}</td>
                  <td>{when(grant.lastUsedAt)}</td>
                  <td>
                    <Button
                      disabled={!!pending}
                      onClick={() => void revoke(grant)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
