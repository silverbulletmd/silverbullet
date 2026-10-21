import { useMemo } from "preact/hooks";
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
import { blockSourceRef, refMatches } from "../shared/blocks.ts";
import type { TabProps } from "../tab.ts";
import {
  type StyleActionDeps,
  type StyleStatus,
  styleActions,
  styleStatus,
} from "./styles.ts";

const STATUS_TITLES: Record<StyleStatus, string> = {
  applied: "Applied",
  empty:
    "No rules parsed: the browser dropped this CSS, which usually means a syntax error",
};

export function StylesView({ client, focusTarget }: TabProps) {
  const { spaceStyles } = client;
  const load = useLoad(spaceStyles);
  const styles = load?.styles ?? [];
  const blocks = useBlockFilter(styles, focusTarget);
  const visible = useMemo(
    () => blocks.fromOrigin.filter((s) => refMatches(s, blocks.phrase)),
    [blocks.fromOrigin, blocks.phrase],
  );
  const totalRules = useMemo(
    () => styles.reduce((n, s) => n + s.rules, 0),
    [styles],
  );

  const deps = useMemo(
    (): StyleActionDeps => ({
      openSource: async (ref) => {
        const target = blockSourceRef(ref, "space-style");
        if (target) await openRef(client, target);
      },
      copyText: (text) => copyText(client, text),
    }),
    [client],
  );

  return (
    <div className="sb-workbench">
      <BlockToolbar
        noun="styles"
        filter={blocks}
        onReload={() => void spaceStyles.load()}
      />
      <div className="sb-workbench-body">
        {client.bootConfig.disableSpaceStyle ? (
          <BlockNote>Space Style is disabled for this space.</BlockNote>
        ) : !load ? (
          <BlockNote>Styles haven't loaded yet.</BlockNote>
        ) : styles.length === 0 ? (
          <BlockNote>
            This space has no <code>space-style</code> blocks.
          </BlockNote>
        ) : (
          <BlockTable label="Styles" columns={["Style", "Priority", "Rules"]}>
            {visible.map((s) => {
              const status = styleStatus(s);
              return (
                <BlockRow
                  key={s.ref}
                  block={s}
                  label={blocks.labels.get(s.ref) ?? { page: s.ref }}
                  status={status}
                  statusTitle={STATUS_TITLES[status]}
                  numbers={[s.priority ?? "–", s.rules]}
                  menu={<ActionMenu actions={styleActions(s)} deps={deps} />}
                  onOpen={() => void deps.openSource(s.ref)}
                />
              );
            })}
          </BlockTable>
        )}
      </div>
      {load && styles.length > 0 ? (
        <div className="sb-wb-footer">
          <span>
            {styles.length} style{styles.length === 1 ? "" : "s"}
          </span>
          <span>
            {totalRules} rule{totalRules === 1 ? "" : "s"}
          </span>
          <span>loaded {new Date(load.loadedAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </div>
  );
}
