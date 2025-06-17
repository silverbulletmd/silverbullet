import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";
import { throttle } from "../async.ts";

import type { KV, KvKey } from "../../type/datastore.ts";

const memoryKeySeparator = "\0";

export class MemoryKvPrimitives implements KvPrimitives {
  protected store = new Map<string, any>();
  private throttledPersist?: () => void;

  constructor(
    protected filePath?: string,
    options: { throttleMs?: number } = {},
  ) {
    // Set up throttled persistence if throttleMs is provided or default to 1000ms
    if (this.filePath) {
      const throttleMs = options.throttleMs !== undefined
        ? options.throttleMs
        : 1000;

      // If throttleMs is 0, persistence will happen immediately without throttling
      if (throttleMs > 0) {
        this.throttledPersist = throttle(() => {
          this.persistToDisk().catch((err) =>
            console.error(`Error persisting to disk: ${err}`)
          );
        }, throttleMs);
      }
    }
  }

  static fromJSON(json: Record<string, any>): MemoryKvPrimitives {
    const result = new MemoryKvPrimitives();
    for (const key of Object.keys(json)) {
      result.store.set(key, json[key]);
    }
    return result;
  }

  /**
   * Create a new MemoryKvPrimitives instance from a file and initialize it
   */
  static async fromFile(
    filePath: string,
    options: { throttleMs?: number } = {},
  ): Promise<MemoryKvPrimitives> {
    const instance = new MemoryKvPrimitives(filePath, options);
    await instance.init();
    return instance;
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  /**
   * Initialize the store by loading data from disk if a file path was provided
   */
  async init(): Promise<void> {
    if (!this.filePath) return;

    try {
      const text = await Deno.readTextFile(this.filePath);
      // Handle empty files gracefully to prevent "SyntaxError: Unexpected end of JSON input"
      if (text.trim() === "") {
        return;
      }

      const jsonData = JSON.parse(text);
      for (const key of Object.keys(jsonData)) {
        this.store.set(key, jsonData[key]);
      }
    } catch (error) {
      // Handle specific errors more gracefully
      if (error instanceof Deno.errors.NotFound) {
        // File doesn't exist yet, nothing to load
        return;
      }

      // Other errors (like invalid JSON) should be logged
      console.warn(`Failed to load KV store from ${this.filePath}:`, error);
    }
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    return Promise.resolve(
      keys.map((key) => this.store.get(key.join(memoryKeySeparator))),
    );
  }

  async batchSet(entries: KV[]): Promise<void> {
    for (const { key, value } of entries) {
      this.store.set(key.join(memoryKeySeparator), value);
    }

    // Trigger persistence
    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      // If no throttling is set up but we have a filePath, persist immediately
      await this.persistToDisk();
    }

    return Promise.resolve();
  }

  async batchDelete(keys: KvKey[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key.join(memoryKeySeparator));
    }

    // Trigger persistence
    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      // If no throttling is set up but we have a filePath, persist immediately
      await this.persistToDisk();
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

  async close(): Promise<void> {
    // Force immediate persistence when closing
    if (this.filePath) {
      await this.persistToDisk();
    }
  }

  /**
   * Persist the current state to disk
   */
  private async persistToDisk(): Promise<void> {
    if (!this.filePath) return;

    try {
      const jsonData = this.toJSON();
      await Deno.writeTextFile(
        this.filePath,
        JSON.stringify(jsonData, null, 2),
      );
    } catch (error) {
      console.error(`Failed to persist KV store to ${this.filePath}:`, error);
    }
  }
}
