import { LimitedMap } from "./limited_map.ts";

const cache = new LimitedMap<any>(50);

export async function ttlCache<K, V>(
  key: K,
  fn: (key: K) => Promise<V>,
  ttlSecs?: number,
): Promise<V> {
  if (!ttlSecs) {
    return fn(key);
  }
  const serializedKey = JSON.stringify(key);
  const cached = cache.get(serializedKey);
  if (cached) {
    return cached;
  }
  const result = await fn(key);
  cache.set(serializedKey, result, ttlSecs * 1000);
  return result;
}
