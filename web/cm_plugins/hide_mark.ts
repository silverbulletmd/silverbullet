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
  isCursorInRange,
  iterateTreeInVisibleRanges,
} from "./util.ts";

/**
 * These types contain markers as child elements that can be hidden.
 */
const typesWithMarks = [
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Highlight",
  "Strikethrough",
  "CommandLink",
];
/**
 * The elements which are used as marks.
 */
const markTypes = [
  "EmphasisMark",
  "CodeMark",
  "HighlightMark",
  "StrikethroughMark",
  "CommandLinkMark",
];

/**
 * Plugin to hide marks when the they are not in the editor selection.
 */
class HideMarkPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.compute(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view: EditorView): DecorationSet {
    const widgets: any[] = [];
    let parentRange: [number, number];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to, node }) => {
        if (typesWithMarks.includes(type.name)) {
          // There can be a possibility that the current node is a
          // child eg. a bold node in a emphasis node, so check
          // for that or else save the node range
          if (
            parentRange &&
            checkRangeOverlap([from, to], parentRange)
          ) {
            return;
          } else parentRange = [from, to];
          if (isCursorInRange(view.state, [from, to])) return;
          const innerTree = node.toTree();
          innerTree.iterate({
            enter({ type, from: markFrom, to: markTo }) {
              // Check for mark types and push the replace
              // decoration
              if (!markTypes.includes(type.name)) return;
              widgets.push(
                invisibleDecoration.range(
                  from + markFrom,
                  from + markTo,
                ),
              );
            },
          });
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

/**
 * Ixora hide marks plugin.
 *
 * This plugin allows to:
 * - Hide marks when they are not in the editor selection.
 */
export const hideMarks = () => [
  ViewPlugin.fromClass(HideMarkPlugin, {
    decorations: (v) => v.decorations,
  }),
];

// HEADINGS

class HideHeaderMarkPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.hideHeaderMark(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.hideHeaderMark(update.view);
    }
  }
  /**
   * Function to decide if to insert a decoration to hide the header mark
   * @param view - Editor view
   * @returns The `Decoration`s that hide the header marks
   */
  private hideHeaderMark(view: EditorView) {
    const widgets: any[] = [];
    const ranges = view.state.selection.ranges;
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        // Get the active line
        const line = view.lineBlockAt(from);
        // If any cursor overlaps with the heading line, skip
        const cursorOverlaps = ranges.some(({ from, to }) =>
          checkRangeOverlap([from, to], [line.from, line.to])
        );
        if (cursorOverlaps && type.name === "HeaderMark") {
          widgets.push(
            Decoration.line({ class: "sb-header-inside" }).range(from),
          );
          return;
        } else if (cursorOverlaps) {
          return;
        }
        if (
          type.name === "HeaderMark" &&
          // Setext heading's horizontal lines are not hidden.
          /[#]/.test(view.state.sliceDoc(from, to))
        ) {
          const dec = Decoration.replace({});
          widgets.push(dec.range(from, to + 1));
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

/**
 * Plugin to hide the header mark.
 *
 * The header mark will not be hidden when:
 * - The cursor is on the active line
 * - The mark is on a line which is in the current selection
 */
export const hideHeaderMarkPlugin = ViewPlugin.fromClass(HideHeaderMarkPlugin, {
  decorations: (v) => v.decorations,
});
