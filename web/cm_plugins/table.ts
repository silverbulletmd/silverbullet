import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import { ParseTree, renderToText } from "../../plug-api/lib/tree.ts";
import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import type { Client } from "../client.ts";
import { resolveAttachmentPath } from "$sb/lib/resolve.ts";

class TableViewWidget extends WidgetType {
  tableBodyText: string;
  constructor(
    readonly pos: number,
    readonly client: Client,
    readonly t: ParseTree,
  ) {
    super();
    this.tableBodyText = renderToText(t);
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.classList.add("sb-table-widget");
    dom.addEventListener("click", (e) => {
      // Pulling data-pos to put the cursor in the right place, falling back
      // to the start of the table.
      const dataAttributes = (e.target as any).dataset;
      this.client.editorView.dispatch({
        selection: {
          anchor: dataAttributes.pos ? +dataAttributes.pos : this.pos,
        },
      });
    });

    dom.innerHTML = renderMarkdownToHtml(this.t, {
      // Annotate every element with its position so we can use it to put
      // the cursor there when the user clicks on the table.
      annotationPositions: true,
      translateUrls: (url) => {
        if (!url.includes("://")) {
          url = resolveAttachmentPath(this.client.currentPage, decodeURI(url));
        }

        return url;
      },
      preserveAttributes: true,
    });

    setTimeout(() => {
      this.client.setCachedWidgetHeight(
        `table:${this.tableBodyText}`,
        dom.clientHeight,
      );
    });
    return dom;
  }

  get estimatedHeight(): number {
    const height = this.client.getCachedWidgetHeight(
      `table:${this.tableBodyText}`,
    );
    // console.log("Calling estimated height for table", height);
    return height;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TableViewWidget &&
      other.tableBodyText === this.tableBodyText
    );
  }
}

export function tablePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        const { from, to, name } = node;
        if (name !== "Table") return;
        if (isCursorInRange(state, [from, to])) return;

        const tableText = state.sliceDoc(from, to);
        const lineStrings = tableText.split("\n");

        const lines: { from: number; to: number }[] = [];
        let fromIt = from;
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

        widgets.push(invisibleDecoration.range(firstLine.from, firstLine.to));
        widgets.push(invisibleDecoration.range(lastLine.from, lastLine.to));

        lines.slice(1, lines.length - 1).forEach((line) => {
          widgets.push(
            Decoration.line({ class: "sb-line-table-outside" }).range(
              line.from,
            ),
          );
        });
        const text = state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              from,
              editor,
              lezerToParseTree(text, node.node),
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
