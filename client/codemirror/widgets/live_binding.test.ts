// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventHook } from "../../plugos/hooks/event.ts";
import { System } from "../../plugos/system.ts";
import { EventInterest } from "../../event_interest.ts";
import { LiveBinding } from "./live_binding.ts";

const newHook = () => {
  const hook = new EventHook();
  new System<EventHookT>(undefined).addHook(hook);
  return hook;
};

test("bind subscribes expanded triggers; dispose removes every listener", async () => {
  vi.useFakeTimers();
  try {
    const hook = newHook();
    const interest = new EventInterest(hook);
    const run = vi.fn();
    const b = new LiveBinding(interest, run);
    b.bind(["edit", "index:tag:task"]);
    await hook.dispatchEvent("index:tag:task");
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    b.dispose();
    expect(hook.listenerCount()).toEqual({ names: 0, listeners: 0 });
  } finally {
    vi.useRealTimers();
  }
});

test("bind reports a missed event since computedAt", async () => {
  const hook = newHook();
  const interest = new EventInterest(hook);
  const hold = interest.listen(["x"]);
  const at = interest.seq();
  await hook.dispatchEvent("x");
  const b = new LiveBinding(interest, () => {});
  expect(b.bind(["x"], at)).toBe(true);
  b.dispose();
  hold();
});
