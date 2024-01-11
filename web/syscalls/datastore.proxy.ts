import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { KV, KvKey, KvQuery } from "$sb/types.ts";
import type { SyscallContext, SysCallMapping } from "../../plugos/system.ts";

export function dataStoreProxySyscalls(
  httpSpacePrimitives: HttpSpacePrimitives,
): SysCallMapping {
  return {
    "datastore.delete": (ctx, key: KvKey) => {
      return rpcCall(httpSpacePrimitives, "datastore.batchDelete", [
        addPrefix(ctx, key),
      ]);
    },
    "datastore.batchDelete": (ctx, keys: KvKey[]) => {
      if (keys.length === 0) {
        return Promise.resolve();
      }
      return rpcCall(
        httpSpacePrimitives,
        "datastore.batchDelete",
        keys.map((key) => addPrefix(ctx, key)),
      );
    },
    "datastore.set": (ctx, key: KvKey, value: any) => {
      return rpcCall(httpSpacePrimitives, "datastore.batchSet", [
        { key: addPrefix(ctx, key), value: value },
      ]);
    },
    "datastore.batchSet": (ctx, entries: KV[]) => {
      if (entries.length === 0) {
        return Promise.resolve();
      }
      return rpcCall(
        httpSpacePrimitives,
        "datastore.batchSet",
        entries.map(({ key, value }) => ({ key: addPrefix(ctx, key), value })),
      );
    },
    "datastore.get": async (ctx, key: KvKey) => {
      const [result] = await rpcCall(
        httpSpacePrimitives,
        "datastore.batchGet",
        [
          addPrefix(ctx, key),
        ],
      );
      return result;
    },
    "datastore.batchGet": (ctx, keys: KvKey[]) => {
      if (keys.length === 0) {
        return Promise.resolve([]);
      }
      return rpcCall(
        httpSpacePrimitives,
        "datastore.batchGet",
        keys.map((key) => addPrefix(ctx, key)),
      );
    },
    "datastore.query": async (ctx, query: KvQuery) => {
      const results: KV[] = await rpcCall(
        httpSpacePrimitives,
        "datastore.query",
        { ...query, prefix: addPrefix(ctx, query.prefix || []) },
      );
      return results.map(({ key, value }) => ({
        key: stripPrefix(key),
        value,
      }));
    },
  };

  function addPrefix(ctx: SyscallContext, key: KvKey): KvKey {
    return [ctx.plug.name, ...key];
  }

  function stripPrefix(key: KvKey): KvKey {
    return key.slice(1);
  }
}

export async function rpcCall(
  httpSpacePrimitives: HttpSpacePrimitives,
  name: string,
  ...args: any[]
): Promise<any> {
  const resp = await httpSpacePrimitives.authenticatedFetch(
    `${httpSpacePrimitives.url}/.rpc/${name}`,
    {
      method: "POST",
      body: JSON.stringify(args),
    },
  );
  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("Remote rpc error", errorText);
    throw new Error(errorText);
  }
  return (await resp.json()).r;
}
