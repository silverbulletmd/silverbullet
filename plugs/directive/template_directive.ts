import { queryRegex } from "$sb/lib/query.ts";
import { ParseTree, renderToText } from "$sb/lib/tree.ts";
import { handlebars, markdown, space } from "$sb/syscalls.ts";

import { replaceTemplateVars } from "../template/template.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { directiveRegex } from "./directives.ts";
import { updateDirectives } from "./command.ts";
import { resolvePath, rewritePageRefs } from "$sb/lib/resolve.ts";
import { PageMeta } from "$sb/types.ts";
import { renderTemplate } from "../template/plug_api.ts";

const templateRegex = /\[\[([^\]]+)\]\]\s*(.*)\s*/;

export async function templateDirectiveRenderer(
  directive: string,
  pageMeta: PageMeta,
  arg: string | ParseTree,
): Promise<string> {
  if (typeof arg !== "string") {
    throw new Error("Template directives must be a string");
  }
  const match = arg.match(templateRegex);
  if (!match) {
    throw new Error(`Invalid template directive: ${arg}`);
  }
  let templatePath = match[1];
  const args = match[2];
  let parsedArgs = {};
  if (args) {
    try {
      parsedArgs = JSON.parse(await replaceTemplateVars(args, pageMeta));
    } catch {
      throw new Error(
        `Failed to parse template instantiation arg: ${
          replaceTemplateVars(args, pageMeta)
        }`,
      );
    }
  }
  let templateText = "";
  if (
    templatePath.startsWith("http://") || templatePath.startsWith("https://")
  ) {
    try {
      const req = await fetch(templatePath);
      templateText = await req.text();
    } catch (e: any) {
      templateText = `ERROR: ${e.message}`;
    }
  } else {
    templatePath = resolvePath(pageMeta.name, templatePath);
    templateText = await space.readPage(templatePath);
  }
  const tree = await markdown.parseMarkdown(templateText);
  await extractFrontmatter(tree, { removeFrontmatterSection: true }); // Remove entire frontmatter section, if any

  // Resolve paths in the template
  rewritePageRefs(tree, templatePath);

  let newBody = renderToText(tree);

  // console.log("Rewritten template:", newBody);

  // if it's a template injection (not a literal "include")
  if (directive === "use") {
    newBody = (await renderTemplate(newBody, pageMeta, parsedArgs)).text;

    // Recursively render directives
    const tree = await markdown.parseMarkdown(newBody);
    newBody = await updateDirectives(pageMeta, tree, newBody);
  }
  return newBody.trim();
}

export function cleanTemplateInstantiations(text: string) {
  return text.replaceAll(directiveRegex, (
    _fullMatch,
    startInst,
    type,
    _args,
    body,
    endInst,
  ): string => {
    if (type === "use") {
      body = body.replaceAll(
        queryRegex,
        (
          _fullMatch: string,
          _startQuery: string,
          _query: string,
          body: string,
        ) => {
          return body.trim();
        },
      );
    }
    return `${startInst}${body}${endInst}`;
  });
}
