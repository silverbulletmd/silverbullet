import { FullTextSearchOptions } from "../../plug-api/plugos-syscall/fulltext.ts";
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

    // console.log(`Created fts5 table ${tableName}`);
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
    "fulltext.search": async (
      _ctx,
      phrase: string,
      options: FullTextSearchOptions,
    ) => {
      return (
        await db.query(
          `SELECT key, bm25(fts) AS score, snippet(fts, 1, ?, ?, ?, ?) as snippet
           FROM ${tableName}
           WHERE value
           MATCH ?
           ORDER BY score LIMIT ?`,
          options.highlightPrefix || "",
          options.highlightPostfix || "",
          options.highlightEllipsis || "...",
          options.summaryMaxLength || 50,
          phrase,
          options.limit || 20,
        )
      ).map((item) => ({
        name: item.key,
        score: item.score,
        snippet: item.snippet,
      }));
    },
  };
}
