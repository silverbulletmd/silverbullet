export const BUDGET_TICKS = 5000;
export const YIELD_AFTER_MS = 500;
export const YIELD_EVERY_MS = 50;
export const YIELD_COUNT_LIMIT = 200;
export const BUSY_LIMIT_DEFAULT_MS = 2000;
export const BUSY_LIMIT_COMMAND_MS = 10000;
export const KEEP_GOING_MS = 10000;

export class LuaBudgetStopped extends Error {
  constructor() {
    super("Script stopped by the user");
    this.name = "LuaBudgetStopped";
  }
}

export type LuaBudget = {
  ticks: number;
  lastCheck: number;
  lastYield: number;
  busyMs: number;
  yieldCount: number;
  awaited: boolean;
  stopped: boolean;
  /** Set once the invocation this budget was created for has completed. */
  finished: boolean;
  limitReported: boolean;
  busyLimitMs: number;
  yieldAfterMs: number;
  onLimit: ((b: LuaBudget) => void) | undefined;
  now: () => number;
  doYield: () => Promise<void>;
};

export function macrotaskYield(): Promise<void> {
  // Do NOT use scheduler.yield() here: it resumes at a *higher* priority than
  // ordinary tasks, so it never lets timers/input/rendering run and defeats
  // the whole point of yielding. MessageChannel posts a genuine macrotask.
  if (typeof MessageChannel === "function") {
    return new Promise<void>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(undefined);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function makeLuaBudget(
  opts: Partial<
    Pick<
      LuaBudget,
      "busyLimitMs" | "yieldAfterMs" | "onLimit" | "now" | "doYield"
    >
  > = {},
): LuaBudget {
  const now = opts.now ?? (() => performance.now());
  return {
    ticks: BUDGET_TICKS,
    lastCheck: now(),
    lastYield: now(),
    busyMs: 0,
    yieldCount: 0,
    awaited: false,
    stopped: false,
    finished: false,
    limitReported: false,
    busyLimitMs: opts.busyLimitMs ?? BUSY_LIMIT_DEFAULT_MS,
    yieldAfterMs: opts.yieldAfterMs ?? YIELD_AFTER_MS,
    onLimit: opts.onLimit,
    now,
    doYield: opts.doYield ?? macrotaskYield,
  };
}

export function budgetTick(b: LuaBudget): Promise<void> | undefined {
  if (b.stopped) {
    throw new LuaBudgetStopped();
  }
  b.ticks = BUDGET_TICKS;

  const now = b.now();
  const sinceCheck = now - b.lastCheck;
  b.lastCheck = now;
  if (b.awaited) {
    b.awaited = false;
  } else {
    b.busyMs += sinceCheck;
  }

  if (
    !b.limitReported &&
    (b.busyMs >= b.busyLimitMs || b.yieldCount >= YIELD_COUNT_LIMIT)
  ) {
    b.limitReported = true;
    b.onLimit?.(b);
  }

  const threshold = b.yieldCount === 0 ? b.yieldAfterMs : YIELD_EVERY_MS;
  if (now - b.lastYield < threshold) {
    return undefined;
  }
  b.lastYield = now;
  b.yieldCount++;
  // The event-loop turn spent yielding (rendering, sync, other scripts) must
  // not be billed to this script's busyMs at the next tick, so re-read the
  // clock on resume rather than trusting the pre-yield lastCheck.
  return b.doYield().then(() => {
    b.lastCheck = b.now();
  });
}
