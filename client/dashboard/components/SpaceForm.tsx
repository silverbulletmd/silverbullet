import { changeMemberAccess } from "../runtime_permissions.ts";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Select,
} from "@silverbulletmd/silverbullet/ui";
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  adminApi,
  getServerInfo,
  listSpaceBindings,
  listUsers,
} from "../api.ts";
import { FolderPicker } from "../FolderPicker.tsx";
import { formatDuration } from "../git_sync_copy.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import {
  type RuntimeAvailability,
  runtimeApiUnavailableReason,
} from "../runtime_availability.ts";
import { FieldErrors, useSlugDefaults } from "../space_fields.tsx";
import {
  SPACE_SECTIONS,
  type SpaceSection,
  settingsPayload,
} from "../space_settings.ts";
import type {
  CommitTiming,
  Binding,
  FieldError,
  MemberEntry,
  RevisionsMode,
  SpaceAccess,
  SpaceInfo,
  UserInfo,
  VisibleSpace,
} from "../types.ts";
import { AccessGrid } from "./AccessGrid.tsx";
import { BindingFields } from "./BindingFields.tsx";

const COMMIT_PRESETS = [
  {
    label: "Responsive — about 30 seconds",
    quietSecs: 30,
    maxIntervalSecs: 300,
  },
  {
    label: "Balanced — about 2 minutes",
    quietSecs: 120,
    maxIntervalSecs: 900,
  },
  {
    label: "Relaxed — about 5 minutes",
    quietSecs: 300,
    maxIntervalSecs: 3600,
  },
];

