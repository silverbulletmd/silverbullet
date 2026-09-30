import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Client } from "../client.ts";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
} from "./util.ts";
import {
  attachWidgetEventHandlers,
  buildResolveTransclusion,
  buildTranslateUrls,
} from "./widget_util.ts";

class TableViewWidget extends WidgetType {
  tableBodyText: string;
  private rowCount: number;

  constructor(
    readonly client: Client,
    readonly t: ParseTree,
  ) {
    super();
    this.tableBodyText = renderToText(t);
    this.rowCount =
      t.children?.filter(
        (child) => child.type === "TableHeader" || child.type === "TableRow",
      ).length ?? 0;
  }

  override get estimatedHeight(): number {
    const cachedHeight = this.client.widgetCache.getCachedWidgetHeight(
      `table:${this.tableBodyText}`,
    );
    // Tables are replaced by a single widget. Without a height estimate,
    // CodeMirror has to revise the document height as each large table enters
    // the viewport, which can move the scroll position by thousands of pixels.
    return cachedHeight > 0 ? cachedHeight : this.rowCount * 42;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.classList.add("sb-table-widget");
    // expandMarkdown is asynchronous. Reserve the widget's height until the
    // table is ready so its insertion does not collapse the scrollable area.
    dom.style.minHeight = `${this.estimatedHeight}px`;
    dom.addEventListener("click", (e) => {
      const dataAttributes = (e.target as any).dataset;
      const fallbackPos = this.client.editorView.posAtDOM(dom, 0);
      this.client.editorView.dispatch({
        selection: {
          anchor: dataAttributes.pos ? +dataAttributes.pos : fallbackPos,
        },
      });
    });

    const resolveTransclusion = buildResolveTransclusion(this.client);
    void expandMarkdown(
      this.client.space,
      this.client.currentName(),
      this.t,
      this.client.clientSystem.spaceLuaEnv,
      {
        syntaxExtensions: this.client.config.get("syntaxExtensions", {}),
        resolveTransclusion,
      },
    ).then((t) => {
      dom.innerHTML = renderMarkdownToHtml(t, {
        // Annotate every element with its position so we can use it to put
        // the cursor there when the user clicks on the table.
        annotationPositions: true,
        shortWikiLinks: this.client.config.get("shortWikiLinks", true),
        translateUrls: buildTranslateUrls(this.client),
        resolveTransclusion,
      });
      dom.style.minHeight = "";
      setTimeout(() => {
        if (!dom.isConnected) return;
        attachWidgetEventHandlers(dom, this.client, this.tableBodyText);

        this.client.widgetCache.setCachedWidgetMeta(
          `table:${this.tableBodyText}`,
          { height: dom.clientHeight, block: true },
        );
      });
    });
    return dom;
  }

  override eq(other: WidgetType): boolean {
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

        hideBlockSource(widgets, state, from, to, "start");

        const text = state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              editor,
              lezerToParseTree(text, node.node),
            ),
            block: true,
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
