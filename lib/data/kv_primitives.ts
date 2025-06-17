import type { KV, KvKey } from "../../type/datastore.ts";

export type KvQueryOptions = {
  prefix?: KvKey;
};

export interface KvPrimitives {
  batchGet(keys: KvKey[]): Promise<(any | undefined)[]>;

  batchSet(entries: KV[]): Promise<void>;

  batchDelete(keys: KvKey[]): Promise<void>;

  query(options: KvQueryOptions): AsyncIterableIterator<KV>;

  // Completely clear all data from this datastore
  clear(): Promise<void>;

  close(): void;
}
