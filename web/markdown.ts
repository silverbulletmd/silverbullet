import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
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

      const ref = parseToRef(page);

      if (!ref || !isMarkdownPath(ref.path)) {
        return;
      }

      // Read the page
      const { text } = await client.space.readPage(getNameFromPath(ref.path));
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

/**
 * Extracts the transclusion from a markdown tree. Right now this is only
 * supported for headers, in which case the Function will extract the header
 * plus all text till the next header
 * @returns Returns null if the header isn't found
 */
export function extractTransclusion(
  markdown: string,
  details: Ref["details"],
): string | null {
  if (!details) {
    return markdown;
  } else if (details.type !== "header") {
    return null;
  }

  const parseTree = parseMarkdown(markdown);

  let from: undefined | number = undefined, to: undefined | number = undefined;
  traverseTree(parseTree, (subTree) => {
    // We are done, but we can't properly cancel the traversal
    if (from && to) {
      return true;
    }

    if (!subTree.type || !subTree.type.startsWith("ATXHeading")) {
      return false;
    }

    // We already found the first header
    if (from) {
      to = subTree.from;
      return true;
    }

    const mark = findNodeOfType(subTree, "HeaderMark");
    if (!mark || !mark.from || !mark.to) {
      return true;
    }

    if (
      renderToText(subTree)
        .slice(mark.to - mark.from)
        .trimStart() === details.header.trim()
    ) {
      from = subTree.from;
    }

    // No need to continue into a header
    return true;
  });

  // Go till end of file if we can't find a second header
  to ??= parseTree.to;

  if (!from) {
    return null;
  }

  return markdown.slice(from, to);
}
