import { h } from "preact";
import type { PopupEntry } from "../../components/popup_menu.ts";
import {
  CopyIcon,
  DefinitionIcon,
  iconElement,
} from "../../components/chrome_icons.tsx";
import type { LiveToggle } from "./directive_actions.ts";

export type WidgetActionId =
  | "definition"
  | "open"
  | "edit"
  | "reload"
  | "copy"
  | "bake"
  | "makeLive"
  | "makeStatic";

export type WidgetCaps = {
  definition: boolean;
  open: boolean;
  edit: boolean;
  live?: string[];
  copy: boolean;
  bake: boolean;
  toggleLive?: LiveToggle;
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
  reload: feather(
    "refresh-cw",
    '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
  ),
  bake: feather(
    "package",
    '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
  ),
  makeLive: feather(
    "radio",
    '<circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path>',
  ),
  makeStatic: feather(
    "minus-circle",
    '<circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line>',
  ),
};

function icon(id: WidgetActionId): string | Node {
  if (id === "copy") return iconElement(h(CopyIcon, {}));
  if (id === "definition") return iconElement(h(DefinitionIcon, {}));
  return ICONS[id];
}

const PHRASES: Record<string, string> = {
  index: "the index changes",
  edit: "this page is edited",
  navigate: "you open another page",
};

export function triggerPhrase(triggers: string[]): string {
  const parts = triggers.map((t) => PHRASES[t] ?? `"${t}" fires`);
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
}

/** One ⋯ menu item, with the icon every widget menu uses for `id`. */
export function widgetMenuItem<Id extends WidgetActionId>(
  id: Id,
  label: string,
): PopupEntry<Id> {
  return { kind: "item", id, label, icon: icon(id) };
}

export function widgetMenuEntries(
  caps: WidgetCaps,
): PopupEntry<WidgetActionId>[] {
  const out: PopupEntry<WidgetActionId>[] = [];
  const action = (id: WidgetActionId, label: string) =>
    out.push(widgetMenuItem(id, label));
  if (caps.live) {
    out.push({
      kind: "info",
      text: `Live · re-runs when ${triggerPhrase(caps.live)}`,
    });
  }
  if (caps.definition) action("definition", "Go to definition");
  if (caps.open) action("open", "Open");
  if (caps.edit) action("edit", "Edit source");
  action("reload", caps.live ? "Reload now" : "Reload");
  if (caps.copy) action("copy", "Copy as Markdown");
  if (caps.bake || caps.toggleLive) out.push({ kind: "separator" });
  if (caps.bake) action("bake", "Bake into page");
  if (caps.toggleLive === "makeStatic") action("makeStatic", "Make static");
  if (caps.toggleLive === "makeLive") action("makeLive", "Make live");
  return out;
}
