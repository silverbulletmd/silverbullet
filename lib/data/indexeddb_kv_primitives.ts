import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";
import { type IDBPDatabase, openDB } from "idb";

import type { KV, KvKey } from "../../type/datastore.ts";

const sep = "\0";
const objectStoreName = "data";

export class IndexedDBKvPrimitives implements KvPrimitives {
  db!: IDBPDatabase<any>;

  constructor(
    private dbName: string,
  ) {
  }

  async init() {
    this.db = await openDB(this.dbName, 1, {
      upgrade: (db) => {
        db.createObjectStore(objectStoreName);
      },
    });
  }

  async clear(): Promise<void> {
    const objectStoreNames = this.db.objectStoreNames;

    // Create a transaction that includes all object stores
    const tx = this.db.transaction(objectStoreNames, "readwrite");

    // Clear each object store in parallel
    const clearPromises = Array.from(objectStoreNames).map((storeName) =>
      tx.objectStore(storeName).clear()
    );

    // Wait for all clears to complete
    await Promise.all(clearPromises);

    // Complete the transaction
    await tx.done;
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    const tx = this.db.transaction(objectStoreName, "readonly");
    return Promise.all(keys.map((key) => tx.store.get(this.buildKey(key))));
  }

  async batchSet(entries: KV[]): Promise<void> {
    const tx = this.db.transaction(objectStoreName, "readwrite");
    await Promise.all([
      ...entries.map(({ key, value }) =>
        tx.store.put(value, this.buildKey(key))
      ),
      tx.done,
    ]);
  }

  async batchDelete(keys: KvKey[]): Promise<void> {
    const tx = this.db.transaction(objectStoreName, "readwrite");
    await Promise.all([
      ...keys.map((key) => tx.store.delete(this.buildKey(key))),
      tx.done,
    ]);
  }

  async *query({ prefix }: KvQueryOptions): AsyncIterableIterator<KV> {
    const tx = this.db.transaction(objectStoreName, "readonly");
    prefix = prefix || [];
    for await (
      const entry of tx.store.iterate(IDBKeyRange.bound(
        this.buildKey([...prefix, ""]),
        this.buildKey([...prefix, "\uffff"]),
      ))
    ) {
      yield { key: this.extractKey(entry.key), value: entry.value };
    }
  }

  close() {
    this.db.close();
  }

  private buildKey(key: KvKey): string {
    for (const k of key) {
      if (k.includes(sep)) {
        throw new Error(`Key cannot contain ${sep}`);
      }
    }
    return key.join(sep);
  }

  private extractKey(key: string): KvKey {
    return key.split(sep);
  }
}
