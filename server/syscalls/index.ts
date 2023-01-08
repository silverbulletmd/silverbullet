// import { Knex } from "knex";
import { SysCallMapping } from "../../plugos/system.ts";
import { Query, queryToSql } from "../../plugos/syscalls/store.sqlite.ts";
import { ISQLite } from "../../plugos/sqlite/sqlite_interface.ts";

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

export async function ensureTable(db: ISQLite): Promise<void> {
  const result = await db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    tableName,
  );
  if (result.length === 0) {
    await db.execute(
      `CREATE TABLE ${tableName} (key STRING, page STRING, value TEXT, PRIMARY KEY (page, key));`,
    );
    await db.execute(
      `CREATE INDEX ${tableName}_idx ON ${tableName}(key);`,
    );
    // console.log(`Created table ${tableName}`);
  }
}

export function pageIndexSyscalls(db: ISQLite): SysCallMapping {
  const apiObj: SysCallMapping = {
    "index.set": async (_ctx, page: string, key: string, value: any) => {
      await db.execute(
        `INSERT INTO ${tableName}
            (page, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(page, key)
          DO UPDATE SET value=excluded.value`,
        page,
        key,
        JSON.stringify(value),
      );
    },
    "index.batchSet": async (_ctx, page: string, kvs: KV[]) => {
      if (kvs.length === 0) {
        return;
      }
      const values = kvs.flatMap((
        kv,
      ) => [page, kv.key, JSON.stringify(kv.value)]);
      await db.execute(
        `INSERT INTO ${tableName}
            (page, key, value)
          VALUES ${kvs.map((_) => "(?, ?, ?)").join(",")}
          ON CONFLICT(key, page)
          DO UPDATE SET value=excluded.value`,
        ...values,
      );
    },
    "index.delete": async (_ctx, page: string, key: string) => {
      await db.execute(
        `DELETE FROM ${tableName} WHERE key = ? AND page = ?`,
        key,
        page,
      );
    },
    "index.get": async (_ctx, page: string, key: string) => {
      const result = await db.query(
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
    "index.queryPrefix": async (_ctx, prefix: string) => {
      return (
        await db.query(
          `SELECT key, page, value FROM ${tableName} WHERE key LIKE ? ORDER BY key, page ASC`,
          `${prefix}%`,
        )
      ).map(({ key, value, page }) => ({
        key,
        page,
        value: JSON.parse(value),
      }));
    },
    "index.query": async (_ctx, query: Query) => {
      const { sql, params } = queryToSql(query);
      return (
        await db.query(`SELECT key, value FROM ${tableName} ${sql}`, ...params)
      ).map(({ key, value, page }: any) => ({
        key,
        page,
        value: JSON.parse(value),
      }));
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": async (_ctx, page: string, prefix: string) => {
      await db.execute(
        `DELETE FROM ${tableName} WHERE key LIKE ? AND page = ?`,
        `${prefix}%`,
        page,
      );
    },
    "index.clearPageIndex": async () => {
      await db.execute(
        `DELETE FROM ${tableName}`,
      );
    },
  };
  return apiObj;
}
