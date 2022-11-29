import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "../deps.ts";
import {
  invisibleDecoration,
  isCursorInRange,
  iterateTreeInVisibleRanges,
} from "./util.ts";

function hideNodes(view: EditorView) {
  const widgets: any[] = [];
  iterateTreeInVisibleRanges(view, {
    enter(node) {
      if (
        node.name === "HorizontalRule" &&
        !isCursorInRange(view.state, [node.from, node.to])
      ) {
        widgets.push(invisibleDecoration.range(node.from, node.to));
        widgets.push(
          Decoration.line({
            class: "sb-line-hr",
          }).range(node.from),
        );
      }

      if (
        node.name === "Image" &&
        !isCursorInRange(view.state, [node.from, node.to])
      ) {
        widgets.push(invisibleDecoration.range(node.from, node.to));
      }

      if (
        node.name === "FrontMatterMarker"
      ) {
        const parent = node.node.parent!;
        if (!isCursorInRange(view.state, [parent.from, parent.to])) {
          widgets.push(
            Decoration.line({
              class: "sb-line-frontmatter-outside",
            }).range(node.from),
          );
        }
      }

      if (
        node.name === "CodeMark"
      ) {
        const parent = node.node.parent!;
        // Hide ONLY if CodeMark is not insine backticks (InlineCode) and the cursor is placed outside
        if (
          parent.node.name !== "InlineCode" &&
          !isCursorInRange(view.state, [parent.from, parent.to])
        ) {
          widgets.push(
            Decoration.line({
              class: "sb-line-code-outside",
            }).range(node.from),
          );
        }
      }
    },
  });
  return Decoration.set(widgets, true);
}

export const cleanBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = hideNodes(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = hideNodes(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
