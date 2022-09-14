import { Knex } from "knex";
import { SysCallMapping } from "../system";

export type Item = {
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

export type Query = {
  filter?: Filter[];
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
  select?: string[];
};

export type Filter = {
  op: string;
  prop: string;
  value: any;
};

export function queryToKnex(
  queryBuilder: Knex.QueryBuilder<Item, any>,
  query: Query
): Knex.QueryBuilder<Item, any> {
  if (query.filter) {
    for (let filter of query.filter) {
      queryBuilder = queryBuilder.andWhereRaw(
        `json_extract(value, '$.${filter.prop}') ${filter.op} ?`,
        [filter.value]
      );
    }
  }
  if (query.limit) {
    queryBuilder = queryBuilder.limit(query.limit);
  }
  if (query.orderBy) {
    queryBuilder = queryBuilder.orderByRaw(
      `json_extract(value, '$.${query.orderBy}') ${
        query.orderDesc ? "desc" : "asc"
      }`
    );
  }
  return queryBuilder;
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
    "store.deleteQuery": async (ctx, query: Query) => {
      await queryToKnex(db<Item>(tableName), query).del();
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
    "store.query": async (ctx, query: Query) => {
      return (
        await queryToKnex(db<Item>(tableName), query).select("key", "value")
      ).map(({ key, value }: { key: string; value: string }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
  };
  return apiObj;
}
