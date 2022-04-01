import {
  flashNotification,
  getCurrentPage,
  reloadPage,
  save,
} from "plugos-silverbullet-syscall/editor";

import { readPage, writePage } from "plugos-silverbullet-syscall/space";
import { invokeFunctionOnServer } from "plugos-silverbullet-syscall/system";
import { scanPrefixGlobal } from "plugos-silverbullet-syscall";

export const queryRegex =
  /(<!--\s*#query\s+(?<table>\w+)\s*(filter\s+["'“”‘’](?<filter>[^"'“”‘’]+)["'“”‘’])?\s*-->)(.+?)(<!--\s*#end\s*-->)/gs;

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
  await invokeFunctionOnServer("updateMaterializedQueriesOnPage", currentPage);
  await reloadPage();
  await flashNotification("Updated materialized queries");
}

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(pageName: string) {
  let { text } = await readPage(pageName);
  text = await replaceAsync(text, queryRegex, async (match, ...args) => {
    let { table, filter, groupBy } = args[args.length - 1];
    const startQuery = args[0];
    const endQuery = args[args.length - 4];
    let results = [];
    switch (table) {
      case "task":
        for (let {
          key,
          page,
          value: { task, complete, children },
        } of await scanPrefixGlobal("task:")) {
          let [, pos] = key.split(":");
          if (!filter || (filter && task.includes(filter))) {
            results.push(
              `* [${complete ? "x" : " "}] [[${page}@${pos}]] ${task}` +
                (children ? "\n" + children.join("\n") : "")
            );
          }
        }
        return `${startQuery}\n${results.sort().join("\n")}\n${endQuery}`;
      case "link":
        let uniqueLinks = new Set<string>();
        for (let { key, page, value: name } of await scanPrefixGlobal(
          `pl:${pageName}:`
        )) {
          let [, pos] = key.split(":");
          if (!filter || (filter && name.includes(filter))) {
            uniqueLinks.add(name);
          }
        }
        for (const uniqueResult of uniqueLinks) {
          results.push(`* [[${uniqueResult}]]`);
        }
        return `${startQuery}\n${results.sort().join("\n")}\n${endQuery}`;
      case "item":
        for (let {
          key,
          page,
          value: { item, children },
        } of await scanPrefixGlobal("it:")) {
          let [, pos] = key.split(":");
          if (!filter || (filter && item.includes(filter))) {
            results.push(
              `* [[${page}@${pos}]] ${item}` +
                (children ? "\n" + children.join("\n") : "")
            );
          }
        }
        return `${startQuery}\n${results.sort().join("\n")}\n${endQuery}`;
      default:
        return match;
    }
  });
  // console.log("New text", text);
  await writePage(pageName, text);
}
