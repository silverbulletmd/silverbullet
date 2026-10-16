import { afterEach, expect, test, vi } from "vitest";
import { frameThrottle } from "./frame_throttle.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("coalesces calls into one per frame with the latest value", () => {
  vi.useFakeTimers();
  const seen: number[] = [];
  const t = frameThrottle(
    (n: number) => seen.push(n),
    (cb) => setTimeout(cb, 16),
  );
  t.call(1);
  t.call(2);
  t.call(3);
  expect(seen).toEqual([]);
  vi.advanceTimersByTime(16);
  expect(seen).toEqual([3]);
  t.call(4);
  vi.advanceTimersByTime(16);
  expect(seen).toEqual([3, 4]);
  vi.advanceTimersByTime(100);
  expect(seen).toEqual([3, 4]);
});

test("cancel drops a pending call", () => {
  vi.useFakeTimers();
  const seen: number[] = [];
  const t = frameThrottle(
    (n: number) => seen.push(n),
    (cb) => setTimeout(cb, 16),
    (id) => clearTimeout(id),
  );
  t.call(1);
  t.cancel();
  vi.advanceTimersByTime(100);
  expect(seen).toEqual([]);
});
