import { describe, expect, test } from "vitest";
import {
  awaitRenderSettled,
  renderBusySelector,
  trackRender,
} from "./render_settle.ts";

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("awaitRenderSettled", () => {
  test("settles once nothing is rendering", async () => {
    expect(
      await awaitRenderSettled({ nextFrame: frame, timeoutMs: 1000 }),
    ).toBe(true);
  });

  test("waits for a tracked render to finish", async () => {
    const render = deferred();
    void trackRender(render.promise);
    let settled = false;
    const waiting = awaitRenderSettled({
      nextFrame: frame,
      timeoutMs: 1000,
    }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    render.resolve();
    expect(await waiting).toBe(true);
  });

  test("waits for a render that starts while it is waiting for quiet frames", async () => {
    const late = deferred();
    let frames = 0;
    let lateFinished = false;
    const result = await awaitRenderSettled({
      nextFrame: async () => {
        frames++;
        if (frames === 1) {
          // A widget scrolled into view by the first measure pass
          void trackRender(late.promise);
          setTimeout(() => {
            lateFinished = true;
            late.resolve();
          }, 20);
        }
        await frame();
      },
      timeoutMs: 1000,
    });
    expect(result).toBe(true);
    expect(lateFinished).toBe(true);
  });

  test("waits for the client to be ready first", async () => {
    const ready = deferred();
    let settled = false;
    const waiting = awaitRenderSettled({
      ready: ready.promise,
      nextFrame: frame,
      timeoutMs: 1000,
    }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    ready.resolve();
    await waiting;
    expect(settled).toBe(true);
  });

  test("waits while the page still shows busy elements", async () => {
    let busyChecks = 0;
    const result = await awaitRenderSettled({
      isBusy: () => ++busyChecks < 5,
      nextFrame: frame,
      timeoutMs: 1000,
    });
    expect(result).toBe(true);
    expect(busyChecks).toBeGreaterThanOrEqual(5);
  });

  test("a failed render counts as finished", async () => {
    const render = deferred();
    void trackRender(render.promise).catch(() => {});
    render.reject(new Error("widget failed"));
    expect(
      await awaitRenderSettled({ nextFrame: frame, timeoutMs: 1000 }),
    ).toBe(true);
  });

  test("gives up with false when rendering does not settle in time", async () => {
    const stuck = deferred();
    void trackRender(stuck.promise);
    expect(await awaitRenderSettled({ nextFrame: frame, timeoutMs: 50 })).toBe(
      false,
    );
    stuck.resolve();
    await stuck.promise;
  });
});

test("busy selector covers loading placeholders, busy views and unsettled page slots", () => {
  expect(renderBusySelector).toContain(".sb-loading-widget");
  expect(renderBusySelector).toContain('[aria-busy="true"]');
  expect(renderBusySelector).toContain('.sb-page-slot:not([data-settled="1"])');
});
