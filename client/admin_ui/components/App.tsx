import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, formatApiError } from "../api.ts";
import { bindingLabel, spaceUrl } from "../bindings.ts";
import type { SpaceInfo } from "../types.ts";
import { Login } from "./Login.tsx";
import { SpaceForm } from "./SpaceForm.tsx";

export function App() {
  const [phase, setPhase] = useState<"loading" | "login" | "list" | "form">(
    "loading",
  );
  const [spaces, setSpaces] = useState<Record<string, SpaceInfo>>({});
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [appError, setAppError] = useState("");

  async function reload() {
    try {
      const s = await api("GET", "api/spaces");
      setSpaces(s);
      setPhase("list");
      setAppError("");
    } catch (e: any) {
      if (e.unauthorized) setPhase("login");
      else setAppError(formatApiError(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  if (phase === "loading") return <p>Loading…</p>;
  if (phase === "login") return <Login onDone={reload} />;
  if (phase === "form") {
    return (
      <SpaceForm
        id={editing}
        initial={editing ? spaces[editing] : undefined}
        onSaved={reload}
        onCancel={() => setPhase("list")}
      />
    );
  }
  const entries = Object.entries(spaces).sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );
  return (
    <Fragment>
      <h1>Spaces</h1>
      {appError && <p class="sb-admin-error">{appError}</p>}
      {entries.length === 0 && <p>No spaces yet — create your first space.</p>}
      <ul class="sb-space-list">
        {entries.map(([id, s]) => (
          <li key={id}>
            <strong>{s.name}</strong>
            <a href={spaceUrl(s.binding)} target="_blank" rel="noopener">
              {bindingLabel(s.binding)}
            </a>
            <span
              class={`sb-badge ${s.status.state}`}
              title={s.status.reason ?? ""}
            >
              {s.status.state}
            </span>
            <span class="sb-actions">
              <button
                onClick={() => {
                  setEditing(id);
                  setPhase("form");
                }}
              >
                edit
              </button>
              <button
                onClick={async () => {
                  if (
                    confirm(
                      `Remove "${s.name}" from the server? Files on disk are kept.`,
                    )
                  ) {
                    try {
                      await api("DELETE", `api/spaces/${id}`);
                      await reload();
                    } catch (e: any) {
                      if (e.unauthorized) setPhase("login");
                      else setAppError(formatApiError(e));
                    }
                  }
                }}
              >
                delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div class="row">
        <button
          onClick={() => {
            setEditing(undefined);
            setPhase("form");
          }}
        >
          Create space
        </button>
        <button
          onClick={async () => {
            try {
              await api("GET", "api/logout");
              setPhase("login");
            } catch (e: any) {
              if (e.unauthorized) setPhase("login");
              else setAppError(formatApiError(e));
            }
          }}
        >
          Log out
        </button>
      </div>
    </Fragment>
  );
}
