import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "../util.ts";

export function cleanBlockPlugin() {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter(node) {
        if (
          node.name === "HorizontalRule" &&
          !isCursorInRange(state, [node.from, node.to])
        ) {
          widgets.push(invisibleDecoration.range(node.from, node.to));
          widgets.push(
            Decoration.line({
              class: "sb-line-hr",
            }).range(node.from),
          );
        }
      },
    });
    return Decoration.set(widgets, true);
  }, {});
}
