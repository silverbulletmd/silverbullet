import { h } from "preact";
import {
  CopyIcon,
  DefinitionIcon,
  iconElement,
} from "../../components/chrome_icons.tsx";
import type { PopupEntry } from "../../components/popup_menu.ts";
import { iconSvg } from "../../../plug-api/ui/icons/registry.ts";

export type WidgetActionId =
  | "definition"
  | "open"
  | "edit"
  | "show"
  | "query"
  // An icon only (the Workbench's refresh buttons): no widget menu reloads
  | "reload"
  | "copy"
  | "bake"
  | "remove"
  | "moveUp"
  | "moveDown"
  | "revert";

export type WidgetCaps = {
  definition: boolean;
  open: boolean;
  edit: boolean;
  copy: boolean;
  /** Delete the object the widget shows */
  remove: boolean;
};

const ACTION_ICONS: Record<
  Exclude<WidgetActionId, "copy" | "definition">,
  string
> = {
  open: "eye",
  edit: "square-pen",
  show: "eye",
  query: "sliders-vertical",
  reload: "refresh-cw",
  bake: "package",
  moveUp: "arrow-up",
  moveDown: "arrow-down",
  revert: "rotate-ccw",
  remove: "trash",
};

const MENU_ICON_SIZE = 15;

export const moreIcon = iconSvg("ellipsis-vertical", { size: MENU_ICON_SIZE });

export function widgetActionIcon(id: WidgetActionId): string | Node {
  if (id === "copy") return iconElement(h(CopyIcon, {}));
  if (id === "definition") return iconElement(h(DefinitionIcon, {}));
  return iconSvg(ACTION_ICONS[id], { size: MENU_ICON_SIZE });
}

/** One ⋯ menu item, with the icon every widget menu uses for `id`. */
export function widgetMenuItem<Id extends WidgetActionId>(
  id: Id,
  label: string,
): Extract<PopupEntry<Id>, { kind: "item" }> {
  return { kind: "item", id, label, icon: widgetActionIcon(id) };
}

/** The menu of a widget other than a `${…}` (that's `directiveMenuEntries`) */
export function widgetMenuEntries(
  caps: WidgetCaps,
): PopupEntry<WidgetActionId>[] {
  const out: PopupEntry<WidgetActionId>[] = [];
  const action = (id: WidgetActionId, label: string) =>
    out.push(widgetMenuItem(id, label));
  if (caps.definition) action("definition", "Go to definition");
  if (caps.open) action("open", "Open");
  if (caps.edit) action("edit", "Edit source");
  if (caps.copy) action("copy", "Copy as Markdown");
  if (caps.remove) {
    out.push({ kind: "separator" });
    action("remove", "Delete");
  }
  return out;
}
