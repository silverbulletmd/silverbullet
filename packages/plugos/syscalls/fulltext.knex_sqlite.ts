import { Knex } from "knex";
import { SysCallMapping } from "../system";

type Item = {
  key: string;
  value: string;
};

export async function ensureFTSTable(
  db: Knex<any, unknown>,
  tableName: string
) {
  if (!(await db.schema.hasTable(tableName))) {
    await db.raw(`CREATE VIRTUAL TABLE ${tableName} USING fts5(key, value);`);

    console.log(`Created fts5 table ${tableName}`);
  }
}

export function fullTextSearchSyscalls(
  db: Knex<any, unknown>,
  tableName: string
): SysCallMapping {
  return {
    "fulltext.index": async (ctx, key: string, value: string) => {
      await db<Item>(tableName).where({ key }).del();
      await db<Item>(tableName).insert({ key, value });
    },
    "fulltext.delete": async (ctx, key: string) => {
      await db<Item>(tableName).where({ key }).del();
    },
    "fulltext.search": async (ctx, phrase: string, limit: number) => {
      return (
        await db<any>(tableName)
          .whereRaw(`value MATCH ?`, [phrase])
          .select(["key", "rank"])
          .orderBy("rank")
          .limit(limit)
      ).map((item) => ({ name: item.key, rank: item.rank }));
    },
  };
}
