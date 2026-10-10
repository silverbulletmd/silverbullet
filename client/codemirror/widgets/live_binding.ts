import { subscribeRefresh } from "../../navigator/page_widget_logic.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";
import type { EventHook } from "../../plugos/hooks/event.ts";

type EventCounts = Map<string, number>;

// One shared counting listener per event name, so a remounted live widget can
// tell whether its cached result missed an event while it was unmounted.
const counts = new WeakMap<EventHook, EventCounts>();

function countsFor(hook: EventHook): EventCounts {
  let c = counts.get(hook);
  if (!c) {
    c = new Map();
    counts.set(hook, c);
  }
  return c;
}

/** Starts counting `names` (once per name). */
function countEvents(hook: EventHook, names: string[]): void {
  const c = countsFor(hook);
  for (const name of names) {
    if (c.has(name)) continue;
    c.set(name, 0);
    hook.addLocalListener(name, () => c.set(name, (c.get(name) ?? 0) + 1));
  }
}

export function snapshotEventCounts(hook: EventHook): EventCounts {
  return new Map(countsFor(hook));
}

/** Whether any of `names` fired since `at` was taken. */
function eventsSince(
  hook: EventHook,
  at: EventCounts,
  names: string[],
): boolean {
  const c = countsFor(hook);
  return names.some((n) => (c.get(n) ?? 0) > (at.get(n) ?? 0));
}

const deferred = new Map<object, () => void>();
let listening = false;

/** Runs `run` once the tab is visible again (latest call per owner wins). */
function runWhenVisible(owner: object, run: () => void): void {
  deferred.set(owner, run);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const runs = [...deferred.values()];
    deferred.clear();
    for (const r of runs) r();
  });
}

function cancelWhenVisible(owner: object): void {
  deferred.delete(owner);
}

/**
 * A live widget's subscription to its triggers: runs it on them, and holds the
 * run while the tab is hidden.
 */
export class LiveBinding {
  private unsubscribe?: () => void;

  constructor(
    private readonly hook: EventHook,
    private readonly run: () => void,
  ) {}

  /**
   * Subscribes to `triggers`, replacing the previous subscription. True when
   * a result computed at `computedAt` already missed one of them.
   */
  bind(
    triggers: string[] | undefined,
    computedAt?: Map<string, number>,
  ): boolean {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (!triggers?.length) return false;
    const events = expandRefreshTriggers(triggers);
    this.unsubscribe = subscribeRefresh(this.hook, events, () =>
      this.trigger(),
    );
    countEvents(this.hook, events);
    return !!computedAt && eventsSince(this.hook, computedAt, events);
  }

  trigger(): void {
    if (document.hidden) {
      runWhenVisible(this, () => this.trigger());
      return;
    }
    this.run();
  }

  dispose(): void {
    this.bind(undefined);
    cancelWhenVisible(this);
  }
}
