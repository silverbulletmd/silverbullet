import { expect, test } from "vitest";
import { indexSyscalls } from "./index.ts";
import { spaceReadSyscalls } from "./space.ts";
import { editorSyscalls } from "./editor.ts";

const dep = (mapping: any, name: string, ...args: any[]) =>
  mapping[name].dependsOn(...args);

test("index reads depend on their tag", () => {
  const m = indexSyscalls({} as any, {} as any);
  expect(dep(m, "index.tag", "task")).toEqual(["index:tag:task"]);
  expect(dep(m, "index.objects", "page")).toEqual(["index:tag:page"]);
  expect(dep(m, "index.tasks", "urgent")).toEqual(["index:tag:task"]);
  expect(dep(m, "index.pages")).toEqual(["index:tag:page"]);
  expect(dep(m, "index.queryLuaObjects", "item", {})).toEqual([
    "index:tag:item",
  ]);
  expect(dep(m, "index.getObjectByRef", "P", "header", "r")).toEqual([
    "index:tag:header",
  ]);
  expect(dep(m, "index.tags")).toEqual(["index"]);
});

test("space reads depend on their file", () => {
  const m = spaceReadSyscalls({} as any);
  expect(dep(m, "space.readPage", "Note")).toEqual(["file:changed:Note.md"]);
  expect(dep(m, "space.getPageMeta", "Note")).toEqual(["file:changed:Note.md"]);
  expect(dep(m, "space.readFile", "a.txt")).toEqual(["file:changed:a.txt"]);
  expect(dep(m, "space.listPages")).toEqual(["index"]);
});

test("editor reads depend on edits and navigation", () => {
  const m = editorSyscalls({} as any);
  expect(dep(m, "editor.getText")).toEqual(["edit"]);
  expect(dep(m, "editor.getCurrentPage")).toEqual(["navigate"]);
  // Indexed meta: a save that changes the open page's tags re-runs readers
  expect(dep(m, "editor.getCurrentPageMeta")).toEqual([
    "navigate",
    "index:tag:page",
  ]);
});
