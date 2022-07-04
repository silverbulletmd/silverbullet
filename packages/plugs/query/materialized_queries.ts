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
import { parseQuery, renderQuery } from "./engine";
import { replaceTemplateVars } from "../core/template";
import { jsonToMDTable, queryRegex } from "./util";
import { dispatch } from "@plugos/plugos-syscall/event";
import { replaceAsync } from "../lib/util";

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
  /(<!--\s*#inst\s+"([^"]+)"(.+?)-->)(.+?)(<!--\s*\/inst\s*-->)/gs;

async function updateTemplateInstantiations(
  text: string,
  pageName: string
): Promise<string> {
  return replaceAsync(
    text,
    templateInstRegex,
    async (fullMatch, startInst, template, args, body, endInst) => {
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
      let { text: templateText } = await readPage(template);
      let templateFn = Handlebars.compile(
        replaceTemplateVars(templateText, pageName),
        { noEscape: true }
      );
      let newBody = templateFn(parsedArgs);
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
  newText = await replaceAsync(
    newText,
    queryRegex,
    async (fullMatch, startQuery, query, body, endQuery) => {
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
