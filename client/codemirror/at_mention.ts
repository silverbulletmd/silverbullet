import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";

export function atMentionPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.type.name !== "AtMention") {
          return;
        }
        // A signature (`-- @name`) is not a recipient pill; its nested
        // AtMention is styled as a byline instead.
        if (node.node.parent?.type.name === "AtMentionSignature") {
          return;
        }
        const { from, to } = node;
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
