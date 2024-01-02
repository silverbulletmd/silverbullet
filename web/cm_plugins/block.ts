import { Client } from "../client.ts";
import { Decoration, EditorState, foldedRanges, syntaxTree } from "../deps.ts";
import { MarkdownWidget } from "./markdown_widget.ts";
import {
  decoratorStateField,
  HtmlWidget,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

export function cleanBlockPlugin(client: Client) {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];

      const panelWidgetHook = client.system.panelWidgetHook;
      const frontmatterCallback = panelWidgetHook.callbacks.get("frontmatter");

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
            node.name === "FrontMatter"
          ) {
            if (!isCursorInRange(state, [node.from, node.to])) {
              // Render as a widget
              if (frontmatterCallback) {
                const text = state.sliceDoc(node.from, node.to);
                const lineStrings = text.split("\n");

                const lines: { from: number; to: number }[] = [];
                let fromIt = node.from;
                for (const line of lineStrings) {
                  lines.push({
                    from: fromIt,
                    to: fromIt + line.length,
                  });
                  fromIt += line.length + 1;
                }

                const firstLine = lines[0], lastLine = lines[lines.length - 1];

                // In case of doubt, back out
                if (!firstLine || !lastLine) return;

                widgets.push(
                  invisibleDecoration.range(firstLine.from, firstLine.to),
                );
                widgets.push(
                  invisibleDecoration.range(lastLine.from, lastLine.to),
                );
                widgets.push(
                  Decoration.line({
                    class: "sb-frontmatter-first-line",
                  }).range(firstLine.from),
                );
                widgets.push(
                  Decoration.line({
                    class: "sb-frontmatter-last-line",
                  }).range(lastLine.from),
                );

                lines.slice(1, lines.length - 1).forEach((line) => {
                  widgets.push(
                    Decoration.line({ class: "sb-line-table-outside" }).range(
                      line.from,
                    ),
                  );
                });

                widgets.push(
                  Decoration.widget({
                    widget: new MarkdownWidget(
                      undefined,
                      client,
                      `frontmatter:${client.currentPage}`,
                      frontmatterCallback,
                      "sb-markdown-frontmatter-widget",
                    ),
                    side: 1,
                    block: true,
                  }).range(node.to),
                );
              } else if (!frontmatterCallback) {
                widgets.push(
                  Decoration.line({
                    class: "sb-line-frontmatter-outside",
                  }).range(node.from),
                );
              }
            }
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
