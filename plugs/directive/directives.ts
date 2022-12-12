import { nodeAtPos, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { markdown } from "$sb/silverbullet-syscall/mod.ts";

import { evalDirectiveRenderer } from "./eval_directive.ts";
import { queryDirectiveRenderer } from "./query_directive.ts";
import {
  cleanTemplateInstantiations,
  templateDirectiveRenderer,
} from "./template_directive.ts";

export const directiveStartRegex =
  /<!--\s*#(use|use-verbose|include|eval|query)\s+(.*?)-->/i;

export const directiveRegex =
  /(<!--\s*#(use|use-verbose|include|eval|query)\s+(.*?)-->)(.+?)(<!--\s*\/\2\s*-->)/gs;
/**
 * Looks for directives in the text dispatches them based on name
 */
export async function directiveDispatcher(
  pageName: string,
  directiveTree: ParseTree,
  directiveRenderers: Record<
    string,
    (
      directive: string,
      pageName: string,
      arg: string | ParseTree,
    ) => Promise<string>
  >,
): Promise<string> {
  // console.log("Got here", JSON.stringify(directiveTree, null, 2));
  const directiveStart = directiveTree.children![0]; // <!-- #directive -->
  const directiveEnd = directiveTree.children![2]; // <!-- /directive -->

  if (directiveStart.children!.length === 1) {
    // Everything not #query
    const match = directiveStartRegex.exec(directiveStart.children![0].text!);
    if (!match) {
      throw Error("No match");
    }

    let [_fullMatch, type, arg] = match;
    try {
      arg = arg.trim();
      const newBody = await directiveRenderers[type](type, pageName, arg);
      const result = `${
        renderToText(directiveStart).trim()
      }\n${newBody.trim()}\n${renderToText(directiveEnd).trim()}`;
      console.log("Sending back:", result);
      return result;
    } catch (e: any) {
      return `${renderToText(directiveStart)}\n**ERROR:** ${e.message}\n${
        renderToText(directiveEnd)
      }`;
    }
  } else {
    // #query
    const newBody = await directiveRenderers["query"](
      "query",
      pageName,
      directiveStart.children![1], // The query ParseTree
    );
    const result = `${
      renderToText(directiveStart).trim()
    }\n${newBody.trim()}\n${renderToText(directiveEnd).trim()}`;
    console.log("Processed query", JSON.stringify(directiveStart, null, 2));
    return result;
  }
}

export async function renderDirectives(
  pageName: string,
  directiveTree: ParseTree,
): Promise<string> {
  // const tree = await markdown.parseMarkdown(text);

  const replacementText = await directiveDispatcher(pageName, directiveTree, {
    use: templateDirectiveRenderer,
    // "use-verbose": templateDirectiveRenderer,
    "include": templateDirectiveRenderer,
    query: queryDirectiveRenderer,
    eval: evalDirectiveRenderer,
  });

  return await cleanTemplateInstantiations(replacementText);
}
