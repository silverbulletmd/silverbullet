import { readFile, writeFile } from "node:fs/promises";
import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { InMemoryKvPrimitives } from "./in_memory_kv_primitives.ts";

import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";

/**
 * An in-memory key-value store that can persist to a JSON file (Node only;
 * the browser uses `InMemoryKvPrimitives`).
 */
export class MemoryKvPrimitives extends InMemoryKvPrimitives {
  private throttledPersist?: () => void;

  constructor(
    protected filePath?: string,
    options: { throttleMs?: number } = {},
  ) {
    super();
    if (this.filePath) {
      const throttleMs =
        options.throttleMs !== undefined ? options.throttleMs : 1000;

      if (throttleMs > 0) {
        this.throttledPersist = throttle(() => {
          this.persistToDisk().catch((err) =>
            console.error(`Error persisting to disk: ${err}`),
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

  /**
   * Initialize the store by loading data from disk if a file path was provided
   */
  override async init(): Promise<void> {
    if (!this.filePath) return;

    try {
      const text = await readFile(this.filePath, "utf-8");
      // Handle empty files gracefully to prevent "SyntaxError: Unexpected end of JSON input"
      if (text.trim() === "") {
        return;
      }

      const jsonData = JSON.parse(text);
      for (const key of Object.keys(jsonData)) {
        this.store.set(key, jsonData[key]);
      }
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        return;
      }

      console.warn(`Failed to load KV store from ${this.filePath}:`, error);
    }
  }

  override async batchSet(entries: KV[]): Promise<void> {
    await super.batchSet(entries);

    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      await this.persistToDisk();
    }

    return Promise.resolve();
  }

  override async batchDelete(keys: KvKey[]): Promise<void> {
    await super.batchDelete(keys);

    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      await this.persistToDisk();
    }

    return Promise.resolve();
  }

  override async close(): Promise<void> {
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
      await writeFile(
        this.filePath,
        JSON.stringify(jsonData, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.error(`Failed to persist KV store to ${this.filePath}:`, error);
    }
  }
}
