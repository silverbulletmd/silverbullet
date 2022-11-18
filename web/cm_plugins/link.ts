// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "../deps.ts";
import {
  checkRangeOverlap,
  invisibleDecoration,
  iterateTreeInVisibleRanges,
} from "./util.ts";

function getLinkAnchor(view: EditorView) {
  const widgets: any[] = [];

  iterateTreeInVisibleRanges(view, {
    enter: ({ type, from, to, node }) => {
      if (type.name !== "URL") return;
      const parent = node.parent;
      const blackListedParents = ["Image"];
      if (parent && !blackListedParents.includes(parent.name)) {
        const marks = parent.getChildren("LinkMark");
        const ranges = view.state.selection.ranges;
        const cursorOverlaps = ranges.some(({ from, to }) =>
          checkRangeOverlap([from, to], [parent.from, parent.to])
        );
        if (!cursorOverlaps) {
          widgets.push(
            ...marks.map(({ from, to }) => invisibleDecoration.range(from, to)),
            invisibleDecoration.range(from, to),
          );
        }
      }
    },
  });

  return Decoration.set(widgets, true);
}

export const goToLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = getLinkAnchor(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = getLinkAnchor(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
