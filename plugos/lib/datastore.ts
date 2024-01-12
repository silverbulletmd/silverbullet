import { KV, KvKey, KvQuery } from "$sb/types.ts";

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export interface DataStore {
  get<T = any>(key: KvKey): Promise<T | null>;
  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]>;
  set(key: KvKey, value: any): Promise<void>;
  batchSet<T = any>(entries: KV<T>[]): Promise<void>;
  delete(key: KvKey): Promise<void>;
  batchDelete(keys: KvKey[]): Promise<void>;
  query<T = any>(query: KvQuery): Promise<KV<T>[]>;
  queryDelete(query: KvQuery): Promise<void>;
}
