import {
  Decoration,
  DecorationSet,
  EditorView,
  syntaxTree,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "../deps.ts";
import {
  editorLines,
  invisibleDecoration,
  isCursorInRange,
  iterateTreeInVisibleRanges,
} from "./util.ts";

import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import { ParseTree } from "$sb/lib/tree.ts";
import { lezerToParseTree } from "../../common/parse_tree.ts";

class TableViewWidget extends WidgetType {
  constructor(
    readonly pos: number,
    readonly editorView: EditorView,
    readonly t: ParseTree,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.classList.add("sb-table-widget");
    dom.addEventListener("click", () => {
      this.editorView.dispatch({
        selection: {
          anchor: this.pos,
        },
      });
    });

    dom.innerHTML = renderMarkdownToHtml(this.t);
    return dom;
  }
}

class TablePlugin {
  decorations: DecorationSet = Decoration.none;
  constructor(view: EditorView) {
    this.decorations = this.decorateLists(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.decorateLists(update.view);
    }
  }
  private decorateLists(view: EditorView) {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: (node) => {
        const { from, to, name } = node;
        if (name !== "Table") return;
        if (isCursorInRange(view.state, [from, to])) return;

        const lines = editorLines(view, from, to);

        const firstLine = lines[0], lastLine = lines[lines.length - 1];

        widgets.push(invisibleDecoration.range(firstLine.from, firstLine.to));
        widgets.push(invisibleDecoration.range(lastLine.from, lastLine.to));

        lines.slice(1, lines.length - 1).forEach((line) => {
          widgets.push(
            Decoration.line({ class: "sb-line-table-outside" }).range(
              line.from,
            ),
          );
        });
        const text = view.state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              from,
              view,
              lezerToParseTree(text, node.node),
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  }
}
export const tablePlugin = ViewPlugin.fromClass(
  TablePlugin,
  {
    decorations: (v) => v.decorations,
  },
);
