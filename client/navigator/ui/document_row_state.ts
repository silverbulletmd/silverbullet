import {
  allNodes,
  buildTree,
  nodeObject,
} from "../../../plug-api/ui/tree_model.ts";
import type { RowState, RowStates } from "../../../plug-api/ui/tree_types.ts";
import type { Row, ViewMeta } from "../types.ts";
import { IconResolver } from "./icon_resolver.ts";

type RawRowState = {
  icon?: string;
  actions?: boolean[];
};

export type DocumentRowDispatch = (
  hook: "rowState",
  args: { objs: Record<string, any>[] },
) => Promise<any>;

export function createDocumentRowLoader(
  dispatch: DocumentRowDispatch,
  meta: ViewMeta,
): (
  rows: Row[],
) => Promise<{ rowState: RowStates; actionIcons: (Element | undefined)[] }> {
  const icons = new IconResolver();
  return async (rows) => {
    const needsState =
      meta.hasRowIcon || !!meta.actions?.some((action) => action.hasWhen);
    const nodes =
      needsState && meta.mode === "tree"
        ? allNodes(buildTree(rows, meta.hierarchy.separator, meta.foldersFirst))
        : undefined;
    let raw: RawRowState[] = [];
    if (needsState) {
      const objs = nodes ? nodes.map(nodeObject) : rows.map((row) => row.obj);
      try {
        const result = await dispatch("rowState", { objs });
        raw = Array.isArray(result) ? result : [];
      } catch (error) {
        console.error("navigator: row state failed", error);
      }
    }
    await icons.resolveIcons([
      ...(meta.actions ?? []).map((action) => action.icon),
      ...raw.map((state) => state?.icon),
    ]);
    const actionIcons = (meta.actions ?? []).map((action) =>
      icons.iconNode(action.icon),
    );
    if (!needsState) return { rowState: {}, actionIcons };
    const states: RowState[] = raw.map((state) => ({
      actions: Array.isArray(state?.actions) ? state.actions : [],
      icon: icons.iconNode(state?.icon),
    }));
    const rowState: RowStates = nodes
      ? {
          byPath: new Map(
            nodes.map((node, i) => [node.path, states[i] ?? { actions: [] }]),
          ),
        }
      : {
          byRow: new WeakMap(
            rows.map((row, i) => [row, states[i] ?? { actions: [] }] as const),
          ),
        };
    return { rowState, actionIcons };
  };
}
