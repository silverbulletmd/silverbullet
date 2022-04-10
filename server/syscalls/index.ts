import { Knex } from "knex";
import { SysCallMapping } from "../../plugos/system";

import { ensureTable, storeSyscalls } from "../../plugos/syscalls/store.knex_node";

type IndexItem = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

/*
 Keyspace design:

 for page lookups:
 p~page~key

 for global lookups:
 k~key~page

 */

function pageKey(page: string, key: string) {
  return `p~${page}~${key}`;
}

function unpackPageKey(dbKey: string): { page: string; key: string } {
  const [, page, key] = dbKey.split("~");
  return { page, key };
}

function globalKey(page: string, key: string) {
  return `k~${key}~${page}`;
}

function unpackGlobalKey(dbKey: string): { page: string; key: string } {
  const [, key, page] = dbKey.split("~");
  return { page, key };
}

export async function ensurePageIndexTable(db: Knex<any, unknown>) {
  await ensureTable(db, "page_index");
}

export function pageIndexSyscalls(db: Knex<any, unknown>): SysCallMapping {
  const storeCalls = storeSyscalls(db, "page_index");
  const apiObj: SysCallMapping = {
    "index.set": async (ctx, page: string, key: string, value: any) => {
      await storeCalls["store.set"](ctx, pageKey(page, key), value);
      await storeCalls["store.set"](ctx, globalKey(page, key), value);
    },
    "index.batchSet": async (ctx, page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj["index.set"](ctx, page, key, value);
      }
    },
    "index.delete": async (ctx, page: string, key: string) => {
      await storeCalls["store.delete"](ctx, pageKey(page, key));
      await storeCalls["store.delete"](ctx, globalKey(page, key));
    },
    "index.get": async (ctx, page: string, key: string) => {
      return storeCalls["store.get"](ctx, pageKey(page, key));
    },
    "index.scanPrefixForPage": async (ctx, page: string, prefix: string) => {
      return (
        await storeCalls["store.queryPrefix"](ctx, pageKey(page, prefix))
      ).map(({ key, value }: { key: string; value: any }) => {
        const { key: pageKey } = unpackPageKey(key);
        return {
          page,
          key: pageKey,
          value,
        };
      });
    },
    "index.scanPrefixGlobal": async (ctx, prefix: string) => {
      return (await storeCalls["store.queryPrefix"](ctx, `k~${prefix}`)).map(
        ({ key, value }: { key: string; value: any }) => {
          const { page, key: pageKey } = unpackGlobalKey(key);
          return {
            page,
            key: pageKey,
            value,
          };
        }
      );
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": async (ctx, page: string, prefix: string) => {
      // Collect all global keys for this page to delete
      let keysToDelete = (
        await storeCalls["store.queryPrefix"](ctx, pageKey(page, prefix))
      ).map(({ key }: { key: string; value: string }) =>
        globalKey(page, unpackPageKey(key).key)
      );
      // Delete all page keys
      await storeCalls["store.deletePrefix"](ctx, pageKey(page, prefix));
      // console.log("Deleting keys", keysToDelete);
      await storeCalls["store.batchDelete"](ctx, keysToDelete);
    },
    "index.clearPageIndex": async (ctx) => {
      await storeCalls["store.deleteAll"](ctx);
    },
  };
  return apiObj;
}
