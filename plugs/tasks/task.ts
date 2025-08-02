import type { IndexTreeEvent } from "../../type/event.ts";

import {
  editor,
  events,
  markdown,
  space,
  sync,
} from "@silverbulletmd/silverbullet/syscalls";

import {
  addParentPointers,
  collectNodesMatching,
  findNodeMatching,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
  renderToText,
  replaceNodesMatching,
  traverseTreeAsync,
} from "../../plug-api/lib/tree.ts";
import { niceDate } from "../../lib/dates.ts";
import {
  cleanAttributes,
  extractAttributes,
} from "@silverbulletmd/silverbullet/lib/attribute";
import { rewritePageRefs } from "@silverbulletmd/silverbullet/lib/resolve";
import { indexObjects } from "../index/plug_api.ts";
import {
  cleanHashTags,
  extractHashTags,
  updateITags,
} from "@silverbulletmd/silverbullet/lib/tags";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import {
  parseRef,
  positionOfLine,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import { enrichItemFromParents } from "../index/item.ts";
import { deepClone } from "@silverbulletmd/silverbullet/lib/json";
import { queryLuaObjects } from "../index/api.ts";
import type { ObjectValue } from "../../type/index.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

export type TaskObject = ObjectValue<
  {
    page: string;
    pos: number;
    name: string;
    text: string;
    done: boolean;
    state: string;
    deadline?: string;
  } & Record<string, any>
>;

export type TaskStateObject = ObjectValue<{
  state: string;
  count: number;
  page: string;
}>;

function getDeadline(deadlineNode: ParseTree): string {
  return deadlineNode.children![0].text!.replace(/📅\s*/, "");
}

const completeStates = ["x", "X"];
const incompleteStates = [" "];

export async function extractTasks(
  name: string,
  tree: ParseTree,
): Promise<TaskObject[]> {
  const tasks: ObjectValue<TaskObject>[] = [];
  const taskStates = new Map<string, { count: number; firstPos: number }>();
  const frontmatter = await extractFrontMatter(tree);

  await traverseTreeAsync(tree, async (n) => {
    if (n.type !== "Task") {
      return false;
    }
    const listItemNode = n.parent!;
    const state = n.children![0].children![1].text!;
    if (!incompleteStates.includes(state) && !completeStates.includes(state)) {
      let currentState = taskStates.get(state);
      if (!currentState) {
        currentState = { count: 0, firstPos: n.from! };
        taskStates.set(state, currentState);
      }
      currentState.count++;
    }
    const complete = completeStates.includes(state);

    const task: TaskObject = {
      ref: `${name}@${n.from}`,
      tag: "task",
      name: "",
      text: "",
      done: complete,
      page: name,
      pos: n.from!,
      state,
    };

    rewritePageRefs(n, name);

    // The task text is everything after the task marker
    task.text = n.children!.slice(1).map(renderToText).join("").trim();

    // This finds the deadline and tags, and removes them from the tree
    replaceNodesMatching(n, (tree) => {
      if (tree.type === "DeadlineDate") {
        task.deadline = getDeadline(tree);
        // Remove this node from the tree
        return null;
      }
    });

    // Extract tags and attributes
    task.tags = extractHashTags(n);
    const extractedAttributes = await extractAttributes(n);

    // Then clean them out
    const clonedNode = deepClone(n, ["parent"]);
    cleanHashTags(clonedNode);
    cleanAttributes(clonedNode);
    task.name = clonedNode.children!.slice(1).map(renderToText).join("").trim();

    for (const [key, value] of Object.entries(extractedAttributes)) {
      task[key] = value;
    }

    updateITags(task, frontmatter);
    await enrichItemFromParents(listItemNode, task, name, frontmatter);

    tasks.push(task);
    return true;
  });

  // Index task states
  if (taskStates.size > 0) {
    await indexObjects<TaskStateObject>(
      name,
      Array.from(taskStates.entries()).map(([state, { firstPos, count }]) => ({
        ref: `${name}@${firstPos}`,
        tag: "taskstate",
        state,
        count,
        page: name,
      })),
    );
  }
  return tasks;
}

export async function indexTasks({ name, tree }: IndexTreeEvent) {
  const extractedTasks = await extractTasks(name, tree);

  // Index tasks themselves
  if (extractTasks.length > 0) {
    await indexObjects(name, extractedTasks);
  }
}

export function taskToggle(event: ClickEvent) {
  if (event.altKey) {
    return;
  }
  return taskCycleAtPos(event.pos);
}

export function previewTaskToggle(eventString: string) {
  const [eventName, pos] = JSON.parse(eventString);
  if (eventName === "task") {
    return taskCycleAtPos(+pos);
  }
}

async function convertListItemToTask(node: ParseTree) {
  const listMark = node.children![0];
  const originalMark = renderToText(listMark);

  // Determine the task marker based on the original list type
  let taskMarker: string;
  if (originalMark.match(/^\d+\./)) {
    // Numbered list: preserve the number
    taskMarker = originalMark + " [ ]";
  } else {
    // Bullet list: use standard bullet
    taskMarker = "* [ ]";
  }

  await editor.dispatch({
    changes: {
      from: listMark.from,
      to: listMark.to,
      insert: taskMarker,
    },
  });
}

async function removeTaskCheckbox(listItemNode: ParseTree) {
  const taskNode = findNodeOfType(listItemNode, "Task");
  if (!taskNode) {
    console.error("No task node found in list item");
    return;
  }

  //  Task node contains: TaskMark, TaskState, and text content. Keep just list marker and content after the checkbox
  const listMark = listItemNode.children![0];
  const contentAfterCheckbox = taskNode.children!.slice(1); // Skip TaskMark which contains [ ]

  const textContent = contentAfterCheckbox.map(renderToText).join("");

  // Replace entire list item content
  await editor.dispatch({
    changes: {
      from: listItemNode.from!,
      to: listItemNode.to!,
      insert: renderToText(listMark) + textContent,
    },
  });
}

async function cycleTaskState(
  node: ParseTree,
  removeCheckbox: boolean = false,
) {
  const stateText = node.children![1].text!;

  // If removeCheckbox is true and task is complete, remove checkbox entirely
  if (removeCheckbox && completeStates.includes(stateText)) {
    // Convert back to regular list item
    const taskNode = node.parent!;
    const listItemNode = taskNode.parent!;
    await removeTaskCheckbox(listItemNode);
    return;
  }

  let changeTo: string | undefined;
  if (completeStates.includes(stateText)) {
    changeTo = " ";
  } else if (incompleteStates.includes(stateText)) {
    changeTo = "x";
  } else {
    // Not a checkbox, but a custom state
    const allStates = await queryLuaObjects<TaskStateObject>(
      "taskstate",
      {},
      {},
    );
    const states = [...new Set(allStates.map((s) => s.state))];
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
      await updateTaskState(ref, stateText, changeTo);
    }
  }

  await events.dispatchEvent("task:stateChange", {
    from: node.parent!.from,
    to: node.parent!.to,
    newState: changeTo,
    text: renderToText(node.parent),
  });
}