export function SpaceForm({
  id,
  initial,
  onSaved,
  cancelHref,
  onDeleted,
  onUnauthorized,
  section = "general",
  onDirtyChange,
  connectionDraft = false,
}: {
  id?: string;
  initial?: SpaceInfo;
  onSaved: (id: string, patch?: Partial<SpaceInfo>) => void;
  section?: SpaceSection;
  connectionDraft?: boolean;
  onDirtyChange?: (sections: SpaceSection[]) => void;
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
  const [hostBinding, setHostBinding] = useState<Binding | null>(
    initial?.binding.host !== undefined ? initial.binding : null,
  );
  const binding = hostBinding ?? { prefix };
  const [primaryUrl, setPrimaryUrl] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<VisibleSpace[]>([]);

  // Initialize through the setters to mark stored folder/prefix values as
  // touched, protecting them from later name edits.
  useEffect(() => {
    if (initial) {
      setFolder(initial.folder);
      if (!initial.binding.host) setPrefix(initial.binding.prefix ?? "");
    }
    // Intentionally run once on mount only.
  }, []);

  const [access, setAccess] = useState<SpaceAccess>(initial?.access ?? "none");
  const [members, setMembers] = useState<Record<string, MemberEntry>>(
    initial?.members ?? {},
  );
  const [users, setUsers] = useState<Record<string, UserInfo>>({});
  const [usersError, setUsersError] = useState(false);
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false);
  // Off for a new space: shell commands are the most dangerous capability a
  // space can hold, so an admin opts in rather than remembering to opt out.
  // An existing space keeps whatever it was configured with.
  const [shellEnabled, setShellEnabled] = useState(
    initial?.shell.enabled ?? false,
  );
  // Edited as the space-separated string the server's own SB_SHELL_WHITELIST
  // uses, and split back into the config's array on save.
  const [shellWhitelist, setShellWhitelist] = useState(
    (initial?.shell.whitelist ?? []).join(" "),
  );
  const [revisions, setRevisions] = useState<RevisionsMode>(
    initial?.revisions ?? "managed",
  );
  const [revisionsCommit, setRevisionsCommit] = useState<CommitTiming>(
    initial?.revisionsCommit ?? { quietSecs: 30, maxIntervalSecs: 300 },
  );
  const [runtimeServerEnabled, setRuntimeServerEnabled] = useState(false);
  const [runtimeAvailability, setRuntimeAvailability] =
    useState<RuntimeAvailability | null>(null);
  const [indexPage, setIndexPage] = useState(initial?.indexPage ?? "index");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");

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

  useEffect(() => {
    getServerInfo()
      .then((info) => {
        setRuntimeAvailability(info.runtimeApi);
        setRuntimeServerEnabled(info.runtimeApiEnabled);
        setPrimaryUrl(info.primaryUrl ?? null);
      })
      .catch((e: any) => {
        if (e.unauthorized) onUnauthorized();
      });
    listSpaceBindings()
      .then(setSpaces)
      .catch((e: any) => {
        if (e.unauthorized) onUnauthorized();
      });
  }, []);
  const runtimeApiUnavailable =
    runtimeApiUnavailableReason(runtimeAvailability) ??
    (!runtimeServerEnabled ? "Disabled in Server settings." : null);

  const values: Partial<SpaceInfo> = {
    name,
    folder,
    binding,
    access,
    members,
    readOnly,
    shell: {
      enabled: shellEnabled,
      whitelist: shellWhitelist.split(/\s+/).filter(Boolean),
    },
    revisions,
    revisionsCommit,
    indexPage,
  };
  const [savedValues, setSavedValues] = useState<Partial<SpaceInfo>>(() => ({
    ...values,
    folder: initial?.folder ?? folder,
    binding: initial?.binding ?? values.binding,
  }));
  const dirtySections = (Object.keys(SPACE_SECTIONS) as SpaceSection[]).filter(
    (key) =>
      JSON.stringify(settingsPayload(values, key)) !==
      JSON.stringify(settingsPayload(savedValues, key)),
  );
  const dirtyKey = dirtySections.join(",");
  useEffect(() => {
    if (id) onDirtyChange?.(dirtySections);
  }, [id, dirtyKey, onDirtyChange]);
  const notify = useNotification("space");
  const [errorSection, setErrorSection] = useState<SpaceSection>();
  const activeDirty = dirtySections.includes(section);
  const modeBlocked =
    section === "revisions" &&
    connectionDraft &&
    revisions !== initial?.revisions;
  const visible = (value: SpaceSection) =>
    id ? section === value : value === "general";

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (saveState === "saving" || modeBlocked) return;
        notify("");
        setErrorSection(section);
        if ((!id || section === "general") && !hostBinding && !prefix.trim()) {
          setErrors([{ field: "binding", message: "prefix is required" }]);
          return;
        }
        const payload = id ? settingsPayload(values, section) : values;
        setErrors([]);
        setSaveState("saving");
        try {
          if (id) {
            await adminApi(
              "PATCH",
              `spaces/${encodeURIComponent(id)}`,
              payload,
            );
            setSavedValues((previous) => ({ ...previous, ...payload }));
            notify("Saved");
            onSaved(id, payload);
          } else {
            const result = await adminApi("POST", "spaces", payload);
            notify("Space created.");
            onSaved(result.id);
          }
        } catch (cause) {
          if ((cause as any)?.unauthorized) onUnauthorized();
          else
            setErrors(
              Array.isArray(cause)
                ? cause
                : [{ field: "", message: "Request failed" }],
            );
        } finally {
          setSaveState("idle");
        }
      }}
    >
      {!id && <h1>Create space</h1>}
      <SaveConfirmation scope="space" />
      {(!id || errorSection === section) && <FieldErrors errors={errors} />}
      <fieldset class="sb-settings-fields" disabled={saveState === "saving"}>
        <div hidden={!visible("general")}>
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
          <BindingFields
            binding={binding}
            primaryUrl={primaryUrl}
            spaces={spaces}
            currentId={id}
            onInput={(next) => {
              if (next.host !== undefined) setHostBinding(next);
              else {
                setHostBinding(null);
                if (!hostBinding && next.prefix !== prefix)
                  setPrefix(next.prefix);
              }
            }}
          />
          {initial?.bindingWarning && (
            <Alert variant="warning">{initial.bindingWarning}</Alert>
          )}
          <label for="space-folder">Folder</label>
          <FolderPicker
            id="space-folder"
            value={folder}
            onChange={setFolder}
            apiBase="api/admin"
            browseStart={folderTouched ? undefined : "spaces"}
          />
          <label for="space-index-page">Index page</label>
          <Input
            id="space-index-page"
            value={indexPage}
            onInput={(e) => setIndexPage(e.currentTarget.value)}
          />
        </div>
        <div hidden={!visible("access")}>
          <fieldset class="sb-access-table">
            <legend>Who has access</legend>
            <p class="sb-help-text">
              Note: write members can also author scripts (Space Lua, install
              libraries and plugs) that run for anyone who opens this space.
            </p>
            <div class="sb-access-row sb-access-public">
              <span class="sb-access-who">Public (not signed in)</span>
              <Select
                value={access}
                onChange={(e) =>
                  setAccess(e.currentTarget.value as SpaceAccess)
                }
              >
                <option value="none">No access</option>
                <option value="read">Read</option>
                <option value="write" disabled={readOnly}>
                  Read &amp; write
                </option>
              </Select>
            </div>
            {access === "read" && (
              <Alert variant="info">
                Anyone can read this space without signing in. Page history and
                revisions stay members-only.
              </Alert>
            )}
            {access === "write" && !readOnly && (
              <Alert variant="warning">
                Anyone on the internet can read AND EDIT this space without
                signing in. Only use for auth-proxy or VPN deployments.
              </Alert>
            )}
            {usersError && (
              <Alert variant="error">
                Could not load users:{" "}
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
            <AccessGrid
              users={users}
              members={members}
              frozen={readOnly}
              runtimeAvailable={runtimeApiUnavailable === null}
              onRuntimeChange={(username, enabled) =>
                setMembers((previous) => ({
                  ...previous,
                  [username]: { ...previous[username], runtimeApi: enabled },
                }))
              }
              onChange={(username, role) =>
                setMembers((previous) => {
                  const next = { ...previous };
                  const member = changeMemberAccess(previous[username], role);
                  if (member) next[username] = member;
                  else delete next[username];
                  return next;
                })
              }
            />
            {runtimeApiUnavailable && (
              <p class="sb-help-text">{runtimeApiUnavailable}</p>
            )}
            {readOnly && (
              <p class="sb-help-text">
                Write access is suspended while this space is frozen. Checked
                permissions are kept for when it is unfrozen.
              </p>
            )}
          </fieldset>
          <label>
            <Checkbox
              checked={readOnly}
              onChange={(e) => setReadOnly(e.currentTarget.checked)}
            />{" "}
            Freeze this space
            <span class="sb-help-text">
              Nobody can write, including admins.
            </span>
          </label>
        </div>
        <div hidden={!visible("revisions")}>
          <label for="space-revisions">Mode</label>
          <Select
            id="space-revisions"
            disabled={connectionDraft}
            aria-describedby={
              connectionDraft ? "revision-mode-help" : undefined
            }
            value={revisions}
            onChange={(e) =>
              setRevisions(e.currentTarget.value as RevisionsMode)
            }
          >
            <option value="disabled">
              Disabled: revision support switched off
            </option>
            <option value="managed">
              Managed: SilverBullet periodically commits automatically
            </option>
            <option value="unmanaged">
              Unmanaged: show revisions only, no auto commit
            </option>
          </Select>
          {connectionDraft && (
            <p id="revision-mode-help" class="sb-help-text">
              Finish or cancel Git setup below before changing revision mode.
            </p>
          )}
          {revisions === "managed" && (
            <Fragment>
              <label for="space-commit-frequency">Commit frequency</label>
              <Select
                id="space-commit-frequency"
                value={(() => {
                  const i = COMMIT_PRESETS.findIndex(
                    (p) =>
                      p.quietSecs === revisionsCommit.quietSecs &&
                      p.maxIntervalSecs === revisionsCommit.maxIntervalSecs,
                  );
                  return i >= 0 ? String(i) : "custom";
                })()}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === "custom") return;
                  const preset = COMMIT_PRESETS[Number(v)];
                  setRevisionsCommit({
                    quietSecs: preset.quietSecs,
                    maxIntervalSecs: preset.maxIntervalSecs,
                  });
                }}
              >
                {COMMIT_PRESETS.map((p, i) => (
                  <option value={String(i)} key={p.label}>
                    {p.label}
                  </option>
                ))}
                {!COMMIT_PRESETS.some(
                  (p) =>
                    p.quietSecs === revisionsCommit.quietSecs &&
                    p.maxIntervalSecs === revisionsCommit.maxIntervalSecs,
                ) && (
                  <option value="custom" disabled>
                    {`Custom (${formatDuration(revisionsCommit.quietSecs)} / ${formatDuration(
                      revisionsCommit.maxIntervalSecs,
                    )})`}
                  </option>
                )}
              </Select>
            </Fragment>
          )}
        </div>
        <div hidden={!visible("advanced")}>
          <h3>Shell commands</h3>
          <label>
            <Checkbox
              checked={shellEnabled}
              onChange={(e) => setShellEnabled(e.currentTarget.checked)}
            />{" "}
            Enable shell commands
            <span class="sb-help-text">
              For added security, leave shell off unless this space needs to run
              server commands.
            </span>
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
        </div>
      </fieldset>
      <div class="row">
        <Button
          type="submit"
          variant="primary"
          disabled={
            saveState === "saving" || modeBlocked || (!!id && !activeDirty)
          }
        >
          {saveState === "saving" ? "Saving…" : id ? "Save changes" : "Create"}
        </Button>
        {!id && (
          <a class="sb-button" href={cancelHref}>
            Cancel
          </a>
        )}
      </div>
      {id && section === "general" && (
        <div class="sb-danger-zone">
          <h3>Remove space</h3>
          <p class="sb-help-text">
            Remove this space from the server. Files on disk are kept.
          </p>
          <Button
            type="button"
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
                setErrorSection("general");
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
            Remove space
          </Button>
        </div>
      )}
    </form>
  );
}
