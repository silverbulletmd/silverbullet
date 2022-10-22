import { editor } from "$sb/silverbullet-syscall/mod.ts";

import Handlebars from "handlebars";

import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";
import { renderQuery } from "./engine.ts";
import { parseQuery } from "./parser.ts";
import { replaceTemplateVars } from "../core/template.ts";
import { jsonToMDTable } from "./util.ts";
import { queryRegex } from "$sb/lib/query.ts";
import { events } from "$sb/plugos-syscall/mod.ts";
import { replaceAsync } from "$sb/lib/util.ts";
import { nodeAtPos, renderToText } from "$sb/lib/tree.ts";
import { extractMeta } from "./data.ts";

export async function updateMaterializedQueriesCommand() {
  const currentPage = await editor.getCurrentPage();
  await editor.save();
  if (
    await invokeFunction(
      "server",
      "updateMaterializedQueriesOnPage",
      currentPage,
    )
  ) {
    await editor.reloadPage();
  }
}

export const templateInstRegex =
  /(<!--\s*#(use|use-verbose|include)\s+\[\[([^\]]+)\]\](.*?)-->)(.+?)(<!--\s*\/\2\s*-->)/gs;

function updateTemplateInstantiations(
  text: string,
  pageName: string,
): Promise<string> {
  return replaceAsync(
    text,
    templateInstRegex,
    async (fullMatch, startInst, type, template, args, _body, endInst) => {
      args = args.trim();
      let parsedArgs = {};
      if (args) {
        try {
          parsedArgs = JSON.parse(args);
        } catch {
          console.error("Failed to parse template instantiation args", args);
          return fullMatch;
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
      if (type === "use" || type === "use-verbose") {
        const tree = await markdown.parseMarkdown(templateText);
        extractMeta(tree, ["$disableDirectives"]);
        templateText = renderToText(tree);
        const templateFn = Handlebars.compile(
          replaceTemplateVars(templateText, pageName),
          { noEscape: true },
        );
        newBody = templateFn(parsedArgs);
      }
      return `${startInst}\n${newBody.trim()}\n${endInst}`;
    },
  );
}

function cleanTemplateInstantiations(text: string): Promise<string> {
  return replaceAsync(
    text,
    templateInstRegex,
    (
      _fullMatch,
      startInst,
      type,
      _template,
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

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(
  pageName: string,
): Promise<boolean> {
  // console.log("Updating queries");
  let text = "";
  try {
    text = await space.readPage(pageName);
  } catch {
    console.warn(
      "Could not read page",
      pageName,
      "perhaps it doesn't yet exist",
    );
    return false;
  }
  let newText = await updateTemplateInstantiations(text, pageName);
  const tree = await markdown.parseMarkdown(newText);
  const metaData = extractMeta(tree, ["$disableDirectives"]);
  // console.log("Meta data", pageName, metaData);
  if (metaData.$disableDirectives) {
    console.log("Directives disabled, skipping");
    return false;
  }
  newText = renderToText(tree);

  newText = await replaceAsync(
    newText,
    queryRegex,
    async (fullMatch, startQuery, query, _body, endQuery, index) => {
      const currentNode = nodeAtPos(tree, index + 1);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        return fullMatch;
      }

      const parsedQuery = parseQuery(replaceTemplateVars(query, pageName));

      // console.log("Parsed query", parsedQuery);
      // Let's dispatch an event and see what happens
      const results = await events.dispatchEvent(
        `query:${parsedQuery.table}`,
        { query: parsedQuery, pageName: pageName },
        10 * 1000,
      );
      if (results.length === 0) {
        return `${startQuery}\n${endQuery}`;
      } else if (results.length === 1) {
        if (parsedQuery.render) {
          const rendered = await renderQuery(parsedQuery, results[0]);
          return `${startQuery}\n${rendered.trim()}\n${endQuery}`;
        } else {
          return `${startQuery}\n${jsonToMDTable(results[0])}\n${endQuery}`;
        }
      } else {
        console.error("Too many query results", results);
        return fullMatch;
      }
    },
  );
  newText = await cleanTemplateInstantiations(newText);
  if (text !== newText) {
    await space.writePage(pageName, newText);
    return true;
  }
  return false;
}
