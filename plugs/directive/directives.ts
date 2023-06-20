import { ParseTree, renderToText } from "$sb/lib/tree.ts";
import { sync } from "../../plug-api/silverbullet-syscall/mod.ts";
import { PageMeta } from "../../web/types.ts";

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
  pageMeta: PageMeta,
  directiveTree: ParseTree,
  directiveRenderers: Record<
    string,
    (
      directive: string,
      pageMeta: PageMeta,
      arg: string | ParseTree,
    ) => Promise<string>
  >,
): Promise<string> {
  const directiveStart = directiveTree.children![0]; // <!-- #directive -->
  const directiveEnd = directiveTree.children![2]; // <!-- /directive -->

  const directiveStartText = renderToText(directiveStart).trim();
  const directiveEndText = renderToText(directiveEnd).trim();

  if (!(await sync.hasInitialSyncCompleted())) {
    console.info(
      "Initial sync hasn't completed yet, not updating directives.",
    );
    // Render the query directive as-is
    return renderToText(directiveTree);
  }

  if (directiveStart.children!.length === 1) {
    // Everything not #query
    const match = directiveStartRegex.exec(directiveStart.children![0].text!);
    if (!match) {
      throw Error("No match");
    }

    let [_fullMatch, type, arg] = match;
    try {
      arg = arg.trim();
      const newBody = await directiveRenderers[type](type, pageMeta, arg);
      const result =
        `${directiveStartText}\n${newBody.trim()}\n${directiveEndText}`;
      return result;
    } catch (e: any) {
      return `${directiveStartText}\n**ERROR:** ${e.message}\n${directiveEndText}`;
    }
  } else {
    // #query
    const newBody = await directiveRenderers["query"](
      "query",
      pageMeta,
      directiveStart.children![1], // The query ParseTree
    );
    const result =
      `${directiveStartText}\n${newBody.trim()}\n${directiveEndText}`;
    return result;
  }
}

export async function renderDirectives(
  pageMeta: PageMeta,
  directiveTree: ParseTree,
): Promise<string> {
  const replacementText = await directiveDispatcher(pageMeta, directiveTree, {
    use: templateDirectiveRenderer,
    include: templateDirectiveRenderer,
    query: queryDirectiveRenderer,
    eval: evalDirectiveRenderer,
  });

  return cleanTemplateInstantiations(replacementText);
}
