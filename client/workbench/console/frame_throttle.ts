type Schedule = (cb: () => void) => unknown;
type Cancel = (id: never) => void;

function defaultSchedule(cb: () => void): unknown {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(cb)
    : setTimeout(cb, 16);
}

function defaultCancel(id: never) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

// Runs fn at most once per frame, with the arguments of the latest call
export function frameThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  schedule: Schedule = defaultSchedule,
  cancel: Cancel = defaultCancel,
): { call: (...args: A) => void; cancel: () => void } {
  let pending: { args: A; id: unknown } | null = null;
  return {
    call: (...args: A) => {
      if (pending) {
        pending.args = args;
        return;
      }
      const p: { args: A; id: unknown } = { args, id: undefined };
      pending = p;
      p.id = schedule(() => {
        pending = null;
        fn(...p.args);
      });
    },
    cancel: () => {
      if (pending) cancel(pending.id as never);
      pending = null;
    },
  };
}
