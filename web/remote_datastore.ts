import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import { KV, KvKey, KvQuery } from "$sb/types.ts";
import { proxySyscall } from "./syscalls/util.ts";
import { IDataStore } from "../plugos/lib/datastore.ts";

// implements DataStore "interface"
export class RemoteDataStore implements IDataStore {
  constructor(private httpPrimitives: HttpSpacePrimitives) {
  }

  private proxy(
    name: string,
    args: any[],
  ) {
    return proxySyscall(
      { plug: { name: "index" } } as any,
      this.httpPrimitives,
      name,
      args,
    );
  }

  get<T = any>(key: KvKey): Promise<T | null> {
    return this.proxy("datastore.get", [key]);
  }

  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    return this.proxy("datastore.batchGet", [keys]);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.proxy("datastore.set", [key, value]);
  }

  batchSet<T = any>(entries: KV<T>[]): Promise<void> {
    return this.proxy("datastore.batchSet", [entries]);
  }

  delete(key: KvKey): Promise<void> {
    return this.proxy("datastore.delete", [key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.proxy("datastore.batchDelete", [keys]);
  }

  query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    return this.proxy("datastore.query", [query]);
  }

  queryDelete(query: KvQuery): Promise<void> {
    return this.proxy("datastore.queryDelete", [query]);
  }
}
