// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { widgetMenuEntries } from "./widget_menu.ts";

const base = {
  definition: false,
  open: false,
  edit: true,
  copy: true,
  bake: true,
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
