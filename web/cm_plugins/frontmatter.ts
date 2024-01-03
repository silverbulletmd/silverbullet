import { Client } from "../client.ts";
import { Decoration, EditorState, syntaxTree } from "../deps.ts";
import { MarkdownWidget } from "./markdown_widget.ts";
import { decoratorStateField, HtmlWidget, isCursorInRange } from "./util.ts";

export function frontmatterPlugin(client: Client) {
  const panelWidgetHook = client.system.panelWidgetHook;
  const frontmatterCallback = panelWidgetHook.callbacks.get("frontmatter");
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];

      syntaxTree(state).iterate({
        enter(node) {
          if (
            node.name === "FrontMatter"
          ) {
            if (!isCursorInRange(state, [node.from, node.to])) {
              if (frontmatterCallback) {
                // Render as a widget
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

                lines.slice(0, lines.length - 1).forEach((line) => {
                  widgets.push(
                    // Reusing line-table-outside here for laziness reasons
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
                      "",
                      frontmatterCallback,
                      "sb-markdown-frontmatter-widget",
                    ),
                    // side: -1,
                    block: true,
                  }).range(lines[lines.length - 1].from),
                );
              } else if (!frontmatterCallback) {
                // Not rendering as a widget
                widgets.push(
                  Decoration.widget({
                    widget: new HtmlWidget(
                      `frontmatter`,
                      "sb-frontmatter-marker",
                    ),
                  }).range(node.from),
                );
                widgets.push(
                  Decoration.line({
                    class: "sb-line-frontmatter-outside",
                  }).range(node.from),
                );
                widgets.push(
                  Decoration.line({
                    class: "sb-line-frontmatter-outside",
                  }).range(state.doc.lineAt(node.to).from),
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
