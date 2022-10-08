import { SQLite } from "../../dep_server.ts";
import { SysCallMapping } from "../system.ts";
import { asyncExecute, asyncQuery } from "./store.deno.ts";

type Item = {
  key: string;
  value: string;
};

export function ensureFTSTable(
  db: SQLite,
  tableName: string,
) {
  const stmt = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  );
  const result = stmt.all(tableName);
  if (result.length === 0) {
    asyncExecute(
      db,
      `CREATE VIRTUAL TABLE ${tableName} USING fts5(key, value);`,
    );

    console.log(`Created fts5 table ${tableName}`);
  }
  return Promise.resolve();
}

export function fullTextSearchSyscalls(
  db: SQLite,
  tableName: string,
): SysCallMapping {
  return {
    "fulltext.index": async (ctx, key: string, value: string) => {
      await asyncExecute(db, `DELETE FROM ${tableName} WHERE key = ?`, key);
      await asyncExecute(
        db,
        `INSERT INTO ${tableName} (key, value) VALUES (?, ?)`,
        key,
        value,
      );
    },
    "fulltext.delete": async (ctx, key: string) => {
      await asyncExecute(db, `DELETE FROM ${tableName} WHERE key = ?`, key);
    },
    "fulltext.search": async (ctx, phrase: string, limit: number) => {
      return (
        await asyncQuery<any>(
          db,
          `SELECT key, rank FROM ${tableName} WHERE value MATCH ? ORDER BY key, rank LIMIT ?`,
          phrase,
          limit,
        )
      ).map((item) => ({ name: item.key, rank: item.rank }));
    },
  };
}