export async function updateTaskState(
  ref: string,
  oldState: string,
  newState: string,
) {
  const currentPage = await editor.getCurrentPage();
  const { page, pos } = parseRef(ref);
  if (pos === undefined) {
    console.error("No position found in page ref, skipping", ref);
    return;
  }
  if (page === currentPage) {
    // In current page, just update the task marker with dispatch
    const editorText = await editor.getText();
    const targetPos = pos instanceof Object
      ? positionOfLine(editorText, pos.line, pos.column)
      : pos;
    // Check if the task state marker is still there
    const targetText = editorText.substring(
      targetPos + 1,
      targetPos + 1 + oldState.length,
    );
    if (targetText !== oldState) {
      console.error(
        "Reference not a task marker, out of date?",
        targetText,
      );
      return;
    }
    await editor.dispatch({
      changes: {
        from: targetPos + 1,
        to: targetPos + 1 + oldState.length,
        insert: newState,
      },
    });
  } else {
    let text = await space.readPage(page);

    const referenceMdTree = await markdown.parseMarkdown(text);
    const targetPos = pos instanceof Object
      ? positionOfLine(text, pos.line, pos.column)
      : pos;
    // Adding +1 to immediately hit the task state node
    const taskStateNode = nodeAtPos(referenceMdTree, targetPos + 1);
    if (!taskStateNode || taskStateNode.type !== "TaskState") {
      console.error(
        "Reference not a task marker, out of date?",
        taskStateNode,
      );
      return;
    }
    taskStateNode.children![1].text = newState;
    text = renderToText(referenceMdTree);
    await space.writePage(page, text);
    sync.scheduleFileSync(`${page}.md`);
  }
}

export async function taskCycleAtPos(pos: number) {
  const text = await editor.getText();
  const mdTree = await markdown.parseMarkdown(text);
  addParentPointers(mdTree);

  let node = nodeAtPos(mdTree, pos);
  if (node) {
    if (node.type === "TaskMark") {
      node = node.parent!;
    }
    if (node.type === "TaskState") {
      await cycleTaskState(node, false);
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

  if (taskNode) {
    const taskState = findNodeOfType(taskNode!, "TaskState");
    if (taskState) {
      // Cycle states: [ ] -> [x] -> (remove checkbox) -> [ ]
      await cycleTaskState(taskState, true);
    }
    return;
  }

  // Convert a bullet point to a task
  const listItem = findParentMatching(node!, (n) => n.type === "ListItem");
  if (!listItem) {
    await editor.flashNotification("No task at cursor");
    return;
  }

  // Check if this ListItem already contains a Task (cursor might be at beginning of line)
  const existingTask = findNodeOfType(listItem, "Task");
  if (existingTask) {
    const taskState = findNodeOfType(existingTask, "TaskState");
    if (taskState) {
      await cycleTaskState(taskState, true);
    }
    return;
  }

  convertListItemToTask(listItem);
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

export async function removeCompletedTasksCommand() {
  const tree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(tree);

  // Taking this ugly approach because the tree is modified in place
  // Just finding and removing one task at a time and then repeating until nothing changes
  while (true) {
    const completedTaskNode = findNodeMatching(tree, (node) => {
      return node.type === "Task" &&
        ["x", "X"].includes(node.children![0].children![1].text!);
    });
    if (completedTaskNode) {
      // Ok got one, let's remove it
      const listItemNode = completedTaskNode.parent!;
      const bulletListNode = listItemNode.parent!;
      // Remove the list item
      const listItemIdx = bulletListNode.children!.indexOf(listItemNode);
      let removeItems = 1;
      if (bulletListNode.children![listItemIdx + 1]?.text === "\n") {
        removeItems++;
      }
      bulletListNode.children!.splice(listItemIdx, removeItems);
    } else {
      // No completed tasks left, we're done
      break;
    }
  }

  await editor.setText(renderToText(tree));
}
