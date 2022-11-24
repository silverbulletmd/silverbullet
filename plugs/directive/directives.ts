import { nodeAtPos, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { markdown } from "$sb/silverbullet-syscall/mod.ts";

import { evalDirectiveRenderer } from "./eval_directive.ts";
import { queryDirectiveRenderer } from "./query_directive.ts";
import {
  cleanTemplateInstantiations,
  templateDirectiveRenderer,
} from "./template_directive.ts";

export const directiveRegex =
  /(<!--\s*#(use|use-verbose|include|eval|query)\s+(.*?)-->)(.+?)(<!--\s*\/\2\s*-->)/gs;

/**
 * Looks for directives in the text dispatches them based on name
 */
export function directiveDispatcher(
  pageName: string,
  text: string,
  tree: ParseTree,
  directiveRenderers: Record<
    string,
    (directive: string, pageName: string, arg: string) => Promise<string>
  >,
): Promise<string> {
  return replaceAsync(
    text,
    directiveRegex,
    async (fullMatch, startInst, type, arg, _body, endInst, index) => {
      const currentNode = nodeAtPos(tree, index + 1);
      // console.log("Node type", currentNode?.type);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        // console.log("Not comment block, ingoring", fullMatch);
        return fullMatch;
      }
      arg = arg.trim();
      try {
        const newBody = await directiveRenderers[type](type, pageName, arg);
        return `${startInst}\n${newBody.trim()}\n${endInst}`;
      } catch (e: any) {
        return `${startInst}\n**ERROR:** ${e.message}\n${endInst}`;
      }
    },
  );
}

export async function renderDirectives(
  pageName: string,
  text: string,
): Promise<string> {
  const tree = await markdown.parseMarkdown(text);

  text = await directiveDispatcher(pageName, text, tree, {
    use: templateDirectiveRenderer,
    "use-verbose": templateDirectiveRenderer,
    "include": templateDirectiveRenderer,
    query: queryDirectiveRenderer,
    eval: evalDirectiveRenderer,
  });

  return await cleanTemplateInstantiations(text);
}
