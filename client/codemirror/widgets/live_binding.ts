import type { EventInterest } from "../../event_interest.ts";
import { REFRESH_DEBOUNCE_MS } from "../../navigator/page_widget_logic.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";

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
  private release?: () => void;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly interest: EventInterest,
    private readonly run: () => void,
  ) {}

  /**
   * Subscribes to `triggers`, replacing the previous subscription. True when
   * a result computed at `computedAt` already missed one of them.
   */
  bind(triggers: string[] | undefined, computedAt?: number): boolean {
    this.release?.();
    this.release = undefined;
    clearTimeout(this.timer);
    if (!triggers?.length) return false;
    const events = expandRefreshTriggers(triggers);
    this.release = this.interest.listen(events, () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.trigger(), REFRESH_DEBOUNCE_MS);
    });
    return (
      computedAt !== undefined && this.interest.firedSince(computedAt, events)
    );
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
