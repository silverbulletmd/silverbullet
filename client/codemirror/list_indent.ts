import type { SyntaxNode } from "@lezer/common";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

/**
 * Compute the marker-zone width in source columns (== `ch` units) for a
 * single ListItem node.
 * @param listItem     The `ListItem` syntax node.
 * @param lineStart    Absolute offset of the line this list-item starts on.
 * @param quoteColumns Columns a blockquote marker run already reserves on
 *                     this line, subtracted so the two never double-count.
 */
export function computeMarkerWidth(
  listItem: SyntaxNode,
  lineStart: number,
  quoteColumns = 0,
): number {
  const mark = listItem.firstChild;
  if (!mark || mark.name !== "ListMark") {
    return 0;
  }
  const leadingIndent = mark.from - lineStart - quoteColumns;
  const markLength = mark.to - mark.from;
  // TaskState wraps `[X]` / `[done]` / etc. (length varies by status string).
  // Width contribution = TaskState range length + 1 for the trailing space.
  const taskState = listItem.getChild("Task")?.getChild("TaskState");
  const taskExtra = taskState ? taskState.to - taskState.from + 1 : 0;
  return leadingIndent + markLength + 1 + taskExtra;
}

/**
 * Contribute a per-line `--sb-list-indent` for every line owned by a ListItem,
 * using `computeMarkerWidth` to derive the value from source. The `.cm-line`
 * rule in editor.scss sums it with the other indent contributions.
 *
 * Nested list lines: when we iterate the syntax tree, outer ListItems are
 * visited before their nested children. CodeMirror concatenates same-position
 * line decorations' `style` attributes with `;`, and the last declaration of
 * a given property wins — so the inner item's (deeper) marker width
 * overwrites the outer item's for the nested portion. This is the behaviour
 * we want: every line gets the marker width of the innermost ListItem it
 * belongs to.
 */
export function listIndentPlugin() {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    const doc = state.doc;
    const quoteMarkupStart = new Map<number, number>();
    const quoteMarkupEnd = new Map<number, number>();
    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        if (type.name === "QuoteMark") {
          // Matches block_quote.ts's rule exactly: the trailing space
          // belongs to the marker.
          const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
          const lineStart = doc.lineAt(from).from;
          quoteMarkupStart.set(
            lineStart,
            Math.min(quoteMarkupStart.get(lineStart) ?? from, from),
          );
          quoteMarkupEnd.set(
            lineStart,
            Math.max(quoteMarkupEnd.get(lineStart) ?? 0, end),
          );
          return;
        }
        if (type.name !== "ListItem") return;
        // QuoteMark precedes ListItem in document order on the same line, so
        // the maps above are already populated by the time we get here.
        const startLine = doc.lineAt(from);
        const quoteColumns = quoteMarkupEnd.has(startLine.from)
          ? quoteMarkupEnd.get(startLine.from)! -
            quoteMarkupStart.get(startLine.from)!
          : 0;
        const width = computeMarkerWidth(node, startLine.from, quoteColumns);
        if (width <= 0) return;
        const styleAttr = `--sb-list-indent:${width}ch`;
        const endLine = doc.lineAt(to);
        for (
          let lineNo = startLine.number;
          lineNo <= endLine.number;
          lineNo++
        ) {
          const line = doc.line(lineNo);
          widgets.push(
            Decoration.line({
              attributes: { style: styleAttr },
            }).range(line.from),
          );
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
