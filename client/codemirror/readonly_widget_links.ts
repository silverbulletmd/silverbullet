import { Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { readOnlyAtomicRanges } from "./util.ts";

// sb-widget-link-cursor also hides the caret, as the link is now the cursor
const activeClasses = ["sb-link-cursor", "sb-widget-link-cursor"];

/**
 * Keyboard access to links and buttons rendered inside widgets (query
 * results, Lua expressions, templates, panels like Linked Mentions) in
 * read-only mode. When an arrow key lands the cursor on a widget, the arrow
 * keys first step through the widget's links and buttons, highlighting the
 * current one, and Mod-Enter/Enter activates it. Past the last one the
 * cursor moves on as usual.
 */
class WidgetLinkNavigator {
  private active: HTMLElement | null = null;
  // The links the active one is stepped through with
  private links: HTMLElement[] = [];
  // Set by an arrow key we let through, consumed by the selection change
  private pending: { direction: 1 | -1; from: number } | null = null;

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (!update.selectionSet) return;
    const pending = this.pending;
    this.pending = null;
    this.setActive(null);
    if (!pending) return;
    const { direction, from } = pending;
    // Read the DOM once it reflects the new state
    this.view.requestMeasure({
      read: (view) => widgetLinksAt(view, view.state.selection.main.head, from),
      write: (links) => {
        this.setActive(
          (direction > 0 ? links[0] : links[links.length - 1]) ?? null,
          links,
        );
      },
    });
  }

  /** Returns true when the key was used to move between widget links. */
  move(direction: 1 | -1): boolean {
    const active = this.active?.isConnected ? this.active : null;
    if (active) {
      const next = this.links[this.links.indexOf(active) + direction];
      if (next) {
        this.setActive(next, this.links);
        return true;
      }
    }
    this.setActive(null);
    // Enter boundary panels only once the cursor reaches the document edge.
    // Text on the first/last line (including wrapped lines) must remain
    // navigable before stepping into a panel such as Linked Mentions.
    const { doc, selection } = this.view.state;
    if (
      selection.main.empty &&
      selection.main.head === (direction > 0 ? doc.length : 0)
    ) {
      const links = widgetLinksAt(this.view, direction > 0 ? doc.length : 0);
      // Nothing lies beyond such a panel: stay on its last link
      const target =
        active && links.includes(active)
          ? active
          : direction > 0
            ? links[0]
            : links[links.length - 1];
      if (target) {
        this.setActive(target, links);
        return true;
      }
    }
    this.pending = { direction, from: selection.main.head };
    return false;
  }

  follow(): boolean {
    if (!this.active?.isConnected) return false;
    // Widgets handle link clicks themselves (see widget_util.ts)
    this.active.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    return true;
  }

  private setActive(link: HTMLElement | null, links: HTMLElement[] = []) {
    this.active?.classList.remove(...activeClasses);
    this.active = link;
    this.links = links;
    if (link) {
      link.classList.add(...activeClasses);
      link.scrollIntoView({ block: "nearest" });
    }
  }

  destroy() {
    this.setActive(null);
  }
}

/**
 * Links and buttons inside the widget(s) at `pos`: those nested in widget
 * content (not the editor's own rendered links, which sit directly in a line)
 * whose document position falls within the hidden range touching `pos`.
 * Ranges holding `leaving`, the position the cursor just moved from, are
 * ignored: the cursor is stepping off those widgets, not onto them.
 */
function widgetLinksAt(
  view: EditorView,
  pos: number,
  leaving?: number,
): HTMLElement[] {
  let from = pos;
  let to = pos;
  let onlyLeaving = false;
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    source(view).between(pos, pos, (rangeFrom, rangeTo) => {
      if (leaving !== undefined && leaving >= rangeFrom && leaving <= rangeTo) {
        onlyLeaving = from === pos && to === pos;
        return;
      }
      onlyLeaving = false;
      from = Math.min(from, rangeFrom);
      to = Math.max(to, rangeTo);
    });
  }
  if (onlyLeaving) return [];
  return [
    ...view.contentDOM.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled)",
    ),
  ].filter((link) => {
    if (link.parentElement?.classList.contains("cm-line")) return false;
    // Skip hidden controls and the widget menus that only show on hover
    if (!link.getClientRects().length) return false;
    if (link.closest(".sb-widget-menu-bar")) return false;
    // Widget content maps to the widget's start, so a link at `to` belongs
    // to the next widget
    const linkPos = view.posAtDOM(link);
    return linkPos === from || (linkPos > from && linkPos < to);
  });
}

const widgetLinkNavigator = ViewPlugin.fromClass(WidgetLinkNavigator);

const navigate = (direction: 1 | -1) => (view: EditorView) =>
  view.plugin(widgetLinkNavigator)?.move(direction) ?? false;

const follow = (view: EditorView) =>
  view.plugin(widgetLinkNavigator)?.follow() ?? false;

export const readOnlyWidgetLinks = [
  readOnlyAtomicRanges,
  widgetLinkNavigator,
  Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: navigate(1) },
      { key: "ArrowRight", run: navigate(1) },
      { key: "ArrowUp", run: navigate(-1) },
      { key: "ArrowLeft", run: navigate(-1) },
      { key: "Enter", run: follow },
      { key: "Mod-Enter", run: follow },
    ]),
  ),
];
