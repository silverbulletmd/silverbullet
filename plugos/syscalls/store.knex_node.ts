import {Knex} from "knex";
import {SysCallMapping} from "../system";

type Item = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

export async function ensureTable(db: Knex<any, unknown>, tableName: string) {
  if (!(await db.schema.hasTable(tableName))) {
    await db.schema.createTable(tableName, (table) => {
      table.string("key");
      table.text("value");
      table.primary(["key"]);
    });
    console.log(`Created table ${tableName}`);
  }
}

export function storeSyscalls(
  db: Knex<any, unknown>,
  tableName: string
): SysCallMapping {
  const apiObj: SysCallMapping = {
    "store.delete": async (ctx, key: string) => {
      await db<Item>(tableName).where({ key }).del();
    },
    "store.deletePrefix": async (ctx, prefix: string) => {
      return db<Item>(tableName).andWhereLike("key", `${prefix}%`).del();
    },
    "store.deleteAll": async (ctx) => {
      await db<Item>(tableName).del();
    },
    "store.set": async (ctx, key: string, value: any) => {
      let changed = await db<Item>(tableName)
        .where({ key })
        .update("value", JSON.stringify(value));
      if (changed === 0) {
        await db<Item>(tableName).insert({
          key,
          value: JSON.stringify(value),
        });
      }
    },
    // TODO: Optimize
    "store.batchSet": async (ctx, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj["store.set"](ctx, key, value);
      }
    },
    "store.batchDelete": async (ctx, keys: string[]) => {
      for (let key of keys) {
        await apiObj["store.delete"](ctx, key);
      }
    },
    "store.get": async (ctx, key: string): Promise<any | null> => {
      let result = await db<Item>(tableName).where({ key }).select("value");
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "store.queryPrefix": async (ctx, prefix: string) => {
      return (
        await db<Item>(tableName)
          .andWhereLike("key", `${prefix}%`)
          .select("key", "value")
      ).map(({ key, value }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
  };
  return apiObj;
}
