import { Decoration, EditorState, syntaxTree } from "../deps.ts";
import {
  decoratorStateField,
  HtmlWidget,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

function hideNodes(state: EditorState) {
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

      if (
        node.name === "FrontMatterMarker"
      ) {
        const parent = node.node.parent!;
        if (!isCursorInRange(state, [parent.from, parent.to])) {
          widgets.push(
            Decoration.line({
              class: "sb-line-frontmatter-outside",
            }).range(node.from),
          );
          if (parent.from === node.from) {
            // Only put this on the first line of the frontmatter
            widgets.push(
              Decoration.widget({
                widget: new HtmlWidget(
                  `frontmatter`,
                  "sb-frontmatter-marker",
                ),
              }).range(node.from),
            );
          }
        }
      }
    },
  });
  return Decoration.set(widgets, true);
}

export function cleanBlockPlugin() {
  return decoratorStateField(hideNodes);
}
