import { KV, KvKey, KvQuery } from "$sb/types.ts";
import type { DataStore } from "../lib/datastore.ts";
import type { SyscallContext, SysCallMapping } from "../system.ts";

/**
 * Exposes the datastore API to plugs, but scoping everything to a prefix based on the plug's name
 * @param ds the datastore to wrap
 * @param prefix prefix to scope all keys to to which the plug name will be appended
 */
export function dataStoreSyscalls(
  ds: DataStore,
  prefix: KvKey = ["ds"],
): SysCallMapping {
  return {
    "datastore.delete": (ctx, key: KvKey) => {
      return ds.delete(applyPrefix(ctx, key));
    },

    "datastore.set": (ctx, key: KvKey, value: any) => {
      return ds.set(applyPrefix(ctx, key), value);
    },

    "datastore.batchSet": (ctx, kvs: KV[]) => {
      return ds.batchSet(
        kvs.map((kv) => ({ key: applyPrefix(ctx, kv.key), value: kv.value })),
      );
    },

    "datastore.batchDelete": (ctx, keys: KvKey[]) => {
      return ds.batchDelete(keys.map((k) => applyPrefix(ctx, k)));
    },

    "datastore.batchGet": (
      ctx,
      keys: KvKey[],
    ): Promise<(any | undefined)[]> => {
      return ds.batchGet(keys.map((k) => applyPrefix(ctx, k)));
    },

    "datastore.get": (ctx, key: KvKey): Promise<any | null> => {
      return ds.get(applyPrefix(ctx, key));
    },

    "datastore.query": async (
      ctx,
      query: KvQuery,
    ): Promise<KV[]> => {
      return (await ds.query({
        ...query,
        prefix: applyPrefix(ctx, query.prefix),
      })).map((kv) => ({
        key: stripPrefix(kv.key),
        value: kv.value,
      }));
    },

    "datastore.queryDelete": (
      ctx,
      query: KvQuery,
    ): Promise<void> => {
      return ds.queryDelete({
        ...query,
        prefix: applyPrefix(ctx, query.prefix),
      });
    },
  };

  function applyPrefix(ctx: SyscallContext, key?: KvKey): KvKey {
    return [...prefix, ctx.plug.name!, ...(key ? key : [])];
  }

  function stripPrefix(key: KvKey): KvKey {
    return key.slice(prefix.length + 1);
  }
}
