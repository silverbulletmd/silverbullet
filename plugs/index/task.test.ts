import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { expect, test } from "vitest";
import { addParentPointers, renderToText } from "../../plug-api/lib/tree.ts";
import { completeStates, removeCompletedTasksFromTree } from "./task.ts";

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
