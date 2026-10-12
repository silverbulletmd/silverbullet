import { expect, test } from "vitest";
import { WidgetCache } from "./widget_cache.ts";

test("a prewarmed result keeps the event counts it was computed at, until invalidated", async () => {
  const cache = new WidgetCache({ set: async () => {} } as any);
  const at = new Map([["index", 2]]);
  await cache.prewarmResult(
    "k",
    async () => 1,
    () => at,
  );
  await cache.prewarmResult(
    "k",
    async () => 2,
    () => new Map(),
  );
  expect(cache.computedAt("k")).toBe(at);
  cache.invalidatePrewarm("k");
  expect(cache.computedAt("k")).toBeUndefined();
});

test("a prewarmed result keeps the triggers its computation found, until invalidated", async () => {
  const cache = new WidgetCache({ set: async () => {} } as any);
  await cache.prewarmResult("k", async (triggers) => {
    triggers.add("pageScope:changed:Budget");
    return 1;
  });
  // A cache hit doesn't run the computation, so it keeps the first triggers
  await cache.prewarmResult("k", async () => 2);
  expect(cache.triggers("k")).toEqual(["pageScope:changed:Budget"]);
  cache.invalidatePrewarm("k");
  expect(cache.triggers("k")).toEqual([]);
});
