import { SQLite } from "../../../dep_server.ts";
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

export function ensureTable(db: SQLite, tableName: string) {
  const stmt = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  );
  const result = stmt.all(tableName);
  if (result.length === 0) {
    db.exec(`CREATE TABLE ${tableName} (key STRING PRIMARY KEY, value TEXT);`);
    console.log(`Created table ${tableName}`);
  }
  return Promise.resolve();
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

export function asyncQuery<T extends Record<string, unknown>>(
  db: SQLite,
  query: string,
  ...params: any[]
): Promise<T[]> {
  // console.log("Querying", query, params);
  return Promise.resolve(db.prepare(query).all<T>(params));
}

export function asyncExecute(
  db: SQLite,
  query: string,
  ...params: any[]
): Promise<number> {
  // console.log("Exdecting", query, params);
  return Promise.resolve(db.exec(query, params));
}

export function storeSyscalls(
  db: SQLite,
  tableName: string,
): SysCallMapping {
  const apiObj: SysCallMapping = {
    "store.delete": async (_ctx, key: string) => {
      await asyncExecute(db, `DELETE FROM ${tableName} WHERE key = ?`, key);
    },
    "store.deletePrefix": async (_ctx, prefix: string) => {
      await asyncExecute(
        db,
        `DELETE FROM ${tableName} WHERE key LIKE "?%"`,
        prefix,
      );
    },
    "store.deleteQuery": async (_ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      await asyncExecute(db, `DELETE FROM ${tableName} ${sql}`, ...params);
    },
    "store.deleteAll": async () => {
      await asyncExecute(db, `DELETE FROM ${tableName}`);
    },
    "store.set": async (_ctx, key: string, value: any) => {
      await asyncExecute(
        db,
        `UPDATE ${tableName} SET value = ? WHERE key = ?`,
        JSON.stringify(value),
        key,
      );
      if (db.changes === 0) {
        await asyncExecute(
          db,
          `INSERT INTO ${tableName} (key, value) VALUES (?, ?)`,
          key,
          JSON.stringify(value),
        );
      }
    },
    // TODO: Optimize
    "store.batchSet": async (ctx, kvs: KV[]) => {
      for (const { key, value } of kvs) {
        await apiObj["store.set"](ctx, key, value);
      }
    },
    "store.batchDelete": async (ctx, keys: string[]) => {
      for (const key of keys) {
        await apiObj["store.delete"](ctx, key);
      }
    },
    "store.get": async (_ctx, key: string): Promise<any | null> => {
      const result = await asyncQuery<Item>(
        db,
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
        await asyncQuery<Item>(
          db,
          `SELECT key, value FROM ${tableName} WHERE key LIKE "?%"`,
          prefix,
        )
      ).map(({ key, value }) => ({
        key,
        value: JSON.parse(value),
      }));
    },
    "store.query": async (_ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      return (
        await asyncQuery<Item>(
          db,
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
