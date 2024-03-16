// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.

import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  checkRangeOverlap,
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
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
];
/**
 * The elements which are used as marks.
 */
const markTypes = [
  "EmphasisMark",
  "CodeMark",
  "HighlightMark",
  "StrikethroughMark",
];

/**
 * Ixora hide marks plugin.
 *
 * This plugin allows to:
 * - Hide marks when they are not in the editor selection.
 */
export function hideMarksPlugin() {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    let parentRange: [number, number];
    syntaxTree(state).iterate({
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
          if (isCursorInRange(state, [from, to])) return;
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
  });
}

// HEADINGS

export function hideHeaderMarkPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (!type.name.startsWith("ATXHeading")) {
          return;
        }
        // Get the active line
        const line = state.sliceDoc(from, to);
        if (isCursorInRange(state, [from, to])) {
          widgets.push(
            Decoration.line({ class: "sb-header-inside" }).range(from),
          );
          return;
        }

        const spacePos = line.indexOf(" ");
        if (spacePos === -1) {
          // Not complete header
          return;
        }
        widgets.push(
          invisibleDecoration.range(
            from,
            from + spacePos + 1,
          ),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
