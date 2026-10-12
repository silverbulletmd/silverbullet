import { expect, test } from "vitest";
import {
  PERF_ENTRY_LIMIT,
  recordMark,
  recordMeasure,
  timedSpan,
} from "./perf.ts";

test("timedSpan records an sb: measure spanning the function", async () => {
  const result = await timedSpan("test-step", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return 42;
  });
  expect(result).toBe(42);
  const entries = performance.getEntriesByName("sb:test-step", "measure");
  expect(entries.length).toBe(1);
  expect(entries[0].duration).toBeGreaterThanOrEqual(15);
});

test("timedSpan records the span even when the function throws", async () => {
  await expect(
    timedSpan("test-throw", () => Promise.reject(new Error("boom"))),
  ).rejects.toThrow("boom");
  expect(performance.getEntriesByName("sb:test-throw", "measure").length).toBe(
    1,
  );
});

test("re-recording a mark or measure replaces the previous entry", async () => {
  recordMark("sb:test-repeat-mark");
  recordMark("sb:test-repeat-mark");
  expect(
    performance.getEntriesByName("sb:test-repeat-mark", "mark"),
  ).toHaveLength(1);
  await timedSpan("test-repeat-span", async () => {});
  await timedSpan("test-repeat-span", async () => {});
  expect(
    performance.getEntriesByName("sb:test-repeat-span", "measure"),
  ).toHaveLength(1);
});

test("distinct names are capped, oldest dropped first", () => {
  const names = Array.from(
    { length: PERF_ENTRY_LIMIT + 50 },
    (_, i) => `sb:test-cap:${i}`,
  );
  for (const name of names) recordMeasure(name, 0, 1);
  const kept = performance
    .getEntriesByType("measure")
    .filter((m) => m.name.startsWith("sb:test-cap:"));
  expect(kept.length).toBeLessThanOrEqual(PERF_ENTRY_LIMIT);
  expect(kept.some((m) => m.name === names.at(-1))).toBe(true);
  expect(kept.some((m) => m.name === names[0])).toBe(false);
});
