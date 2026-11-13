import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  cloneTree,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Client } from "../../client.ts";
import type { PopupEntry } from "../../components/popup_menu.ts";
import { lezerToParseTree } from "../../markdown_parser/parse_tree.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import {
  destroyRenderTarget,
  renderMarkdownInto,
} from "../../markdown_renderer/render_into.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
} from "../util.ts";
import { registerWidgetMenu } from "../widgets/block_menu.ts";
import { blockSpanAt } from "../widgets/block_span.ts";
import { registerMarkdownWidget } from "../widgets/code_widget.ts";
import { widgetMenuItem } from "../widgets/widget_menu.ts";
import { attachWidgetEventHandlers } from "../widgets/widget_util.ts";

export class TableViewWidget extends WidgetType {
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

    registerWidgetMenu(dom, {
      label: "Table",
      block: true,
      entries: () => tableMenuEntries(this.client, dom, this.tableBodyText),
      span: () => {
        const from = tableSourceAt(this.client, dom);
        return from === undefined
          ? undefined
          : blockSpanAt(this.client.editorView.state, from);
      },
    });

    const render = (target: HTMLElement) =>
      renderMarkdownInto(
        target,
        cloneTree(this.t),
        liveContextForClient(this.client, { taskRefs: "page" }),
        { annotationPositions: true },
      );
    registerMarkdownWidget(dom, render);
    void render(dom).then((filled) => {
      if (!filled) return;
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

  override destroy(dom: HTMLElement): void {
    destroyRenderTarget(dom);
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof TableViewWidget &&
      other.tableBodyText === this.tableBodyText
    );
  }
}

/** Where a shown table's source starts now */
function tableSourceAt(client: Client, dom: HTMLElement): number | undefined {
  if (!dom.isConnected) return;
  try {
    return client.editorView.posAtDOM(dom, 0);
  } catch {
    return;
  }
}

/**
 * A rendered table's menu (behind the margin ⋮, which adds Move and Delete):
 * Edit source where the page can be edited, Copy as Markdown
 */
export function tableMenuEntries(
  client: Client,
  dom: HTMLElement,
  source: string,
): PopupEntry[] {
  const readOnly = client.isReadOnlyMode() || client.editorView.state.readOnly;
  const edit: PopupEntry = {
    ...widgetMenuItem("edit", "Edit source"),
    run: () => {
      const anchor = tableSourceAt(client, dom);
      if (anchor === undefined) return;
      client.editorView.dispatch({ selection: { anchor } });
      client.focus();
    },
  };
  const copy: PopupEntry = {
    ...widgetMenuItem("copy", "Copy as Markdown"),
    run: () => {
      void client.clientSystem
        .localSyscall("editor.copyToClipboard", [source.trim()])
        .then(() => client.ui.flashNotification("Copied as Markdown"))
        .catch(console.error);
    },
  };
  return readOnly ? [copy] : [edit, copy];
}

export function tablePlugin(editor: Client) {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
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
  }, {});
}
