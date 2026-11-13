// Widget menus by DOM element: each widget type registers a source with its
// own menu builder on its card, and whichever handle shows opens it: on
// desktop the ⋮ in the margin (line_handle.ts), which adds Move up / Move
// down / Delete for the whole block and a submenu per nested widget; on
// mobile the widget's corner ⋯, which opens the builder's menu as is.
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { Client } from "../../client.ts";
import type { PopupEntry, PopupIcon } from "../../components/popup_menu.ts";
import {
  type BlockSpan,
  canMoveBlock,
  deleteBlock,
  moveBlock,
} from "./block_span.ts";
import { widgetActionIcon, widgetMenuItem } from "./widget_menu.ts";

export type WidgetMenuSource = {
  /** Names the widget's submenu or section in an outer menu: "Query", "Embed" */
  label: string;
  /** A block-level card (gets its own ⋮) rather than an inline widget */
  block: boolean;
  /** The widget type's menu (items carry their own `run`) */
  entries(): PopupEntry[];
  /**
   * The whole block in the page, for the Move up / Move down / Delete the ⋮
   * adds; absent, or undefined, where it isn't one
   */
  span?(): BlockSpan | undefined;
};

/** Marks an element with a registered menu source */
export const WIDGET_MENU_ATTR = "data-sb-widget-menu";
const WIDGET_MENU_SELECTOR = `[${WIDGET_MENU_ATTR}]`;

const sources = new WeakMap<Element, WidgetMenuSource>();

/** Registers (or replaces) `el`'s menu source */
export function registerWidgetMenu(
  el: HTMLElement,
  source: WidgetMenuSource,
): void {
  sources.set(el, source);
  el.setAttribute(WIDGET_MENU_ATTR, source.block ? "block" : "inline");
}

export function unregisterWidgetMenu(el: HTMLElement): void {
  sources.delete(el);
  el.removeAttribute?.(WIDGET_MENU_ATTR);
}

export function widgetMenuSource(el: Element): WidgetMenuSource | undefined {
  return sources.get(el);
}

/**
 * Whether widgets put their menu behind the margin ⋮ rather than a corner ⋯:
 * on desktop (a fine pointer). A client without a view state (a test double)
 * keeps the ⋯.
 */
export function widgetMenusInMargin(client: {
  ui?: { viewState?: { isMobile?: boolean } };
}): boolean {
  return client.ui?.viewState?.isMobile === false;
}

/** The registered element nearest around `el`, `el` included, within `root` */
function registeredAround(el: Element, root: Element): Element | undefined {
  const found = el.closest(WIDGET_MENU_SELECTOR);
  return found && root.contains(found) && found !== root ? found : undefined;
}

/**
 * The outermost block-level card around `el` within `root` (the editor's
 * content), if any: its ⋮ shows while the pointer is anywhere over it
 */
export function blockWidgetAround(
  el: Element,
  root: Element,
): HTMLElement | undefined {
  let card: HTMLElement | undefined;
  for (
    let at = registeredAround(el, root);
    at;
    at = at.parentElement ? registeredAround(at.parentElement, root) : undefined
  ) {
    if (sources.get(at)?.block) card = at as HTMLElement;
  }
  return card;
}

/** The registered widgets directly inside `el`: not inside another one */
export function innerWidgets(el: Element): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(WIDGET_MENU_SELECTOR)].filter(
    (inner) =>
      sources.has(inner) &&
      inner.parentElement?.closest(WIDGET_MENU_SELECTOR) ===
        (el.matches(WIDGET_MENU_SELECTOR) ? el : null),
  );
}

/** The inline widgets with menus directly inside `el` (a `${…}` in a line) */
export function inlineWidgets(el: Element): HTMLElement[] {
  return innerWidgets(el).filter((w) => !sources.get(w)?.block);
}

/**
 * Move up, Move down and Delete for the whole block `span` finds, looked up
 * again when picked so they act on where the block is then
 */
