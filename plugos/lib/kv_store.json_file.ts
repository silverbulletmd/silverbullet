import { KV, KVStore } from "./kv_store.ts";

export class JSONKVStore implements KVStore {
  private data: { [key: string]: any } = {};

  async load(path: string) {
    this.loadString(await Deno.readTextFile(path));
  }

  loadString(jsonString: string) {
    this.data = JSON.parse(jsonString);
  }

  async save(path: string) {
    await Deno.writeTextFile(path, JSON.stringify(this.data));
  }

  del(key: string): Promise<void> {
    delete this.data[key];
    return Promise.resolve();
  }

  deletePrefix(prefix: string): Promise<void> {
    for (const key in this.data) {
      if (key.startsWith(prefix)) {
        delete this.data[key];
      }
    }
    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    this.data = {};
    return Promise.resolve();
  }

  set(key: string, value: any): Promise<void> {
    this.data[key] = value;
    return Promise.resolve();
  }
  batchSet(kvs: KV[]): Promise<void> {
    for (const kv of kvs) {
      this.data[kv.key] = kv.value;
    }
    return Promise.resolve();
  }
  batchDelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      delete this.data[key];
    }
    return Promise.resolve();
  }
  batchGet(keys: string[]): Promise<any[]> {
    return Promise.resolve(keys.map((key) => this.data[key]));
  }
  get(key: string): Promise<any> {
    return Promise.resolve(this.data[key]);
  }
  has(key: string): Promise<boolean> {
    return Promise.resolve(key in this.data);
  }
  queryPrefix(keyPrefix: string): Promise<{ key: string; value: any }[]> {
    const results: { key: string; value: any }[] = [];
    for (const key in this.data) {
      if (key.startsWith(keyPrefix)) {
        results.push({ key, value: this.data[key] });
      }
    }
    return Promise.resolve(results);
  }
}
