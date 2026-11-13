import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "../util.ts";

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

function decorateBlockQuote(state: EditorState) {
  const widgets: Range<Decoration>[] = [];
  const depth = new Map<number, number>();
  const markupStart = new Map<number, number>();
  const markupEnd = new Map<number, number>();
  // The markers the tree found on each line, wherever they sit: after a list
  // marker (`* > quote`) as much as at the line start.
  const markersOnLine = new Map<number, number>();

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
      // both is exactly as wide, revealed, the column slot pins it to the
      // same two editor columns. Either way a line occupies the same width.
      const end = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
      const lineStart = state.doc.lineAt(from).from;
      markersOnLine.set(lineStart, (markersOnLine.get(lineStart) ?? 0) + 1);
      markupStart.set(
        lineStart,
        Math.min(markupStart.get(lineStart) ?? from, from),
      );
      markupEnd.set(lineStart, Math.max(markupEnd.get(lineStart) ?? 0, end));
      widgets.push(
        isCursorInRange(state, [from, to])
          ? Decoration.mark({
              class: "sb-quote-mark sb-col-slot",
              attributes: { style: `--sb-slot-columns:${end - from}` },
            }).range(from, end)
          : Decoration.replace({
              widget: new QuoteMarkSpacer(end - from),
            }).range(from, end),
      );
    },
  });

  for (const [lineStart, levels] of depth) {
    // A lazy continuation writes no marker of its own; without a stand-in it
    // would start a marker-width left of the line it continues.
    const missing = levels - (markersOnLine.get(lineStart) ?? 0);
    if (missing > 0) {
      widgets.push(
        Decoration.widget({
          widget: new QuoteMarkSpacer(missing * markerColumns),
          side: -1,
        }).range(lineStart),
      );
    }
    // The spacers hold the first row's columns; this reserves them on the rows
    // it wraps into, which inline padding cannot reach. Measured from the
    // first marker, not the line start: leading whitespace on a quote nested
    // in a list is the item's indent, which listIndentPlugin already reserves.
    const written = markupEnd.has(lineStart)
      ? markupEnd.get(lineStart)! - markupStart.get(lineStart)!
      : 0;
    const columns = written + Math.max(missing, 0) * markerColumns;
    if (columns > 0) {
      // Where the markup itself starts, which is not derivable from the
      // indents: a list inside a quote puts the `>` first, a quote inside a
      // list puts the item's indent first. The bars key off this so they land
      // on the spacers they stand in for either way.
      const offset = markupStart.has(lineStart)
        ? markupStart.get(lineStart)! - lineStart
        : 0;
      widgets.push(
        Decoration.line({
          attributes: {
            style:
              `--sb-quote-indent:calc(${columns} * var(--editor-column));` +
              // --sb-list-pad: columns an enclosing ordered item was
              // widened by (list_indent.ts), which move a nested quote too.
              `--sb-quote-bar-offset:calc((${offset} + var(--sb-list-pad, 0)) * var(--editor-column))`,
          },
        }).range(lineStart),
      );
    }
  }

  return Decoration.set(widgets, true);
}

export function blockquotePlugin() {
  return decoratorStateField(decorateBlockQuote, {});
}
