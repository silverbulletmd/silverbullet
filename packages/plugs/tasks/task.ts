import type { ClickEvent, IndexTreeEvent } from "@silverbulletmd/web/app_event";

import {
  batchSet,
  scanPrefixGlobal,
} from "@silverbulletmd/plugos-silverbullet-syscall/index";
import {
  readPage,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import {
  dispatch,
  filterBox,
  getCursor,
  getText,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import {
  addParentPointers,
  collectNodesMatching,
  collectNodesOfType,
  findNodeOfType,
  nodeAtPos,
  ParseTree,
  renderToText,
} from "@silverbulletmd/common/tree";
import { removeQueries } from "../query/util";
import { applyQuery, QueryProviderEvent, renderQuery } from "../query/engine";
import { niceDate } from "../core/dates";

export type Task = {
  name: string;
  done: boolean;
  deadline?: string;
  nested?: string;
  // Not saved in DB, just added when pulled out (from key)
  pos?: number;
  page?: string;
};

function getDeadline(deadlineNode: ParseTree): string {
  return deadlineNode.children![0].text!.replace(/📅\s*/, "");
}

export async function indexTasks({ name, tree }: IndexTreeEvent) {
  // console.log("Indexing tasks");
  let tasks: { key: string; value: Task }[] = [];
  removeQueries(tree);
  collectNodesOfType(tree, "Task").forEach((n) => {
    let task = n.children!.slice(1).map(renderToText).join("").trim();
    let complete = n.children![0].children![0].text! !== "[ ]";
    let value: Task = {
      name: task,
      done: complete,
    };

    let deadlineNode = findNodeOfType(n, "DeadlineDate");
    if (deadlineNode) {
      value.deadline = getDeadline(deadlineNode);
    }

    let taskIndex = n.parent!.children!.indexOf(n);
    let nestedItems = n.parent!.children!.slice(taskIndex + 1);
    if (nestedItems.length > 0) {
      value.nested = nestedItems.map(renderToText).join("").trim();
    }
    tasks.push({
      key: `task:${n.from}`,
      value,
    });
    // console.log("Task", value);
  });

  console.log("Found", tasks.length, "task(s)");
  await batchSet(name, tasks);
}

export async function taskToggle(event: ClickEvent) {
  return taskToggleAtPos(event.pos);
}

async function toggleTaskMarker(node: ParseTree, moveToPos: number) {
  let changeTo = "[x]";
  if (node.children![0].text === "[x]" || node.children![0].text === "[X]") {
    changeTo = "[ ]";
  }
  await dispatch({
    changes: {
      from: node.from,
      to: node.to,
      insert: changeTo,
    },
    selection: {
      anchor: moveToPos,
    },
  });

  let parentWikiLinks = collectNodesMatching(
    node.parent!,
    (n) => n.type === "WikiLinkPage"
  );
  for (let wikiLink of parentWikiLinks) {
    let ref = wikiLink.children![0].text!;
    if (ref.includes("@")) {
      let [page, pos] = ref.split("@");
      let text = (await readPage(page)).text;

      let referenceMdTree = await parseMarkdown(text);
      // Adding +1 to immediately hit the task marker
      let taskMarkerNode = nodeAtPos(referenceMdTree, +pos + 1);

      if (!taskMarkerNode || taskMarkerNode.type !== "TaskMarker") {
        console.error(
          "Reference not a task marker, out of date?",
          taskMarkerNode
        );
        return;
      }
      taskMarkerNode.children![0].text = changeTo;
      text = renderToText(referenceMdTree);
      console.log("Updated reference paged text", text);
      await writePage(page, text);
    }
  }
}

export async function taskToggleAtPos(pos: number) {
  let text = await getText();
  let mdTree = await parseMarkdown(text);
  addParentPointers(mdTree);

  let node = nodeAtPos(mdTree, pos);
  if (node && node.type === "TaskMarker") {
    await toggleTaskMarker(node, pos);
  }
}

export async function taskToggleCommand() {
  let text = await getText();
  let pos = await getCursor();
  let tree = await parseMarkdown(text);
  addParentPointers(tree);

  let node = nodeAtPos(tree, pos);
  // We kwow node.type === Task (due to the task context)
  let taskMarker = findNodeOfType(node!, "TaskMarker");
  await toggleTaskMarker(taskMarker!, pos);
}

export async function postponeCommand() {
  let text = await getText();
  let pos = await getCursor();
  let tree = await parseMarkdown(text);
  addParentPointers(tree);

  let node = nodeAtPos(tree, pos)!;
  // We kwow node.type === DeadlineDate (due to the task context)
  let date = getDeadline(node);
  let option = await filterBox(
    "Postpone for...",
    [
      { name: "a day", orderId: 1 },
      { name: "a week", orderId: 2 },
      { name: "following Monday", orderId: 3 },
    ],
    "Select the desired time span to delay this task"
  );
  if (!option) {
    return;
  }
  let d = new Date(date);
  switch (option.name) {
    case "a day":
      d.setDate(d.getDate() + 1);
      break;
    case "a week":
      d.setDate(d.getDate() + 7);
      break;
    case "following Monday":
      d.setDate(d.getDate() + ((7 - d.getDay() + 1) % 7 || 7));
      break;
  }
  await dispatch({
    changes: {
      from: node.from,
      to: node.to,
      insert: `📅 ${niceDate(d)}`,
    },
    selection: {
      anchor: pos,
    },
  });
  // await toggleTaskMarker(taskMarker!, pos);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<Task[]> {
  let allTasks: Task[] = [];
  for (let { key, page, value } of await scanPrefixGlobal("task:")) {
    let [, pos] = key.split(":");
    allTasks.push({
      ...value,
      page: page,
      pos: pos,
    });
  }
  return applyQuery(query, allTasks);
}
