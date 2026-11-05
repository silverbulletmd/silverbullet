import { expect, test } from "vitest";
import { Config } from "../../config.ts";
import { pinnedTags, togglePin } from "./pins.ts";

test("pinning appends a tag", () => {
  expect(togglePin(["page", "task"], "project")).toEqual([
    "page",
    "task",
    "project",
  ]);
});

test("unpinning removes only that tag", () => {
  expect(togglePin(["page", "task", "project"], "task")).toEqual([
    "page",
    "project",
  ]);
});

test("pins are read from config, nothing pinned when the option is missing", () => {
  expect(pinnedTags(new Config())).toEqual([]);
  const config = new Config();
  config.set("workbench.pinnedTags", ["task", "project"]);
  expect(pinnedTags(config)).toEqual(["task", "project"]);
});
