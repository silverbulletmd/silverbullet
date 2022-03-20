import { Knex } from "knex";

type IndexItem = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

export default function (db: Knex) {
  const apiObj = {
    "indexer.clearPageIndexForPage": async (page: string) => {
      await db<IndexItem>("page_index").where({ page }).del();
    },
    "indexer.set": async (page: string, key: string, value: any) => {
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
    "indexer.batchSet": async (page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj["indexer.set"](page, key, value);
      }
    },
    "indexer.get": async (page: string, key: string) => {
      let result = await db<IndexItem>("page_index")
        .where({ page, key })
        .select("value");
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "indexer.delete": async (page: string, key: string) => {
      await db<IndexItem>("page_index").where({ page, key }).del();
    },
    "indexer.scanPrefixForPage": async (page: string, prefix: string) => {
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
    "indexer.scanPrefixGlobal": async (prefix: string) => {
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
    "indexer.deletePrefixForPage": async (page: string, prefix: string) => {
      return db<IndexItem>("page_index")
        .where({ page })
        .andWhereLike("key", `${prefix}%`)
        .del();
    },
    "indexer.clearPageIndex": async () => {
      return db<IndexItem>("page_index").del();
    },
  };
  return apiObj;
}
