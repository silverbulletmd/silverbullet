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
 * Plugin to hide path prefix when the cursor is not inside.
 */
class CleanWikiLinkPlugin {
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
    // let parentRange: [number, number];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        if (type.name === "WikiLinkPage") {
          // Adding 2 on each side due to [[ and ]] that are outside the WikiLinkPage node
          if (isCursorInRange(view.state, [from - 2, to + 2])) {
            return;
          }

          // Add decoration to hide the prefix [[
          widgets.push(
            invisibleDecoration.range(
              from - 2,
              from,
            ),
          );
          // Add decoration to hide the postfix [[
          widgets.push(
            invisibleDecoration.range(
              to,
              to + 2,
            ),
          );

          // Now check if there's a "/" inside
          const text = view.state.sliceDoc(from, to);
          if (text.indexOf("/") === -1) {
            return;
          }
          // Add a inivisible decoration to hide the path prefix
          widgets.push(
            invisibleDecoration.range(
              from,
              from + text.lastIndexOf("/") + 1,
            ),
          );
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

export const cleanWikiLinkPlugin = () => [
  ViewPlugin.fromClass(CleanWikiLinkPlugin, {
    decorations: (v) => v.decorations,
  }),
];
