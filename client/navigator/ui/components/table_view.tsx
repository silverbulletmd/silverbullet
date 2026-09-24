import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Checkbox } from "../../../../plug-api/ui/checkbox.tsx";
import { RowActions } from "../../../../plug-api/ui/row_actions.tsx";
import type { RowStates } from "../../../../plug-api/ui/tree_types.ts";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import type { Client } from "../../../client.ts";
import { activateOnKey, isRowActivation } from "../../page_widget_logic.ts";
import { tableValueParts } from "../../table_model.ts";
import type { ActionMeta, Row, TableColumn } from "../../types.ts";
import { MarkdownText, renderRowMarkdown } from "./row_markdown.tsx";

function CellString({
  text,
  client,
  pageName,
}: {
  text: string;
  client: Client;
  pageName?: string;
}) {
  const [rendered, setRendered] = useState<{
    text: string;
    node?: HTMLElement;
  }>();
  useEffect(() => {
    let live = true;
    void renderRowMarkdown(client, text, pageName).then((node) => {
      if (live) setRendered({ text, node });
    });
    return () => {
      live = false;
    };
  }, [client, text, pageName]);
  return rendered?.text === text && rendered.node ? (
    <MarkdownText
      client={client}
      node={rendered.node}
      className="sb-table-markdown"
    />
  ) : (
    <>{text}</>
  );
}

export function TableView({
  rows,
  columns,
  client,
  pageName,
  onSelect,
  selectedIndex,
  actions,
  actionIcons,
  rowState,
  readOnly = false,
  actionsDisabled = false,
  onAction,
  createRow,
}: {
  rows: (Row | undefined)[];
  columns: TableColumn[];
  client: Client;
  pageName?: string;
  onSelect?: (index: number) => void;
  selectedIndex?: number;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  rowState?: RowStates;
  readOnly?: boolean;
  actionsDisabled?: boolean;
  onAction?: (index: number, action: number) => void | Promise<void>;
  createRow?: (selected: boolean) => ComponentChildren;
}) {
  const selectedRef = useRef<HTMLTableRowElement>(null);
  const [busy, setBusy] = useState(false);
  const pendingAction = useRef(false);
  const keys = useMemo(() => new WeakMap<Row, number>(), []);
  const nextKey = useRef(0);
  useEffect(() => {
    if (onSelect) revealInClosest(selectedRef.current, ".sb-nav-body");
  }, [selectedIndex]);
  const runAction = async (index: number, action: number) => {
    if (pendingAction.current || actionsDisabled) return;
    pendingAction.current = true;
    setBusy(true);
    try {
      await onAction?.(index, action);
    } finally {
      pendingAction.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="sb-table-scroll"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        )
          event.stopPropagation();
      }}
    >
      <table className="sb-view-table">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" data-type={column.type}>
                {column.label}
              </th>
            ))}
            {!!actions?.length && (
              <th
                className="sb-table-actions"
                scope="col"
                aria-label="Actions"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            if (!row)
              return (
                <tr key="create">
                  <td colSpan={columns.length + (actions?.length ? 1 : 0)}>
                    {createRow?.(index === selectedIndex)}
                  </td>
                </tr>
              );
            let key = keys.get(row);
            if (key === undefined) {
              key = nextKey.current++;
              keys.set(row, key);
            }
            const activate = () => onSelect?.(index);
            return (
              <tr
                key={key}
                className={
                  (onSelect ? "sb-table-selectable" : "sb-table-passive") +
                  (onSelect && index === selectedIndex
                    ? " sb-nav-selected"
                    : "") +
                  (row.cssClass ? ` ${row.cssClass}` : "")
                }
                ref={
                  onSelect && index === selectedIndex ? selectedRef : undefined
                }
                tabIndex={onSelect ? 0 : undefined}
                onClick={
                  onSelect
                    ? (event) => {
                        if (isRowActivation(event.target)) activate();
                      }
                    : undefined
                }
                onKeyDown={
                  onSelect
                    ? (event) => {
                        if (event.target === event.currentTarget)
                          activateOnKey(event, activate);
                      }
                    : undefined
                }
              >
                {columns.map((column, columnIndex) => (
                  <td key={columnIndex} data-type={column.type}>
                    {tableValueParts(
                      row.cells
                        ? row.cells[columnIndex]
                        : column.attribute === undefined
                          ? undefined
                          : row.obj[column.attribute],
                      column.type,
                    ).map((part, partIndex) =>
                      part.boolean !== undefined ? (
                        <Checkbox
                          key={partIndex}
                          checked={part.boolean}
                          disabled
                          aria-label={part.text}
                          title={part.text}
                        />
                      ) : part.url ? (
                        <a
                          key={partIndex}
                          href={part.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            client.openUrl(part.url!);
                          }}
                        >
                          {part.text}
                        </a>
                      ) : part.markdown ? (
                        <CellString
                          key={partIndex}
                          text={part.text}
                          client={client}
                          pageName={pageName}
                        />
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      ),
                    )}
                  </td>
                ))}
                {!!actions?.length && (
                  <td className="sb-table-actions">
                    <RowActions
                      actions={actions}
                      icons={actionIcons}
                      mask={rowState?.byRow?.get(row)?.actions}
                      readOnly={readOnly}
                      documentMode
                      disabled={actionsDisabled || busy}
                      onRun={(action) => void runAction(index, action)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
