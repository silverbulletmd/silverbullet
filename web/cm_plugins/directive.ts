import { Decoration, EditorState, syntaxTree } from "../deps.ts";
import { decoratorStateField, isCursorInRange } from "./util.ts";

function getDirectives(state: EditorState) {
  const widgets: any[] = [];

  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (type.name !== "CommentBlock") {
        return;
      }
      const text = state.sliceDoc(from, to);
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
      if (!isCursorInRange(state, [from, to])) {
        widgets.push(
          Decoration.line({
            class: "sb-directive-outside",
          }).range(from),
        );
      }
    },
  });

  return Decoration.set(widgets, true);
}

export function directivePlugin() {
  return decoratorStateField(getDirectives);
}
