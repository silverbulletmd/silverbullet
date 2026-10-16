import { useEffect, useRef } from "preact/hooks";
import {
  moreIcon,
  widgetActionIcon,
} from "../../codemirror/widgets/widget_menu.ts";
import { openPopupMenu } from "../../components/popup_menu.ts";
import type { LogEntry } from "../console_log.ts";
import { type ActionDeps, entryActions } from "../entry_actions.ts";

/** A log entry's ⋯ menu: the same button and popup as a `${…}` widget's. */
export function EntryMenu({
  entry,
  deps,
}: {
  entry: LogEntry;
  deps: ActionDeps;
}) {
  const close = useRef<() => void>();
  useEffect(() => () => close.current?.(), []);
  const actions = entryActions(entry);
  if (!actions.length) return null;
  return (
    <button
      type="button"
      className="sb-wb-menu"
      title="Entry actions"
      aria-label="Entry actions"
      aria-haspopup="menu"
      onClick={(e) => {
        const button = e.currentTarget;
        if (button.getAttribute("aria-expanded") === "true") {
          close.current?.();
          return;
        }
        close.current = openPopupMenu(
          button,
          actions.map((a, i) => ({
            kind: "item" as const,
            id: String(i),
            label: a.label,
            icon: widgetActionIcon(a.icon),
          })),
          (id) => {
            actions[Number(id)]
              ?.run(deps)
              .catch((err) =>
                console.error("workbench: entry action failed", err),
              );
          },
          "sb-widget-menu",
        );
      }}
      dangerouslySetInnerHTML={{ __html: moreIcon }}
    />
  );
}
