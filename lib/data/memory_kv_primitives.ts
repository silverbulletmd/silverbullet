import { KV, KvKey } from "../../plug-api/types.ts";
import { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

const memoryKeySeparator = "\0";

export class MemoryKvPrimitives implements KvPrimitives {
  protected store = new Map<string, any>();

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

  static fromJSON(json: Record<string, any>): MemoryKvPrimitives {
    const result = new MemoryKvPrimitives();
    for (const key of Object.keys(json)) {
      result.store.set(key, json[key]);
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

  close(): void {
  }
}
