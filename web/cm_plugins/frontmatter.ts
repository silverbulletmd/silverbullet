import { EditorState } from "@codemirror/state";
import { foldedRanges, syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField, HtmlWidget, isCursorInRange } from "./util.ts";

export function frontmatterPlugin() {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];
      const foldRanges = foldedRanges(state);

      syntaxTree(state).iterate({
        enter(node) {
          if (
            node.name === "FrontMatterMarker"
          ) {
            const parent = node.node.parent!;

            const folded = foldRanges.iter();
            let shouldShowFrontmatterBanner = false;
            while (folded.value) {
              // Check if cursor is in the folded range
              if (isCursorInRange(state, [folded.from, folded.to])) {
                // console.log("Cursor is in folded area, ");
                shouldShowFrontmatterBanner = true;
                break;
              }
              folded.next();
            }
            if (!isCursorInRange(state, [parent.from, parent.to])) {
              widgets.push(
                Decoration.line({
                  class: "sb-line-frontmatter-outside",
                }).range(node.from),
              );
              shouldShowFrontmatterBanner = true;
            }
            if (shouldShowFrontmatterBanner && parent.from === node.from) {
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
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
