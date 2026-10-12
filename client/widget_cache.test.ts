import { expect, test } from "vitest";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventInterest } from "./event_interest.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { System } from "./plugos/system.ts";
import { WidgetCache } from "./widget_cache.ts";

const setup = () => {
  const hook = new EventHook();
  new System<EventHookT>(undefined).addHook(hook);
  const interest = new EventInterest(hook);
  const cache = new WidgetCache({} as any, interest);
  return { hook, interest, cache };
};

test("a prewarmed result keeps the triggers its computation found, until invalidated", async () => {
  const { cache } = setup();
  await cache.prewarmResult("k", async (track) => {
    track("pageScope:changed:Budget");
    return 1;
  });
  // A cache hit doesn't run the computation, so it keeps the first triggers
  await cache.prewarmResult("k", async () => 2);
  expect(cache.triggers("k")).toEqual(["pageScope:changed:Budget"]);
  cache.invalidatePrewarm("k");
  expect(cache.triggers("k")).toEqual([]);
  expect(cache.computedAt("k")).toBeUndefined();
});

test("a cached result holds what it tracked until it is removed", async () => {
  const { hook, interest, cache } = setup();
  await cache.prewarmResult("k", async (track) => {
    track("index:tag:task");
    track("edit");
    return 1;
  });
  expect(cache.triggers("k")).toEqual(["index:tag:task", "edit"]);
  // index:tag:task, editor:pageModified
  expect(hook.listenerCount().names).toBe(2);
  cache.invalidatePrewarm("k");
  expect(hook.listenerCount()).toEqual({ names: 0, listeners: 0 });
  expect(interest.size).toBe(0);
});

test("computedAt lets a remount see an event fired after the read", async () => {
  const { hook, interest, cache } = setup();
  await cache.prewarmResult("k", async (track) => {
    track("x");
    return 1;
  });
  const at = cache.computedAt("k")!;
  expect(interest.firedSince(at, ["x"])).toBe(false);
  await hook.dispatchEvent("x");
  expect(interest.firedSince(at, ["x"])).toBe(true);
});

test("the prewarm cache is bounded and eviction releases", async () => {
  const { hook, cache } = setup();
  for (let i = 0; i < 1001; i++) {
    await cache.prewarmResult(`k${i}`, async (track) => {
      track(`e${i}`);
      return i;
    });
  }
  expect(cache.prewarmSize).toBe(1000);
  expect(hook.listenerCount().names).toBe(1000);
});

test("sweep drops entries no widget asked for since the previous sweep", async () => {
  const { cache } = setup();
  await cache.prewarmResult("old", async () => 1);
  cache.sweepPrewarm();
  await cache.prewarmResult("kept", async () => 2);
  cache.sweepPrewarm();
  expect(cache.computedAt("old")).toBeUndefined();
  expect(cache.prewarmSize).toBe(1);
});

test("clearPrewarm releases everything", async () => {
  const { hook, cache } = setup();
  await cache.prewarmResult("a", async (track) => {
    track("x");
    return 1;
  });
  cache.clearPrewarm();
  expect(hook.listenerCount().names).toBe(0);
});

test("a read reported after its entry was dropped holds nothing", async () => {
  const { hook, cache } = setup();
  let track: ((e: string) => void) | undefined;
  let finish = () => {};
  const done = cache.prewarmResult("k", (t) => {
    track = t;
    return new Promise<number>((resolve) => {
      finish = () => resolve(1);
    });
  });
  cache.invalidatePrewarm("k");
  track!("late");
  finish();
  await done;
  expect(hook.listenerCount()).toEqual({ names: 0, listeners: 0 });
});
