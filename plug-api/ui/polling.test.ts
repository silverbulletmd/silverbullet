// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePolling } from "./polling.ts";

function Poller({
  load,
  active,
}: {
  load: () => Promise<void>;
  active: boolean;
}) {
  usePolling(load, 2000, active);
  return null;
}

let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

function mount(load: () => Promise<void>, active: boolean) {
  void act(() => render(h(Poller, { load, active }), root));
}

test("loads every interval while active", async () => {
  const load = vi.fn(async () => {});
  mount(load, true);
  expect(load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4000);
  expect(load).toHaveBeenCalledTimes(3);
});

test("never loads after unmount", async () => {
  const load = vi.fn(async () => {});
  mount(load, true);
  await vi.advanceTimersByTimeAsync(2000);
  void act(() => render(null, root));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(load).toHaveBeenCalledTimes(1);
});

test("does not load while inactive, and stops when it becomes inactive", async () => {
  const load = vi.fn(async () => {});
  mount(load, false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(load).not.toHaveBeenCalled();
  mount(load, true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
  mount(load, false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(load).toHaveBeenCalledTimes(1);
});

test("skips ticks while the document is hidden", async () => {
  const load = vi.fn(async () => {});
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  mount(load, true);
  await vi.advanceTimersByTimeAsync(6000);
  expect(load).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
  visibility.mockRestore();
});

test("does not start a load while the previous one is still running", async () => {
  let finish = () => {};
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount(load, true);
  await vi.advanceTimersByTimeAsync(6000);
  expect(load).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(2);
});
