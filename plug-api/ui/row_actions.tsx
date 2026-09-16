import { Icon } from "./icon.tsx";
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

export function RowActions({
  actions,
  icons,
  mask,
  readOnly,
  documentMode,
  disabled,
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
            tabIndex={documentMode ? 0 : -1}
            title={action.label}
            aria-label={action.label}
            disabled={disabled}
            onMouseDown={documentMode ? undefined : (e) => e.preventDefault()}
            onKeyDown={documentMode ? (e) => e.stopPropagation() : undefined}
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
