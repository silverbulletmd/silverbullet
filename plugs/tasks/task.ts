import type {
  ClickEvent,
  IndexTreeEvent,
  QueryProviderEvent,
} from "$sb/app_event.ts";

import {
  editor,
  index,
  markdown,
  space,
} from "$sb/silverbullet-syscall/mod.ts";

import {
  addParentPointers,
  collectNodesMatching,
  collectNodesOfType,
  findNodeOfType,
  nodeAtPos,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";
import { niceDate } from "$sb/lib/dates.ts";

export type Task = {
  name: string;
  done: boolean;
  deadline?: string;
  tags?: string[];
  nested?: string;
  // Not saved in DB, just added when pulled out (from key)
  pos?: number;
  page?: string;
};

function getDeadline(deadlineNode: ParseTree): string {
  return deadlineNode.children![0].text!.replace(/📅\s*/, "");
}

export async function indexTasks({ name, tree }: IndexTreeEvent) {
  const tasks: { key: string; value: Task }[] = [];
  removeQueries(tree);
  addParentPointers(tree);
  collectNodesOfType(tree, "Task").forEach((n) => {
    const complete = n.children![0].children![0].text! !== "[ ]";
    const task: Task = {
      name: "",
      done: complete,
    };

    replaceNodesMatching(n, (tree) => {
      if (tree.type === "DeadlineDate") {
        task.deadline = getDeadline(tree);
        // Remove this node from the tree
        return null;
      }
      if (tree.type === "Hashtag") {
        if (!task.tags) {
          task.tags = [];
        }
        // Push the tag to the list, removing the initial #
        task.tags.push(tree.children![0].text!.substring(1));
        // Remove this node from the tree
        // return null;
      }
    });

    task.name = n.children!.slice(1).map(renderToText).join("").trim();

    const taskIndex = n.parent!.children!.indexOf(n);
    const nestedItems = n.parent!.children!.slice(taskIndex + 1);
    if (nestedItems.length > 0) {
      task.nested = nestedItems.map(renderToText).join("").trim();
    }
    tasks.push({
      key: `task:${n.from}`,
      value: task,
    });
  });

  // console.log("Found", tasks.length, "task(s)");
  await index.batchSet(name, tasks);
}

export function taskToggle(event: ClickEvent) {
  return taskToggleAtPos(event.pos);
}

export function previewTaskToggle(eventString: string) {
  const [eventName, pos] = JSON.parse(eventString);
  if (eventName === "task") {
    return taskToggleAtPos(+pos);
  }
}

async function toggleTaskMarker(node: ParseTree, moveToPos: number) {
  let changeTo = "[x]";
  if (node.children![0].text === "[x]" || node.children![0].text === "[X]") {
    changeTo = "[ ]";
  }
  await editor.dispatch({
    changes: {
      from: node.from,
      to: node.to,
      insert: changeTo,
    },
  });

  const parentWikiLinks = collectNodesMatching(
    node.parent!,
    (n) => n.type === "WikiLinkPage",
  );
  for (const wikiLink of parentWikiLinks) {
    const ref = wikiLink.children![0].text!;
    if (ref.includes("@")) {
      const [page, pos] = ref.split("@");
      let text = await space.readPage(page);

      const referenceMdTree = await markdown.parseMarkdown(text);
      // Adding +1 to immediately hit the task marker
      const taskMarkerNode = nodeAtPos(referenceMdTree, +pos + 1);

      if (!taskMarkerNode || taskMarkerNode.type !== "TaskMarker") {
        console.error(
          "Reference not a task marker, out of date?",
          taskMarkerNode,
        );
        return;
      }
      taskMarkerNode.children![0].text = changeTo;
      text = renderToText(referenceMdTree);
      await space.writePage(page, text);
    }
  }
}

export async function taskToggleAtPos(pos: number) {
  const text = await editor.getText();
  const mdTree = await markdown.parseMarkdown(text);
  addParentPointers(mdTree);

  const node = nodeAtPos(mdTree, pos);
  if (node && node.type === "TaskMarker") {
    await toggleTaskMarker(node, pos);
  }
}

export async function taskToggleCommand() {
  const text = await editor.getText();
  const pos = await editor.getCursor();
  const tree = await markdown.parseMarkdown(text);
  addParentPointers(tree);

  const node = nodeAtPos(tree, pos);
  // We kwow node.type === Task (due to the task context)
  const taskMarker = findNodeOfType(node!, "TaskMarker");
  await toggleTaskMarker(taskMarker!, pos);
}

export async function postponeCommand() {
  const text = await editor.getText();
  const pos = await editor.getCursor();
  const tree = await markdown.parseMarkdown(text);
  addParentPointers(tree);

  const node = nodeAtPos(tree, pos)!;
  // We kwow node.type === DeadlineDate (due to the task context)
  const date = getDeadline(node);
  const option = await editor.filterBox(
    "Postpone for...",
    [
      { name: "a day", orderId: 1 },
      { name: "a week", orderId: 2 },
      { name: "following Monday", orderId: 3 },
    ],
    "Select the desired time span to delay this task",
  );
  if (!option) {
    return;
  }
  // Parse "naive" due date
  let [yyyy, mm, dd] = date.split("-").map(Number)
  // Create new naive Date object.
  // `monthIndex` parameter is zero-based, so subtract 1 from parsed month.
  const d = new Date(yyyy, mm - 1, dd);
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
  // console.log("New date", niceDate(d));
  await editor.dispatch({
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
  const allTasks: Task[] = [];
  for (const { key, page, value } of await index.queryPrefix("task:")) {
    const pos = key.split(":")[1];
    allTasks.push({
      ...value,
      page: page,
      pos: pos,
    });
  }
  return applyQuery(query, allTasks);
}
