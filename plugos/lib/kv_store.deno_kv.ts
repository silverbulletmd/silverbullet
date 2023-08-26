/// <reference lib="deno.unstable" />

import { KV, KVStore } from "./kv_store.ts";

const kvBatchSize = 10;

export class DenoKVStore implements KVStore {
  kv!: Deno.Kv;
  path: string | undefined;

  async init(path?: string) {
    this.path = path;
    this.kv = await Deno.openKv(path);
  }

  close() {
    this.kv.close();
  }

  async delete() {
    this.kv.close();
    if (this.path) {
      await Deno.remove(this.path);
    }
  }

  del(key: string): Promise<void> {
    return this.batchDelete([key]);
  }
  async deletePrefix(prefix: string): Promise<void> {
    const allKeys: string[] = [];
    for await (
      const result of this.kv.list(
        prefix
          ? {
            start: [prefix],
            end: [endRange(prefix)],
          }
          : { prefix: [] },
      )
    ) {
      allKeys.push(result.key[0] as string);
    }
    return this.batchDelete(allKeys);
  }
  deleteAll(): Promise<void> {
    return this.deletePrefix("");
  }
  set(key: string, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }
  async batchSet(kvs: KV[]): Promise<void> {
    // Split into batches of kvBatchSize
    const batches: KV[][] = [];
    for (let i = 0; i < kvs.length; i += kvBatchSize) {
      batches.push(kvs.slice(i, i + kvBatchSize));
    }
    for (const batch of batches) {
      let batchOp = this.kv.atomic();
      for (const { key, value } of batch) {
        batchOp = batchOp.set([key], value);
      }
      const res = await batchOp.commit();
      if (!res.ok) {
        throw res;
      }
    }
  }
  async batchDelete(keys: string[]): Promise<void> {
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += kvBatchSize) {
      batches.push(keys.slice(i, i + kvBatchSize));
    }
    for (const batch of batches) {
      let batchOp = this.kv.atomic();
      for (const key of batch) {
        batchOp = batchOp.delete([key]);
      }
      const res = await batchOp.commit();
      if (!res.ok) {
        throw res;
      }
    }
  }
  async batchGet(keys: string[]): Promise<any[]> {
    const results: any[] = [];
    const batches: Deno.KvKey[][] = [];
    for (let i = 0; i < keys.length; i += kvBatchSize) {
      batches.push(keys.slice(i, i + kvBatchSize).map((k) => [k]));
    }
    for (const batch of batches) {
      const res = await this.kv.getMany(batch);
      results.push(...res.map((r) => r.value));
    }
    return results;
  }
  async get(key: string): Promise<any> {
    return (await this.kv.get([key])).value;
  }
  async has(key: string): Promise<boolean> {
    return (await this.kv.get([key])).value !== null;
  }
  async queryPrefix(keyPrefix: string): Promise<{ key: string; value: any }[]> {
    const results: { key: string; value: any }[] = [];
    for await (
      const result of this.kv.list(
        keyPrefix
          ? {
            start: [keyPrefix],
            end: [endRange(keyPrefix)],
          }
          : { prefix: [] },
      )
    ) {
      results.push({
        key: result.key[0] as string,
        value: result.value as any,
      });
    }
    return results;
  }
}

function endRange(prefix: string) {
  const lastChar = prefix[prefix.length - 1];
  const nextLastChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
  return prefix.slice(0, -1) + nextLastChar;
}
