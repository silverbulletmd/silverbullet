// Marks and measures are recorded on every navigation and widget render: the
// timeline keeps one entry per name and at most this many names, oldest first
// out, so it can't grow for as long as the tab stays open.
export const PERF_ENTRY_LIMIT = 300;

const recorded = new Map<string, "mark" | "measure">();

function clear(name: string, kind: "mark" | "measure") {
  if (kind === "mark") performance.clearMarks(name);
  else performance.clearMeasures(name);
}

function remember(name: string, kind: "mark" | "measure") {
  const previous = recorded.get(name);
  if (previous) clear(name, previous);
  recorded.delete(name);
  recorded.set(name, kind);
  if (recorded.size > PERF_ENTRY_LIMIT) {
    const [oldest, oldestKind] = recorded.entries().next().value!;
    recorded.delete(oldest);
    clear(oldest, oldestKind);
  }
}

/** A `performance.mark`, replacing an earlier one of the same name. */
export function recordMark(name: string): void {
  remember(name, "mark");
  performance.mark(name);
}

/** A `performance.measure`, replacing an earlier one of the same name. */
export function recordMeasure(name: string, start: number, end: number): void {
  remember(name, "measure");
  performance.measure(name, { start, end });
}

/**
 * Wraps an async step in a `performance.measure` span named `sb:<name>`, so
 * boot phases show up in the DevTools Performance panel and can be read back
 * via performance.getEntriesByType("measure").
 */
export async function timedSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    recordMeasure(`sb:${name}`, start, performance.now());
  }
}
