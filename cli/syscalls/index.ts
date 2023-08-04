/// <reference lib="deno.unstable" />

import type { SysCallMapping } from "../../plugos/system.ts";

type Item = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

// Keyspace:
// ["index", page, key] -> value
// ["indexByKey", key, page] -> value

/**
 * Implements the index syscalls using Deno's KV store.
 * @param dbFile
 * @returns
 */
export function pageIndexSyscalls(dbFile?: string): SysCallMapping {
  const kv = Deno.openKv(dbFile);
  const apiObj: SysCallMapping = {
    "index.set": async (_ctx, page: string, key: string, value: any) => {
      const res = await (await kv).atomic()
        .set(["index", page, key], value)
        .set(["indexByKey", key, page], value)
        .commit();
      if (!res.ok) {
        throw res;
      }
    },
    "index.batchSet": async (_ctx, page: string, kvs: KV[]) => {
      // await items.bulkPut(kvs);
      for (const { key, value } of kvs) {
        await apiObj["index.set"](_ctx, page, key, value);
      }
    },
    "index.delete": async (_ctx, page: string, key: string) => {
      const res = await (await kv).atomic()
        .delete(["index", page, key])
        .delete(["indexByKey", key, page])
        .commit();
      if (!res.ok) {
        throw res;
      }
    },
    "index.get": async (_ctx, page: string, key: string) => {
      return (await (await kv).get(["index", page, key])).value;
    },
    "index.queryPrefix": async (_ctx, prefix: string) => {
      const results: { key: string; page: string; value: any }[] = [];
      for await (
        const result of (await kv).list({
          start: ["indexByKey", prefix],
          end: [
            "indexByKey",
            prefix.slice(0, -1) +
            // This is a hack to get the next character in the ASCII table (e.g. "a" -> "b")
            String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1),
          ],
        })
      ) {
        results.push({
          key: result.key[1] as string,
          page: result.key[2] as string,
          value: result.value,
        });
      }
      return results;
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": async (_ctx, page: string, prefix: string) => {
      for await (
        const result of (await kv).list({
          start: ["index", page, prefix],
          end: ["index", page, prefix + "~"],
        })
      ) {
        await apiObj["index.delete"](_ctx, page, result.key[2]);
      }
    },
    "index.clearPageIndex": async (ctx) => {
      for await (
        const result of (await kv).list({
          prefix: ["index"],
        })
      ) {
        await apiObj["index.delete"](ctx, result.key[1], result.key[2]);
      }
    },
    "index.close": async () => {
      (await kv).close();
    },
  };
  return apiObj;
}
