import { queryRegex } from "$sb/lib/query.ts";
import { ParseTree, renderToText } from "$sb/lib/tree.ts";
import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import Handlebars from "handlebars";

import { replaceTemplateVars } from "../core/template.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { directiveRegex } from "./directives.ts";
import { updateDirectives } from "./command.ts";
import { buildHandebarOptions } from "./util.ts";
import { PageMeta } from "../../web/types.ts";

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
  const template = match[1];
  const args = match[2];
  let parsedArgs = {};
  if (args) {
    try {
      parsedArgs = JSON.parse(replaceTemplateVars(args, pageMeta));
    } catch {
      throw new Error(
        `Failed to parse template instantiation arg: ${
          replaceTemplateVars(args, pageMeta)
        }`,
      );
    }
  }
  let templateText = "";
  if (template.startsWith("http://") || template.startsWith("https://")) {
    try {
      const req = await fetch(template);
      templateText = await req.text();
    } catch (e: any) {
      templateText = `ERROR: ${e.message}`;
    }
  } else {
    templateText = await space.readPage(template);
  }
  const tree = await markdown.parseMarkdown(templateText);
  await extractFrontmatter(tree, [], true); // Remove entire frontmatter section, if any
  let newBody = renderToText(tree);

  // if it's a template injection (not a literal "include")
  if (directive === "use") {
    const templateFn = Handlebars.compile(
      newBody,
      { noEscape: true },
    );
    newBody = templateFn(parsedArgs, buildHandebarOptions(pageMeta));

    // Recursively render directives
    newBody = await updateDirectives(pageMeta, newBody);
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
