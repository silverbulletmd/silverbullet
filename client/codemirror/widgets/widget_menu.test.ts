// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { widgetMenuEntries } from "./widget_menu.ts";

const base = {
  definition: false,
  open: false,
  edit: true,
  query: false,
  copy: true,
  bake: true,
  remove: false,
};
const labels = (caps: any) =>
  widgetMenuEntries(caps).map((e) =>
    e.kind === "item" ? e.label : e.kind === "separator" ? "—" : e.text,
  );

test("a plain ${…} widget", () => {
  expect(labels(base)).toEqual([
    "Edit source",
    "Reload",
    "Copy as Markdown",
    "—",
    "Bake into page",
  ]);
});

test("a query widget offers the query builder after Edit source", () => {
  expect(labels({ ...base, query: true }).slice(0, 2)).toEqual([
    "Edit source",
    "Edit in query builder",
  ]);
});

test("the menu has no live entries and always says Reload", () => {
  const texts = labels(base);
  expect(texts).toContain("Reload");
  expect(texts.join(" ")).not.toMatch(/live|static|Reload now/i);
});

test("an HTML-only widget in read-only mode", () => {
  expect(labels({ ...base, copy: false, bake: false })).toEqual([
    "Edit source",
    "Reload",
  ]);
});

test("a deletable object ends with Delete, apart from the rest", () => {
  expect(labels({ ...base, copy: false, bake: false, remove: true })).toEqual([
    "Edit source",
    "Reload",
    "—",
    "Delete",
  ]);
});
