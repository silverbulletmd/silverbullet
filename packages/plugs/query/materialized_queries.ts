import {
  flashNotification,
  getCurrentPage,
  getText,
  reloadPage,
  save,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";

import {
  readPage,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { parseQuery, renderQuery } from "./engine";
import { replaceTemplateVars } from "../core/template";
import { jsonToMDTable, queryRegex, removeQueries } from "./util";
import { dispatch } from "@plugos/plugos-syscall/event";
import { replaceAsync } from "../lib/util";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";

export async function updateMaterializedQueriesCommand() {
  const currentPage = await getCurrentPage();
  await save();
  await flashNotification("Updating materialized queries...");
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

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(
  pageName: string
): Promise<boolean> {
  let { text } = await readPage(pageName);

  let newText = await replaceAsync(
    text,
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
