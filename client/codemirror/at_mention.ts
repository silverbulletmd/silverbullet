import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";

export function atMentionPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "AtMention") {
          return;
        }
        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: "sb-at-mention",
            attributes: {
              "data-mention-name": state.sliceDoc(from + 1, to),
            },
          }).range(from, to),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
