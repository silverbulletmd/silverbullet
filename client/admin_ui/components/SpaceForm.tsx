import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api.ts";
import { slugify } from "../bindings.ts";
import type { Binding, FieldError, SpaceInfo } from "../types.ts";
import { FolderField } from "./FolderField.tsx";

export function SpaceForm({
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
        setHostStatus(
          remote.instance === own.instance ? "verified" : "mismatch",
        );
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
