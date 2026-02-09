import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "./util.ts";

export function attributePlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.type.name !== "Attribute") {
          return;
        }
        if (isCursorInRange(state, [node.from, node.to])) {
          return;
        }

        const attributeText = state.sliceDoc(node.from, node.to);

        // attribute text will have a format of [hell: bla bla bla]
        const attributeName = attributeText.slice(
          1,
          attributeText.indexOf(":"),
        );
        const attributeValue = attributeText.slice(
          attributeText.indexOf(":") + 1,
          attributeText.length - 1,
        ).trim();

        // Wrap the tag in html anchor element
        widgets.push(
          Decoration.mark({
            tagName: "span",
            class: "sb-attribute",
            attributes: {
              [`data-${attributeName}`]: attributeValue,
            },
          }).range(node.from, node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
