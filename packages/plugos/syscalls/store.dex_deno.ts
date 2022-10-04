import type { QueryBuilder } from "https://deno.land/x/dex@1.0.2/types/index.d.ts";
import { RowObject } from "https://deno.land/x/sqlite/mod.ts";
import type { SQLite3 } from "../../../mod.ts";

import { Dex } from "../../../mod.ts";
import { SysCallMapping } from "../system.ts";

export type Item = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

const dex = Dex<Item>({ client: "sqlite3" });

export function ensureTable(db: SQLite3, tableName: string) {
  const result = db.query<[string]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName],
  );
  if (result.length === 0) {
    const createQuery = dex.schema.createTable(tableName, (table) => {
      table.string("key");
      table.text("value");
      table.primary(["key"]);
    }).toString();

    db.query(createQuery);

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
  queryBuilder: QueryBuilder<Item, any>,
  query: Query,
): QueryBuilder<Item, any> {
  if (query.filter) {
    for (const filter of query.filter) {
      queryBuilder = queryBuilder.andWhereRaw(
        `json_extract(value, '$.${filter.prop}') ${filter.op} ?`,
        [filter.value],
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
      }`,
    );
  }
  return queryBuilder;
}

function asyncQuery<T extends RowObject>(
  db: SQLite3,
  query: QueryBuilder<any, any>,
): Promise<T[]> {
  return Promise.resolve(db.queryEntries<T>(query.toString()));
}

function asyncExecute(
  db: SQLite3,
  query: QueryBuilder<any, any>,
): Promise<void> {
  return Promise.resolve(db.execute(query.toString()));
}

export function storeSyscalls(
  db: SQLite3,
  tableName: string,
): SysCallMapping {
  const apiObj: SysCallMapping = {
    "store.delete": async (_ctx, key: string) => {
      await asyncExecute(db, dex(tableName).where({ key }).del());
    },
    "store.deletePrefix": async (_ctx, prefix: string) => {
      await asyncExecute(
        db,
        dex(tableName).whereRaw(`"key" LIKE "${prefix}%"`).del(),
      );
    },
    "store.deleteQuery": async (_ctx, query: Query) => {
      await asyncExecute(db, queryToKnex(dex(tableName), query).del());
    },
    "store.deleteAll": async () => {
      await asyncExecute(db, dex(tableName).del());
    },
    "store.set": async (_ctx, key: string, value: any) => {
      await asyncExecute(
        db,
        dex(tableName).where({ key }).update("value", JSON.stringify(value)),
      );
      if (db.changes === 0) {
        await asyncExecute(
          db,
          dex(tableName).insert({
            key,
            value: JSON.stringify(value),
          }),
        );
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
    "store.get": async (_ctx, key: string): Promise<any | null> => {
      const result = await asyncQuery<Item>(
        db,
        dex(tableName).where({ key }).select("value"),
      );
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "store.queryPrefix": async (ctx, prefix: string) => {
      return (
        await asyncQuery<Item>(
          db,
          dex(tableName)
            .andWhereRaw(`"key" LIKE "${prefix}%"`)
            .select("key", "value"),
        )
      ).map(({ key, value }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
    "store.query": async (_ctx, query: Query) => {
      return (
        await asyncQuery<Item>(
          db,
          queryToKnex(dex(tableName), query).select("key", "value"),
        )
      ).map(({ key, value }: { key: string; value: string }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
  };
  return apiObj;
}
