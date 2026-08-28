import type { Row, ViewMeta } from "./types.ts";

/**
 * Everything a page-docked widget *decides*, separated from what it renders:
 * when to re-fetch, how much to draw, when the slot has settled enough to be
 * measured, what a keystroke does. None of it touches Preact or the DOM, so it
 * is asserted directly in `page_widget_logic.test.ts` — this project's vitest
 * run has no jsdom (see `nav_error_boundary.test.ts`), and a hook-driven
 * function component cannot be mounted there.
 */

const REFRESH_DEBOUNCE_MS = 300;

type EventHook = {
  addLocalListener(name: string, callback: (...args: any[]) => any): void;
  removeLocalListener(name: string, callback: (...args: any[]) => any): void;
};

/**
 * Re-runs `run` (debounced) on every event the view's `refreshOn` names, and
 * returns the teardown.
 */
export function subscribeRefresh(
  eventHook: EventHook,
  events: string[],
  run: () => void,
): () => void {
  // De-duped: a view naming an event twice must not run the fetch twice.
  const names = [...new Set(events)];
  if (names.length === 0) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onEvent = () => {
    clearTimeout(timer);
    timer = setTimeout(run, REFRESH_DEBOUNCE_MS);
  };
  for (const name of names) eventHook.addLocalListener(name, onEvent);
  return () => {
    clearTimeout(timer);
    for (const name of names) eventHook.removeLocalListener(name, onEvent);
  };
}

/** The view's own render cap, and what it left out. */
export function visibleRows<T>(
  rows: T[],
  limit: number,
): { shown: T[]; more: number } {
  if (!(limit > 0) || rows.length <= limit) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, limit), more: rows.length - limit };
}

/**
 * Whether a string is worth handing to the markdown pipeline at all.
 */
export function needsMarkdown(text: string): boolean {
  // `_` only counts at a word boundary: CommonMark won't emphasize an
  // intra-word underscore, and `some_page_name` is an ordinary page name.
  return /[[\]`*~<>&\\!]|(?:^|\s)_|_(?:\s|$)|https?:\/\//.test(text);
}

/**
 * Whether a click on this element is the row's to act on. A link, a command
 * button or a task checkbox inside rendered markdown answers its own click --
 * the row must not also navigate on top of it.
 */
export function isRowActivation(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  if (!el?.closest) return true;
  return !el.closest("a, button, input, select, textarea");
}

/**
 * Reports when every view in a slot has resolved its rows, so the slot is
 * measured at its real height rather than mid-fetch. A view that re-fetches
 * (`refreshOn`) reports again after the first settle: that is a genuine height
 * change, so it re-measures rather than being ignored.
 */
export function createSettleTracker(
  names: string[],
  onAllSettled: () => void,
): (name: string) => void {
  const pending = new Set(names);
  if (pending.size === 0) {
    onAllSettled();
    return () => {};
  }
  return (name: string) => {
    if (pending.size === 0) {
      onAllSettled();
      return;
    }
    pending.delete(name);
    if (pending.size === 0) onAllSettled();
  };
}

/**
 * What one load of a content view settled on, committed as a unit: the
 * markdown (what Copy puts on the clipboard), the node it rendered to, and
 * why it didn't. Every field lands in the same `setState`, which is what keeps
 * the widget from painting chrome ahead of its own body.
 */
export type ContentState = {
  markdown: string;
  node?: HTMLElement;
  error?: string;
};

export type ContentOutcome = "pending" | "error" | "empty" | "ready";

/**
 * What a content widget has to show. `empty` covers both "the view said
 * nothing" and "the markdown rendered to nothing", which are the same thing to
 * a reader: no widget at all.
 */
export function contentOutcome(
  state: ContentState | undefined,
): ContentOutcome {
  if (state === undefined) return "pending";
  if (state.error !== undefined) return "error";
  if (!state.markdown.trim() || !state.node) return "empty";
  return "ready";
}

/**
 * Whether this outcome reports the slot settle. Everything except `pending`
 * does -- a load error, a *render* error, an empty view and a rendered one
 * alike. A terminal outcome that failed to report would leave the slot's
 * height cache reserving a phantom gap on every later visit to the page.
 */
export function settlesSlot(outcome: ContentOutcome): boolean {
  return outcome !== "pending";
}

/**
 * Which widget a docked view gets. A content view renders a markdown document;
 * everything else renders rows.
 */
export function widgetKind(
  meta: Pick<ViewMeta, "hasContent">,
): "content" | "rows" {
  return meta.hasContent ? "content" : "rows";
}

/**
 * A collapse toggle's next state and what to persist for it. Trivial on its
 * own; exported because the widget must always do both halves -- flip *and*
 * write -- and a toggle that only flipped would come back expanded on the
 * next page load with nothing on screen to say why.
 */
export function toggleCollapsed(collapsed: boolean): {
  next: boolean;
  persist: boolean;
} {
  return { next: !collapsed, persist: !collapsed };
}

/**
 * Whether a page widget draws its body. Collapsed rolls the widget up to its
 * title bar; the body is removed rather than hidden, so the slot re-measures
 * to the bar's own height instead of reserving the body's.
 */
export function showsBody(collapsed: boolean, hasBody: boolean): boolean {
  return hasBody && !collapsed;
}

/**
 * A stable identity for one load's result, so a `refreshOn` burst that produces
 * the same thing again can skip the render and the commit.
 */
export function rowsIdentity(rows: Row[]): string | undefined {
  try {
    return JSON.stringify(
      rows.map((row) => [
        row.obj,
        row.primary,
        row.label,
        row.description,
        row.cssClass,
        // Drawn as chips by `TreeView`, so a decoration that carries a count
        // or a relative time would otherwise freeze at its first value.
        row.decorations,
      ]),
    );
  } catch {
    return undefined;
  }
}

/**
 * Whether a freshly loaded result is worth committing.
 */
export function shouldCommit(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  if (previous === undefined || next === undefined) return true;
  return previous !== next;
}

/** The identity of a load, folding in its error so the two never mask each other. */
export function loadIdentity(
  error: string | undefined,
  content: string | undefined,
): string | undefined {
  if (content === undefined) return undefined;
  return `${error === undefined ? "" : `e:${error}`}\u0000${content}`;
}

/**
 * The bookkeeping behind "skip a refresh that changed nothing".
 */
export function createLoadGate(): {
  shouldCommit(identity: string | undefined): boolean;
  committed(identity: string | undefined): void;
  failed(): void;
} {
  let last: string | undefined;
  return {
    shouldCommit: (identity) => shouldCommit(last, identity),
    committed: (identity) => {
      last = identity;
    },
    failed: () => {
      last = undefined;
    },
  };
}

/**
 * What a keystroke means on a page-docked tree row. Enter/Space open the row
 * (as a click does). Left/Right work the tree.
 */
export function treeKeyAction(
  key: string,
  node: { isFolder: boolean; isExpanded: boolean },
): "select" | "expand" | "collapse" | undefined {
  if (key === "Enter" || key === " ") return "select";
  if (!node.isFolder) return undefined;
  if (key === "ArrowRight") return node.isExpanded ? undefined : "expand";
  if (key === "ArrowLeft") return node.isExpanded ? "collapse" : undefined;
  return undefined;
}

/** Enter/Space on a `role="button"` row, matching what a click does. */
export function activateOnKey(
  ev: { key: string; preventDefault(): void },
  activate: () => void,
): void {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  ev.preventDefault();
  activate();
}
