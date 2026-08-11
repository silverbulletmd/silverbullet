import { Icon } from "./icon.tsx";
import type { ActionMeta } from "./tree_types.ts";

export type RowActionsProps = {
  actions: ActionMeta[];
  /** Resolved icon node per action, parallel to `actions`. */
  icons?: (Element | undefined)[];
  /** Per-action `when` result; undefined while none has been computed yet. */
  mask?: boolean[];
  readOnly: boolean;
  onRun: (index: number) => void;
};

/**
 * The quiet icon buttons at a row's right edge. Meant to be mounted only for
 * the selected row and the row under the pointer, shown by CSS on hover and
 * on the selected row -- so a long list carries no button DOM it isn't about
 * to show, and the selected row remains the keyboard/touch path to the same
 * actions.
 */
export function RowActions({
  actions,
  icons,
  mask,
  readOnly,
  onRun,
}: RowActionsProps) {
  const visible = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action, index }) => {
      if (readOnly && action.requireMode === "rw") return false;
      return !action.hasWhen || mask?.[index] === true;
    });
  if (visible.length === 0) return null;
  return (
    <span class="sb-row-actions">
      {visible.map(({ action, index }) => {
        const icon = icons?.[index];
        return (
          <button
            key={index}
            type="button"
            class="sb-row-action"
            // Not a tab stop: the caller's own input keeps focus throughout,
            // and keyboard users reach the same operations another way.
            tabIndex={-1}
            title={action.label}
            aria-label={action.label}
            // A mousedown on a button blurs whatever input has focus before
            // the click ever lands; suppressing the default keeps focus where
            // it belongs (and keeps the row's own click handler out of it).
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onRun(index);
            }}
          >
            {icon ? (
              <Icon node={icon} class="sb-row-action-icon" />
            ) : (
              <span class="sb-row-action-label">{action.label}</span>
            )}
          </button>
        );
      })}
    </span>
  );
}
