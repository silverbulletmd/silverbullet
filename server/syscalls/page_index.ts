import { Knex } from "knex";
import { SysCallMapping } from "../../plugbox/system";

type IndexItem = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

export default function (db: Knex): SysCallMapping {
  const apiObj: SysCallMapping = {
    clearPageIndexForPage: async (ctx, page: string) => {
      await db<IndexItem>("page_index").where({ page }).del();
    },
    set: async (ctx, page: string, key: string, value: any) => {
      let changed = await db<IndexItem>("page_index")
        .where({ page, key })
        .update("value", JSON.stringify(value));
      if (changed === 0) {
        await db<IndexItem>("page_index").insert({
          page,
          key,
          value: JSON.stringify(value),
        });
      }
    },
    batchSet: async (ctx, page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj.set(ctx, page, key, value);
      }
    },
    get: async (ctx, page: string, key: string) => {
      let result = await db<IndexItem>("page_index")
        .where({ page, key })
        .select("value");
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    delete: async (ctx, page: string, key: string) => {
      await db<IndexItem>("page_index").where({ page, key }).del();
    },
    scanPrefixForPage: async (ctx, page: string, prefix: string) => {
      return (
        await db<IndexItem>("page_index")
          .where({ page })
          .andWhereLike("key", `${prefix}%`)
          .select("page", "key", "value")
      ).map(({ page, key, value }) => ({
        page,
        key,
        value: JSON.parse(value),
      }));
    },
    scanPrefixGlobal: async (ctx, prefix: string) => {
      return (
        await db<IndexItem>("page_index")
          .andWhereLike("key", `${prefix}%`)
          .select("page", "key", "value")
      ).map(({ page, key, value }) => ({
        page,
        key,
        value: JSON.parse(value),
      }));
    },
    deletePrefixForPage: async (ctx, page: string, prefix: string) => {
      return db<IndexItem>("page_index")
        .where({ page })
        .andWhereLike("key", `${prefix}%`)
        .del();
    },
    clearPageIndex: async () => {
      return db<IndexItem>("page_index").del();
    },
  };
  return apiObj;
}
