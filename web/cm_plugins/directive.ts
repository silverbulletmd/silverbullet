import { Decoration, EditorState, syntaxTree } from "../deps.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

// Does a few things: hides the directives when the cursor is not placed inside
// Adds a class to the start and end of the directive when the cursor is placed inside
export function directivePlugin() {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    const cursorPos = state.selection.main.head;

    // TODO: This doesn't handle nested directives properly
    let posOfLastOpen = { from: 0, to: 0 };

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "CommentBlock") {
          return;
        }
        const text = state.sliceDoc(from, to);
        if (/<!--\s*#/.exec(text)) {
          // Open directive
          posOfLastOpen = { from, to };
        } else if (/<!--\s*\//.exec(text)) {
          // Close directive
          if (
            (cursorPos > to || cursorPos < posOfLastOpen.from) &&
            !isCursorInRange(state, [posOfLastOpen.from, to])
          ) {
            widgets.push(
              invisibleDecoration.range(
                posOfLastOpen.from,
                posOfLastOpen.to + 1,
              ),
            );
            widgets.push(
              invisibleDecoration.range(from - 1, to),
            );
          } else {
            widgets.push(
              Decoration.line({
                class: "sb-directive-start",
              }).range(posOfLastOpen.from),
            );
            widgets.push(
              Decoration.line({
                class: "sb-directive-end",
              }).range(from),
            );
          }
        } else {
          return;
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
