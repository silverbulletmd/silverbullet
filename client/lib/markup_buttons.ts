import type { EditorState } from "@codemirror/state";
import { firstKeyboardHint } from "../../plug-api/lib/shortcut.ts";
import type { Client } from "../client.ts";
import {
  matchesNodeContexts,
  type NodeContextFilter,
} from "./node_contexts.ts";

/**
 * Where markup buttons show, each with its own list under `markupBar.<surface>`
 * (list order is display order): the bar above the keyboard on phones and
 * tablets, the bubble over a text selection on desktop, and the menu behind
 * the desktop ⋮ line handle.
 */
export type MarkupSurface = "mobile" | "selection" | "line";

export type MarkupButton = NodeContextFilter & {
  icon: string;
  description?: string;
  command?: string;
  run?: () => void;
  /** Line menu: buttons with the same group share one submenu row */
  group?: string;
  /** Line menu: shown ticked when the line is in one of these contexts */
  activeContexts?: string[];
};

/** A desktop markup UI part, switched by `markupBar.<part>` in the config. */
type MarkupBarPart = "selectionBubble" | "lineHandle";

/**
 * Whether a desktop markup UI part is switched on by its `markupBar` option
 * (on unless set to false). Read on every use, so a config reload applies
 * without restarting.
 */
function markupBarEnabled(
  client: Pick<Client, "config">,
  part: MarkupBarPart,
): boolean {
  return client.config.get<boolean>(["markupBar", part], true) !== false;
}

/** Which markup surfaces are on (see `markupSurfaces`) */
export type MarkupSurfaces = {
  /** The bar above the keyboard, on phones and tablets */
  mobile: boolean;
  /** The bubble over a text selection, on desktop */
  selection: boolean;
  /** The line menu's markup buttons and its Set state entry, on desktop */
  line: boolean;
  /** The line menu's Add tag entry, on desktop */
  addTag: boolean;
  /**
   * Widget menus behind the ⋮ (block widgets' own, inline widgets' sections
   * of their line's menu), on desktop: also read-only (with only the items
   * that don't edit), whatever the toggle and `markupBar.lineHandle` say
   */
  widget: boolean;
};

/**
 * The one place that decides which markup surfaces are on, for every surface
 * and their mounting. All but widget menus need a writable editor: the space and page are not
 * read-only, nor is `state` when given (leave it out where there is no editor
 * state yet, e.g. when mounting). Then:
 * - the mobile bar shows on mobile with this device's markup bar toggle on;
 * - the selection bubble on desktop with the toggle and
 *   `markupBar.selectionBubble` on;
 * - the line menu's buttons on desktop with the toggle and
 *   `markupBar.lineHandle` on;
 * - its Add tag entry on desktop with `markupBar.lineHandle` on, whatever the
 *   toggle says;
 * - widget menus behind the ⋮ on desktop, always: they need no writable
 *   editor (their items that edit check that themselves).
 * The ⋮ handle shows wherever its menu has entries. Read on every use, so a
 * config reload or a toggle applies without restarting.
 */
export function markupSurfaces(
  client: Pick<Client, "config" | "isReadOnlyMode"> & {
    ui: {
      viewState: { isMobile: boolean; uiOptions: { markupBar: boolean } };
    };
  },
  state?: Pick<EditorState, "readOnly">,
): MarkupSurfaces {
  const { isMobile, uiOptions } = client.ui.viewState;
  const editable = !state?.readOnly && !client.isReadOnlyMode();
  const toggle = uiOptions.markupBar;
  const desktop = editable && !isMobile;
  const lineHandle = desktop && markupBarEnabled(client, "lineHandle");
  return {
    mobile: editable && isMobile && toggle,
    selection: desktop && toggle && markupBarEnabled(client, "selectionBubble"),
    line: lineHandle && toggle,
    addTag: lineHandle,
    widget: !isMobile,
  };
}

/**
 * The configured buttons of a surface, in display order, read on every use so
 * a config reload applies: `markupBar.<surface>`, except that a space still
 * setting the deprecated `keyboardBar` list gets that one on the mobile bar.
 */
export function markupButtons(
  client: Pick<Client, "config">,
  surface: MarkupSurface,
): MarkupButton[] {
  if (surface === "mobile") {
    const legacy = client.config.get<MarkupButton[] | undefined>(
      "keyboardBar",
      undefined,
    );
    if (legacy) return legacy;
  }
  return client.config.get<MarkupButton[]>(["markupBar", surface], []);
}

/** The buttons whose `onlyContexts` / `exceptContexts` match `contexts` */
export function buttonsFor(
  buttons: MarkupButton[],
  contexts: string[],
): MarkupButton[] {
  return buttons.filter((button) => matchesNodeContexts(button, contexts));
}

export function runMarkupButton(client: Client, button: MarkupButton) {
  if (button.command) {
    void client.runCommandByName(button.command);
  } else {
    button.run?.();
  }
}

export function buttonLabel(button: MarkupButton): string {
  return button.description ?? button.command ?? "";
}

/** The keyboard shortcut of a button's command, for a tooltip or menu hint */
export function buttonHint(
  client: Client,
  button: MarkupButton,
): string | undefined {
  const command =
    button.command && client.ui.viewState.commands.get(button.command);
  return command ? firstKeyboardHint(command) : undefined;
}
