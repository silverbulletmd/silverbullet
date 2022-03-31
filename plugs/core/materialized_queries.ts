import { syscall } from "../lib/syscall";

export const queryRegex =
  /(<!--\s*#query\s+(?<table>\w+)\s*(filter\s+["'“”‘’](?<filter>[^"'“”‘’]+)["'“”‘’])?\s*(group by\s+(?<groupBy>\w+))?\s*-->)(.+?)(<!--\s*#end\s*-->)/gs;

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
  await syscall(
    "system.invokeFunctionOnServer",
    "updateMaterializedQueriesOnPage",
    await syscall("editor.getCurrentPage")
  );
  await syscall("editor.reloadPage");
  await syscall("editor.flashNotification", "Updated materialized queries");
}

// Called from client, running on server
export async function updateMaterializedQueriesOnPage(pageName: string) {
  let { text } = await syscall("space.readPage", pageName);
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
        } of await syscall("index.scanPrefixGlobal", "task:")) {
          let [, pos] = key.split(":");
          if (!filter || (filter && task.includes(filter))) {
            results.push(
                `* [${complete ? "x" : " "}] [[${page}@${pos}]] ${task}`
            );
            if (children) {
              results.push(children.join("\n"));
            }
          }
        }
        return `${startQuery}\n${results.join("\n")}\n${endQuery}`;
      case "link":
        let uniqueLinks = new Set<string>();
        for (let {key, page, value: name} of await syscall(
            "index.scanPrefixGlobal",
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
          value: {item, children},
        } of await syscall("index.scanPrefixGlobal", "it:")) {
          let [, pos] = key.split(":");
          if (!filter || (filter && item.includes(filter))) {
            results.push(`* [[${page}@${pos}]] ${item}`);
            if (children) {
              results.push(children.join("\n"));
            }
          }
        }
        return `${startQuery}\n${results.join("\n")}\n${endQuery}`;
      default:
        return match;
    }
  });
  // console.log("New text", text);
  await syscall("space.writePage", pageName, text);
}
