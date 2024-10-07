import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import { parse as parseLua } from "$common/space_lua/parse.ts";
import type {
  LuaBlock,
  LuaFunctionCallStatement,
} from "$common/space_lua/ast.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { luaToString } from "$common/space_lua/runtime.ts";
import { parse as parseMarkdown } from "$common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";

class LuaDirectiveWidget extends WidgetType {
  constructor(
    readonly code: string,
    private client: Client,
  ) {
    super();
  }

  eq(other: LuaDirectiveWidget) {
    return other.code === this.code;
  }

  // get estimatedHeight(): number {
  //   const cachedHeight = this.client.getCachedWidgetHeight(
  //     `content:${this.url}`,
  //   );
  //   return cachedHeight;
  // }

  toDOM() {
    const span = document.createElement("span");
    span.className = "sb-lua-directive";
    try {
      const parsedLua = parseLua(`_(${this.code})`) as LuaBlock;
      const expr =
        (parsedLua.statements[0] as LuaFunctionCallStatement).call.args[0];

      Promise.resolve(evalExpression(expr, client.clientSystem.spaceLuaEnv.env))
        .then((result) => {
          const mdTree = parseMarkdown(
            extendedMarkdownLanguage,
            luaToString(result),
          );

          const html = renderMarkdownToHtml(mdTree, {
            // Annotate every element with its position so we can use it to put
            // the cursor there when the user clicks on the table.
            annotationPositions: true,
            translateUrls: (url) => {
              if (isLocalPath(url)) {
                url = resolvePath(
                  this.client.currentPage,
                  decodeURI(url),
                );
              }

              return url;
            },
            preserveAttributes: true,
          }, this.client.ui.viewState.allPages);
          span.innerHTML = html;
        }).catch((e) => {
          console.error("Lua eval error", e);
          span.innerText = `Lua error: ${e.message}`;
        });
    } catch (e: any) {
      console.error("Lua parser error", e);
      span.innerText = `Lua error: ${e.message}`;
    }
    span.innerText = "...";

    return span;
  }
}

export function luaDirectivePlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      console.info("Not rendering widgets");
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "LuaDirective") {
          return;
        }

        if (isCursorInRange(state, [node.from, node.to])) {
          return;
        }

        const text = state.sliceDoc(node.from + 2, node.to - 1);

        widgets.push(
          Decoration.widget({
            widget: new LuaDirectiveWidget(text, client),
          }).range(node.to),
        );
        widgets.push(invisibleDecoration.range(node.from, node.to));
      },
    });

    return Decoration.set(widgets, true);
  });
}
