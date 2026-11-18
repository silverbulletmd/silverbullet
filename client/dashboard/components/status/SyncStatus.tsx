import { Alert } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { isLoudSyncState } from "../../../sync_notification.ts";
import { adminApi, apiErrorText, getGitStatus } from "../../api.ts";
import {
  gitProblemText,
  gitStateLabel,
  gitSyncsWith,
} from "../../git_sync_status.ts";
import { dashboardUrl } from "../../routes.ts";
import type { GitStatus, SpaceInfo } from "../../types.ts";

type Row = {
  id: string;
  name: string;
  status: GitStatus | null;
};

const REFRESH_MS = 5000;

function hasProblem(row: Row): boolean {
  return row.status === null || isLoudSyncState(row.status.sync);
}

function byProblemThenName(a: Row, b: Row): number {
  return (
    Number(hasProblem(b)) - Number(hasProblem(a)) ||
    a.name.localeCompare(b.name)
  );
}

async function loadRows(): Promise<Row[]> {
  const spaces: Record<string, SpaceInfo> = await adminApi("GET", "spaces");
  const synced = Object.entries(spaces).filter(([, s]) => gitSyncsWith(s));
  const rows = await Promise.all(
    synced.map(async ([id, space]) => ({
      id,
      name: space.name,
      status: await getGitStatus(id).catch(() => null),
    })),
  );
  return rows.sort(byProblemThenName);
}

/** Status → Sync: every git-synced space's state, problems first. */
export function SyncStatus({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    // Each space's status runs git; a slow round must finish before the next.
    let fetching = false;
    const refresh = async () => {
      if (document.hidden || fetching) return;
      fetching = true;
      try {
        const next = await loadRows();
        if (!disposed) {
          setRows(next);
          setError("");
        }
      } catch (cause) {
        if (disposed) return;
        const text = apiErrorText(cause, onUnauthorized);
        if (text !== null) setError(text);
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {rows === null && !error && <p>Loading…</p>}
      {rows?.length === 0 && <p>No spaces sync with Git.</p>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table class="sb-user-table">
            <thead>
              <tr>
                <th>Space</th>
                <th>State</th>
                <th>Last successful sync</th>
                <th class="sb-numeric-cell">Outgoing</th>
                <th class="sb-numeric-cell">Incoming</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const problem = row.status && gitProblemText(row.status);
                return (
                  <tr key={row.id}>
                    <td>
                      <a
                        href={dashboardUrl(
                          `/${encodeURIComponent(row.id)}?section=revisions`,
                        )}
                      >
                        {row.name}
                      </a>
                    </td>
                    <td>
                      {row.status
                        ? gitStateLabel(row.status)
                        : "Status unavailable"}
                      {problem && <div class="sb-help-text">{problem}</div>}
                    </td>
                    <td>
                      {row.status?.lastSuccess
                        ? new Date(row.status.lastSuccess).toLocaleString()
                        : "Never"}
                    </td>
                    <td class="sb-numeric-cell">{row.status?.ahead ?? "?"}</td>
                    <td class="sb-numeric-cell">{row.status?.behind ?? "?"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
