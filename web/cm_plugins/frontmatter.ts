import type { EditorState } from "@codemirror/state";
import { foldedRanges, syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField, HtmlWidget, isCursorInRange, LinkWidget } from "./util.ts";

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

          // Render external links inside frontmatter code as clickable anchors
          if (node.name === "FrontMatterCode") {
            const from = node.from;
            const to = node.to;
            const text = state.sliceDoc(from, to);
            const urlRegex = /(https?:\/\/[^\s"']+)/g;
            let match: RegExpExecArray | null;
            while ((match = urlRegex.exec(text)) !== null) {
              const mFrom = from + (match.index ?? 0);
              const mTo = mFrom + match[0].length;
              if (isCursorInRange(state, [mFrom, mTo])) {
                continue;
              }
              // Replace URL text with a LinkWidget to make it navigable
              const url = match[0];
              widgets.push(
                Decoration.replace({
                  widget: new LinkWidget({
                    text: url,
                    title: `Open ${url}`,
                    href: url,
                    cssClass: "sb-external-link",
                    from: mFrom,
                    callback: () => {
                      try {
                          globalThis.open(url, "_blank" );
                      } catch (err) {
                        console.error("Failed to open external link", err);
                      }
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
