// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { triggerPhrase, widgetMenuEntries } from "./widget_menu.ts";

const base = {
  definition: false,
  open: false,
  edit: true,
  copy: true,
  bake: true,
  toggleLive: "makeLive",
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
    "Make live",
  ]);
});

test("a live widget leads with what it reacts to", () => {
  expect(
    labels({ ...base, live: ["index"], toggleLive: "makeStatic" }),
  ).toEqual([
    "Live · re-runs when the index changes",
    "Edit source",
    "Reload now",
    "Copy as Markdown",
    "—",
    "Bake into page",
    "Make static",
  ]);
});

test("an HTML-only widget in read-only mode", () => {
  expect(
    labels({ ...base, copy: false, bake: false, toggleLive: undefined }),
  ).toEqual(["Edit source", "Reload"]);
});

test("trigger phrases", () => {
  expect(triggerPhrase(["index", "edit"])).toBe(
    "the index changes or this page is edited",
  );
  expect(triggerPhrase(["navigate", "index", "my:event"])).toBe(
    'you open another page, the index changes or "my:event" fires',
  );
});
