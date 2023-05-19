import Dexie, { Table } from "dexie";
import type { KV, KVStore } from "./kv_store.ts";

export class DexieKVStore implements KVStore {
  db: Dexie;
  items: Table<KV, string>;
  constructor(
    private dbName: string,
    private tableName: string,
    private indexedDB?: any,
  ) {
    this.db = new Dexie(dbName, {
      indexedDB,
    });
    this.db.version(1).stores({
      [tableName]: "key",
    });
    this.items = this.db.table<KV, string>(tableName);
  }

  async del(key: string) {
    await this.items.delete(key);
  }

  async deletePrefix(prefix: string) {
    await this.items.where("key").startsWith(prefix).delete();
  }

  async deleteAll() {
    await this.items.clear();
  }

  async set(key: string, value: any) {
    await this.items.put({
      key,
      value,
    });
  }

  async batchSet(kvs: KV[]) {
    await this.items.bulkPut(
      kvs.map(({ key, value }) => ({
        key,
        value,
      })),
    );
  }

  async batchDelete(keys: string[]) {
    await this.items.bulkDelete(keys);
  }

  async batchGet(
    keys: string[],
  ): Promise<(any | undefined)[]> {
    return (await this.items.bulkGet(keys)).map((result) => result?.value);
  }

  async get(key: string): Promise<any | null> {
    const result = await this.items.get({ key });
    return result ? result.value : null;
  }

  async has(key: string): Promise<boolean> {
    return await this.items.get({
      key,
    }) !== undefined;
  }

  async queryPrefix(
    keyPrefix: string,
  ): Promise<{ key: string; value: any }[]> {
    const results = await this.items.where("key").startsWith(keyPrefix)
      .toArray();
    return results.map((result) => ({
      key: result.key,
      value: result.value,
    }));
  }
}
