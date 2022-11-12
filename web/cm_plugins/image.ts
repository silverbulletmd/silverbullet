// IMAGE

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
        node.name === "Image" &&
        !isCursorInRange(view.state, [node.from, node.to])
      ) {
        widgets.push(invisibleDecoration.range(node.from, node.to));
      }
    },
  });
  return Decoration.set(widgets, true);
}

export const hideImageNodePlugin = ViewPlugin.fromClass(
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
