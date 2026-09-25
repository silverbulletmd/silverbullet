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
    oldState: stateText,
    text: renderToText(node.parent),
  });
}

/**
 * Where a task changed through a ref lives, used to fill the
 * `task:stateChange` event.
 */
export type UpdatedTask = {
  page: string;
  pos: number;
  /** The task's text before the change, same as for an in-page toggle */
  text: string;
  /** Editor range of the task, only set when it's in the page being edited */
  from?: number;
  to?: number;
};

/**
 * Finds the Task node of the list item a task ref points to (`pos` is the
 * start of that item).
 */
export function findTaskNodeAtRefPos(
  tree: ParseTree,
  pos: number,
): ParseTree | null {
  const itemNode = nodeAtPos(tree, pos + 1);
  return itemNode ? findNodeOfType(itemNode, "Task") : null;
}

export async function updateTaskState(
  path: string,
  oldState: string,
  newState: string,
): Promise<UpdatedTask | undefined> {
  const currentPath = await editor.getCurrentPath();
  const ref = parseToRef(path);

  if (!ref) {
    console.log("Could not parse task ref, skipping", path);
    return;
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
      return;
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
    return;
  }

  if (ref.path === currentPath) {
    const editorText = await editor.getText();

    const targetPos =
      ref.details.type === "position"
        ? ref.details.pos
        : getOffsetFromLineColumn(
            editorText,
            ref.details.line,
            ref.details.column,
          );

    const targetText = editorText.substring(
      targetPos + 3, // 3 because: "* ["
      targetPos + 3 + oldState.length,
    );
    if (targetText !== oldState) {
      console.error("Reference not a task marker, out of date?", targetText);
      return;
    }
    const taskNode = findTaskNodeAtRefPos(
      await markdown.parseMarkdown(editorText),
      targetPos,
    );
    await editor.dispatch({
      changes: {
        from: targetPos + 3,
        to: targetPos + 3 + oldState.length,
        insert: newState,
      },
    });
    return {
      page: getNameFromPath(ref.path),
      pos: targetPos,
      text: taskNode ? renderToText(taskNode) : "",
      from: taskNode?.from,
      to: taskNode?.to,
    };
  } else {
    const pageName = getNameFromPath(ref.path);
    let text = await space.readPage(pageName);

    const referenceMdTree = await markdown.parseMarkdown(text);
    const targetPos =
      ref.details.type === "position"
        ? ref.details.pos
        : getOffsetFromLineColumn(text, ref.details.line, ref.details.column);

    const itemNode = nodeAtPos(referenceMdTree, targetPos + 1);
    if (!itemNode) {
      console.error("Reference not a valid item, out of date?", itemNode);
      return;
    }
    const taskStateNode = findNodeOfType(itemNode, "TaskState");
    if (!taskStateNode) {
      console.error("Cannot find a task state", taskStateNode);
      return;
    }
    const taskNode = findNodeOfType(itemNode, "Task");
    const taskText = taskNode ? renderToText(taskNode) : "";
    taskStateNode.children![1].text = newState;
    text = renderToText(referenceMdTree);
    await space.writePage(pageName, text);
    // Best-effort sync; will catch up on next cycle if SW is unavailable
    sync.performFileSync(`${pageName}.md`).catch((e) => {
      console.warn("File sync after task update failed:", e.message);
    });
    return { page: pageName, pos: targetPos, text: taskText };
  }
}

/**
 * Changes the state of the task a ref points to, like when it's toggled from
 * a query widget, and fires `task:stateChange` for it (#788). Returns whether
 * the task was updated.
 */
export async function setTaskStateByRef(
  path: string,
  oldState: string,
  newState: string,
): Promise<boolean> {
  const updated = await updateTaskState(path, oldState, newState);
  if (!updated) {
    return false;
  }
  await events.dispatchEvent("task:stateChange", {
    ...updated,
    ref: path,
    newState,
    oldState,
  });
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

export async function cycleTaskStateByRef(
  path: string,
  oldState: string,
): Promise<string> {
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
  await setTaskStateByRef(path, oldState, newState);
  return newState;
}
