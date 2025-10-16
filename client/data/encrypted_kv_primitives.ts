import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

import type { KV, KvKey } from "../../plug-api/types/datastore.ts";
import {
  decryptAesGcm,
  decryptStringDeterministic,
  deriveKeysFromPassword,
  encryptAesGcm,
  encryptStringDeterministic,
} from "@silverbulletmd/silverbullet/lib/crypto";

import { decode, encode } from "@msgpack/msgpack";

export class EncryptedKvPrimitives implements KvPrimitives {
  private keyKey!: CryptoKey;
  private dataKey!: CryptoKey;

  constructor(
    private wrapped: KvPrimitives,
    private password: string,
    private salt: Uint8Array,
  ) {
  }

  async init() {
    const { ctr, gcm } = await deriveKeysFromPassword(this.password, this.salt);
    this.keyKey = ctr;
    this.dataKey = gcm;
  }

  clear(): Promise<void> {
    return this.wrapped.clear();
  }

  private encryptKey(key: KvKey): Promise<KvKey> {
    return Promise.all(
      key.map((part) => encryptStringDeterministic(this.keyKey, part)),
    );
  }

  private decryptKey(key: KvKey): Promise<KvKey> {
    return Promise.all(
      key.map((part) => decryptStringDeterministic(this.keyKey, part)),
    );
  }

  private encryptValue(value: any): Promise<any> {
    if (value === undefined) {
      return Promise.resolve(undefined);
    }
    return encryptAesGcm(this.dataKey, encode(value));
  }

  private async decryptValue(value: any): Promise<any> {
    if (value === undefined) {
      return undefined;
    }
    return decode(await decryptAesGcm(this.dataKey, value));
  }

  async batchGet(keys: KvKey[]): Promise<any[]> {
    const encryptedKeys: KvKey[] = await Promise.all(keys.map((key) => {
      return this.encryptKey(key);
    }));
    const encryptedValues = await this.wrapped.batchGet(encryptedKeys);
    return Promise.all(
      encryptedValues.map((value) => this.decryptValue(value)),
    );
  }

  async batchSet(entries: KV[]): Promise<void> {
    const encryptedEntries: KV[] = await Promise.all(
      entries.map(async ({ key, value }) => {
        const encryptedKey = await this.encryptKey(key);
        const encryptedValue = await this.encryptValue(value);
        return { key: encryptedKey, value: encryptedValue };
      }),
    );
    await this.wrapped.batchSet(encryptedEntries);
  }

  async batchDelete(keys: KvKey[]): Promise<void> {
    const encryptedKeys = await Promise.all(
      keys.map((key) => this.encryptKey(key)),
    );
    await this.wrapped.batchDelete(encryptedKeys);
  }

  async *query({ prefix }: KvQueryOptions): AsyncIterableIterator<KV> {
    const encryptedResults: KV[] = [];
    // Collect all results first
    for await (
      const entry of this.wrapped.query({
        prefix: prefix ? await this.encryptKey(prefix) : undefined,
      })
    ) {
      encryptedResults.push(entry);
    }

    // Then decrypt them (to avoid transaction problems with wrapped indexed DBs)
    for (const entry of encryptedResults) {
      yield {
        key: await this.decryptKey(entry.key),
        value: await this.decryptValue(entry.value),
      };
    }
  }

  close() {
    this.wrapped.close();
  }
}
