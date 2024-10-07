import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
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
import { MarkdownWidget } from "./markdown_widget.ts";

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
            widget: new MarkdownWidget(
              node.from,
              client,
              `lua:${text}`,
              text,
              async (bodyText) => {
                try {
                  const parsedLua = parseLua(`_(${bodyText})`) as LuaBlock;
                  const expr =
                    (parsedLua.statements[0] as LuaFunctionCallStatement).call
                      .args[0];

                  const result = await evalExpression(
                    expr,
                    client.clientSystem.spaceLuaEnv.env,
                  );
                  return {
                    markdown: "" + result,
                  };
                } catch (e: any) {
                  console.error("Lua eval error", e);
                  return {
                    markdown: `**Lua error:** ${e.message}`,
                  };
                }
              },
              "sb-lua-directive",
              true,
            ),
          }).range(node.to),
        );
        widgets.push(invisibleDecoration.range(node.from, node.to));
      },
    });

    return Decoration.set(widgets, true);
  });
}
