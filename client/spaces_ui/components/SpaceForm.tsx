import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
  Select,
} from "@silverbulletmd/silverbullet/ui";
import { adminApi, listUsers } from "../api.ts";
import { FolderPicker } from "../FolderPicker.tsx";
import {
  FieldErrors,
  UrlPrefixInput,
  useSlugDefaults,
} from "../space_fields.tsx";
import type { Binding, FieldError, SpaceInfo, UserInfo } from "../types.ts";

export function SpaceForm({
  id,
  initial,
  onSaved,
  cancelHref,
  onDeleted,
  onUnauthorized,
}: {
  id?: string;
  initial?: SpaceInfo;
  onSaved: (id: string) => void;
  cancelHref: string;
  onDeleted: () => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // The folder and prefix track a sanitized version of the name until the
  // user edits them by hand. Hostnames never derive from the name, so they
  // get their own plain state below rather than living in this hook.
  const { folder, folderTouched, prefix, onNameChange, setFolder, setPrefix } =
    useSlugDefaults((slug) => `spaces/${slug}`);
  const [bindType, setBindType] = useState<"prefix" | "host">(
    initial?.binding.host ? "host" : "prefix",
  );
  const [hostValue, setHostValue] = useState(initial?.binding.host ?? "");
  const bindValue = bindType === "host" ? hostValue : prefix;

  // Bootstrap from `initial` (edit mode) exactly once. Going through the
  // hook's setters — rather than lazy initial state — also marks folder/prefix
  // as touched, which is what protects an existing space's stored values from
  // being clobbered by a later name edit (mirroring the old `!!initial` seed
  // for `folderTouched`/`bindValueTouched`).
  useEffect(() => {
    if (initial) {
      setFolder(initial.folder);
      if (!initial.binding.host) setPrefix(initial.binding.prefix ?? "");
    }
    // Intentionally run once on mount only.
  }, []);

  const [isPublic, setIsPublic] = useState(initial?.public ?? false);
  const [members, setMembers] = useState<Set<string>>(
    new Set(Object.keys(initial?.members ?? {})),
  );
  const [users, setUsers] = useState<Record<string, UserInfo>>({});
  const [usersError, setUsersError] = useState(false);
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false);
  const [shellEnabled, setShellEnabled] = useState(
    initial?.shell.enabled ?? true,
  );
  // Edited as the space-separated string the server's own SB_SHELL_WHITELIST
  // uses, and split back into the config's array on save.
  const [shellWhitelist, setShellWhitelist] = useState(
    (initial?.shell.whitelist ?? []).join(" "),
  );
  const [runtimeApi, setRuntimeApi] = useState(initial?.runtimeApi ?? false);
  const [indexPage, setIndexPage] = useState(initial?.indexPage ?? "index");
  const [errors, setErrors] = useState<FieldError[]>([]);
  // Saving an existing space navigates to the URL it is already on, so without
  // this the screen is pixel-identical before and after a successful save and
  // there is no way to tell whether anything happened.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [hostStatus, setHostStatus] = useState<
    "verified" | "mismatch" | "unreachable" | null
  >(null);

  // The confirmation is transient: it answers "did that save?" and then gets
  // out of the way, rather than lingering next to fields the user has since
  // edited again.
  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [saveState]);

  // Live hostname check: probe the candidate hostname from the browser and
  // compare the answering server's per-boot instance id with our own. Proves
  // DNS + routing + proxy forwarding end to end (from this browser's vantage
  // point). `/.instance` answers on any Host, so this works before the
  // binding exists.
  //
  // Deliberately probed on this page's own scheme and port rather than the
  // https:// shown in the affix: the question is whether the hostname reaches
  // *this* server from here, and an admin on http://localhost:3000 has no TLS
  // to probe. Answering "unreachable" for every local setup would make the
  // check worthless where it is needed most.
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

  // Known users, for the member checklist below.
  const loadUsers = () => {
    setUsersError(false);
    listUsers()
      .then(setUsers)
      .catch((e: any) => {
        if (e.unauthorized) onUnauthorized();
        else setUsersError(true);
      });
  };
  useEffect(loadUsers, []);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (bindType === "prefix" && !prefix.trim()) {
          setErrors([{ field: "binding", message: "prefix is required" }]);
          return;
        }
        const binding: Binding =
          bindType === "host" ? { host: hostValue } : { prefix };
        const payload = {
          name,
          folder,
          binding,
          public: isPublic,
          members: Object.fromEntries([...members].map((m) => [m, {}])),
          readOnly,
          shell: {
            enabled: shellEnabled,
            // Sent even while the field is hidden, so turning shell commands
            // off and back on does not silently discard the allow list.
            whitelist: shellWhitelist.split(/\s+/).filter(Boolean),
          },
          runtimeApi,
          indexPage,
        };
        setErrors([]);
        setSaveState("saving");
        try {
          // PATCH, not PUT: this payload omits description, themeColor,
          // headHtml, spaceIgnore and logPush, which the form has no inputs
          // for. A full-replace PUT resets them on every save.
          if (id) {
            await adminApi("PATCH", `spaces/${id}`, payload);
            setSaveState("saved");
            onSaved(id);
          } else {
            const result = await adminApi("POST", "spaces", payload);
            // Creating navigates to the new space's own edit screen, which is
            // change enough on its own — no confirmation needed.
            setSaveState("idle");
            onSaved(result.id);
          }
        } catch (errs) {
          setSaveState("idle");
          if ((errs as any)?.unauthorized) {
            onUnauthorized();
            return;
          }
          setErrors(
            Array.isArray(errs)
              ? errs
              : [{ field: "", message: "Request failed" }],
          );
        }
      }}
    >
      <h1>{id ? "Edit space" : "Create space"}</h1>
      <FieldErrors errors={errors} />
      <label for="space-name">Name</label>
      <Input
        id="space-name"
        value={name}
        onInput={(e) => {
          const newName = e.currentTarget.value;
          setName(newName);
          onNameChange(newName);
        }}
      />
      <label for="space-bind-type">Binding</label>
      <Select
        id="space-bind-type"
        value={bindType}
        onChange={(e) =>
          setBindType(e.currentTarget.value as "prefix" | "host")
        }
      >
        <option value="prefix">URL prefix (this host)</option>
        <option value="host">Hostname</option>
      </Select>
      <label for="space-bind-value">
        {bindType === "prefix" ? "Prefix" : "Hostname"}
      </label>
      {bindType === "prefix" ? (
        <UrlPrefixInput
          id="space-bind-value"
          value={prefix}
          onInput={setPrefix}
        />
      ) : (
        <div class="sb-url-input">
          {/* Only the scheme is fixed, and it is always https://: SilverBullet
              requires TLS, and a host-bound space is reached through whatever
              proxy terminates it — never on this server's own listening port.
              Nothing follows the hostname, so there is no trailing affix; a
              bare "/" only added noise. */}
          <span class="sb-url-affix">https://</span>
          <Input
            id="space-bind-value"
            value={hostValue}
            placeholder="notes.example.com"
            onInput={(e) => setHostValue(e.currentTarget.value)}
          />
        </div>
      )}
      {bindType === "host" && hostStatus && (
        <Fragment>
          {hostStatus === "verified" && (
            <span class="sb-spaces-ok">✓ hostname reaches this server</span>
          )}
          {hostStatus === "mismatch" && (
            <span class="sb-spaces-error">
              hostname reaches a different server
            </span>
          )}
          {hostStatus === "unreachable" && (
            <span class="sb-spaces-warn">
              could not verify: hostname does not reach this server from your
              browser (DNS or proxy not set up yet?)
            </span>
          )}
        </Fragment>
      )}
      <label for="space-folder">Folder</label>
      <FolderPicker
        id="space-folder"
        value={folder}
        onChange={setFolder}
        apiBase="api/admin"
        // The default value tracks `spaces/<slug>` (relative to the server
        // root) and doesn't exist yet — browsing its parent ("spaces") shows
        // the existing space folders to pick from, same idea as the wizard's
        // parentDir(folder). Once the user (or an existing space's stored
        // value) has a real folder, just browse that value's own
        // subdirectories (the picker's default).
        browseStart={folderTouched ? undefined : "spaces"}
      />
      <h3>Access</h3>
      <fieldset class="sb-member-list">
        <legend>Members</legend>
        {usersError && (
          <Alert variant="error">
            Could not load users —{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                loadUsers();
              }}
            >
              retry
            </a>
          </Alert>
        )}
        {!usersError && Object.keys(users).length === 0 && (
          <p>No other users yet — create some in the Users tab.</p>
        )}
        {Object.entries(users)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([username, u]) => (
            <label class="sb-member-row" key={username}>
              <Checkbox
                checked={u.admin || members.has(username)}
                disabled={u.admin}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setMembers((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(username);
                    else next.delete(username);
                    return next;
                  });
                }}
              />{" "}
              {username}
              {u.admin && <Badge>admin</Badge>}
            </label>
          ))}
      </fieldset>
      <details>
        <summary>Advanced</summary>
        <label>
          <Checkbox
            checked={isPublic}
            onChange={(e) => setIsPublic(e.currentTarget.checked)}
          />{" "}
          Public (no login required)
        </label>
        {/* Kept next to the toggle that causes it: a warning about the
            selected combination is useless where you cannot see the
            checkboxes it refers to. */}
        {isPublic && !readOnly && (
          <Alert variant="warning">
            Anyone can read AND EDIT this space without logging in — intended
            for auth-proxy deployments.
          </Alert>
        )}
        <label>
          <Checkbox
            checked={readOnly}
            onChange={(e) => setReadOnly(e.currentTarget.checked)}
          />{" "}
          Read-only
        </label>
        <label>
          <Checkbox
            checked={shellEnabled}
            onChange={(e) => setShellEnabled(e.currentTarget.checked)}
          />{" "}
          Enable shell commands
        </label>
        {/* Only meaningful while shell commands are on, so it appears with
            them rather than sitting there greyed out. */}
        {shellEnabled && (
          <Fragment>
            <label for="space-shell-whitelist">
              Allowed commands
              <span class="sb-help-text">
                Space-separated. Leave empty to allow every command.
              </span>
            </label>
            <Input
              id="space-shell-whitelist"
              value={shellWhitelist}
              placeholder="git pandoc"
              onInput={(e) => setShellWhitelist(e.currentTarget.value)}
            />
          </Fragment>
        )}
        <label>
          <Checkbox
            checked={runtimeApi}
            onChange={(e) => setRuntimeApi(e.currentTarget.checked)}
          />{" "}
          Enable runtime API
        </label>
        <label for="space-index-page">Index page</label>
        <Input
          id="space-index-page"
          value={indexPage}
          onInput={(e) => setIndexPage(e.currentTarget.value)}
        />
      </details>
      <div class="row">
        <Button
          type="submit"
          variant="primary"
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? "Saving…" : id ? "Save" : "Create"}
        </Button>
        <a class="sb-button" href={cancelHref}>
          Cancel
        </a>
        {/* Rendered unconditionally so it is a live region the moment the
            form mounts: a status element inserted at the same time as its
            text often goes unannounced. */}
        <span class="sb-spaces-ok" role="status">
          {saveState === "saved" ? "✓ Saved" : ""}
        </span>
      </div>
      {id && (
        <div class="sb-danger-zone">
          <Button
            variant="danger"
            onClick={async () => {
              if (
                !confirm(
                  `Remove "${initial?.name ?? id}" from the server? Files on disk are kept.`,
                )
              ) {
                return;
              }
              try {
                await adminApi("DELETE", `spaces/${id}`);
                onDeleted();
              } catch (errs) {
                if ((errs as any)?.unauthorized) {
                  onUnauthorized();
                  return;
                }
                setErrors(
                  Array.isArray(errs)
                    ? errs
                    : [{ field: "", message: "Request failed" }],
                );
              }
            }}
          >
            Delete space
          </Button>
        </div>
      )}
    </form>
  );
}
