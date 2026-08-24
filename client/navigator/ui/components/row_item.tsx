import type { Ref } from "preact";
import { highlightMatches } from "../../../../plug-api/ui/highlight.tsx";
import {
  type HoverTracker,
  useHovered,
} from "../../../../plug-api/ui/hover.ts";
import { Icon } from "../../../../plug-api/ui/icon.tsx";
import { RowActions } from "../../../../plug-api/ui/row_actions.tsx";
import type { RowState } from "../engine.ts";
import type { ActionMeta, Decoration, Row } from "../../types.ts";

function Chip({ decoration }: { decoration: Decoration }) {
  return (
    <span
      className={"sb-nav-chip " + (decoration.cssClass ?? "")}
      title={decoration.title}
    >
      {decoration.text ?? decoration.icon}
    </span>
  );
}

export function RowItem({
  row,
  index,
  selected,
  actions,
  actionIcons,
  hover,
  state,
  hasIcon,
  readOnly,
  phrase,
  onClick,
  onAction,
  elRef,
}: {
  row: Row;
  /** Position in the rendered list -- the hover tracking reads it back. */
  index: number;
  selected: boolean;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  /** Decides, per row, whether this one's actions are worth mounting. */
  hover: HoverTracker;
  state?: RowState;
  /** Whether the view defines row icons at all, i.e. reserves the slot. */
  hasIcon: boolean;
  readOnly: boolean;
  /** The phrase ranking rows, for matched-character highlighting -- undefined while it's empty. */
  phrase?: string;
  onClick: () => void;
  onAction: (index: number) => void;
  elRef?: Ref<HTMLDivElement>;
}) {
  const decorations = row.decorations ?? [];
  // Unconditional: a hook call behind `selected ||` would change the hook
  // order the moment the selection moved onto this row.
  const hovered = useHovered(hover, row);
  const showActions = selected || hovered;
  const left = decorations.filter((d) => d.position === "left");
  const right = decorations.filter((d) => d.position !== "left");
  return (
    <div
      ref={elRef}
      className={
        "sb-nav-row" +
        (selected ? " sb-nav-selected" : "") +
        (row.cssClass ? ` ${row.cssClass}` : "")
      }
      data-index={index}
      onClick={onClick}
    >
      {hasIcon &&
        (state?.icon ? (
          <Icon node={state.icon} class="sb-nav-icon" />
        ) : (
          // Empty, not absent: rows stay aligned whether or not this object
          // resolved an icon.
          <span className="sb-nav-icon" />
        ))}
      {left.map((d, i) => (
        <Chip key={`l${i}`} decoration={d} />
      ))}
      <span className="sb-nav-primary">
        {highlightMatches(row.primary, phrase)}
      </span>
      {row.description && (
        <span className="sb-nav-description">{row.description}</span>
      )}
      {right.map((d, i) => (
        <Chip key={`r${i}`} decoration={d} />
      ))}
      {actions && showActions && (
        <RowActions
          actions={actions}
          icons={actionIcons}
          mask={state?.actions}
          readOnly={readOnly}
          onRun={onAction}
        />
      )}
    </div>
  );
}
