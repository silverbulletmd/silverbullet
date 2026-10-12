import { expect, test } from "vitest";
import { EventHook } from "./plugos/hooks/event.ts";
import { EventInterest } from "./event_interest.ts";
import type { System } from "./plugos/system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";

function newHook(): EventHook {
  const hook = new EventHook();
  hook.apply({
    loadedPlugs: new Map(),
    on: () => {},
  } as unknown as System<EventHookT>);
  return hook;
}

test("a name has one hook listener while held, none after the last release", async () => {
  const hook = newHook();
  const interest = new EventInterest(hook);
  const fired: string[] = [];
  const a = interest.listen(["x", "y"], (n) => fired.push(`a:${n}`));
  const b = interest.listen(["x"], (n) => fired.push(`b:${n}`));
  expect(hook.listenerCount()).toEqual({ names: 2, listeners: 2 });
  await hook.dispatchEvent("x");
  expect(fired).toEqual(["a:x", "b:x"]);
  a();
  a();
  expect(hook.listenerCount()).toEqual({ names: 1, listeners: 1 });
  b();
  expect(hook.listenerCount()).toEqual({ names: 0, listeners: 0 });
  expect(interest.size).toBe(0);
});

test("firedSince sees events on held names after the sequence was taken", async () => {
  const hook = newHook();
  const interest = new EventInterest(hook);
  const release = interest.listen(["x"]);
  const at = interest.seq();
  expect(interest.firedSince(at, ["x"])).toBe(false);
  await hook.dispatchEvent("x");
  expect(interest.firedSince(at, ["x"])).toBe(true);
  expect(interest.firedSince(interest.seq(), ["x"])).toBe(false);
  release();
  // Nothing holds it: no record kept
  expect(interest.firedSince(at, ["x"])).toBe(false);
});

test("a callback released while its event fires is not called afterwards", async () => {
  const hook = newHook();
  const interest = new EventInterest(hook);
  const calls: string[] = [];
  let releaseB = () => {};
  interest.listen(["x"], () => {
    calls.push("a");
    releaseB();
  });
  releaseB = interest.listen(["x"], () => calls.push("b"));
  await hook.dispatchEvent("x");
  await hook.dispatchEvent("x");
  expect(calls).toEqual(["a", "a"]);
});
