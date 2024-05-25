import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

export function cleanBlockPlugin() {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];

      syntaxTree(state).iterate({
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

          if (
            node.name === "Image" &&
            !isCursorInRange(state, [node.from, node.to])
          ) {
            widgets.push(invisibleDecoration.range(node.from, node.to));
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
