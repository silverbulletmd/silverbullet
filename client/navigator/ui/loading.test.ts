import { afterEach, expect, test, vi } from "vitest";
import { LoadingState } from "./loading.ts";

afterEach(() => vi.useRealTimers());

test("delays visible loading and clears it when the current request settles", () => {
  vi.useFakeTimers();
  const state = new LoadingState();
  const changed = vi.fn();
  const unsubscribe = state.subscribe(changed);
  const request = state.begin();
  expect(state.pending).toBe(true);
  expect(state.visible).toBe(false);
  vi.advanceTimersByTime(149);
  expect(state.visible).toBe(false);
  vi.advanceTimersByTime(1);
  expect(state.visible).toBe(true);
  request.finish();
  expect(state.pending).toBe(false);
  expect(state.visible).toBe(false);
  expect(changed).toHaveBeenCalledTimes(3);
  unsubscribe();
});

test("only the latest request controls loading, even if an older request remains pending", () => {
  vi.useFakeTimers();
  const state = new LoadingState();
  const first = state.begin();
  const second = state.begin();
  first.finish();
  expect(state.pending).toBe(true);
  expect(first.isCurrent()).toBe(false);
  vi.advanceTimersByTime(150);
  expect(state.visible).toBe(true);
  const third = state.begin();
  third.finish();
  expect(state.pending).toBe(false);
  second.finish();
  expect(state.visible).toBe(false);
});

test("fast requests and cancellation never leave a delayed spinner behind", () => {
  vi.useFakeTimers();
  const state = new LoadingState();
  state.begin().finish();
  vi.advanceTimersByTime(200);
  expect(state.visible).toBe(false);
  const request = state.begin();
  state.cancel();
  expect(request.isCurrent()).toBe(false);
  vi.advanceTimersByTime(200);
  expect(state.pending).toBe(false);
  expect(state.visible).toBe(false);
});
