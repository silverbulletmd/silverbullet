import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  parseRef,
  type Ref,
  validatePageName,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import type { LuaExpression } from "../lib/space_lua/ast.ts";
import { evalExpression } from "../lib/space_lua/eval.ts";
import type { LuaEnv, LuaStackFrame } from "../lib/space_lua/runtime.ts";
import { parseExpressionString } from "../lib/space_lua/parse.ts";
import { renderExpressionResult } from "./markdown_util.ts";
import type { Client } from "./client.ts";

/**
 * Expands custom markdown Lua directives and transclusions into plain markdown
 * @param mdTree parsed markdown tree
 * @returns modified mdTree
 */
export async function expandMarkdown(
  client: Client,
  mdTree: ParseTree,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<ParseTree> {
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "Image") {
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
      let ref: Ref | undefined;
      try {
        ref = parseRef(page);
        validatePageName(ref.page);
      } catch {
        // Not a valid page name, so not a page reference
        return;
      }

      // Read the page

      const { text } = await client.space.readPage(ref.page);
      const parsedBody = parseMarkdown(text);
      // Recursively process
      return expandMarkdown(
        client,
        parsedBody,
        env,
        sf,
      );
    } else if (n.type === "LuaDirective") {
      const expr = findNodeOfType(n, "LuaExpressionDirective") as
        | LuaExpression
        | null;
      if (!expr) {
        return;
      }
      const exprText = renderToText(expr);

      try {
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
      } catch (e: any) {
        // Reduce blast radius and give useful error message
        console.error("Error evaluating Lua directive", exprText, e);
        return parseMarkdown(`**Error:** ${e.message}`);
      }
    }
  });
  return mdTree;
}
