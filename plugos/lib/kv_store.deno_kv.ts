/// <reference lib="deno.unstable" />

import { KV, KVStore } from "./kv_store.ts";

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

  async del(key: string): Promise<void> {
    const res = await this.kv.atomic()
      .delete([key])
      .commit();
    if (!res.ok) {
      throw res;
    }
  }
  async deletePrefix(prefix: string): Promise<void> {
    for await (
      const result of this.kv.list({
        start: [prefix],
        end: [endRange(prefix)],
      })
    ) {
      await this.del(result.key[0] as string);
    }
  }
  async deleteAll(): Promise<void> {
    for await (
      const result of this.kv.list({ prefix: [] })
    ) {
      await this.del(result.key[0] as string);
    }
  }
  async set(key: string, value: any): Promise<void> {
    const res = await this.kv.atomic()
      .set([key], value)
      .commit();
    if (!res.ok) {
      throw res;
    }
  }
  async batchSet(kvs: KV[]): Promise<void> {
    for (const { key, value } of kvs) {
      await this.set(key, value);
    }
  }
  async batchDelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.del(key);
    }
  }
  batchGet(keys: string[]): Promise<any[]> {
    const results: Promise<any>[] = [];
    for (const key of keys) {
      results.push(this.get(key));
    }
    return Promise.all(results);
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
      const result of (this.kv).list({
        start: [keyPrefix],
        end: [endRange(keyPrefix)],
      })
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
