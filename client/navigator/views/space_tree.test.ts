import { expect, test } from "vitest";
import { withFolderRows } from "./space_tree.ts";

const names = (rows: { name: string; isFolder?: boolean }[]) =>
  rows.map(({ name, isFolder }) => (isFolder ? `${name}/` : name));

test("only folders nothing else shows get a row of their own", () => {
  const contents = [{ name: "Projects/Plan" }, { name: "index" }];
  expect(
    names(withFolderRows(contents, ["Projects", "Archive", "Raw", "Raw/2026"])),
  ).toEqual(["Projects/Plan", "index", "Archive/", "Raw/2026/"]);
});

test("a page heading an empty folder is marked as one", () => {
  const contents = [{ name: "Journal", ref: "Journal" }];
  expect(withFolderRows(contents, ["Journal"])).toEqual([
    { name: "Journal", ref: "Journal", isFolder: true },
  ]);
});

test("without folders the contents pass through untouched", () => {
  const contents = [{ name: "index" }];
  expect(withFolderRows(contents, [])).toBe(contents);
});
