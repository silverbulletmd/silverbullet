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
    performance.measure(`sb:${name}`, { start, end: performance.now() });
  }
}
