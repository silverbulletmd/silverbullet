import {
  addParentPointers,
  findParentMatching,
  ParseTree,
  renderToText,
} from "$sb/lib/tree.ts";
import { PageMeta } from "$sb/types.ts";
import { editor, markdown } from "$sb/syscalls.ts";

import { evalDirectiveRenderer } from "./eval_directive.ts";
import { queryDirectiveRenderer } from "./query_directive.ts";
import {
  cleanTemplateInstantiations,
  templateDirectiveRenderer,
} from "./template_directive.ts";

/** An error that occurs while a directive is being rendered.
 * Mostly annotates the underlying error with page metadata.
 */
export class RenderDirectiveError extends Error {
  pageMeta: PageMeta;
  directive: string;
  cause: Error;

  constructor(pageMeta: PageMeta, directive: string, cause: Error) {
    super(`In directive "${directive}" from "${pageMeta.name}": ${cause}`, {
      cause: cause,
    });

    this.pageMeta = pageMeta;
    this.directive = directive;
    this.cause = cause;
  }
}

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

  const firstPart = directiveStart.children![0].text!;
  if (firstPart?.includes("#query")) {
    // #query
    const newBody = await directiveRenderers["query"](
      "query",
      pageMeta,
      directiveStart.children![1].children![0], // The query ParseTree
    );
    const result =
      `${directiveStartText}\n${newBody.trim()}\n${directiveEndText}`;
    return result;
  } else if (firstPart?.includes("#eval")) {
    console.log("Eval stuff", directiveStart.children![1].children![0]);
    const newBody = await directiveRenderers["eval"](
      "eval",
      pageMeta,
      directiveStart.children![1].children![0],
    );
    const result =
      `${directiveStartText}\n${newBody.trim()}\n${directiveEndText}`;
    return result;
  } else {
    // Everything not #query and #eval
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
  }
}

export async function renderDirectives(
  pageMeta: PageMeta,
  directiveTree: ParseTree,
): Promise<string> {
  try {
    const replacementText = await directiveDispatcher(pageMeta, directiveTree, {
      use: templateDirectiveRenderer,
      include: templateDirectiveRenderer,
      query: queryDirectiveRenderer,
      eval: evalDirectiveRenderer,
    });
    return cleanTemplateInstantiations(replacementText);
  } catch (e) {
    throw new RenderDirectiveError(
      pageMeta,
      renderToText(directiveTree.children![0].children![1]).trim(),
      e,
    );
  }
}
