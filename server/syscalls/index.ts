import { Knex } from "knex";
import { SysCallMapping } from "../../plugos/system";

import {
  ensureTable,
  storeReadSyscalls,
  storeWriteSyscalls,
} from "../../plugos/syscalls/store.knex_node";

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
  const readCalls = storeReadSyscalls(db, "page_index");
  const writeCalls = storeWriteSyscalls(db, "page_index");
  const apiObj: SysCallMapping = {
    set: async (ctx, page: string, key: string, value: any) => {
      await writeCalls.set(ctx, pageKey(page, key), value);
      await writeCalls.set(ctx, globalKey(page, key), value);
    },
    batchSet: async (ctx, page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj.set(ctx, page, key, value);
      }
    },
    delete: async (ctx, page: string, key: string) => {
      await writeCalls.delete(ctx, pageKey(page, key));
      await writeCalls.delete(ctx, globalKey(page, key));
    },
    get: async (ctx, page: string, key: string) => {
      return readCalls.get(ctx, pageKey(page, key));
    },
    scanPrefixForPage: async (ctx, page: string, prefix: string) => {
      return (await readCalls.queryPrefix(ctx, pageKey(page, prefix))).map(
        ({ key, value }: { key: string; value: any }) => {
          const { key: pageKey } = unpackPageKey(key);
          return {
            page,
            key: pageKey,
            value,
          };
        }
      );
    },
    scanPrefixGlobal: async (ctx, prefix: string) => {
      return (await readCalls.queryPrefix(ctx, `k~${prefix}`)).map(
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
    clearPageIndexForPage: async (ctx, page: string) => {
      await apiObj.deletePrefixForPage(ctx, page, "");
    },
    deletePrefixForPage: async (ctx, page: string, prefix: string) => {
      // Collect all global keys for this page to delete
      let keysToDelete = (
        await readCalls.queryPrefix(ctx, pageKey(page, prefix))
      ).map(({ key }: { key: string; value: string }) =>
        globalKey(page, unpackPageKey(key).key)
      );
      // Delete all page keys
      await writeCalls.deletePrefix(ctx, pageKey(page, prefix));
      await writeCalls.batchDelete(ctx, keysToDelete);
    },
    clearPageIndex: async (ctx) => {
      await writeCalls.deleteAll(ctx);
    },
  };
  return apiObj;
}
