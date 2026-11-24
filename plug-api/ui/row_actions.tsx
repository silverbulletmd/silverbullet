import { RowMenu, type RowMenuItem } from "./row_menu.tsx";
import type { ActionMeta } from "./tree_types.ts";

export type RowActionsProps = {
  actions: ActionMeta[];
  /** Resolved icon node per action, parallel to `actions`. */
  icons?: (Element | undefined)[];
  /** Per-action `when` result; undefined while none has been computed yet. */
  mask?: boolean[];
  readOnly: boolean;
  documentMode?: boolean;
  disabled?: boolean;
  onRun: (index: number) => void;
};

/** The menu items for the actions that apply: allowed in this mode, and
 * whose `when` (if any) agreed, per `mask`. For a tree's root, only the
 * actions marked `root`. */
export function rowActionItems({
  actions,
  icons,
  mask,
  readOnly,
  disabled,
  root,
  onRun,
}: Omit<RowActionsProps, "documentMode"> & { root?: boolean }): RowMenuItem[] {
  return actions
    .map((action, index) => ({ action, index }))
    .filter(({ action, index }) => {
      if (root && !action.root) return false;
      if (readOnly && action.requireMode === "rw") return false;
      return !action.hasWhen || mask?.[index] === true;
    })
    .map(({ action, index }) => ({
      label: action.label,
      icon: icons?.[index],
      disabled,
      run: () => onRun(index),
    }));
}

/**
 * A row's actions, as one ⋯ menu (also opened by the menu key or Shift-F10
 * on the selected row; see `openRowMenu`). A right-click keeps the browser's
 * own menu. In a panel the filter input keeps focus
 * and the trigger stays out of the tab order; in a document it is a regular,
 * tabbable button whose keys stay away from the row's own.
 */
export function RowActions({ documentMode, ...props }: RowActionsProps) {
  const items = rowActionItems(props);
  if (items.length === 0) return null;
  return (
    <span
      class="sb-row-actions"
      onMouseDown={documentMode ? undefined : (e) => e.preventDefault()}
      onKeyDown={documentMode ? (e) => e.stopPropagation() : undefined}
    >
      <RowMenu label="Actions" items={items} tabIndex={documentMode ? 0 : -1} />
    </span>
  );
}
