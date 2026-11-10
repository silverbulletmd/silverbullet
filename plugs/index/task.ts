import {
  config,
  editor,
  events,
  index,
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
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  getNameFromPath,
  getOffsetFromLineColumn,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

export const completeStates = ["x", "X"];

export const incompleteStates = [" "];

export function taskToggle(event: ClickEvent) {
  if (event.altKey) {
    return;
  }
  return taskCycleAtPos(event.pos);
}

function sortedTaskStateNames(allStates: Record<string, any>): string[] {
  return Object.entries(allStates)
    .sort(([, a]: any, [, b]: any) => (a.order ?? 0) - (b.order ?? 0))
    .map(([name]) => name);
}

async function convertListItemToTask(node: ParseTree) {
  const listMark = node.children![0];
  const originalMark = renderToText(listMark);

  let taskMarker: string;
  if (originalMark.match(/^\d+\./)) {
    taskMarker = `${originalMark} [ ]`;
  } else {
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

  if (removeCheckbox && completeStates.includes(stateText)) {
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
    const allStates = await config.get("taskStates", {});
    const states = sortedTaskStateNames(allStates);
    console.log("All states", states);
    let currentStateIndex = states.indexOf(stateText);
    if (currentStateIndex === -1) {
      console.error("Unknown state", stateText);
      currentStateIndex = 0;
    }
    const nextStateIndex = (currentStateIndex + 1) % states.length;
    changeTo = states[nextStateIndex];
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

/**
 * The TaskState node of the task whose list item starts at `pos`, the
 * position a task ref records. Null when no task's item starts there, so a ref
 * that has gone stale never lands on a neighbouring task.
 */
export function findTaskStateAtRefPos(
  tree: ParseTree,
  pos: number,
): ParseTree | null {
  const item = findNodeMatching(
    tree,
    (n) => n.type === "ListItem" && n.from === pos,
  );
  const task = item?.children?.find((n) => n.type === "Task");
  return task?.children?.find((n) => n.type === "TaskState") ?? null;
}

/**
 * Sets the state of the task a ref points to, if it is still in `oldState`.
 * @returns whether the task was changed
 */
export async function updateTaskState(
  path: string,
  oldState: string,
  newState: string,
): Promise<boolean> {
  const currentPath = await editor.getCurrentPath();
  const ref = parseToRef(path);

  if (!ref) {
    console.log("Could not parse task ref, skipping", path);
    return false;
  }

  // Anchor refs need resolving to a concrete page+position before we can
  // edit the task marker.
  if (ref.details?.type === "anchor") {
    const pageFilter = ref.path
      ? ref.path.endsWith(".md")
        ? ref.path.slice(0, -3)
        : ref.path
      : undefined;
    const result = await index.resolveAnchor(ref.details.name, pageFilter);
    if (!result.ok) {
      console.log("Could not resolve task anchor, skipping", path, result);
      return false;
    }
    ref.path = `${result.page}.md`;
    ref.details = { type: "position", pos: result.range[0] };
  }

  if (
    !ref.details ||
    !isMarkdownPath(ref.path) ||
    (ref.details.type !== "linecolumn" && ref.details.type !== "position")
  ) {
    console.log("No position found in page ref, skipping", ref);
    return false;
  }

  const inEditor = ref.path === currentPath;
  const pageName = getNameFromPath(ref.path);
  const text = inEditor
    ? await editor.getText()
    : await space.readPage(pageName);
  const targetPos =
    ref.details.type === "position"
      ? ref.details.pos
      : getOffsetFromLineColumn(text, ref.details.line, ref.details.column);
  const tree = await markdown.parseMarkdown(text);
  const stateNode = findTaskStateAtRefPos(tree, targetPos)?.children?.[1];
  if (stateNode?.text !== oldState) {
    console.error("Task ref out of date, not updating", path, oldState);
    return false;
  }

  if (inEditor) {
    await editor.dispatch({
      changes: { from: stateNode.from, to: stateNode.to, insert: newState },
    });
  } else {
    stateNode.text = newState;
    await space.writePage(pageName, renderToText(tree));
    // Best-effort sync; will catch up on next cycle if SW is unavailable
    sync.performFileSync(`${pageName}.md`).catch((e) => {
      console.warn("File sync after task update failed:", e.message);
    });
  }
  return true;
}

let taskCycleLock = false;

export async function taskCycleAtPos(pos: number) {
  if (taskCycleLock) return;
  taskCycleLock = true;
  try {
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
  } finally {
    taskCycleLock = false;
  }
}

export async function taskCycleCommand() {
  if (taskCycleLock) return;
  taskCycleLock = true;
  try {
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
      node = nodeAtPos(tree, pos - 1);
    }
    if (!node) {
      await editor.flashNotification("No task at cursor");
      return;
    }
    const taskNode =
      node.type === "Task"
        ? node
        : findParentMatching(node!, (n) => n.type === "Task");

    if (taskNode) {
      const taskState = findNodeOfType(taskNode!, "TaskState");
      if (taskState) {
        await cycleTaskState(taskState, true);
      }
      return;
    }

    const listItem = findParentMatching(node!, (n) => n.type === "ListItem");
    if (!listItem) {
      await editor.flashNotification("No task at cursor");
      return;
    }

    const existingTask = findNodeOfType(listItem, "Task");
    if (existingTask) {
      const taskState = findNodeOfType(existingTask, "TaskState");
      if (taskState) {
        await cycleTaskState(taskState, true);
      }
      return;
    }

    await convertListItemToTask(listItem);
  } finally {
    taskCycleLock = false;
  }
}

// Mutates the tree in place.
export function removeCompletedTasksFromTree(
  tree: ParseTree,
  allCompletedStates: string[],
) {
  // Restart traversal after each removal because it mutates the tree.
  while (true) {
    const completedTaskNode = findNodeMatching(tree, (node) => {
      return (
        node.type === "Task" &&
        allCompletedStates.includes(node.children![0].children![1].text!)
      );
    });
    if (completedTaskNode) {
      const listItemNode = completedTaskNode.parent!;
      const bulletListNode = listItemNode.parent!;
      const listItemIdx = bulletListNode.children!.indexOf(listItemNode);
      // Also remove the adjacent whitespace/newline separator text node.
      // Prefer the following separator; if none, remove the preceding one.
      const nextChild = bulletListNode.children![listItemIdx + 1];
      const prevChild =
        listItemIdx > 0 ? bulletListNode.children![listItemIdx - 1] : undefined;
      if (nextChild && !nextChild.type && nextChild.text?.startsWith("\n")) {
        bulletListNode.children!.splice(listItemIdx, 2);
      } else if (
        prevChild &&
        !prevChild.type &&
        prevChild.text?.startsWith("\n")
      ) {
        bulletListNode.children!.splice(listItemIdx - 1, 2);
      } else {
        bulletListNode.children!.splice(listItemIdx, 1);
      }
      // If the BulletList now has no ListItem children, remove it and any
      // adjacent whitespace/newline text node from its parent. This prevents
      // blank lines left behind when all items in a nested list are completed.
      if (
        bulletListNode.parent &&
        !bulletListNode.children!.some((c) => c.type === "ListItem")
      ) {
        const parentChildren = bulletListNode.parent.children!;
        const blIdx = parentChildren.indexOf(bulletListNode);
        const blNext = parentChildren[blIdx + 1];
        const blPrev = blIdx > 0 ? parentChildren[blIdx - 1] : undefined;
        if (blNext && !blNext.type && blNext.text?.startsWith("\n")) {
          parentChildren.splice(blIdx, 2);
        } else if (blPrev && !blPrev.type && blPrev.text?.startsWith("\n")) {
          parentChildren.splice(blIdx - 1, 2);
        } else {
          parentChildren.splice(blIdx, 1);
        }
      }
    } else {
      break;
    }
  }
}

export async function removeCompletedTasksCommand() {
  const tree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(tree);

  const allCompletedStates = completeStates.concat(
    Object.values(await config.get("taskStates", {}))
      .filter((ts: any) => ts.done)
      .map((ts: any) => ts.name),
  );

  removeCompletedTasksFromTree(tree, allCompletedStates);

  await editor.setText(renderToText(tree));
}

/**
 * Moves the task a ref points to from `oldState` to the next state.
 * @returns the new state, or undefined when the task is no longer in
 * `oldState` at that ref and was left as it is
 */
export async function cycleTaskStateByRef(
  path: string,
  oldState: string,
): Promise<string | undefined> {
  let newState: string;
  if (completeStates.includes(oldState)) {
    newState = " ";
  } else if (incompleteStates.includes(oldState)) {
    newState = "x";
  } else {
    const allStates = await config.get("taskStates", {});
    const states = sortedTaskStateNames(allStates);
    let idx = states.indexOf(oldState);
    if (idx === -1) {
      idx = 0;
    }
    newState = states[(idx + 1) % states.length];
  }
  if (!(await updateTaskState(path, oldState, newState))) {
    return undefined;
  }
  await events.dispatchEvent("task:stateChange", {
    newState,
  });
  return newState;
}
