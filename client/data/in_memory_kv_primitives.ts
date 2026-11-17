import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";

const memoryKeySeparator = "\0";

/**
 * A key-value store that lives only in memory. Safe for the browser: a
 * "Shared computer" session keeps its datastore here instead of IndexedDB.
 */
export class InMemoryKvPrimitives implements KvPrimitives {
  protected store = new Map<string, any>();

  init(): Promise<void> {
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    return Promise.resolve(
      keys.map((key) => this.store.get(key.join(memoryKeySeparator))),
    );
  }

  batchSet(entries: KV[]): Promise<void> {
    for (const { key, value } of entries) {
      this.store.set(key.join(memoryKeySeparator), value);
    }
    return Promise.resolve();
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key.join(memoryKeySeparator));
    }
    return Promise.resolve();
  }

  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  async *query(options: KvQueryOptions): AsyncIterableIterator<KV> {
    const prefix = options.prefix?.join(memoryKeySeparator);
    const sortedKeys = [...this.store.keys()].sort();
    for (const key of sortedKeys) {
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      yield {
        key: key.split(memoryKeySeparator),
        value: this.store.get(key),
      };
    }
  }

  countQuery({ prefix }: KvQueryOptions): Promise<number> {
    const prefixStr = prefix ? prefix.join(memoryKeySeparator) : undefined;
    const keys = [...this.store.keys()];
    return Promise.resolve(
      keys.filter((key) => !prefixStr || key.startsWith(prefixStr)).length,
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
