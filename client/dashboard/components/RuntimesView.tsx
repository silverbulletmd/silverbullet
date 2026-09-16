import { Alert, Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { adminApi, formatApiError } from "../api.ts";

type RuntimeInfo = {
  id: string;
  spaceId: string;
  spaceName: string;
  username: string | null;
  status: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  diskBytes: number | null;
};

function bytes(value: number | null): string {
  if (value === null) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}

export function RuntimesView({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [rows, setRows] = useState<RuntimeInfo[] | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState("");
  const manage = useRef<(id: string, action: "stop" | "reset") => void>(
    () => {},
  );
  useEffect(() => {
    let disposed = false;
    let fetching = false;
    let acting = false;
    let queued = false;
    let generation = 0;
    const reportError = (error: any, loading = false) => {
      if (disposed) return;
      if (error.unauthorized) onUnauthorized();
      else (loading ? setLoadError : setError)(formatApiError(error));
    };
    const refresh = async (force = false) => {
      if (disposed || document.hidden || acting) return;
      if (fetching) {
        queued ||= force;
        return;
      }
      fetching = true;
      const current = generation;
      try {
        const result: RuntimeInfo[] = await adminApi("GET", "runtimes");
        if (!disposed && current === generation) {
          setRows(result);
          setLoadError("");
        }
      } catch (error) {
        if (current === generation) reportError(error, true);
      } finally {
        fetching = false;
        if (queued) {
          queued = false;
          void refresh();
        }
      }
    };
    manage.current = async (id, action) => {
      if (acting || disposed) return;
      acting = true;
      generation++;
      setPending(id);
      setError("");
      try {
        await adminApi("POST", `runtimes/${encodeURIComponent(id)}/${action}`);
      } catch (error) {
        reportError(error);
      } finally {
        acting = false;
        if (!disposed) {
          setPending("");
          void refresh(true);
        }
      }
    };
    const visible = () => {
      if (!document.hidden) void refresh(true);
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      <p class="sb-help-text">
        This page lists currently active Runtime API users.
      </p>

      {loadError && <Alert variant="error">{loadError}</Alert>}
      {rows === null && !loadError && <p>Loading…</p>}
      {rows?.length === 0 && <p>No runtimes have been started.</p>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table class="sb-user-table">
            <thead>
              <tr>
                <th>Space</th>
                <th>User</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Index size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.spaceName}</td>
                  <td>{row.username ?? "Accountless"}</td>
                  <td>
                    {row.status === "stop_failed" ? "Stop failed" : row.status}
                  </td>
                  <td>
                    {row.cpuPercent === null
                      ? "Unavailable"
                      : `${row.cpuPercent.toFixed(1)}%`}
                  </td>
                  <td>{bytes(row.memoryBytes)}</td>
                  <td>{bytes(row.diskBytes)}</td>
                  <td>
                    <Button
                      disabled={
                        !!pending ||
                        !["starting", "running", "stop_failed"].includes(
                          row.status,
                        )
                      }
                      onClick={() => manage.current(row.id, "stop")}
                    >
                      Stop
                    </Button>{" "}
                    <Button
                      disabled={!!pending || row.status === "stopping"}
                      onClick={() => manage.current(row.id, "reset")}
                    >
                      Reset
                    </Button>
                    {pending === row.id && <span> Working…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="sb-help-text">
            Memory usage is an estimate. "Stop" stops the client, "Reset" stops
            and deletes the index. The next Runtime API request can start a new
            runtime.
          </p>
        </div>
      )}
    </div>
  );
}
