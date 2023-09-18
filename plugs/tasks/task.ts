import type { ClickEvent, IndexTreeEvent } from "$sb/app_event.ts";

import { editor, markdown, space, sync } from "$sb/syscalls.ts";

import {
  addParentPointers,
  collectNodesMatching,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  ParseTree,
  renderToText,
  replaceNodesMatching,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { niceDate } from "$sb/lib/dates.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { determineType } from "../index/attributes.ts";
import { AttributeObject, ObjectValue } from "$sb/types.ts";
import { indexObjects, queryObjects } from "../index/plug_api.ts";
import type { TagObject } from "../index/tags.ts";

export type TaskObject = {
  page: string;
  pos: number;
  name: string;
  done: boolean;
  state: string;
  deadline?: string;
  tags?: string[];
} & Record<string, any>;

export type TaskStateObject = {
  state: string;
  count: number;
  page: string;
};

function getDeadline(deadlineNode: ParseTree): string {
  return deadlineNode.children![0].text!.replace(/📅\s*/, "");
}

const completeStates = ["x", "X"];
const incompleteStates = [" "];

export async function indexTasks({ name, tree }: IndexTreeEvent) {
  const tasks: ObjectValue<TaskObject>[] = [];
  const taskStates = new Map<string, number>();
  removeQueries(tree);
  addParentPointers(tree);
  const allAttributes: AttributeObject[] = [];
  const allTags = new Set<string>();
  await traverseTreeAsync(tree, async (n) => {
    if (n.type !== "Task") {
      return false;
    }
    const state = n.children![0].children![1].text!;
    if (!incompleteStates.includes(state) && !completeStates.includes(state)) {
      if (!taskStates.has(state)) {
        taskStates.set(state, 1);
      } else {
        taskStates.set(state, taskStates.get(state)! + 1);
      }
    }
    const complete = completeStates.includes(state);
    const task: TaskObject = {
      name: "",
      done: complete,
      page: name,
      pos: n.from!,
      state,
    };

    rewritePageRefs(n, name);

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
        const tagName = tree.children![0].text!.substring(1);
        task.tags.push(tagName);
        allTags.add(tagName);
        // Remove this node from the tree
        // return null;
      }
    });

    // Extract attributes and remove from tree
    const extractedAttributes = await extractAttributes(n, true);
    const tags = ["task", ...task.tags || []];
    for (const [key, value] of Object.entries(extractedAttributes)) {
      task[key] = value;
      for (const tag of tags) {
        allAttributes.push({
          name: key,
          attributeType: determineType(value),
          tag,
          page: name,
        });
      }
    }

    task.name = n.children!.slice(1).map(renderToText).join("").trim();

    tasks.push({
      key: [`${n.from}`],
      tags,
      value: task,
    });
    return true;
  });

  // console.log("Found", allAttributes, "task attributes(s)");
  // await indexAttributes(name, allAttributes);

  // Index task states
  if (taskStates.size > 0) {
    await indexObjects<TaskStateObject>(
      name,
      Array.from(taskStates.entries()).map(([state, count]) => ({
        tags: ["taskstate"],
        key: [state],
        value: {
          state,
          count,
          page: name,
        } as TaskStateObject,
      })),
    );
  }

  if (allTags.size > 0) {
    await indexObjects<TagObject>(
      name,
      Array.from(allTags).map((tag) => ({
        tags: ["tag"],
        key: [tag],
        value: {
          name: tag,
          page: name,
          context: "task",
        },
      })),
    );
  }

  // Index tasks themselves
  if (tasks.length > 0) {
    await indexObjects(name, tasks);
  }
}

export function taskToggle(event: ClickEvent) {
  if (event.altKey) {
    return;
  }
  return taskCycleAtPos(event.page, event.pos);
}

export async function previewTaskToggle(eventString: string) {
  const [eventName, pos] = JSON.parse(eventString);
  if (eventName === "task") {
    return taskCycleAtPos(await editor.getCurrentPage(), +pos);
  }
}

async function cycleTaskState(
  pageName: string,
  node: ParseTree,
) {
  const stateText = node.children![1].text!;
  let changeTo: string | undefined;
  if (completeStates.includes(stateText)) {
    changeTo = " ";
  } else if (incompleteStates.includes(stateText)) {
    changeTo = "x";
  } else {
    // Not a checkbox, but a custom state
    const allStates = await queryObjects<TaskStateObject>("taskstate", {});
    const states = [...new Set(allStates.map((s) => s.value.state))];
    states.sort();
    // Select a next state
    const currentStateIndex = states.indexOf(stateText);
    if (currentStateIndex === -1) {
      console.error("Unknown state", stateText);
      return;
    }
    const nextStateIndex = (currentStateIndex + 1) % states.length;
    changeTo = states[nextStateIndex];
    // console.log("All possible states", states);
    // return;
  }
  await editor.dispatch({
    changes: {
      from: node.children![1].from,
      to: node.children![1].to,
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
      const [page, posS] = ref.split("@");
      const pos = +posS;
      if (page === pageName) {
        // In current page, just update the task marker with dispatch
        const editorText = await editor.getText();
        // Check if the task state marker is still there
        const targetText = editorText.substring(
          pos + 1,
          pos + 1 + stateText.length,
        );
        if (targetText !== stateText) {
          console.error(
            "Reference not a task marker, out of date?",
            targetText,
          );
          return;
        }
        await editor.dispatch({
          changes: {
            from: pos + 1,
            to: pos + 1 + stateText.length,
            insert: changeTo,
          },
        });
      } else {
        let text = await space.readPage(page);

        const referenceMdTree = await markdown.parseMarkdown(text);
        // Adding +1 to immediately hit the task state node
        const taskStateNode = nodeAtPos(referenceMdTree, pos + 1);
        if (!taskStateNode || taskStateNode.type !== "TaskState") {
          console.error(
            "Reference not a task marker, out of date?",
            taskStateNode,
          );
          return;
        }
        taskStateNode.children![1].text = changeTo;
        text = renderToText(referenceMdTree);
        await space.writePage(page, text);
        sync.scheduleFileSync(`${page}.md`);
      }
    }
  }
}

export async function taskCycleAtPos(pageName: string, pos: number) {
  const text = await editor.getText();
  const mdTree = await markdown.parseMarkdown(text);
  addParentPointers(mdTree);

  let node = nodeAtPos(mdTree, pos);
  if (node) {
    if (node.type === "TaskMark") {
      node = node.parent!;
    }
    if (node.type === "TaskState") {
      await cycleTaskState(pageName, node);
    }
  }
}

export async function taskCycleCommand() {
  const text = await editor.getText();
  const pos = await editor.getCursor();
  const tree = await markdown.parseMarkdown(text);
  addParentPointers(tree);

  let node = nodeAtPos(tree, pos);
  if (!node) {
    await editor.flashNotification("No task at cursor");
    return;
  }
  if (["BulletList", "Document"].includes(node.type!)) {
    // Likely at the end of the line, let's back up a position
    node = nodeAtPos(tree, pos - 1);
  }
  if (!node) {
    await editor.flashNotification("No task at cursor");
    return;
  }
  console.log("Node", node);
  const taskNode = node.type === "Task"
    ? node
    : findParentMatching(node!, (n) => n.type === "Task");
  if (!taskNode) {
    await editor.flashNotification("No task at cursor");
    return;
  }
  const taskState = findNodeOfType(taskNode!, "TaskState");
  if (taskState) {
    await cycleTaskState(await editor.getCurrentPage(), taskState);
  }
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
  const [yyyy, mm, dd] = date.split("-").map(Number);
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
}
