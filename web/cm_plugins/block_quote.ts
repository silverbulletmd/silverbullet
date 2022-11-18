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

class BlockquotePlugin {
  decorations: DecorationSet = Decoration.none;
  constructor(view: EditorView) {
    this.decorations = this.decorateLists(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.decorateLists(update.view);
    }
  }
  private decorateLists(view: EditorView) {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        if (isCursorInRange(view.state, [from, to])) return;
        if (type.name === "QuoteMark") {
          widgets.push(invisibleDecoration.range(from, to));
          widgets.push(
            Decoration.line({ class: "sb-blockquote-outside" }).range(from),
          );
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}
export const blockquotePlugin = ViewPlugin.fromClass(
  BlockquotePlugin,
  {
    decorations: (v) => v.decorations,
  },
);
