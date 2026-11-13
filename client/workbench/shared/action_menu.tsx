import { useEffect, useRef } from "preact/hooks";
import {
  moreIcon,
  widgetActionIcon,
} from "../../codemirror/widgets/widget_menu.ts";
import { togglePopupMenu } from "../../components/popup_menu.ts";
import type { Action } from "./action.ts";

/** A row's ⋯ menu: the same button and popup as a `${…}` widget's. */
export function ActionMenu<Deps>({
  actions,
  deps,
}: {
  actions: Action<Deps>[];
  deps: Deps;
}) {
  const close = useRef<() => void>();
  useEffect(() => () => close.current?.(), []);
  if (!actions.length) return null;
  return (
    <button
      type="button"
      className="sb-wb-menu"
      title="Actions"
      aria-label="Actions"
      aria-haspopup="menu"
      onClick={(e) => {
        // A row's own click (e.g. opening its source) must not fire too
        e.stopPropagation();
        const button = e.currentTarget;
        close.current = togglePopupMenu(
          button,
          actions.map((a) => ({
            kind: "item" as const,
            label: a.label,
            icon: widgetActionIcon(a.icon),
            disabled: a.disabled,
            run: () => {
              a.run(deps).catch((err) =>
                console.error("workbench: action failed", err),
              );
            },
          })),
          { className: "sb-widget-menu" },
        );
      }}
      dangerouslySetInnerHTML={{ __html: moreIcon }}
    />
  );
}
