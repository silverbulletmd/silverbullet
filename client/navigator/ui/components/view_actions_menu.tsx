import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { useEffect, useRef } from "preact/hooks";
import type { Client } from "../../../client.ts";
import { openPopupMenu } from "../../../components/popup_menu.ts";
import {
  moreIcon,
  widgetMenuItem,
} from "../../../codemirror/widgets/widget_menu.ts";

/**
 * A docked view's ⋯ menu: the same button and popup as a `${…}` widget's, for
 * the actions beside the dock menu and ×. Absent when there are none.
 */
export function ViewActionsMenu({
  client,
  definition,
  copy,
}: {
  client: Pick<Client, "navigate">;
  definition?: Ref;
  copy?: () => Promise<void>;
}) {
  const close = useRef<() => void>();
  useEffect(() => () => close.current?.(), []);
  if (!definition && !copy) return null;
  return (
    <div className="sb-dock-menu-anchor">
      <button
        type="button"
        className="sb-nav-actions"
        data-button="menu"
        title="Widget actions"
        aria-label="Widget actions"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const button = e.currentTarget;
          if (button.getAttribute("aria-expanded") === "true") {
            close.current?.();
            return;
          }
          const entries = [
            ...(definition
              ? [widgetMenuItem("definition", "Go to definition")]
              : []),
            ...(copy ? [widgetMenuItem("copy", "Copy as Markdown")] : []),
          ];
          close.current = openPopupMenu(
            button,
            entries,
            (id) => {
              if (id === "definition" && definition) {
                void client.navigate(definition);
              } else if (id === "copy" && copy) {
                copy().catch(console.error);
              }
            },
            "sb-widget-menu",
          );
        }}
        dangerouslySetInnerHTML={{ __html: moreIcon }}
      />
    </div>
  );
}
