import type { SyntaxNode } from "@lezer/common";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

/**
 * Compute the marker-zone width in source columns (== `ch` units) for a
 * single ListItem node.
 * @param listItem  The `ListItem` syntax node.
 * @param lineStart Absolute offset of the line this list-item starts on.
 */
export function computeMarkerWidth(
  listItem: SyntaxNode,
  lineStart: number,
): number {
  const mark = listItem.firstChild;
  if (!mark || mark.name !== "ListMark") {
    return 0;
  }
  const leadingIndent = mark.from - lineStart;
  const markLength = mark.to - mark.from;
  // TaskState wraps `[X]` / `[done]` / etc. (length varies by status string).
  // Width contribution = TaskState range length + 1 for the trailing space.
  const taskState = listItem.getChild("Task")?.getChild("TaskState");
  const taskExtra = taskState ? (taskState.to - taskState.from) + 1 : 0;
  return leadingIndent + markLength + 1 + taskExtra;
}

/**
 * Emit a per-line `padding-left` / `text-indent` for every line owned by a
 * ListItem, using `computeMarkerWidth` to derive the value from source.
 *
 * Nested list lines: when we iterate the syntax tree, outer ListItems are
 * visited before their nested children. CodeMirror's Decoration.set with
 * `sort: true` resolves multiple line decorations at the same position by
 * picking the latest one added in iteration order — so the inner item's
 * (deeper) marker width overwrites the outer item's for the nested portion.
 * This is the behaviour we want: every line gets the marker width of the
 * innermost ListItem it belongs to.
 */
export function listIndentPlugin() {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    const doc = state.doc;
    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        if (type.name !== "ListItem") return;
        const startLine = doc.lineAt(from);
        const width = computeMarkerWidth(node, startLine.from);
        if (width <= 0) return;
        const styleAttr =
          `padding-left:${width}ch;text-indent:-${width}ch`;
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
