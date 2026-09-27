// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.
import {
  type EditorState,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";

type LinkOptions = {
  text: string;
  href?: string;
  title: string;
  cssClass: string;
  from: number;
  callback: (e: MouseEvent) => void;
};

export class LinkWidget extends WidgetType {
  constructor(readonly options: LinkOptions) {
    super();
  }

  toDOM(): HTMLElement {
    const anchor = document.createElement("a");
    anchor.className = this.options.cssClass;
    anchor.textContent = this.options.text;
    anchor.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        this.options.callback(e);
      } catch (e) {
        console.error("Error handling wiki link click", e);
      }
    });
    let touchCount = 0;
    anchor.addEventListener("touchmove", () => touchCount++);
    anchor.addEventListener("touchend", (e) => {
      if (touchCount === 0) {
        e.preventDefault();
        e.stopPropagation();
        this.options.callback(new MouseEvent("click", e));
      }
      touchCount = 0;
    });
    anchor.setAttribute("title", this.options.title);
    anchor.href = this.options.href || "#";
    return anchor;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof LinkWidget &&
      this.options.from === other.options.from &&
      this.options.text === other.options.text &&
      this.options.href === other.options.href &&
      this.options.title === other.options.title;
  }
}

export class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly className?: string,
    readonly onClick?: (e: MouseEvent) => void,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    if (this.className) el.className = this.className;
    if (this.onClick) el.addEventListener("click", this.onClick);
    el.innerHTML = this.html;
    return el;
  }
}

export function decoratorStateField(
  stateToDecoratorMapper: (state: EditorState) => DecorationSet,
) {
  return StateField.define<DecorationSet>({
    create(state: EditorState) {
      return stateToDecoratorMapper(state);
    },
    update(value: DecorationSet, tr: Transaction) {
      if (tr.isUserEvent("input.type.compose")) {
        if (tr.docChanged) return value.map(tr.changes);
        return value;
      }
      if (tr.isUserEvent("select.pointer")) return value;
      return stateToDecoratorMapper(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

export class ButtonWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly title: string,
    readonly cssClass: string,
    readonly callback: (e: MouseEvent) => void,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const anchor = document.createElement("button");
    anchor.className = this.cssClass;
    anchor.textContent = this.text;
    anchor.addEventListener("mouseup", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callback(e);
    });
    anchor.setAttribute("title", this.title);
    return anchor;
  }
}

/**
 * Tracks whether a read-only editor has been deliberately positioned by the
 * user. This is intentionally separate from source-reveal behavior: the
 * cursor must remain visible while keyboard navigation crosses rendered links
 * and Lua widgets.
 */
export const readOnlyCursorActive = StateField.define<boolean>({
  create(state) {
    const { from, to } = state.selection.main;
    return from !== 0 || to !== 0;
  },
  update(value, tr) {
    if (value) return true;
    return tr.selection !== undefined &&
      !tr.startState.selection.eq(tr.newSelection);
  },
});

/**
 * Check if any of the editor cursors is in the given range.
 *
 * Read-only mode deliberately never reveals the underlying Markdown source
 * merely because the logical caret moved there. Rendered links, SLIQ results,
 * and widgets must remain visible and keyboard-navigable; the caret's visual
 * activation is handled independently by readOnlyCursorActive.
 */
export function isCursorInRange(state: EditorState, range: [number, number]) {
  if (state.readOnly) return false;
  return state.selection.ranges.some((selection) =>
    checkRangeOverlap(range, [selection.from, selection.to]),
  );
}

export function checkRangeOverlap(
  range1: [number, number],
  range2: [number, number],
) {
  return range1[0] <= range2[1] && range2[0] <= range1[1];
}

export function checkRangeSubset(
  parent: [number, number],
  child: [number, number],
) {
  return child[0] >= parent[0] && child[1] <= parent[1];
}

export const invisibleDecoration = Decoration.replace({});

const hiddenLineDecoration = Decoration.line({
  class: "sb-line-table-outside",
});

export function hideBlockSource(
  widgets: Range<Decoration>[],
  state: EditorState,
  from: number,
  to: number,
  widgetAt: "start" | "end" = "end",
) {
  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);
  if (fromLine.number === toLine.number) {
    widgets.push(invisibleDecoration.range(from, to));
    return;
  }
  if (widgetAt === "start") {
    widgets.push(invisibleDecoration.range(from, fromLine.to));
  } else if (from === fromLine.from) {
    widgets.push(hiddenLineDecoration.range(fromLine.from));
  } else {
    widgets.push(invisibleDecoration.range(from, fromLine.to));
  }
  for (let n = fromLine.number + 1; n < toLine.number; n++) {
    widgets.push(hiddenLineDecoration.range(state.doc.line(n).from));
  }
  if (widgetAt === "end") {
    widgets.push(invisibleDecoration.range(toLine.from, to));
  } else if (to === toLine.to) {
    widgets.push(hiddenLineDecoration.range(toLine.from));
  } else {
    widgets.push(invisibleDecoration.range(toLine.from, to));
  }
}

export type WidgetRenderMode = "ready" | "loading" | "disabled";

export function widgetRenderMode(client: Client): WidgetRenderMode {
  if (client.currentPageMeta()?.pageDecoration?.renderWidgets === false) {
    return "disabled";
  }
  if (
    !client.systemReady ||
    !client.clientSystem.scriptsLoaded ||
    !client.fullIndexCompleted ||
    !client.pageListLoaded
  ) {
    return "loading";
  }
  return "ready";
}
