import { Knex } from "knex";
import { SysCallMapping } from "@plugos/plugos/system";
import { Query, queryToKnex } from "@plugos/plugos/syscalls/store.knex_node";

type Item = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

const tableName = "page_index";

export async function ensureTable(db: Knex<any, unknown>) {
  if (!(await db.schema.hasTable(tableName))) {
    await db.schema.createTable(tableName, (table) => {
      table.string("page");
      table.string("key");
      table.text("value");
      table.primary(["page", "key"]);
      table.index(["key"]);
    });

    console.log(`Created table ${tableName}`);
  }
}

export function pageIndexSyscalls(db: Knex<any, unknown>): SysCallMapping {
  const apiObj: SysCallMapping = {
    "index.set": async (ctx, page: string, key: string, value: any) => {
      let changed = await db<Item>(tableName)
        .where({ key, page })
        .update("value", JSON.stringify(value));
      if (changed === 0) {
        await db<Item>(tableName).insert({
          key,
          page,
          value: JSON.stringify(value),
        });
      }
    },
    "index.batchSet": async (ctx, page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj["index.set"](ctx, page, key, value);
      }
    },
    "index.delete": async (ctx, page: string, key: string) => {
      await db<Item>(tableName).where({ key, page }).del();
    },
    "index.get": async (ctx, page: string, key: string) => {
      let result = await db<Item>(tableName)
        .where({ key, page })
        .select("value");
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "index.queryPrefix": async (ctx, prefix: string) => {
      return (
        await db<Item>(tableName)
          .andWhereLike("key", `${prefix}%`)
          .select("key", "value", "page")
      ).map(({ key, value, page }) => ({
        key,
        page,
        value: JSON.parse(value),
      }));
    },
    "index.query": async (ctx, query: Query) => {
      return (
        await queryToKnex(db<Item>(tableName), query).select(
          "key",
          "value",
          "page"
        )
      ).map(({ key, value, page }: any) => ({
        key,
        page,
        value: JSON.parse(value),
      }));
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": async (ctx, page: string, prefix: string) => {
      return db<Item>(tableName)
        .where({ page })
        .andWhereLike("key", `${prefix}%`)
        .del();
    },
    "index.clearPageIndex": async (ctx) => {
      await db<Item>(tableName).del();
    },
  };
  return apiObj;
}
