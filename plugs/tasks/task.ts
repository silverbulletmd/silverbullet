import type { ClickEvent } from "../../webapp/app_event";
import { IndexEvent } from "../../webapp/app_event";

import { whiteOutQueries } from "../core/materialized_queries";
import { batchSet, scanPrefixGlobal } from "plugos-silverbullet-syscall/index";
import { readPage, writePage } from "plugos-silverbullet-syscall/space";
import {
  dispatch,
  getLineUnderCursor,
  getSyntaxNodeAtPos,
} from "plugos-silverbullet-syscall/editor";

const allTasksPageName = "ALL TASKS";
const taskRe = /[\-\*]\s*\[([ Xx])\]\s*(.*)/g;
const taskFullRe =
  /(?<prefix>[\t ]*)[\-\*]\s*\[([ Xx])\]\s*([^\n]+)(\n\k<prefix>\s+[\-\*][^\n]+)*/g;
const extractPageLink = /[\-\*]\s*\[[ Xx]\]\s\[\[([^\]]+)@(\d+)\]\]\s*(.*)/;

type Task = {
  task: string;
  complete: boolean;
  pos?: number;
  children?: string[];
};

export async function indexTasks({ name, text }: IndexEvent) {
  if (name === allTasksPageName) {
    return;
  }

  console.log("Indexing tasks");
  let tasks: { key: string; value: Task }[] = [];
  text = whiteOutQueries(text);
  for (let match of text.matchAll(taskFullRe)) {
    let entire = match[0];
    let complete = match[2] !== " ";
    let task = match[3];
    let pos = match.index!;
    let lines = entire.split("\n");

    let value: Task = {
      task,
      complete,
    };
    if (lines.length > 1) {
      value.children = lines.slice(1);
    }
    tasks.push({
      key: `task:${pos}`,
      value,
    });
  }
  console.log("Found", tasks.length, "task(s)");
  await batchSet(name, tasks);
}

export async function updateTaskPage() {
  let allTasks = await scanPrefixGlobal("task:");
  let pageTasks = new Map<string, Task[]>();
  for (let {
    key,
    page,
    value: { task, complete },
  } of allTasks) {
    if (complete) {
      continue;
    }
    let [, pos] = key.split(":");
    let tasks = pageTasks.get(page) || [];
    tasks.push({ task, complete, pos: +pos });
    pageTasks.set(page, tasks);
  }

  let mdPieces = [];
  for (let pageName of [...pageTasks.keys()].sort()) {
    mdPieces.push(`\n## ${pageName}\n`);
    for (let task of pageTasks.get(pageName)!) {
      mdPieces.push(
        `* [${task.complete ? "x" : " "}] [[${pageName}@${task.pos}]] ${
          task.task
        }`
      );
    }
  }

  let taskMd = mdPieces.join("\n");
  await writePage(allTasksPageName, taskMd);
}

export async function taskToggle(event: ClickEvent) {
  let syntaxNode = await getSyntaxNodeAtPos(event.pos);
  if (syntaxNode && syntaxNode.name === "TaskMarker") {
    let changeTo = "[x]";
    if (syntaxNode.text === "[x]" || syntaxNode.text === "[X]") {
      changeTo = "[ ]";
    }
    await dispatch({
      changes: {
        from: syntaxNode.from,
        to: syntaxNode.to,
        insert: changeTo,
      },
      selection: {
        anchor: event.pos,
      },
    });
    if (event.page === allTasksPageName) {
      // Propagate back to the page in question
      let line = await getLineUnderCursor();
      let match = line.match(extractPageLink);
      if (match) {
        let [, page, posS] = match;
        let pos = +posS;
        let pageData = await readPage(page);
        let text = pageData.text;

        // Apply the toggle
        text =
          text.substring(0, pos) +
          text.substring(pos).replace(/^([\-\*]\s*)\[[ xX]\]/, "$1" + changeTo);

        await writePage(page, text);
      }
    }
  }
}
