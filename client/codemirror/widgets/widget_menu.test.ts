// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type WidgetCaps, widgetMenuEntries } from "./widget_menu.ts";

const base: WidgetCaps = {
  definition: false,
  open: false,
  edit: true,
  copy: true,
  remove: false,
};
const labels = (caps: WidgetCaps) =>
  widgetMenuEntries(caps).map((e) =>
    e.kind === "separator" ? "—" : e.kind === "info" ? e.text : e.label,
  );

test("a code widget", () => {
  expect(labels(base)).toEqual(["Edit source", "Copy as Markdown"]);
});

test("an HTML-only widget in read-only mode", () => {
  expect(labels({ ...base, edit: false, copy: false })).toEqual([]);
});

test("a deletable object ends with Delete, apart from the rest", () => {
  expect(labels({ ...base, copy: false, remove: true })).toEqual([
    "Edit source",
    "—",
    "Delete",
  ]);
});
