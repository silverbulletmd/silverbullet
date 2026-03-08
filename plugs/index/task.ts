import {
  config,
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
    const allStates = await config.get("taskStates", {});
    const states = Object.keys(allStates);
    console.log("All states", states);
    states.sort();
    // Select a next state
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

export async function updateTaskState(
  path: string,
  oldState: string,
  newState: string,
) {
  const currentPath = await editor.getCurrentPath();
  const ref = parseToRef(path);

  if (
    !ref || !ref.details || !isMarkdownPath(ref.path) ||
    (ref.details.type !== "linecolumn" && ref.details.type !== "position")
  ) {
    console.log("No position found in page ref, skipping", ref);
    return;
  }

  if (ref.path === currentPath) {
    // In current page, just update the task marker with dispatch
    const editorText = await editor.getText();

    const targetPos = ref.details.type === "position"
      ? ref.details.pos
      : getOffsetFromLineColumn(
        editorText,
        ref.details.line,
        ref.details.column,
      );

    // Check if the task state marker is still there
    const targetText = editorText.substring(
      targetPos + 3, // 3 because: "* ["
      targetPos + 3 + oldState.length,
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
        from: targetPos + 3,
        to: targetPos + 3 + oldState.length,
        insert: newState,
      },
    });
  } else {
    const pageName = getNameFromPath(ref.path);
    let text = await space.readPage(pageName);

    const referenceMdTree = await markdown.parseMarkdown(text);
    const targetPos = ref.details.type === "position"
      ? ref.details.pos
      : getOffsetFromLineColumn(
        text,
        ref.details.line,
        ref.details.column,
      );

    const itemNode = nodeAtPos(referenceMdTree, targetPos + 1);
    if (!itemNode) {
      console.error(
        "Reference not a valid item, out of date?",
        itemNode,
      );
      return;
    }
    const taskStateNode = findNodeOfType(itemNode, "TaskState");
    if (!taskStateNode) {
      console.error(
        "Cannot find a task state",
        taskStateNode,
      );
      return;
    }
    taskStateNode.children![1].text = newState;
    text = renderToText(referenceMdTree);
    await space.writePage(pageName, text);
    sync.performFileSync(`${pageName}.md`);
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

// Core logic extracted for testability. Mutates tree in place.
export function removeCompletedTasksFromTree(
  tree: ParseTree,
  allCompletedStates: string[],
) {
  // Taking this ugly approach because the tree is modified in place
  // Just finding and removing one task at a time and then repeating until nothing changes
  while (true) {
    const completedTaskNode = findNodeMatching(tree, (node) => {
      return node.type === "Task" &&
        allCompletedStates.includes(node.children![0].children![1].text!);
    });
    if (completedTaskNode) {
      // Ok got one, let's remove it
      const listItemNode = completedTaskNode.parent!;
      const bulletListNode = listItemNode.parent!;
      // Remove the list item
      const listItemIdx = bulletListNode.children!.indexOf(listItemNode);
      // Also remove the adjacent whitespace/newline separator text node.
      // Prefer the following separator; if none, remove the preceding one.
      const nextChild = bulletListNode.children![listItemIdx + 1];
      const prevChild = listItemIdx > 0
        ? bulletListNode.children![listItemIdx - 1]
        : undefined;
      if (nextChild && !nextChild.type && nextChild.text?.startsWith("\n")) {
        // Remove item and following separator
        bulletListNode.children!.splice(listItemIdx, 2);
      } else if (
        prevChild && !prevChild.type && prevChild.text?.startsWith("\n")
      ) {
        // Remove preceding separator and item
        bulletListNode.children!.splice(listItemIdx - 1, 2);
      } else {
        // No separator to remove, just remove the item
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
          // Remove BulletList and following separator
          parentChildren.splice(blIdx, 2);
        } else if (
          blPrev && !blPrev.type && blPrev.text?.startsWith("\n")
        ) {
          // Remove preceding separator and BulletList
          parentChildren.splice(blIdx - 1, 2);
        } else {
          parentChildren.splice(blIdx, 1);
        }
      }
    } else {
      // No completed tasks left, we're done
      break;
    }
  }
}

export async function removeCompletedTasksCommand() {
  const tree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(tree);

  const allCompletedStates = completeStates.concat(
    Object.values(await config.get("taskStates", {})).filter((ts: any) =>
      ts.done
    ).map((ts: any) => ts.name),
  );

  removeCompletedTasksFromTree(tree, allCompletedStates);

  await editor.setText(renderToText(tree));
}
