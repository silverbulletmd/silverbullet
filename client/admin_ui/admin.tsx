import { Fragment, render } from "preact";
import { useEffect, useState } from "preact/hooks";

type Binding = { prefix?: string; host?: string; port?: number };
type SpaceInfo = {
  name: string;
  folder: string;
  binding: Binding;
  auth: { mode: "inherit" | "custom" | "none"; user?: string };
  readOnly: boolean;
  shell: { enabled: boolean; whitelist: string[] };
  runtimeApi: boolean;
  indexPage: string;
  hasPassword: boolean;
  status: { state: "running" | "errored"; reason?: string };
};
type FieldError = { field: string; message: string };

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) throw { unauthorized: true };
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw json.errors ?? [{ field: "", message: `HTTP ${resp.status}` }];
  return json;
}

function formatApiError(e: unknown): string {
  if (Array.isArray(e)) {
    return e
      .map((fe: FieldError) => (fe.field ? `${fe.field}: ${fe.message}` : fe.message))
      .join(", ");
  }
  return "Request failed";
}

/** Lower-cased, filesystem-safe version of a space name for its default folder. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** URL-ish display text for a binding; doubles as the link text in the list. */
function bindingLabel(b: Binding): string {
  const port = location.port ? `:${location.port}` : "";
  if (b.host) return `${b.host}${port}`;
  if (b.port) return `${location.hostname}:${b.port}`;
  return b.prefix || "/";
}

function spaceUrl(b: Binding): string {
  // Host-bound spaces are served by the same listener as this admin page, so
  // they live on the same port (e.g. http://test.localhost:3000/ in dev).
  if (b.host) {
    return `//${b.host}${location.port ? `:${location.port}` : ""}/`;
  }
  if (b.port) return `//${location.hostname}:${b.port}/`;
  return `${b.prefix || ""}/`;
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await api("POST", "api/login", { username, password });
        if (r.status === "ok") onDone();
        else setError(r.error ?? "Login failed");
      }}
    >
      <h1>SilverBullet Admin</h1>
      {error && <p class="sb-admin-error">{error}</p>}
      <label for="login-username">Username</label>
      <input
        id="login-username"
        type="text"
        value={username}
        onInput={(e) => setUsername(e.currentTarget.value)}
      />
      <label for="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />
      <div class="row">
        <button type="submit">Log in</button>
      </div>
    </form>
  );
}

function FolderField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!value) {
        setStatus("");
        return;
      }
      try {
        const r = await api(
          "GET",
          `api/fs/dirs?path=${encodeURIComponent(value)}`,
        );
        setStatus(r.status);
      } catch {
        /* transient */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <Fragment>
      <label for="space-folder">Folder</label>
      <input
        id="space-folder"
        type="text"
        value={value}
        placeholder="spaces/…"
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      {value && status === "exists" && (
        <span class="sb-admin-ok">✓ directory exists</span>
      )}
      {value && status === "missing" && <span>will be created</span>}
      {value && status === "notADirectory" && (
        <span class="sb-admin-error">not a directory</span>
      )}
    </Fragment>
  );
}

