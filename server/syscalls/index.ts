// import { Knex } from "knex";
import { SysCallMapping } from "../../plugos/system.ts";
import {
  asyncExecute,
  asyncQuery,
  Query,
  queryToSql,
} from "../../plugos/syscalls/store.deno.ts";
import { SQLite } from "../deps.ts";

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

export function ensureTable(db: SQLite): Promise<void> {
  const stmt = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  );
  const result = stmt.all(tableName);
  if (result.length === 0) {
    db.exec(
      `CREATE TABLE ${tableName} (key STRING, page STRING, value TEXT, PRIMARY KEY (page, key));`,
    );
    db.exec(
      `CREATE INDEX ${tableName}_idx ON ${tableName}(key);`,
    );
    console.log(`Created table ${tableName}`);
  }
  return Promise.resolve();
}

export function pageIndexSyscalls(db: SQLite): SysCallMapping {
  const apiObj: SysCallMapping = {
    "index.set": async (ctx, page: string, key: string, value: any) => {
      await asyncExecute(
        db,
        `UPDATE ${tableName} SET value = ? WHERE key = ? AND page = ?`,
        JSON.stringify(value),
        key,
        page,
      );
      if (db.changes === 0) {
        await asyncExecute(
          db,
          `INSERT INTO ${tableName} (key, page, value) VALUES (?, ?, ?)`,
          key,
          page,
          JSON.stringify(value),
        );
      }
    },
    "index.batchSet": async (ctx, page: string, kvs: KV[]) => {
      for (let { key, value } of kvs) {
        await apiObj["index.set"](ctx, page, key, value);
      }
    },
    "index.delete": async (ctx, page: string, key: string) => {
      await asyncExecute(
        db,
        `DELETE FROM ${tableName} WHERE key = ? AND page = ?`,
        key,
        page,
      );
    },
    "index.get": async (ctx, page: string, key: string) => {
      const result = await asyncQuery<Item>(
        db,
        `SELECT value FROM ${tableName} WHERE key = ? AND page = ?`,
        key,
        page,
      );
      if (result.length) {
        return JSON.parse(result[0].value);
      } else {
        return null;
      }
    },
    "index.queryPrefix": async (ctx, prefix: string) => {
      return (
        await asyncQuery<Item>(
          db,
          `SELECT key, page, value FROM ${tableName} WHERE key LIKE ?`,
          `${prefix}%`,
        )
      ).map(({ key, value, page }) => ({
        key,
        page,
        value: JSON.parse(value),
      }));
    },
    "index.query": async (ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      return (
        await asyncQuery<Item>(
          db,
          `SELECT key, value FROM ${tableName} ${sql}`,
          ...params,
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
      await asyncExecute(
        db,
        `DELETE FROM ${tableName} WHERE key LIKE ? AND page = ?`,
        `${prefix}%`,
        page,
      );
    },
    "index.clearPageIndex": async () => {
      await asyncExecute(
        db,
        `DELETE FROM ${tableName}`,
      );
    },
  };
  return apiObj;
}
