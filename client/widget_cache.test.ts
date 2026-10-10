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
