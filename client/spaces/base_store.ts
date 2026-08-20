import { hashSHA256 } from "@silverbulletmd/silverbullet/lib/crypto";
import type { KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { KvPrimitives } from "../data/kv_primitives.ts";

const basePrefix: KvKey = ["$sync", "base"];
const safetyPrefix: KvKey = ["$sync", "safety"];

const defaultMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const defaultMaxBytes = 50 * 1024 * 1024;

export class BaseStore {
  constructor(private kv: KvPrimitives) {}

  async putBase(data: Uint8Array): Promise<string> {
    const hash = await hashSHA256(data);
    await this.kv.batchSet([{ key: [...basePrefix, hash], value: data }]);
    return hash;
  }

  async getBase(hash: string): Promise<Uint8Array | null> {
    const [value] = await this.kv.batchGet([[...basePrefix, hash]]);
    return value ?? null;
  }

  async pruneBases(referenced: Set<string>): Promise<void> {
    const toDelete: KvKey[] = [];
    for await (const { key } of this.kv.query({ prefix: basePrefix })) {
      const hash = key[key.length - 1];
      if (!referenced.has(hash)) {
        toDelete.push(key);
      }
    }
    if (toDelete.length > 0) {
      await this.kv.batchDelete(toDelete);
    }
  }

  async putSafety(data: Uint8Array): Promise<string> {
    const hash = await hashSHA256(data);
    await this.kv.batchSet([
      { key: [...safetyPrefix, hash], value: { data, ts: Date.now() } },
    ]);
    return hash;
  }

  async listSafety(): Promise<{ hash: string; size: number; ts: number }[]> {
    const entries: { hash: string; size: number; ts: number }[] = [];
    for await (const { key, value } of this.kv.query({
      prefix: safetyPrefix,
    })) {
      entries.push({
        hash: key[key.length - 1],
        size: value.data.byteLength,
        ts: value.ts,
      });
    }
    entries.sort((a, b) => b.ts - a.ts);
    return entries;
  }

  async getSafety(hash: string): Promise<Uint8Array | null> {
    const [value] = await this.kv.batchGet([[...safetyPrefix, hash]]);
    return value?.data ?? null;
  }

  async pruneSafety(
    maxAgeMs: number = defaultMaxAgeMs,
    maxBytes: number = defaultMaxBytes,
    nowMs: number = Date.now(),
  ): Promise<void> {
    const entries: { key: KvKey; data: Uint8Array; ts: number }[] = [];
    for await (const { key, value } of this.kv.query({
      prefix: safetyPrefix,
    })) {
      entries.push({ key, data: value.data, ts: value.ts });
    }

    const toDelete = new Set<KvKey>();
    for (const entry of entries) {
      if (nowMs - entry.ts > maxAgeMs) {
        toDelete.add(entry.key);
      }
    }

    const remaining = entries
      .filter((entry) => !toDelete.has(entry.key))
      .sort((a, b) => a.ts - b.ts);
    let totalSize = remaining.reduce(
      (sum, entry) => sum + entry.data.byteLength,
      0,
    );
    for (const entry of remaining) {
      if (totalSize <= maxBytes) {
        break;
      }
      toDelete.add(entry.key);
      totalSize -= entry.data.byteLength;
    }

    if (toDelete.size > 0) {
      await this.kv.batchDelete([...toDelete]);
    }
  }
}
