import { KV, KvKey, KvValue } from "$sb/types.ts";

export type KvQueryOptions = {
  prefix?: KvKey;
};

export interface KvPrimitives {
  batchGet(keys: KvKey[]): Promise<(KvValue | undefined)[]>;
  batchSet(entries: KV[]): Promise<void>;
  batchDelete(keys: KvKey[]): Promise<void>;
  query(options: KvQueryOptions): AsyncIterableIterator<KV>;
}
