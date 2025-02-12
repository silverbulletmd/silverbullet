import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  parsePageRef,
  validatePageName,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import { renderExpressionResult } from "../plugs/template/util.ts";
import { parseMarkdown } from "$common/markdown_parser/parser.ts";
import type { LuaExpression } from "$common/space_lua/ast.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import type { LuaEnv, LuaStackFrame } from "$common/space_lua/runtime.ts";
import { parseExpressionString } from "$common/space_lua/parse.ts";
import type { CodeWidgetHook } from "../web/hooks/code_widget.ts";

/**
 * Finds code widgets, runs their plug code to render and inlines their content in the parse tree
 * @param mdTree parsed markdown tree
 * @param pageName name of the current page
 * @returns modified mdTree
 */
export async function expandCodeWidgets(
  codeWidgetHook: CodeWidgetHook,
  mdTree: ParseTree,
  pageName: string,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<ParseTree> {
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "FencedCode") {
      const codeInfo = findNodeOfType(n, "CodeInfo");
      if (!codeInfo) {
        return;
      }
      const codeType = codeInfo.children![0].text!;
      const codeTextNode = findNodeOfType(n, "CodeText");
      try {
        // This will error out if this is not a code wiget, which is fine
        const langCallback = codeWidgetHook.codeWidgetCallbacks.get(codeType);
        if (!langCallback) {
          return {
            text: "",
          };
        }
        const result = await langCallback(
          renderToText(codeTextNode!),
          pageName,
        );
        if (!result) {
          return {
            text: "",
          };
        }
        // Only do this for "markdown" widgets, that is: that can render to markdown
        if (result.markdown !== undefined) {
          const parsedBody = parseMarkdown(result.markdown);
          // Recursively process
          return expandCodeWidgets(
            codeWidgetHook,
            parsedBody,
            pageName,
            env,
            sf,
          );
        }
      } catch (e: any) {
        // 'not found' is to be expected (no code widget configured for this language)
        // Every other error should probably be reported
        if (!e.message.includes("not found")) {
          console.trace();
          console.error("Error rendering code", e.message);
        }
      }
    } else if (n.type === "Image") {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const wikiLinkMark = findNodeOfType(n, "WikiLinkMark");
      if (!wikiLinkMark) {
        return;
      }
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage");
      if (!wikiLinkPage) {
        return;
      }

      const page = wikiLinkPage.children![0].text!;

      // Check if this is likely a page link (based on the path format, e.g. if it contains an extension, it's probably not a page link)
      try {
        const ref = parsePageRef(page);
        validatePageName(ref.page);
      } catch {
        // Not a valid page name, so not a page reference
        return;
      }

      // Internally translate this to a template that inlines a page, then render that
      const langCallback = codeWidgetHook.codeWidgetCallbacks.get("template")!;
      const result = await langCallback(`{{[[${page}]]}}`, pageName);
      if (!result) {
        return {
          text: "",
        };
      }
      // Only do this for "markdown" widgets, that is: that can render to markdown
      if (result.markdown !== undefined) {
        const parsedBody = await parseMarkdown(result.markdown);
        // Recursively process
        return expandCodeWidgets(
          codeWidgetHook,
          parsedBody,
          page,
          env,
          sf,
        );
      }
    } else if (n.type === "LuaDirective") {
      const expr = findNodeOfType(n, "LuaExpressionDirective") as
        | LuaExpression
        | null;
      if (!expr) {
        return;
      }
      const exprText = renderToText(expr);

      let result = await evalExpression(
        parseExpressionString(exprText),
        env,
        sf,
      );

      if (result?.markdown) {
        result = result.markdown;
      }

      const markdown = await renderExpressionResult(result);
      return parseMarkdown(markdown);
    }
  });
  return mdTree;
}
