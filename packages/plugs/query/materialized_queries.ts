import {
  flashNotification,
  getCurrentPage,
  getText,
  reloadPage,
  save
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";

import { readPage, writePage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { parseQuery } from "./engine";
import { replaceTemplateVars } from "../core/template";
import { queryRegex, removeQueries } from "./util";
import { dispatch } from "@silverbulletmd/plugos-syscall/event";
import { replaceAsync } from "../lib/util";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";

export async function updateMaterializedQueriesCommand() {
  const currentPage = await getCurrentPage();
  await save();
  await flashNotification("Updating materialized queries...");
  await invokeFunction(
    "server",
    "updateMaterializedQueriesOnPage",
    currentPage
  );
  await reloadPage();
  await flashNotification("Updated materialized queries");
}

export async function whiteOutQueriesCommand() {
  const text = await getText();
  const parsed = await parseMarkdown(text);
  console.log(removeQueries(parsed));
}

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(pageName: string) {
  let { text } = await readPage(pageName);

  text = await replaceAsync(
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
        return `${startQuery}\n${results[0]}\n${endQuery}`;
      } else {
        console.error("Too many query results", results);
        return fullMatch;
      }
    }
  );
  // console.log("New text", text);
  await writePage(pageName, text);
}
