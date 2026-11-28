import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { expect, test } from "vitest";
import { addParentPointers, renderToText } from "../../plug-api/lib/tree.ts";
import {
  completeStates,
  cycleTaskStateByRef,
  findTaskStateAtRefPos,
  removeCompletedTasksFromTree,
  updateTaskState,
} from "./task.ts";

function removeCompleted(md: string): string {
  createMockSystem();
  const tree = parseMarkdown(md);
  addParentPointers(tree);
  removeCompletedTasksFromTree(tree, completeStates);
  return renderToText(tree);
}

test("removeCompletedTasks: flat list", () => {
  const input = `- [x] completed
- [ ] incomplete
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] incomplete\n");
});

test("removeCompletedTasks: flat list, completed last", () => {
  const input = `- [ ] incomplete
- [x] completed
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] incomplete\n");
});

test("removeCompletedTasks: flat list, all completed", () => {
  const input = `- [x] one
- [x] two
`;
  const result = removeCompleted(input);
  expect(result).toEqual("");
});

test("removeCompletedTasks: nested list, completed has sibling", () => {
  const input = `- [ ] parent item
  - [x] completed nested
  - [ ] incomplete nested
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] parent item\n  - [ ] incomplete nested\n");
});

test("removeCompletedTasks: nested list, only nested item completed", () => {
  const input = `- [ ] parent item
  - [x] only nested item
- [ ] sibling item
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] parent item\n- [ ] sibling item\n");
});

test("removeCompletedTasks: nested list, all nested completed", () => {
  const input = `- [ ] parent item
  - [x] nested completed one
  - [x] nested completed two
- [ ] sibling item
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] parent item\n- [ ] sibling item\n");
});

test("removeCompletedTasks: mixed flat and nested", () => {
  const input = `- [x] flat completed
- [ ] flat incomplete
  - [x] nested completed
  - [ ] nested incomplete
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] flat incomplete\n  - [ ] nested incomplete\n");
});

test("removeCompletedTasks: uppercase X treated as completed", () => {
  const input = `- [X] completed uppercase
- [ ] incomplete
`;
  const result = removeCompleted(input);
  expect(result).toEqual("- [ ] incomplete\n");
});

test("removeCompletedTasks: no completed tasks, no change", () => {
  const input = `- [ ] one
- [ ] two
`;
  const result = removeCompleted(input);
  expect(result).toEqual(input);
});

const stateAt = (md: string, pos: number) =>
  findTaskStateAtRefPos(parseMarkdown(md), pos)?.children?.[1].text;

test("findTaskStateAtRefPos: finds the state of the task whose item starts at pos", () => {
  const md = "Intro\n\n* [TODO] first\n  * [ ] nested\n1. [DONE] ordered\n";
  expect(stateAt(md, md.indexOf("* [TODO]"))).toEqual("TODO");
  expect(stateAt(md, md.indexOf("* [ ] nested"))).toEqual(" ");
  expect(stateAt(md, md.indexOf("1. [DONE]"))).toEqual("DONE");
});

test("findTaskStateAtRefPos: finds nothing where no task's item starts", () => {
  const md = "* [TODO] first\n* plain item\n* [DONE] second\n";
  const second = md.indexOf("* [DONE]");
  expect(stateAt(md, second - 1)).toBeUndefined();
  expect(stateAt(md, second + 1)).toBeUndefined();
  expect(stateAt(md, md.indexOf("first"))).toBeUndefined();
  expect(stateAt(md, md.indexOf("* plain"))).toBeUndefined();
});

/** Stands in for the editor, with `text` as the open page "Open". */
function openPage(text: string) {
  const mock = createMockSystem();
  const editorState = { text };
  mock.system.registerSyscalls([], {
    "editor.getCurrentPath": () => "Open.md",
    "editor.getText": () => editorState.text,
    "editor.dispatch": (_ctx: any, change: any) => {
      const { from, to, insert } = change.changes;
      editorState.text =
        editorState.text.slice(0, from) + insert + editorState.text.slice(to);
    },
  });
  return { ...mock, editorState };
}

test("updateTaskState changes a task on another page only where its ref points", async () => {
  const { space } = openPage("");
  const md = "# Shopping\n\n* [TODO] milk\n* [READY] eggs\n";
  await space.writePage("Shopping", md);
  const eggs = md.indexOf("* [READY]");

  // A ref that went stale and now points into the line before
  expect(await updateTaskState(`Shopping@${eggs - 3}`, "READY", "DONE")).toBe(
    false,
  );
  // A state the task no longer has
  expect(await updateTaskState(`Shopping@${eggs}`, "TODO", "DONE")).toBe(false);
  expect((await space.readPage("Shopping")).text).toEqual(md);

  expect(await updateTaskState(`Shopping@${eggs}`, "READY", "DONE")).toBe(true);
  expect((await space.readPage("Shopping")).text).toEqual(
    "# Shopping\n\n* [TODO] milk\n* [DONE] eggs\n",
  );
});

test("updateTaskState changes a task in the open page only when its whole state matches", async () => {
  const md = "* [IN PROGRESSOGRESS] damaged\n* [TODO] fine\n";
  const { editorState } = openPage(md);

  expect(await updateTaskState("Open@0", "IN PROGRESS", "WAITING")).toBe(false);
  expect(editorState.text).toEqual(md);

  expect(
    await updateTaskState(`Open@${md.indexOf("* [TODO]")}`, "TODO", "READY"),
  ).toBe(true);
  expect(editorState.text).toEqual(
    "* [IN PROGRESSOGRESS] damaged\n* [READY] fine\n",
  );
});

test("cycleTaskStateByRef reports no new state when the task was not changed", async () => {
  const md = "* [x] done\n";
  const { editorState } = openPage(md);
  expect(await cycleTaskStateByRef("Open@0", " ")).toBeUndefined();
  expect(editorState.text).toEqual(md);
  expect(await cycleTaskStateByRef("Open@0", "x")).toEqual(" ");
  expect(editorState.text).toEqual("* [ ] done\n");
});
