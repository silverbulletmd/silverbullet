import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import type { Client } from "../client.ts";
import { parse as parseLua } from "../../lib/space_lua/parse.ts";
import type {
  LuaBlock,
  LuaFunctionCallStatement,
} from "../../lib/space_lua/ast.ts";
import { evalExpression } from "../../lib/space_lua/eval.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  luaValueToJS,
  singleResult,
} from "../../lib/space_lua/runtime.ts";
import { encodeRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import { resolveASTReference } from "../space_lua.ts";
import { LuaWidget } from "./lua_widget.ts";
import YAML from "js-yaml";
import type { PageMeta } from "../../type/index.ts";

export function luaDirectivePlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    let shouldRender = true;

    // Don't render Lua directives of federated pages (security)
    if (
      !client.clientSystem.scriptsLoaded
    ) {
      return Decoration.none;
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        // Disable rendering of Lua directives in #meta/template pages
        // Either in frontmatter
        if (node.name === "FrontMatterCode") {
          const text = state.sliceDoc(node.from, node.to);
          try {
            const parsedFrontmatter = YAML.load(text);
            let tags = parsedFrontmatter.tags || [];
            if (typeof tags === "string") {
              tags = tags.split(/\s+|,\s*/);
            }
            if (tags.find((tag: string) => tag.startsWith("meta/template"))) {
              shouldRender = false;
              return;
            }
          } catch {
            // Ignore
          }
        }
        // Or with a hash tag
        if (node.name === "Hashtag") {
          const text = state.sliceDoc(node.from, node.to);
          if (text.startsWith("#meta/template")) {
            shouldRender = false;
            return;
          }
        }

        if (node.name !== "LuaDirective") {
          return;
        }

        if (isCursorInRange(state, [node.from, node.to])) {
          return;
        }

        const text = state.sliceDoc(node.from + 2, node.to - 1);
        const currentPageMeta = client.ui.viewState.current?.meta as PageMeta;
        widgets.push(
          Decoration.widget({
            widget: new LuaWidget(
              client,
              `lua:${text}:${currentPageMeta?.name}`,
              text,
              async (bodyText) => {
                try {
                  const parsedLua = parseLua(`_(${bodyText})`) as LuaBlock;
                  const expr =
                    (parsedLua.statements[0] as LuaFunctionCallStatement).call
                      .args[0];

                  const tl = new LuaEnv();
                  tl.setLocal(
                    "currentPage",
                    currentPageMeta ||
                      { name: client.ui.viewState.current?.path },
                  );
                  const sf = LuaStackFrame.createWithGlobalEnv(
                    client.clientSystem.spaceLuaEnv.env,
                    expr.ctx,
                  );
                  const threadLocalizedEnv = new LuaEnv(
                    client.clientSystem.spaceLuaEnv.env,
                  );
                  threadLocalizedEnv.setLocal("_CTX", tl);
                  return luaValueToJS(
                    singleResult(
                      await evalExpression(
                        expr,
                        threadLocalizedEnv,
                        sf,
                      ),
                    ),
                    sf,
                  );
                } catch (e: any) {
                  if (e instanceof LuaRuntimeError) {
                    if (e.sf?.astCtx) {
                      const source = resolveASTReference(e.sf.astCtx);
                      if (source) {
                        // We know the origin node of the error, let's reference it
                        return `**Lua error:** ${e.message} (Origin: [[${
                          encodeRef(source)
                        }]])`;
                      }
                    }
                  }
                  return `**Lua error:** ${e.message}`;
                }
              },
              true,
              true,
            ),
          }).range(node.to),
        );
        widgets.push(invisibleDecoration.range(node.from, node.to));
      },
    });

    if (!shouldRender) {
      return Decoration.set([]);
    }

    return Decoration.set(widgets, true);
  });
}
