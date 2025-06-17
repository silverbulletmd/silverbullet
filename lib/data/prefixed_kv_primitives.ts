import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

import type { KV, KvKey } from "../../type/datastore.ts";

/**
 * Turns any KvPrimitives into a KvPrimitives that automatically prefixes all keys (and removes them again when reading)
 */
export class PrefixedKvPrimitives implements KvPrimitives {
  constructor(private wrapped: KvPrimitives, private prefix: KvKey) {
  }

  clear(): Promise<void> {
    return this.wrapped.clear();
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    return this.wrapped.batchGet(keys.map((key) => this.applyPrefix(key)));
  }

  batchSet(entries: KV[]): Promise<void> {
    return this.wrapped.batchSet(
      entries.map(({ key, value }) => ({ key: this.applyPrefix(key), value })),
    );
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.wrapped.batchDelete(keys.map((key) => this.applyPrefix(key)));
  }

  async *query(options: KvQueryOptions): AsyncIterableIterator<KV> {
    for await (
      const result of this.wrapped.query({
        prefix: this.applyPrefix(options.prefix),
      })
    ) {
      yield { key: this.stripPrefix(result.key), value: result.value };
    }
  }

  close(): void {
    this.wrapped.close();
  }

  private applyPrefix(key?: KvKey): KvKey {
    return [...this.prefix, ...(key ? key : [])];
  }

  private stripPrefix(key: KvKey): KvKey {
    return key.slice(this.prefix.length);
  }
}
