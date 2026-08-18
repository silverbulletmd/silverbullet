import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "./util.ts";

/** Columns a `> ` marker occupies, and thus the width of a stand-in for one. */
const markerColumns = 2;

/** Stands in for a quote marker a line does not render, matching its width. */
class QuoteMarkSpacer extends WidgetType {
  constructor(readonly columns: number) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "sb-quote-spacer";
    span.style.paddingLeft = `calc(${this.columns} * var(--editor-column))`;
    return span;
  }

  override eq(other: QuoteMarkSpacer) {
    return other.columns === this.columns;
  }

  override ignoreEvent() {
    return false;
  }
}

/**
 * The `>` run a line opens with, however the tree happens to model it. A
 * marker takes one space as padding and then up to three more as indent, and
 * overcounting is absorbed by the `missing <= 0` guard, so this errs generous.
 */
function writtenMarkers(lineText: string): number {
  return /^\s{0,3}(?:>\s{0,4})*/.exec(lineText)![0].split(">").length - 1;
}

function decorateBlockQuote(state: EditorState) {
  const widgets: Range<Decoration>[] = [];
  const depth = new Map<number, number>();

  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (type.name === "Blockquote") {
        const last = state.doc.lineAt(to).number;
        for (let n = state.doc.lineAt(from).number; n <= last; n++) {
          const lineStart = state.doc.line(n).from;
          depth.set(lineStart, (depth.get(lineStart) ?? 0) + 1);
        }
        return;
      }
      if (type.name !== "QuoteMark") return;
      // The trailing space belongs to the marker: hidden, the spacer replacing
      // both is exactly as wide, revealed, the mark class pins it to the same
      // two editor columns. Either way a line occupies the same width.
      const end = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
      widgets.push(
        isCursorInRange(state, [from, to])
          ? Decoration.mark({ class: "sb-quote-mark" }).range(from, end)
          : Decoration.replace({
              widget: new QuoteMarkSpacer(end - from),
            }).range(from, end),
      );
    },
  });

  // A lazy continuation writes no marker of its own; without a stand-in it
  // would start a marker-width left of the line it continues.
  for (const [lineStart, levels] of depth) {
    const missing = levels - writtenMarkers(state.doc.lineAt(lineStart).text);
    if (missing <= 0) continue;
    widgets.push(
      Decoration.widget({
        widget: new QuoteMarkSpacer(missing * markerColumns),
        side: -1,
      }).range(lineStart),
    );
  }

  return Decoration.set(widgets, true);
}

export function blockquotePlugin() {
  return decoratorStateField(decorateBlockQuote);
}
