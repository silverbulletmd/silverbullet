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
import { nodeAtPos } from "@silverbulletmd/common/tree";

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
  /(<!--\s*#(template|include)\s+"([^"]+)"(.+?)-->)(.+?)(<!--\s*\/\2\s*-->)/gs;

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
      // if it's a template (note a literal "include")
      if (type === "template") {
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

  newText = await replaceAsync(
    newText,
    queryRegex,
    async (fullMatch, startQuery, query, body, endQuery, index) => {
      let currentNode = nodeAtPos(tree, index + 1);
      if (currentNode?.type !== "CommentBlock") {
        // If not a comment block, it's likely a code block, ignore
        return fullMatch;
      }
      // console.log("Text slice", newText.substring(index, index + 100));

      let parsedQuery = parseQuery(replaceTemplateVars(query, pageName));

      console.log("Parsed query", parsedQuery);
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
  if (text !== newText) {
    await writePage(pageName, newText);
    return true;
  }
  return false;
}
