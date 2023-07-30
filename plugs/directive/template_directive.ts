import { queryRegex } from "$sb/lib/query.ts";
import {
  findNodeOfType,
  ParseTree,
  renderToText,
  traverseTree,
} from "$sb/lib/tree.ts";
import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import Handlebars from "handlebars";

import { replaceTemplateVars } from "../core/template.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { directiveRegex } from "./directives.ts";
import { updateDirectives } from "./command.ts";
import { buildHandebarOptions } from "./util.ts";
import { PageMeta } from "../../web/types.ts";
import { resolvePath } from "$sb/lib/resolve.ts";

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
  await extractFrontmatter(tree, [], true); // Remove entire frontmatter section, if any

  // Resolve paths in the template
  rewritePageRefs(tree, templatePath);

  let newBody = renderToText(tree);

  // console.log("Rewritten template:", newBody);

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

function rewritePageRefs(tree: ParseTree, templatePath: string) {
  traverseTree(tree, (n): boolean => {
    if (n.type === "DirectiveStart") {
      const pageRef = findNodeOfType(n, "PageRef")!;
      if (pageRef) {
        const pageRefName = pageRef.children![0].text!.slice(2, -2);
        pageRef.children![0].text = `[[${
          resolvePath(templatePath, pageRefName)
        }]]`;
      }
      const directiveText = n.children![0].text;
      // #use or #import
      if (directiveText) {
        const match = /\[\[(.+)\]\]/.exec(directiveText);
        if (match) {
          const pageRefName = match[1];
          n.children![0].text = directiveText.replace(
            match[0],
            `[[${resolvePath(templatePath, pageRefName)}]]`,
          );
        }
      }

      return true;
    }
    if (n.type === "WikiLinkPage") {
      n.children![0].text = resolvePath(templatePath, n.children![0].text!);
      return true;
    }

    return false;
  });
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
