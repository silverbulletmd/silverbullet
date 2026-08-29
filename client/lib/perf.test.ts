import { expect, test } from "vitest";
import { timedSpan } from "./perf.ts";

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
