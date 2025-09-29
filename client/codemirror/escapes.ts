import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

export function cleanEscapePlugin() {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];

      syntaxTree(state).iterate({
        enter({ type, from, to }) {
          if (
            type.name === "Escape" &&
            !isCursorInRange(state, [from, to])
          ) {
            widgets.push(invisibleDecoration.range(from, from + 1));
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
