import { KVStore } from "../../plugos/lib/kv_store.ts";
import type { SysCallMapping } from "../../plugos/system.ts";

export type KV = {
  key: string;
  value: any;
};

// Keyspace:
// ["index", page, key] -> value
// ["indexByKey", key, page] -> value

const sep = "!";

/**
 * Implements the index syscalls using Deno's KV store.
 * @param dbFile
 * @returns
 */
export function pageIndexSyscalls(kv: KVStore): SysCallMapping {
  const apiObj: SysCallMapping = {
    "index.set": (_ctx, page: string, key: string, value: any) => {
      return kv.batchSet(
        [{
          key: `index${sep}${page}${sep}${key}`,
          value,
        }, {
          key: `indexByKey${sep}${key}${sep}${page}`,
          value,
        }],
      );
    },
    "index.batchSet": async (_ctx, page: string, kvs: KV[]) => {
      for (const { key, value } of kvs) {
        await apiObj["index.set"](_ctx, page, key, value);
      }
    },
    "index.delete": (_ctx, page: string, key: string) => {
      return kv.batchDelete([
        `index${sep}${page}${sep}${key}`,
        `indexByKey${sep}${key}${sep}${page}`,
      ]);
    },
    "index.get": (_ctx, page: string, key: string) => {
      return kv.get(`index${sep}${page}${sep}${key}`);
    },
    "index.queryPrefix": async (_ctx, prefix: string) => {
      const results: { key: string; page: string; value: any }[] = [];
      for (
        const result of await kv.queryPrefix(`indexByKey!${prefix}`)
      ) {
        const [_ns, key, page] = result.key.split(sep);
        results.push({
          key,
          page,
          value: result.value,
        });
      }
      return results;
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": async (_ctx, page: string, prefix: string) => {
      for (
        const result of await kv.queryPrefix(
          `index${sep}${page}${sep}${prefix}`,
        )
      ) {
        const [_ns, page, key] = result.key.split(sep);
        await apiObj["index.delete"](_ctx, page, key);
      }
    },
    "index.clearPageIndex": async (ctx) => {
      for (const result of await kv.queryPrefix(`index${sep}`)) {
        const [_ns, page, key] = result.key.split(sep);
        await apiObj["index.delete"](ctx, page, key);
      }
    },
  };
  return apiObj;
}
