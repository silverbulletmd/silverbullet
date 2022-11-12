import {
  Decoration,
  DecorationSet,
  EditorView,
  syntaxTree,
  ViewPlugin,
  ViewUpdate,
} from "../deps.ts";
import { isCursorInRange } from "./util.ts";

function getDirectives(view: EditorView) {
  const widgets: any[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: ({ type, from, to }) => {
        if (type.name !== "CommentBlock") {
          return;
        }
        const text = view.state.sliceDoc(from, to);
        if (/<!--\s*#/.exec(text)) {
          // Open directive
          widgets.push(
            Decoration.line({
              class: "sb-directive-start",
            }).range(from),
          );
        } else if (/<!--\s*\//.exec(text)) {
          widgets.push(
            Decoration.line({
              class: "sb-directive-end",
            }).range(from),
          );
        } else {
          return;
        }
        if (!isCursorInRange(view.state, [from, to])) {
          widgets.push(
            Decoration.line({
              class: "sb-directive-outside",
            }).range(from),
          );
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const directivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = getDirectives(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = getDirectives(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
