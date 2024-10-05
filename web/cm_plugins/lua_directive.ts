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
import { parse } from "$common/space_lua/parse.ts";
import type {
  LuaBlock,
  LuaFunctionCallStatement,
} from "$common/space_lua/ast.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { luaToString } from "$common/space_lua/runtime.ts";

class LuaDirectiveWidget extends WidgetType {
  constructor(
    readonly code: string,
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
      const parsedLua = parse(`_(${this.code})`) as LuaBlock;
      const expr =
        (parsedLua.statements[0] as LuaFunctionCallStatement).call.args[0];

      Promise.resolve(evalExpression(expr, client.clientSystem.spaceLuaEnv.env))
        .then((result) => {
          span.innerText = luaToString(result);
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
            widget: new LuaDirectiveWidget(text),
          }).range(node.to),
        );
        widgets.push(invisibleDecoration.range(node.from, node.to));
      },
    });

    return Decoration.set(widgets, true);
  });
}
