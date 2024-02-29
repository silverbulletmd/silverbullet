import { KV, KvKey } from "../../plug-api/types.ts";

export type KvQueryOptions = {
  prefix?: KvKey;
};

export interface KvPrimitives {
  batchGet(keys: KvKey[]): Promise<(any | undefined)[]>;
  batchSet(entries: KV[]): Promise<void>;
  batchDelete(keys: KvKey[]): Promise<void>;
  query(options: KvQueryOptions): AsyncIterableIterator<KV>;
  close(): void;
}
