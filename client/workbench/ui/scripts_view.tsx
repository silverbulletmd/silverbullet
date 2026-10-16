import { Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import { LuaRuntimeError } from "../../space_lua/runtime.ts";
import {
  resolveASTReference,
  type ScriptLoad,
  type ScriptRecord,
} from "../../space_lua.ts";
import { copyText, openRef } from "../action.ts";
import {
  filterScripts,
  formatLoadTime,
  originCounts,
  type ScriptActionDeps,
  type ScriptFilter,
  type ScriptOrigin,
  scriptActions,
  scriptCounts,
  scriptLabels,
  scriptsFrom,
} from "../scripts.ts";
import type { SourceLookup } from "../source_frames.ts";
import { errorMessage } from "../value_preview.ts";
import { ActionMenu } from "./action_menu.tsx";
import { errorFrames, LuaErrorDetails, type OpenTarget } from "./lua_error.tsx";
import type { TabProps } from "./tab.ts";

const ORIGINS: { value: ScriptOrigin; label: string }[] = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "builtin", label: "Built-in" },
];

const FILTERS: { value: ScriptFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "loaded", label: "Loaded" },
  { value: "failed", label: "Failed" },
  { value: "quarantined", label: "Quarantined" },
];

const STATUS_TITLES: Record<ScriptRecord["status"], string> = {
  loaded: "Loaded",
  failed: "Failed to load",
  stopped: "Stopped while loading; quarantined from the next load",
  quarantined: "Quarantined: skipped until re-enabled or edited",
};

/** What rows need besides their record; stable across renders. */
type RowContext = {
  deps: ScriptActionDeps;
  onOpen: OpenTarget;
  sourceFor: SourceLookup;
};

export function ScriptsView({ client, focusTarget }: TabProps) {
  const luaEnv = client.clientSystem.spaceLuaEnv;
  const [load, setLoad] = useState<ScriptLoad | undefined>(luaEnv.lastLoad);
  const [phrase, setPhrase] = useState("");
  const [origin, setOrigin] = useState(0);
  const [filter, setFilter] = useState(0);
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoad(luaEnv.lastLoad);
    return luaEnv.onLoad(setLoad);
  }, [luaEnv]);

  useEffect(() => {
    const el = filterInput.current;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  const scripts = load?.scripts ?? [];
  const labels = useMemo(() => scriptLabels(scripts), [scripts]);
  const origins = useMemo(() => originCounts(scripts), [scripts]);
  // Status counts follow the picked origin
  const fromOrigin = useMemo(
    () => scriptsFrom(scripts, ORIGINS[origin].value),
    [scripts, origin],
  );
  const counts = useMemo(() => scriptCounts(fromOrigin), [fromOrigin]);
  const visible = useMemo(
    () => filterScripts(fromOrigin, phrase, FILTERS[filter].value),
    [fromOrigin, phrase, filter],
  );

  const ctx = useMemo((): RowContext => {
    const { clientSystem } = client;
    return {
      deps: {
        openSource: async (ref) => {
          const target = resolveASTReference({ ref, from: 0 });
          if (target) await openRef(client, target);
        },
        copyText: (text) => copyText(client, text),
        reEnable: (ref) => clientSystem.reEnableScripts([ref]),
      },
      // Script errors point into pages, never into console input
      onOpen: (target) => {
        if (target.kind === "page") void openRef(client, target.ref);
      },
      sourceFor: (ref) => clientSystem.spaceLuaEnv.sourceFor(ref),
    };
  }, [client]);

  return (
    <div className="sb-workbench">
      <div className="sb-wb-toolbar">
        <input
          ref={filterInput}
          type="search"
          className="sb-wb-filter"
          placeholder="Filter scripts"
          aria-label="Filter scripts"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={phrase}
          onInput={(e) => setPhrase(e.currentTarget.value)}
        />
        <SegmentedControl
          items={ORIGINS.map((o) => ({
            label: `${o.label} ${origins[o.value]}`,
          }))}
          activeIndex={origin}
          onPick={setOrigin}
          takeFocus
          ariaLabel="Show scripts from"
        />
        <SegmentedControl
          items={FILTERS.map((f) => ({
            label: `${f.label} ${counts[f.value]}`,
          }))}
          activeIndex={filter}
          onPick={setFilter}
          takeFocus
          ariaLabel="Show scripts"
        />
        <Button onClick={() => void client.clientSystem.loadLuaScripts()}>
          Reload
        </Button>
      </div>
      <div className="sb-workbench-body">
        {client.bootConfig.disableSpaceLua ? (
          <div className="sb-wb-empty">
            Space Lua is disabled for this space.
          </div>
        ) : !load ? (
          <div className="sb-wb-empty">Scripts haven't loaded yet.</div>
        ) : scripts.length === 0 ? (
          <div className="sb-wb-empty">
            This space has no <code>space-lua</code> blocks.
          </div>
        ) : (
          <div className="sb-wb-scripts" role="table" aria-label="Scripts">
            <div className="sb-wb-script sb-wb-script-head" role="row">
              <span role="columnheader" aria-label="Status" />
              <span role="columnheader">Script</span>
              <span role="columnheader" className="sb-wb-num">
                Priority
              </span>
              <span role="columnheader" className="sb-wb-num">
                Load
              </span>
              <span role="columnheader" aria-label="Actions" />
            </div>
            {visible.map((r) => (
              <ScriptRow
                key={r.ref}
                record={r}
                label={labels.get(r.ref) ?? { page: r.ref }}
                ctx={ctx}
              />
            ))}
          </div>
        )}
      </div>
      {load && scripts.length > 0 ? (
        <div className="sb-wb-footer">
          <span>
            {scripts.length} script{scripts.length === 1 ? "" : "s"}
          </span>
          <span>{Math.round(load.ms)} ms total</span>
          <span>loaded {new Date(load.loadedAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </div>
  );
}

function ScriptRow({
  record,
  label,
  ctx,
}: {
  record: ScriptRecord;
  label: { page: string; pos?: number };
  ctx: RowContext;
}) {
  return (
    <>
      <div
        className={`sb-wb-script sb-wb-script-${record.status}`}
        role="row"
        title={record.ref}
        onClick={() => void ctx.deps.openSource(record.ref)}
      >
        <span
          className="sb-wb-status"
          role="cell"
          title={STATUS_TITLES[record.status]}
          aria-label={STATUS_TITLES[record.status]}
        />
        <span className="sb-wb-script-name" role="cell">
          {label.page}
          {label.pos !== undefined ? (
            <span className="sb-wb-muted">@{label.pos}</span>
          ) : null}
        </span>
        <span className="sb-wb-num" role="cell">
          {record.priority}
        </span>
        <span className="sb-wb-num" role="cell">
          {formatLoadTime(record)}
        </span>
        <span role="cell">
          <ActionMenu actions={scriptActions(record)} deps={ctx.deps} />
        </span>
      </div>
      {record.status === "failed" ? (
        <div className="sb-wb-script-error" role="row">
          <div role="cell">
            {record.error instanceof LuaRuntimeError ? (
              <LuaErrorDetails
                err={record.error}
                frames={errorFrames(record.error, ctx.sourceFor)}
                onOpen={ctx.onOpen}
              />
            ) : (
              <div className="sb-wb-message">{errorMessage(record.error)}</div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
