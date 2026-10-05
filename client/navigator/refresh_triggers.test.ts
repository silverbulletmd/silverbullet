import { expect, test } from "vitest";
import { expandRefreshTriggers } from "./refresh_triggers.ts";

test("each trigger name expands to its events", () => {
  expect(expandRefreshTriggers(["index"])).toEqual([
    "file:changed",
    "file:deleted",
    "mq:emptyQueue:indexQueue",
  ]);
  expect(expandRefreshTriggers(["navigate"])).toEqual([
    "editor:pageLoaded",
    "editor:documentLoaded",
  ]);
  expect(expandRefreshTriggers(["edit"])).toEqual(["editor:pageModified"]);
});

test("other entries are event names, mixed lists de-duplicate", () => {
  expect(
    expandRefreshTriggers(["navigate", "fixture:changed", "editor:pageLoaded"]),
  ).toEqual(["editor:pageLoaded", "editor:documentLoaded", "fixture:changed"]);
  expect(expandRefreshTriggers(["constructor"])).toEqual(["constructor"]);
});
