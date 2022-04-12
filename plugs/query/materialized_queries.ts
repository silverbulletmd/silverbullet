import { flashNotification, getCurrentPage, reloadPage, save } from "plugos-silverbullet-syscall/editor";

import { listPages, readPage, writePage } from "plugos-silverbullet-syscall/space";
import { invokeFunction } from "plugos-silverbullet-syscall/system";
import { scanPrefixGlobal } from "plugos-silverbullet-syscall";
import { niceDate } from "../core/dates";
import { applyQuery, parseQuery } from "./engine";
import { PageMeta } from "../../common/types";
import type { Task } from "../tasks/task";
import { Item } from "../core/item";
import YAML from "yaml";

export const queryRegex =
  /(<!--\s*#query\s+(.+?)-->)(.+?)(<!--\s*#end\s*-->)/gs;

export function whiteOutQueries(text: string): string {
  return text.replaceAll(queryRegex, (match) =>
    new Array(match.length + 1).join(" ")
  );
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (match: string, ...args: any[]) => Promise<string>
) {
  const promises: Promise<string>[] = [];
  str.replace(regex, (match: string, ...args: any[]): string => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
    return "";
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift()!);
}

export async function updateMaterializedQueriesCommand() {
  const currentPage = await getCurrentPage();
  await save();
  await invokeFunction(
    "server",
    "updateMaterializedQueriesOnPage",
    currentPage
  );
  await reloadPage();
  await flashNotification("Updated materialized queries");
}

function replaceTemplateVars(s: string): string {
  return s.replaceAll(/\{\{(\w+)\}\}/g, (match, v) => {
    switch (v) {
      case "today":
        return niceDate(new Date());
        break;
    }
    return match;
  });
}

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(pageName: string) {
  let { text } = await readPage(pageName);

  text = await replaceAsync(
    text,
    queryRegex,
    async (fullMatch, startQuery, query, body, endQuery) => {
      let parsedQuery = parseQuery(replaceTemplateVars(query));

      console.log("Parsed query", parsedQuery);

      switch (parsedQuery.table) {
        case "page":
          let allPages = await listPages();
          let markdownPages = applyQuery(parsedQuery, allPages).map(
            (pageMeta: PageMeta) => `* [[${pageMeta.name}]]`
          );
          return `${startQuery}\n${markdownPages.join("\n")}\n${endQuery}`;
        case "task":
          let allTasks: Task[] = [];
          for (let { key, page, value } of await scanPrefixGlobal("task:")) {
            let [, pos] = key.split(":");
            allTasks.push({
              ...value,
              page: page,
              pos: pos,
            });
          }
          let markdownTasks = applyQuery(parsedQuery, allTasks).map(
            (t) =>
              `* [${t.done ? "x" : " "}] [[${t.page}@${t.pos}]] ${t.name}` +
              (t.nested ? "\n  " + t.nested : "")
          );
          return `${startQuery}\n${markdownTasks.join("\n")}\n${endQuery}`;
        case "link":
          let uniqueLinks = new Set<string>();
          for (let { value: name } of await scanPrefixGlobal(
            `pl:${pageName}:`
          )) {
            uniqueLinks.add(name);
          }
          let markdownLinks = applyQuery(
            parsedQuery,
            [...uniqueLinks].map((l) => ({ name: l }))
          ).map((pageMeta) => `* [[${pageMeta.name}]]`);
          return `${startQuery}\n${markdownLinks.join("\n")}\n${endQuery}`;
        case "item":
          let allItems: Item[] = [];
          for (let { key, page, value } of await scanPrefixGlobal("it:")) {
            let [, pos] = key.split("@");
            allItems.push({
              ...value,
              page: page,
              pos: +pos,
            });
          }
          let markdownItems = applyQuery(parsedQuery, allItems).map(
            (item) =>
              `* [[${item.page}@${item.pos}]] ${item.name}` +
              (item.nested ? "\n  " + item.nested : "")
          );
          return `${startQuery}\n${markdownItems.join("\n")}\n${endQuery}`;
        case "data":
          let allData: Object[] = [];
          for (let { key, page, value } of await scanPrefixGlobal("data:")) {
            let [, pos] = key.split("@");
            allData.push({
              ...value,
              page: page,
              pos: +pos,
            });
          }
          let markdownData = applyQuery(parsedQuery, allData).map((item) =>
            YAML.stringify(item)
          );
          return `${startQuery}\n\`\`\`data\n${markdownData.join(
            "---\n"
          )}\`\`\`\n${endQuery}`;
        default:
          return fullMatch;
      }
    }
  );
  // console.log("New text", text);
  await writePage(pageName, text);
}
