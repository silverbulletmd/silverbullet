import { AsyncSQLite } from "../sqlite/async_sqlite.ts";
import { ISQLite } from "../sqlite/sqlite_interface.ts";
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

export async function ensureTable(db: ISQLite, tableName: string) {
  const result = await db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    tableName,
  );
  if (result.length === 0) {
    await db.execute(
      `CREATE TABLE ${tableName} (key STRING PRIMARY KEY, value TEXT);`,
    );
    // console.log(`Created table ${tableName}`);
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

export function queryToSql(
  query: Query,
): { sql: string; params: any[] } {
  const whereClauses: string[] = [];
  const clauses: string[] = [];
  const params: any[] = [];
  if (query.filter) {
    for (const filter of query.filter) {
      whereClauses.push(
        `json_extract(value, '$.${filter.prop}') ${filter.op} ?`,
      );
      params.push(filter.value);
    }
  }
  if (query.orderBy) {
    clauses.push(
      `ORDER BY json_extract(value, '$.${query.orderBy}') ${
        query.orderDesc ? "desc" : "asc"
      }`,
    );
  }
  if (query.limit) {
    clauses.push(`LIMIT ${query.limit}`);
  }
  return {
    sql: whereClauses.length > 0
      ? `WHERE ${whereClauses.join(" AND ")} ${clauses.join(" ")}`
      : clauses.join(" "),
    params,
  };
}

export function storeSyscalls(
  db: ISQLite,
  tableName: string,
): SysCallMapping {
  const apiObj: SysCallMapping = {
    "store.delete": async (_ctx, key: string) => {
      await db.execute(`DELETE FROM ${tableName} WHERE key = ?`, key);
    },
    "store.deletePrefix": async (_ctx, prefix: string) => {
      await db.execute(
        `DELETE FROM ${tableName} WHERE key LIKE ?`,
        `${prefix}%`,
      );
    },
    "store.deleteQuery": async (_ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      await db.execute(`DELETE FROM ${tableName} ${sql}`, ...params);
    },
    "store.deleteAll": async () => {
      await db.execute(`DELETE FROM ${tableName}`);
    },
    "store.set": async (_ctx, key: string, value: any) => {
      await db.execute(
        `INSERT INTO ${tableName}
            (key, value)
          VALUES (?, ?)
          ON CONFLICT(key)
          DO UPDATE SET value=excluded.value`,
        key,
        JSON.stringify(value),
      );
    },
    "store.batchSet": async (_ctx, kvs: KV[]) => {
      if (kvs.length === 0) {
        return;
      }
      const values = kvs.flatMap((
        kv,
      ) => [kv.key, JSON.stringify(kv.value)]);
      await db.execute(
        `INSERT INTO ${tableName}
            (key, value)
          VALUES ${kvs.map((_) => "(?, ?)").join(",")}
          ON CONFLICT(key)
          DO UPDATE SET value=excluded.value`,
        ...values,
      );
    },
    "store.batchDelete": async (ctx, keys: string[]) => {
      for (const key of keys) {
        await apiObj["store.delete"](ctx, key);
      }
    },
    "store.get": async (_ctx, key: string): Promise<any | null> => {
      const result = await db.query(
        `SELECT value FROM ${tableName} WHERE key = ?`,
        key,
      );
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "store.queryPrefix": async (_ctx, prefix: string) => {
      return (
        await db.query(
          `SELECT key, value FROM ${tableName} WHERE key LIKE ?`,
          `${prefix}%`,
        )
      ).map(({ key, value }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
    "store.query": async (_ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      return (
        await db.query(
          `SELECT key, value FROM ${tableName} ${sql}`,
          ...params,
        )
      ).map(({ key, value }: { key: string; value: string }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
  };
  return apiObj;
}
