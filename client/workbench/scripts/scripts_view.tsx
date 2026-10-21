import { useMemo, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import { LuaRuntimeError } from "../../space_lua/runtime.ts";
import type { ScriptRecord } from "../../space_lua.ts";
import { copyText, openRef } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import {
  BlockNote,
  BlockRow,
  BlockTable,
  BlockToolbar,
  useBlockFilter,
  useLoad,
} from "../shared/block_ui.tsx";
import { blockSourceRef } from "../shared/blocks.ts";
import {
  errorFrames,
  LuaErrorDetails,
  type OpenTarget,
} from "../shared/lua_error.tsx";
import type { SourceLookup } from "../shared/source_frames.ts";
import { errorMessage } from "../shared/value_preview.ts";
import type { TabProps } from "../tab.ts";
import {
  filterScripts,
  formatLoadTime,
  SCRIPT_STATUS_TITLES,
  type ScriptActionDeps,
  type ScriptFilter,
  scriptActions,
  scriptCounts,
} from "./scripts.ts";

const FILTERS: { value: ScriptFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "loaded", label: "Loaded" },
  { value: "failed", label: "Failed" },
  { value: "quarantined", label: "Quarantined" },
];

/** What rows need besides their record; stable across renders. */
type RowContext = {
  deps: ScriptActionDeps;
  onOpen: OpenTarget;
  sourceFor: SourceLookup;
};

export function ScriptsView({ client, focusTarget }: TabProps) {
  const { clientSystem } = client;
  const load = useLoad(clientSystem.spaceLuaEnv);
  const scripts = load?.scripts ?? [];
  const blocks = useBlockFilter(scripts, focusTarget);
  const [filter, setFilter] = useState(0);
  // Status counts follow the picked origin
  const counts = useMemo(
    () => scriptCounts(blocks.fromOrigin),
    [blocks.fromOrigin],
  );
  const visible = useMemo(
    () =>
      filterScripts(blocks.fromOrigin, blocks.phrase, FILTERS[filter].value),
    [blocks.fromOrigin, blocks.phrase, filter],
  );

  const ctx = useMemo(
    (): RowContext => ({
      deps: {
        openSource: async (ref) => {
          const target = blockSourceRef(ref, "space-lua");
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
    }),
    [client],
  );

  return (
    <div className="sb-workbench">
      <BlockToolbar
        noun="scripts"
        filter={blocks}
        onReload={() => void clientSystem.loadLuaScripts()}
      >
        <SegmentedControl
          items={FILTERS.map((f) => ({
            label: `${f.label} ${counts[f.value]}`,
          }))}
          activeIndex={filter}
          onPick={setFilter}
          takeFocus
          ariaLabel="Show scripts"
        />
      </BlockToolbar>
      <div className="sb-workbench-body">
        {client.bootConfig.disableSpaceLua ? (
          <BlockNote>Space Lua is disabled for this space.</BlockNote>
        ) : !load ? (
          <BlockNote>Scripts haven't loaded yet.</BlockNote>
        ) : scripts.length === 0 ? (
          <BlockNote>
            This space has no <code>space-lua</code> blocks.
          </BlockNote>
        ) : (
          <BlockTable label="Scripts" columns={["Script", "Priority", "Load"]}>
            {visible.map((r) => (
              <ScriptRow
                key={r.ref}
                record={r}
                label={blocks.labels.get(r.ref) ?? { page: r.ref }}
                ctx={ctx}
              />
            ))}
          </BlockTable>
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
      <BlockRow
        block={record}
        label={label}
        status={record.status}
        statusTitle={SCRIPT_STATUS_TITLES[record.status]}
        numbers={[record.priority, formatLoadTime(record)]}
        menu={<ActionMenu actions={scriptActions(record)} deps={ctx.deps} />}
        onOpen={() => void ctx.deps.openSource(record.ref)}
      />
      {record.status === "failed" ? (
        <div className="sb-wb-block-error" role="row">
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