export function blockActionEntries(
  client: Pick<Client, "editorView" | "focus">,
  span: () => BlockSpan | undefined,
): PopupEntry[] {
  const now = span();
  if (!now) return [];
  const state = client.editorView.state;
  const run =
    (
      change: (
        state: EditorState,
        span: BlockSpan,
      ) => TransactionSpec | undefined,
    ) =>
    () => {
      const view = client.editorView;
      const at = span();
      const spec = at && change(view.state, at);
      if (spec) view.dispatch(spec);
      client.focus();
    };
  return [
    {
      ...widgetMenuItem("moveUp", "Move up"),
      disabled: canMoveBlock(state, now, -1)
        ? undefined
        : "Nothing above to move past",
      run: run((s, at) => moveBlock(s, at, -1)),
    },
    {
      ...widgetMenuItem("moveDown", "Move down"),
      disabled: canMoveBlock(state, now, 1)
        ? undefined
        : "Nothing below to move past",
      run: run((s, at) => moveBlock(s, at, 1)),
    },
    { kind: "separator" },
    { ...widgetMenuItem("remove", "Delete"), run: run(deleteBlock) },
  ];
}

/** Gives each item with an id and no `run` one that calls `run(id)` */
export function bindMenu<Id extends string>(
  entries: PopupEntry<Id>[],
  run: (id: Id) => void | Promise<void>,
): PopupEntry<Id>[] {
  return entries.map((entry) => {
    if (entry.kind === "submenu") {
      return { ...entry, entries: bindMenu(entry.entries, run) };
    }
    if (entry.kind !== "item" || entry.run || entry.id === undefined) {
      return entry;
    }
    const id = entry.id;
    return {
      ...entry,
      run: () => {
        Promise.resolve(run(id)).catch(console.error);
      },
    };
  });
}

/** Joins non-empty groups with separators */
export function joinGroups<Id extends string>(
  groups: PopupEntry<Id>[][],
): PopupEntry<Id>[] {
  const out: PopupEntry<Id>[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    if (out.length) out.push({ kind: "separator" });
    out.push(...group);
  }
  return out;
}

const submenuIcon: PopupIcon = () => widgetActionIcon("edit");

/**
 * One submenu row per widget in `widgets`, labelled by their sources (a
 * number added where labels repeat), each opening that widget's full menu;
 * widgets with an empty menu are left out
 */
export function widgetSubmenus(
  client: Pick<Client, "editorView" | "focus" | "isReadOnlyMode">,
  widgets: HTMLElement[],
): PopupEntry[] {
  const menus = widgets.flatMap((el) => {
    const source = sources.get(el);
    if (!source) return [];
    const entries = widgetMenuEntriesFor(client, el);
    return entries.length ? [{ label: source.label, entries }] : [];
  });
  const counts = new Map<string, number>();
  for (const { label } of menus) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return menus.map(({ label, entries }) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return {
      kind: "submenu",
      label: (counts.get(label) ?? 0) > 1 ? `${label} ${n}` : label,
      icon: submenuIcon,
      entries,
    };
  });
}

/**
 * The ⋮ menu of the widget at `el`: its type's menu, then Move up / Move down
 * / Delete for its whole block (where the page can be edited and it is one),
 * then a submenu per nested widget. A widget with no menu of its own and one
 * nested widget shows that one's menu in place of a submenu, without its
 * Delete when the block's own Delete is there.
 */
export function widgetMenuEntriesFor(
  client: Pick<Client, "editorView" | "focus" | "isReadOnlyMode">,
  el: HTMLElement,
): PopupEntry[] {
  const source = sources.get(el);
  if (!source) return [];
  const editable =
    !client.isReadOnlyMode() && !client.editorView.state.readOnly;
  const block =
    editable && source.span
      ? blockActionEntries(client, source.span.bind(source))
      : [];
  const own = source.entries();
  const inner = innerWidgets(el);
  if (!own.length && inner.length === 1) {
    const only = widgetMenuEntriesFor(client, inner[0]);
    const flat = block.length
      ? only.filter((e) => !(e.kind === "item" && e.id === "remove"))
      : only;
    return joinGroups([trimSeparators(flat), block]);
  }
  return joinGroups([own, block, widgetSubmenus(client, inner)]);
}

/** Without leading, trailing or doubled separators */
function trimSeparators(entries: PopupEntry[]): PopupEntry[] {
  const out: PopupEntry[] = [];
  for (const entry of entries) {
    if (
      entry.kind === "separator" &&
      (!out.length || out[out.length - 1].kind === "separator")
    ) {
      continue;
    }
    out.push(entry);
  }
  while (out.length && out[out.length - 1].kind === "separator") out.pop();
  return out;
}
