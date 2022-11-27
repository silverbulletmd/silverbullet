import { pageLinkRegex } from "../../common/parser.ts";
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
        if (type.name === "WikiLink") {
          // Adding 2 on each side due to [[ and ]] that are outside the WikiLinkPage node
          if (isCursorInRange(view.state, [from, to])) {
            return;
          }

          // Add decoration to hide the prefix [[
          widgets.push(
            invisibleDecoration.range(
              from,
              from + 2,
            ),
          );
          // Add decoration to hide the postfix [[
          widgets.push(
            invisibleDecoration.range(
              to - 2,
              to,
            ),
          );

          // Now check if this page has an alias
          const text = view.state.sliceDoc(from, to);
          const match = pageLinkRegex.exec(text);
          if (!match) return;
          const [_fullMatch, page, pipePart] = match;

          if (!pipePart) {
            // No alias, let's check if there's a slash in the page name
            if (text.indexOf("/") === -1) {
              return;
            }
            // Add a inivisible decoration to hide the path prefix
            widgets.push(
              invisibleDecoration.range(
                from + 2, // +2 to skip the [[
                from + text.lastIndexOf("/") + 1,
              ),
            );
          } else {
            // Alias is present, so we hide the part before the pipe
            widgets.push(
              invisibleDecoration.range(
                from + 2,
                from + page.length + 3, // 3 is for the [[ and the |
              ),
            );
          }
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
