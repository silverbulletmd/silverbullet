import { queryRegex } from "$sb/lib/query.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import Handlebars from "handlebars";

import { replaceTemplateVars } from "../core/template.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { directiveRegex, renderDirectives } from "./directives.ts";

const templateRegex = /\[\[([^\]]+)\]\]\s*(.*)\s*/;

export async function templateDirectiveRenderer(
  directive: string,
  pageName: string,
  arg: string,
): Promise<string> {
  const match = arg.match(templateRegex);
  if (!match) {
    throw new Error(`Invalid template directive: ${arg}`);
  }
  const template = match[1];
  const args = match[2];
  let parsedArgs = {};
  if (args) {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      throw new Error(`Failed to parse template instantiation args: ${arg}`);
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
  let newBody = templateText;
  // if it's a template injection (not a literal "include")
  if (directive === "use" || directive === "use-verbose") {
    const tree = await markdown.parseMarkdown(templateText);
    extractFrontmatter(tree, ["$disableDirectives"]);
    templateText = renderToText(tree);
    const templateFn = Handlebars.compile(
      replaceTemplateVars(templateText, pageName),
      { noEscape: true },
    );
    newBody = templateFn(parsedArgs);

    // Recursively render directives
    newBody = await renderDirectives(pageName, newBody);
  }
  return newBody.trim();
}

export function cleanTemplateInstantiations(text: string): Promise<string> {
  return replaceAsync(
    text,
    directiveRegex,
    (
      _fullMatch,
      startInst,
      type,
      _args,
      body,
      endInst,
    ): Promise<string> => {
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
      return Promise.resolve(`${startInst}${body}${endInst}`);
    },
  );
}
