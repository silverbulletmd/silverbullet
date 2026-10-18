import { expect, test } from "vitest";
import {
  followsEditor,
  panelViewMeta,
  validatePanelView,
} from "./plug_views.ts";

test("a declaration needs a name and a title", () => {
  expect(validatePanelView({ name: "example.map", title: "Map" })).toEqual([]);
  expect(validatePanelView({ title: "Map" })).toEqual(["view: needs a name"]);
  expect(validatePanelView("example.map")).toHaveLength(1);
});

test("docks and tabs are checked", () => {
  expect(
    validatePanelView({
      name: "example.map",
      title: "Map",
      dock: "page-top",
      supportedDocks: ["modal", "floating"],
      tabs: [{ label: "" }],
    }),
  ).toEqual([
    "view: dock must be one of modal, lhs, rhs, bhs",
    "view: supportedDocks must list docks among modal, lhs, rhs, bhs",
    "view: tabs must be a list of { label } entries",
  ]);
});

test("meta: a filterless view in its dock, with its tabs as segments", () => {
  const meta = panelViewMeta({
    name: "example.map",
    title: "Map",
    dock: "rhs",
    tabs: [{ label: "Near" }, { label: "All" }],
  });
  expect(meta).toMatchObject({
    name: "example.map",
    title: "Map",
    dock: "rhs",
    supportedDocks: ["rhs"],
    noFilter: true,
  });
  expect(meta.segments?.map((s) => [s.label, s.default])).toEqual([
    ["Near", true],
    ["All", false],
  ]);
});

test("meta: the modal by default, without segments when there are no tabs", () => {
  const meta = panelViewMeta({ name: "example.map", title: "Map" });
  expect(meta.dock).toBe("modal");
  expect(meta.supportedDocks).toEqual(["modal"]);
  expect(meta.segments).toBeUndefined();
});

test("a tab's own followEditor wins over the view's", () => {
  const def = {
    name: "example.map",
    title: "Map",
    followEditor: true,
    tabs: [{ label: "Near" }, { label: "All", followEditor: false }],
  };
  expect(followsEditor(def, "Near")).toBe(true);
  expect(followsEditor(def, "All")).toBe(false);
  expect(followsEditor({ name: "x", title: "X" })).toBe(false);
});
