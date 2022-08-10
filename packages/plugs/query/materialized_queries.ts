import {
  getCurrentPage,
  reloadPage,
  save,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import Handlebars from "handlebars";

import {
  readPage,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { renderQuery } from "./engine";
import { parseQuery } from "./parser";
import { replaceTemplateVars } from "../core/template";
import { jsonToMDTable, queryRegex } from "./util";
import { dispatch } from "@plugos/plugos-syscall/event";
import { replaceAsync } from "../lib/util";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { nodeAtPos, renderToText } from "@silverbulletmd/common/tree";
import { extractMeta } from "./data";

export async function updateMaterializedQueriesCommand() {
  const currentPage = await getCurrentPage();
  await save();
  if (
    await invokeFunction(
      "server",
      "updateMaterializedQueriesOnPage",
      currentPage
    )
  ) {
    await reloadPage();
  }
}

export const templateInstRegex =
  /(<!--\s*#(use|use-verbose|include)\s+\[\[([^\]]+)\]\](.*?)-->)(.+?)(<!--\s*\/\2\s*-->)/gs;

async function updateTemplateInstantiations(
  text: string,
  pageName: string
): Promise<string> {
  return replaceAsync(
    text,
    templateInstRegex,
    async (fullMatch, startInst, type, template, args, body, endInst) => {
      args = args.trim();
      let parsedArgs = {};
      if (args) {
        try {
          parsedArgs = JSON.parse(args);
        } catch (e) {
          console.error("Failed to parse template instantiation args", args);
          return fullMatch;
        }
      }
      let templateText = "";
      if (template.startsWith("http://") || template.startsWith("https://")) {
        try {
          let req = await fetch(template);
          templateText = await req.text();
        } catch (e: any) {
          templateText = `ERROR: ${e.message}`;
        }
      } else {
        templateText = (await readPage(template)).text;
      }
      let newBody = templateText;
      // if it's a template injection (not a literal "include")
      if (type === "use" || type === "use-verbose") {
        let tree = await parseMarkdown(templateText);
        extractMeta(tree, ["$disableDirectives"]);
        templateText = renderToText(tree);
        let templateFn = Handlebars.compile(
          replaceTemplateVars(templateText, pageName),
          { noEscape: true }
        );
        newBody = templateFn(parsedArgs);
      }
      return `${startInst}\n${newBody.trim()}\n${endInst}`;
    }
  );
}

async function cleanTemplateInstantiations(text: string): Promise<string> {
  return replaceAsync(
    text,
    templateInstRegex,
    async (fullMatch, startInst, type, template, args, body, endInst) => {
      if (type === "use") {
        body = body.replaceAll(
          queryRegex,
          (
            fullMatch: string,
            startQuery: string,
            query: string,
            body: string
          ) => {
            return body.trim();
          }
        );
      }
      return `${startInst}${body}${endInst}`;
    }
  );
}

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(
  pageName: string
): Promise<boolean> {
  let text = "";
  try {
    text = (await readPage(pageName)).text;
  } catch {
    console.warn(
      "Could not read page",
      pageName,
      "perhaps it doesn't yet exist"
    );
    return false;
  }
  let newText = await updateTemplateInstantiations(text, pageName);
  let tree = await parseMarkdown(newText);
  let metaData = extractMeta(tree, ["$disableDirectives"]);
  if (metaData.$disableDirectives) {
    console.log("Directives disabled, skipping");
    return false;
  }
  newText = renderToText(tree);

  newText = await replaceAsync(
    newText,
    queryRegex,
    async (fullMatch, startQuery, query, body, endQuery, index) => {
      let currentNode = nodeAtPos(tree, index + 1);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        return fullMatch;
      }

      let parsedQuery = parseQuery(replaceTemplateVars(query, pageName));

      // console.log("Parsed query", parsedQuery);
      // Let's dispatch an event and see what happens
      let results = await dispatch(
        `query:${parsedQuery.table}`,
        { query: parsedQuery, pageName: pageName },
        10 * 1000
      );
      if (results.length === 0) {
        return `${startQuery}\n${endQuery}`;
      } else if (results.length === 1) {
        if (parsedQuery.render) {
          let rendered = await renderQuery(parsedQuery, results[0]);
          return `${startQuery}\n${rendered.trim()}\n${endQuery}`;
        } else {
          return `${startQuery}\n${jsonToMDTable(results[0])}\n${endQuery}`;
        }
      } else {
        console.error("Too many query results", results);
        return fullMatch;
      }
    }
  );
  newText = await cleanTemplateInstantiations(newText);
  if (text !== newText) {
    await writePage(pageName, newText);
    return true;
  }
  return false;
}
