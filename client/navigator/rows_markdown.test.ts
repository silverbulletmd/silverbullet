import { expect, test } from "vitest";
import { rowsToMarkdown } from "./rows_markdown.ts";

const row = (obj: any, cells?: unknown[]) => ({
  obj,
  primary: obj.name,
  cells,
});

test("tables copy as GFM, lists as bullets", () => {
  const rows = [
    row({ name: "Alpha task", done: false }),
    row({ name: "Beta | task", done: true }),
  ];
  expect(rowsToMarkdown(rows, { mode: "table" })).toBe(
    "|name|done|\n|--|--|\n|Alpha task|false|\n|Beta \\| task|true|",
  );
  expect(
    rowsToMarkdown(rows, {
      mode: "table",
      columns: [{ label: "Task", attribute: "name" }],
    }),
  ).toBe("|Task|\n|--|\n|Alpha task|\n|Beta \\| task|");
  expect(rowsToMarkdown(rows, { mode: "list" })).toBe(
    "* Alpha task\n* Beta | task",
  );
});

test("table copy keeps pipes inside wiki links and attributes", () => {
  const rows = [row({ name: "[[Projects/Sketchbook|Sketchbook]] [due: a|b]" })];
  expect(rowsToMarkdown(rows, { mode: "table" })).toBe(
    "|name|\n|--|\n|[[Projects/Sketchbook|Sketchbook]] [due: a|b]|",
  );
});

test("list rows never copy as `undefined` and stay one line each", () => {
  const rows = [
    { obj: {}, primary: undefined as unknown as string },
    row({ name: "Alpha\ntask" }),
  ];
  expect(rowsToMarkdown(rows, { mode: "list" })).toBe("* \n* Alpha task");
});

test("tree rows copy as a nested list, folders included", () => {
  const rows = [
    row({ name: "Projects/Sketchbook" }),
    row({ name: "Projects/Sketchbook/Alpha task" }),
    row({ name: "Inbox" }),
  ];
  const hierarchy = { field: "name", separator: "/" };
  expect(rowsToMarkdown(rows, { mode: "tree", hierarchy })).toBe(
    ["* Projects", "  * Sketchbook", "    * Alpha task", "* Inbox"].join("\n"),
  );
});
