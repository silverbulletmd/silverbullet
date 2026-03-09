import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import type { Client } from "../client.ts";
import { parseInterpolationBlock } from "../space_lua/parse.ts";
import { evalBlockForValue } from "../space_lua/eval.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  luaValueToJS,
  singleResult,
} from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import {
  encodeRef,
  getNameFromPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import { resolveASTReference } from "../space_lua.ts";
import { LuaWidget } from "./lua_widget.ts";

// Generation counter
let pageGeneration = 0;
let lastDirectiveTexts = "";

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

    const globalEnv = client.clientSystem.spaceLuaEnv.env;
    // Page-scoped env: reads chain to global, writes stop here
    const pageEnv = new LuaEnv(globalEnv, true);

    // Collect all directive texts to detect any change on the page
    const allDirectiveTexts: string[] = [];

    // Sequential evaluation chain
    const directiveResults = new Map<number, Promise<any>>();
    let evalChain: Promise<void> = Promise.resolve();

    syntaxTree(state).iterate({
      enter: (node) => {
        // Disable rendering of Lua directives in #meta/template pages
        // Either in frontmatter
        if (node.name === "FrontMatterCode") {
          const text = state.sliceDoc(node.from, node.to);
          try {
            // Very ad-hoc regex to detect if meta/template appears in the tag list
            if (/tags:.*meta\/template/s.exec(text)) {
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

        const codeText = state.sliceDoc(node.from, node.to);
        const expressionText = codeText.slice(2, -1);
        allDirectiveTexts.push(expressionText);
        const currentPageMeta = client.currentPageMeta();
        const nodePos = node.to;
        const cursorInside = isCursorInRange(state, [node.from, node.to]);

        // Always evaluate for side effects (page-scoped env)
        const resultPromise = evalChain.then(async () => {
          if (expressionText.trim().length === 0) {
            return "**Error:** Empty Lua expression";
          }
          try {
            const parsedBlock = parseInterpolationBlock(expressionText);

            const tl = new LuaEnv();
            tl.setLocal(
              "currentPage",
              currentPageMeta || (client.ui.viewState.current
                ? {
                  name: getNameFromPath(
                    client.ui.viewState.current.path,
                  ),
                }
                : undefined),
            );
            const sf = LuaStackFrame.createWithGlobalEnv(
              globalEnv,
              parsedBlock.ctx,
            );
            // Block-local env on top of page-scoped env
            const blockEnv = new LuaEnv(pageEnv);
            blockEnv.setLocal("_CTX", tl);
            const rawResult = singleResult(
              await evalBlockForValue(
                parsedBlock,
                blockEnv,
                sf,
              ),
            );
            // keep tagged floats as-is for proper formatting
            if (
              isTaggedFloat(rawResult) || typeof rawResult === "number"
            ) {
              return rawResult;
            }
            // everything else needs luaValueToJS for widget support
            return luaValueToJS(rawResult, sf);
          } catch (e: any) {
            if (e instanceof LuaRuntimeError) {
              if (e.sf?.astCtx) {
                const source = resolveASTReference(e.sf.astCtx);
                if (source) {
                  return `**Lua error:** ${e.message} (Origin: [[${
                    encodeRef(source)
                  }]])`;
                }
              }
            }
            return `**Lua error:** ${e.message}`;
          }
        });

        directiveResults.set(nodePos, resultPromise);
        evalChain = resultPromise.then(() => {});

        // Only add widget decoration when cursor is outside
        if (!cursorInside) {
          widgets.push(
            Decoration.widget({
              widget: new LuaWidget(
                client,
                `lua:${expressionText}:${currentPageMeta?.name}:${pageGeneration}`,
                expressionText,
                codeText,
                (_bodyText) => {
                  return directiveResults.get(nodePos)!;
                },
                true,
                true,
                null,
              ),
            }).range(nodePos),
          );

          if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
            widgets.push(invisibleDecoration.range(node.from, node.to));
          }
        }
      },
    });

    // Re-generation if any directive text changed
    const joined = allDirectiveTexts.join("\0");
    if (joined !== lastDirectiveTexts) {
      lastDirectiveTexts = joined;
      pageGeneration++;
    }

    if (!shouldRender) {
      return Decoration.set([]);
    }

    return Decoration.set(widgets, true);
  });
}
