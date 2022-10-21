import { AsyncSQLite } from "../../plugos/sqlite/async_sqlite.ts";
import { SysCallMapping } from "../system.ts";

export async function ensureFTSTable(
  db: AsyncSQLite,
  tableName: string,
) {
  const result = await db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    tableName,
  );
  if (result.length === 0) {
    await db.execute(
      `CREATE VIRTUAL TABLE ${tableName} USING fts5(key, value);`,
    );

    console.log(`Created fts5 table ${tableName}`);
  }
}

export function fullTextSearchSyscalls(
  db: AsyncSQLite,
  tableName: string,
): SysCallMapping {
  return {
    "fulltext.index": async (_ctx, key: string, value: string) => {
      await db.execute(`DELETE FROM ${tableName} WHERE key = ?`, key);
      await db.execute(
        `INSERT INTO ${tableName} (key, value) VALUES (?, ?)`,
        key,
        value,
      );
    },
    "fulltext.delete": async (_ctx, key: string) => {
      await db.execute(`DELETE FROM ${tableName} WHERE key = ?`, key);
    },
    "fulltext.search": async (_ctx, phrase: string, limit: number) => {
      console.log("Got search query", phrase);
      return (
        await db.query(
          `SELECT key, rank FROM ${tableName} WHERE value MATCH ? ORDER BY key, rank LIMIT ?`,
          phrase,
          limit,
        )
      ).map((item) => ({ name: item.key, rank: item.rank }));
    },
  };
}
