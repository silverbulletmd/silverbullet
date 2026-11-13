// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  checkRangeOverlap,
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "../util.ts";

/**
 * These types contain markers as child elements that can be hidden.
 */
const typesWithMarks = [
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Highlight",
  "Strikethrough",
  "Superscript",
  "Subscript",
];
/**
 * The elements which are used as marks.
 */
const markTypes = [
  "EmphasisMark",
  "CodeMark",
  "HighlightMark",
  "StrikethroughMark",
  "SuperscriptMark",
  "SubscriptMark",
];

/**
 * Ixora hide marks plugin.
 *
 * This plugin allows to:
 * - Hide marks when they are not in the editor selection.
 */
export function hideMarksPlugin() {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];
    let parentRange: [number, number];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: ({ type, from, to, node }) => {
        if (typesWithMarks.includes(type.name)) {
          // There can be a possibility that the current node is a
          // child eg. a bold node in a emphasis node, so check
          // for that or else save the node range
          if (parentRange && checkRangeOverlap([from, to], parentRange)) {
            return;
          } else parentRange = [from, to];
          if (isCursorInRange(state, [from, to])) return;
          const innerTree = node.toTree();
          innerTree.iterate({
            enter({ type, from: markFrom, to: markTo }) {
              if (!markTypes.includes(type.name)) return;
              widgets.push(
                invisibleDecoration.range(from + markFrom, from + markTo),
              );
            },
          });
        }
      },
    });
    return Decoration.set(widgets, true);
  }, {});
}

export function hideHeaderMarkPlugin() {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: ({ type, from, to }) => {
        if (!type.name.startsWith("ATXHeading")) {
          return;
        }
        const line = state.sliceDoc(from, to);
        if (line === "#") {
          // Empty header, potentially a tag, style it as such
          widgets.push(
            Decoration.mark({
              tagName: "span",
              class: "sb-hashtag-text",
            }).range(from, from + 1),
          );

          return;
        }
        const spacePos = line.indexOf(" ");
        if (isCursorInRange(state, [from, to])) {
          // The revealed `## ` hangs into the gutter by --sb-header-hang;
          // holding it to exactly that width keeps the title where the
          // hidden marker left it, whatever the font's `#` and space widths.
          if (spacePos !== -1) {
            widgets.push(
              Decoration.mark({ class: "sb-header-mark-slot" }).range(
                from,
                from + spacePos + 1,
              ),
            );
          }
          // A line decoration anchored anywhere but a line start is discarded
          // in silence, and a heading inside a blockquote or a list item does
          // not start at one.
          widgets.push(
            Decoration.line({ class: "sb-header-inside" }).range(
              state.doc.lineAt(from).from,
            ),
          );
          return;
        }

        if (spacePos === -1) {
          return;
        }
        widgets.push(invisibleDecoration.range(from, from + spacePos + 1));
      },
    });
    return Decoration.set(widgets, true);
  }, {});
}
