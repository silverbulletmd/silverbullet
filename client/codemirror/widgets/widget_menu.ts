import { h } from "preact";
import type { PopupEntry } from "../../components/popup_menu.ts";
import {
  CopyIcon,
  DefinitionIcon,
  iconElement,
} from "../../components/chrome_icons.tsx";

export type WidgetActionId =
  | "definition"
  | "open"
  | "edit"
  | "query"
  | "reload"
  | "copy"
  | "bake"
  | "remove"
  | "revert";

export type WidgetCaps = {
  definition: boolean;
  open: boolean;
  edit: boolean;
  /** A `query[[…]]` the Workbench's query builder can open */
  query: boolean;
  copy: boolean;
  bake: boolean;
};

const feather = (name: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-${name}">${body}</svg>`;

const editIcon = feather(
  "edit",
  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
);

export const moreIcon = feather(
  "more-horizontal",
  '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
);

const ICONS: Record<Exclude<WidgetActionId, "copy" | "definition">, string> = {
  open: feather(
    "eye",
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
  ),
  edit: editIcon,
  query: feather(
    "sliders",
    '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>',
  ),
  reload: feather(
    "refresh-cw",
    '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
  ),
  bake: feather(
    "package",
    '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
  ),
  revert: feather(
    "rotate-ccw",
    '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
  ),
  remove: feather(
    "trash-2",
    '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
  ),
};

export function widgetActionIcon(id: WidgetActionId): string | Node {
  if (id === "copy") return iconElement(h(CopyIcon, {}));
  if (id === "definition") return iconElement(h(DefinitionIcon, {}));
  return ICONS[id];
}

/** One ⋯ menu item, with the icon every widget menu uses for `id`. */
export function widgetMenuItem<Id extends WidgetActionId>(
  id: Id,
  label: string,
): PopupEntry<Id> {
  return { kind: "item", id, label, icon: widgetActionIcon(id) };
}

export function widgetMenuEntries(
  caps: WidgetCaps,
): PopupEntry<WidgetActionId>[] {
  const out: PopupEntry<WidgetActionId>[] = [];
  const action = (id: WidgetActionId, label: string) =>
    out.push(widgetMenuItem(id, label));
  if (caps.definition) action("definition", "Go to definition");
  if (caps.open) action("open", "Open");
  if (caps.edit) action("edit", "Edit source");
  if (caps.query) action("query", "Edit in query builder");
  action("reload", "Reload");
  if (caps.copy) action("copy", "Copy as Markdown");
  if (caps.bake) {
    out.push({ kind: "separator" });
    action("bake", "Bake into page");
  }
  return out;
}
