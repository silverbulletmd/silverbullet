import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { HoverTracker, resolveHover } from "../../../../plug-api/ui/hover.ts";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import type { RankedRow, RowStates } from "../engine.ts";
import type { ActionMeta } from "../types.ts";
import { RowItem } from "./row_item.tsx";

export function ListView({
  rows,
  selectedIndex,
  showEmpty,
  actions,
  actionIcons,
  rowState,
  hasIcon,
  readOnly,
  phrase,
  createRow,
  onSelect,
  onAction,
}: {
  /** An `undefined` entry is the create row's slot -- see `createRow`. */
  rows: (RankedRow | undefined)[];
  selectedIndex: number;
  showEmpty: boolean;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  rowState?: RowStates;
  hasIcon: boolean;
  readOnly: boolean;
  /** The phrase ranking rows, for matched-character highlighting -- undefined while it's empty. */
  phrase?: string;
  /**
   * Renders the create row, which the list holds a slot for rather than
   * appending: it belongs *second*, under the best match, so one ArrowDown
   * from the top row means "create it instead".
   */
  createRow?: (selected: boolean) => ComponentChildren;
  onSelect: (index: number) => void;
  onAction: (index: number, actionIndex: number) => void;
}) {
  const selectedRef = useRef<HTMLDivElement>(null);
  // Which row's actions are mounted besides the selected one's. Outside the
  // render tree (see hover.ts), and delegated rather than a listener per row.
  const hover = useMemo(() => new HoverTracker(), []);

  /** The row a DOM node sits in, by identity -- never by position. */
  const rowAt = (node: Element | null | undefined) => {
    const el = node?.closest?.("[data-index]") as HTMLElement | null;
    const index = el?.dataset?.index;
    return index === undefined ? undefined : rows[Number(index)]?.row;
  };

  // Deliberately keyed on the selection alone: a refresh replaces `rows`
  // without moving the selection, and re-revealing there would yank the
  // user's manual scroll position back.
  useEffect(() => {
    revealInClosest(selectedRef.current, ".sb-nav-body");
  }, [selectedIndex]);

  // A new set of rows, or a scroll the pointer didn't ask for: whatever it was
  // over may be gone, and a different row now sits where it is parked.
  useEffect(() => {
    resolveHover(hover, rowAt);
  }, [rows, selectedIndex, hover]);

  if (rows.length === 0) {
    return showEmpty ? <div className="sb-nav-empty">No results</div> : null;
  }

  return (
    <div
      className="sb-nav-list"
      onPointerOver={(e) => hover.track(e, rowAt)}
      onPointerLeave={() => hover.set(undefined)}
    >
      {rows.map((entry, i) =>
        entry === undefined ? (
          <Fragment key="create">{createRow?.(i === selectedIndex)}</Fragment>
        ) : (
          <RowItem
            key={i}
            row={entry.row}
            index={i}
            selected={i === selectedIndex}
            actions={actions}
            actionIcons={actionIcons}
            hover={hover}
            state={rowState?.byRow?.get(entry.row)}
            hasIcon={hasIcon}
            readOnly={readOnly}
            phrase={phrase}
            elRef={i === selectedIndex ? selectedRef : undefined}
            onClick={() => onSelect(i)}
            onAction={(actionIndex) => onAction(i, actionIndex)}
          />
        ),
      )}
    </div>
  );
}
