// BLOCKQUOTE

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "../deps.ts";
import {
  editorLines,
  isCursorInRange,
  iterateTreeInVisibleRanges,
} from "./util.ts";

const quoteMarkRE = /^(\s*>+)/gm;
/**
 * Plugin to add style blockquotes.
 */
class BlockQuotePlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.styleBlockquote(view);
  }
  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet
    ) {
      this.decorations = this.styleBlockquote(update.view);
    }
  }
  /**
   * @param view - The editor view
   * @returns The blockquote decorations to add to the editor
   */
  private styleBlockquote(view: EditorView): DecorationSet {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: ({ name, from, to }) => {
        if (name !== "Blockquote") return;
        const lines = editorLines(view, from, to);

        lines.forEach((line) => {
          const lineDec = Decoration.line({
            class: "sb-blockquote",
          });
          widgets.push(lineDec.range(line.from));
        });

        if (
          lines.every(
            (line) => !isCursorInRange(view.state, [line.from, line.to]),
          )
        ) {
          const marks = Array.from(
            view.state.sliceDoc(from, to).matchAll(quoteMarkRE),
          )
            .map((x) => from + x.index!)
            .map((i) =>
              Decoration.line({
                class: "sb-blockquote-outside",
              }).range(i)
            );

          widgets.push(...marks);
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

export const blockQuotePlugin = ViewPlugin.fromClass(BlockQuotePlugin, {
  decorations: (v) => v.decorations,
});
