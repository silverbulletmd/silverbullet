import { Knex } from "knex";
import { SysCallMapping } from "../system";

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

export function storeWriteSyscalls(
  db: Knex<any, unknown>,
  tableName: string
): SysCallMapping {
  const apiObj: SysCallMapping = {
    delete: async (ctx, key: string) => {
      await db<Item>(tableName).where({ key }).del();
    },
    deletePrefix: async (ctx, prefix: string) => {
      return db<Item>(tableName).andWhereLike("key", `${prefix}%`).del();
    },
    deleteAll: async (ctx) => {
      await db<Item>(tableName).del();
    },
    set: async (ctx, key: string, value: any) => {
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
    batchSet: async (ctx, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj.set(ctx, key, value);
      }
    },
    batchDelete: async (ctx, keys: string[]) => {
      for (let key of keys) {
        await apiObj.delete(ctx, key);
      }
    },
  };
  return apiObj;
}

export function storeReadSyscalls(
  db: Knex<any, unknown>,
  tableName: string
): SysCallMapping {
  return {
    get: async (ctx, key: string): Promise<any | null> => {
      let result = await db<Item>(tableName).where({ key }).select("value");
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    queryPrefix: async (ctx, prefix: string) => {
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
}
