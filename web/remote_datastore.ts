import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import { KV, KvKey, KvQuery } from "$sb/types.ts";
import { IDataStore } from "../plugos/lib/datastore.ts";
import { rpcCall } from "./syscalls/datastore.proxy.ts";

// implements DataStore "interface"
export class RemoteDataStore implements IDataStore {
  constructor(private httpPrimitives: HttpSpacePrimitives) {
  }

  private proxy(
    name: string,
    ...args: any[]
  ) {
    // console.trace();
    return rpcCall(
      this.httpPrimitives,
      name,
      ...args,
    );
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    const results = await this.batchGet([key]);
    return results[0];
  }

  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    return this.proxy("datastore.batchGet", keys);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }

  batchSet<T = any>(entries: KV<T>[]): Promise<void> {
    return this.proxy("datastore.batchSet", entries);
  }

  delete(key: KvKey): Promise<void> {
    return this.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.proxy("datastore.batchDelete", keys);
  }

  query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    return this.proxy("datastore.query", query);
  }

  queryDelete(query: KvQuery): Promise<void> {
    return this.proxy("datastore.queryDelete", query);
  }
}
