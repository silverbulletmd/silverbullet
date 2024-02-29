/// <reference lib="deno.unstable" />

import { KV, KvKey } from "../../plug-api/types.ts";
import { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

const kvBatchSize = 100;

export class DenoKvPrimitives implements KvPrimitives {
  constructor(private db: Deno.Kv) {
  }

  async batchGet(keys: KvKey[]): Promise<any[]> {
    const results: any[] = [];
    const batches: Deno.KvKey[][] = [];
    for (let i = 0; i < keys.length; i += kvBatchSize) {
      batches.push(keys.slice(i, i + kvBatchSize));
    }
    for (const batch of batches) {
      const res = await this.db.getMany(batch);
      results.push(...res.map((r) => r.value === null ? undefined : r.value));
    }
    return results;
  }
  async batchSet(entries: KV[]): Promise<void> {
    // Split into batches of kvBatchSize
    const batches: KV[][] = [];
    for (let i = 0; i < entries.length; i += kvBatchSize) {
      batches.push(entries.slice(i, i + kvBatchSize));
    }
    for (const batch of batches) {
      let batchOp = this.db.atomic();
      for (const { key, value } of batch) {
        batchOp = batchOp.set(key, value);
      }
      const res = await batchOp.commit();
      if (!res.ok) {
        throw res;
      }
    }
  }
  async batchDelete(keys: KvKey[]): Promise<void> {
    const batches: KvKey[][] = [];
    for (let i = 0; i < keys.length; i += kvBatchSize) {
      batches.push(keys.slice(i, i + kvBatchSize));
    }
    for (const batch of batches) {
      let batchOp = this.db.atomic();
      for (const key of batch) {
        batchOp = batchOp.delete(key);
      }
      const res = await batchOp.commit();
      if (!res.ok) {
        throw res;
      }
    }
  }
  async *query({ prefix }: KvQueryOptions): AsyncIterableIterator<KV> {
    prefix = prefix || [];
    for await (
      const result of this.db.list({ prefix: prefix as Deno.KvKey })
    ) {
      yield { key: result.key as KvKey, value: result.value as any };
    }
  }

  close() {
    this.db.close();
  }
}
