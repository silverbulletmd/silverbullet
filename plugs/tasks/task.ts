import type { ClickEvent } from "../../webapp/app_event";
import { IndexEvent } from "../../webapp/app_event";

import { whiteOutQueries } from "../core/materialized_queries";
import { batchSet } from "plugos-silverbullet-syscall/index";
import { readPage, writePage } from "plugos-silverbullet-syscall/space";
import {
  dispatch,
  getLineUnderCursor,
  getSyntaxNodeAtPos,
} from "plugos-silverbullet-syscall/editor";

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

export async function taskToggle(event: ClickEvent) {
  return taskToggleAtPos(event.pos);
}

export async function taskToggleAtPos(pos: number) {
  let syntaxNode = await getSyntaxNodeAtPos(pos);
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
        anchor: pos,
      },
    });
    // In case there's a page reference with @ position in the task, let's propagate this change back to that page
    // Example: * [ ] [[MyPage@123]] My task
    let line = await getLineUnderCursor();
    let match = line.match(extractPageLink);
    if (match) {
      console.log("Found a remote task reference, updating other page");
      let [, page, posS] = match;
      let pos = +posS;
      let pageData = await readPage(page);
      let text = pageData.text;

      // Apply the toggle
      text =
        text.substring(0, pos) +
        text
          .substring(pos)
          .replace(/^(\s*[\-\*]\s*)\[[ xX]\]/, "$1" + changeTo);

      await writePage(page, text);
    }
  }
}