function SpaceForm({
  id,
  initial,
  onSaved,
  onCancel,
}: {
  id?: string;
  initial?: SpaceInfo;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [folder, setFolder] = useState(initial?.folder ?? "");
  // The folder and (prefix-type) binding value track a sanitized version of
  // the name until the user edits them by hand (or the space already exists —
  // then the stored values are authoritative).
  const [folderTouched, setFolderTouched] = useState(!!initial);
  const [bindValueTouched, setBindValueTouched] = useState(!!initial);
  const [bindType, setBindType] = useState<"prefix" | "host" | "port">(
    initial?.binding.host ? "host" : initial?.binding.port ? "port" : "prefix",
  );
  const [bindValue, setBindValue] = useState(
    initial?.binding.host ??
    initial?.binding.prefix ??
    String(initial?.binding.port ?? ""),
  );
  const [authMode, setAuthMode] = useState(initial?.auth.mode ?? "inherit");
  const [authUser, setAuthUser] = useState(initial?.auth.user ?? "");
  const [password, setPassword] = useState("");
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false);
  const [shellEnabled, setShellEnabled] = useState(
    initial?.shell.enabled ?? true,
  );
  const [runtimeApi, setRuntimeApi] = useState(initial?.runtimeApi ?? false);
  const [indexPage, setIndexPage] = useState(initial?.indexPage ?? "index");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [portStatus, setPortStatus] = useState<{
    status: string;
    reason: string;
  } | null>(null);
  const [hostStatus, setHostStatus] = useState<
    "verified" | "mismatch" | "unreachable" | null
  >(null);

  // Live port-availability check while a port binding is being edited.
  useEffect(() => {
    if (bindType !== "port" || !bindValue) {
      setPortStatus(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const self = id ? `&self=${encodeURIComponent(id)}` : "";
        const r = await api(
          "GET",
          `api/net/port?port=${encodeURIComponent(bindValue)}${self}`,
        );
        setPortStatus({ status: r.status, reason: r.reason ?? "" });
      } catch {
        /* transient */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [bindType, bindValue, id]);

  // Live hostname check: probe the candidate hostname from the browser and
  // compare the answering server's per-boot instance id with our own. Proves
  // DNS + routing + proxy forwarding end to end (from this browser's vantage
  // point). `/.instance` answers on any Host, so this works before the
  // binding exists.
  useEffect(() => {
    if (
      bindType !== "host" ||
      !bindValue ||
      bindValue.includes("/") ||
      bindValue.includes(":")
    ) {
      setHostStatus(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const own = await (await fetch("/.instance")).json();
        const port = location.port ? `:${location.port}` : "";
        const probe = await fetch(
          `${location.protocol}//${bindValue}${port}/.instance`,
          { signal: AbortSignal.timeout(4000) },
        );
        const remote = await probe.json();
        setHostStatus(remote.instance === own.instance ? "verified" : "mismatch");
      } catch {
        setHostStatus("unreachable");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [bindType, bindValue]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const binding: Binding =
          bindType === "host"
            ? { host: bindValue }
            : bindType === "port"
              ? { port: parseInt(bindValue, 10) }
              : { prefix: bindValue };
        const auth =
          authMode === "custom"
            ? { mode: authMode, user: authUser }
            : { mode: authMode };
        const payload = {
          name,
          folder,
          binding,
          auth,
          readOnly,
          shell: {
            enabled: shellEnabled,
            whitelist: initial?.shell.whitelist ?? [],
          },
          runtimeApi,
          indexPage,
        };
        try {
          let spaceId = id;
          if (id) await api("PUT", `api/spaces/${id}`, payload);
          else spaceId = (await api("POST", "api/spaces", payload)).id;
          if (authMode === "custom" && password) {
            await api("POST", `api/spaces/${spaceId}/password`, { password });
          }
          onSaved();
        } catch (errs) {
          setErrors(
            Array.isArray(errs)
              ? errs
              : [{ field: "", message: "Request failed" }],
          );
        }
      }}
    >
      <h2>{id ? "Edit space" : "Create space"}</h2>
      {errors.map((e) => (
        <p class="sb-admin-error" key={e.field}>
          {e.field}: {e.message}
        </p>
      ))}
      <label for="space-name">Name</label>
      <input
        id="space-name"
        type="text"
        value={name}
        onInput={(e) => {
          const newName = e.currentTarget.value;
          setName(newName);
          const slug = slugify(newName);
          if (!folderTouched) {
            setFolder(slug ? `spaces/${slug}` : "");
          }
          if (!bindValueTouched && bindType === "prefix") {
            setBindValue(slug ? `/${slug}` : "");
          }
        }}
      />
      <label for="space-bind-type">Binding</label>
      <select
        id="space-bind-type"
        value={bindType}
        onChange={(e) => {
          const newType = e.currentTarget.value as "prefix" | "host" | "port";
          setBindType(newType);
          // An untouched value keeps tracking the name for prefixes, and
          // resets for host/port (those can't be derived from the name).
          if (!bindValueTouched) {
            const slug = slugify(name);
            setBindValue(newType === "prefix" && slug ? `/${slug}` : "");
          }
        }}
      >
        <option value="prefix">URL prefix (this host)</option>
        <option value="host">Hostname</option>
        <option value="port">Dedicated port</option>
      </select>
      <label for="space-bind-value">
        {bindType === "prefix"
          ? "Prefix"
          : bindType === "host"
            ? "Hostname"
            : "Port"}
      </label>
      {/* Emulate the resulting URL: fixed scheme/host/port parts render as
          affixes around the editable segment. */}
      <div class="sb-url-input">
        <span class="sb-url-affix">
          {bindType === "prefix"
            ? location.origin
            : bindType === "host"
              ? `${location.protocol}//`
              : `${location.protocol}//${location.hostname}:`}
        </span>
        <input
          id="space-bind-value"
          type="text"
          value={bindValue}
          placeholder={
            bindType === "prefix"
              ? "/work"
              : bindType === "host"
                ? "notes.example.com"
                : "3001"
          }
          onInput={(e) => {
            setBindValue(e.currentTarget.value);
            setBindValueTouched(true);
          }}
        />
        {bindType === "host" && (
          <span class="sb-url-affix">
            {location.port ? `:${location.port}/` : "/"}
          </span>
        )}
        {bindType === "port" && <span class="sb-url-affix">/</span>}
      </div>
      {bindType === "host" && hostStatus && (
        <Fragment>
          {hostStatus === "verified" && (
            <span class="sb-admin-ok">✓ hostname reaches this server</span>
          )}
          {hostStatus === "mismatch" && (
            <span class="sb-admin-error">
              hostname reaches a different server
            </span>
          )}
          {hostStatus === "unreachable" && (
            <span class="sb-admin-warn">
              could not verify: hostname does not reach this server from your
              browser (DNS or proxy not set up yet?)
            </span>
          )}
        </Fragment>
      )}
      {bindType === "port" && portStatus && (
        <Fragment>
          {portStatus.status === "available" && (
            <span class="sb-admin-ok">
              ✓ port available
              {portStatus.reason ? ` (${portStatus.reason})` : ""}
            </span>
          )}
          {portStatus.status === "inUse" && (
            <span class="sb-admin-error">port in use: {portStatus.reason}</span>
          )}
          {portStatus.status === "invalid" && (
            <span class="sb-admin-error">{portStatus.reason}</span>
          )}
        </Fragment>
      )}
      <FolderField
        value={folder}
        onChange={(v) => {
          setFolder(v);
          setFolderTouched(true);
        }}
      />
      <label for="space-auth-mode">Authentication</label>
      <select
        id="space-auth-mode"
        value={authMode}
        onChange={(e) => setAuthMode(e.currentTarget.value as any)}
      >
        <option value="inherit">Admin credentials (inherit)</option>
        <option value="custom">Space-specific user</option>
        <option value="none">Open (no login)</option>
      </select>
      {authMode === "custom" && (
        <Fragment>
          <label for="space-auth-user">Space username</label>
          <input
            id="space-auth-user"
            type="text"
            value={authUser}
            onInput={(e) => setAuthUser(e.currentTarget.value)}
          />
          <label for="space-password">
            Space password {initial?.hasPassword ? "(leave empty to keep)" : ""}
          </label>
          <input
            id="space-password"
            type="password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </Fragment>
      )}
      <details>
        <summary>Advanced</summary>
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.currentTarget.checked)}
          />{" "}
          Read-only
        </label>
        <label>
          <input
            type="checkbox"
            checked={shellEnabled}
            onChange={(e) => setShellEnabled(e.currentTarget.checked)}
          />{" "}
          Enable shell commands
        </label>
        <label>
          <input
            type="checkbox"
            checked={runtimeApi}
            onChange={(e) => setRuntimeApi(e.currentTarget.checked)}
          />{" "}
          Enable runtime API (headless Chrome)
        </label>
        <label for="space-index-page">Index page</label>
        <input
          id="space-index-page"
          type="text"
          value={indexPage}
          onInput={(e) => setIndexPage(e.currentTarget.value)}
        />
      </details>
      <div class="row">
        <button type="submit">{id ? "Save" : "Create"}</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function App() {
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

render(<App />, document.getElementById("root")!);
