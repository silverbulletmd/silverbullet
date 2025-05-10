import type { LuaExpression } from "$common/space_lua/ast.ts";
import {
  LuaEnv,
  luaGet,
  luaKeys,
  LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { asyncQuickSort } from "$common/space_lua/util.ts";
import type { DataStore } from "$lib/data/datastore.ts";
import type { KvKey } from "@silverbulletmd/silverbullet/types";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/client";

export function buildItemEnv(
  objectVariable: string | undefined,
  item: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(env);
  if (!objectVariable) {
    // Inject all item keys as variables
    for (const key of luaKeys(item)) {
      itemEnv.setLocal(key, luaGet(item, key, sf));
    }
    // As well as _
    itemEnv.setLocal("_", item);
  } else {
    itemEnv.setLocal(objectVariable, item);
  }
  return itemEnv;
}

export type LuaOrderBy = {
  expr: LuaExpression;
  desc: boolean;
};

/**
 * Represents a query for a collection
 */
export type LuaCollectionQuery = {
  objectVariable?: string;
  // The filter expression evaluated with Lua
  where?: LuaExpression;
  // The order by expression evaluated with Lua
  orderBy?: LuaOrderBy[];
  // The select expression evaluated with Lua
  select?: LuaExpression;
  // The limit of the query
  limit?: number;
  // The offset of the query
  offset?: number;
  // Whether to return only distinct values
  distinct?: boolean;
};

export interface LuaQueryCollection {
  query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
  ): Promise<any[]>;
}

/**
 * Implements a query collection for a regular JavaScript array
 */
export class ArrayQueryCollection<T> implements LuaQueryCollection {
  constructor(private readonly array: T[]) {}

  async query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
    collation?: QueryCollationConfig,
  ): Promise<any[]> {
    const result: any[] = [];

    // Filter the array
    for (const item of this.array) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      if (query.where && !await evalExpression(query.where, itemEnv, sf)) {
        continue;
      }
      result.push(item);
    }

    return applyTransforms(result, query, env, sf, collation);
  }
}

export async function applyTransforms(
  result: any[],
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame,
  collation?: QueryCollationConfig,
): Promise<any[]> {
  // Apply the order by
  if (query.orderBy) {
    // Retrieve from config API if not passed
    if (collation === undefined) {
      // const config = sf.threadLocal.get("_GLOBAL").get("config"); // FIXME: Somehow _GLOBAL is empty here
      const config = client.config; // HACK: Shouldn't be using client here directly

      collation = config.get("queryCollation", {});
    }
    // Both arguments are optional, so passing undefined is fine
    const collator = Intl.Collator(collation?.locale, collation?.options);

    result = await asyncQuickSort(result, async (a, b) => {
      // Compare each orderBy clause until we find a difference
      for (const { expr, desc } of query.orderBy!) {
        const aEnv = buildItemEnv(query.objectVariable, a, env, sf);
        const bEnv = buildItemEnv(query.objectVariable, b, env, sf);

        const aVal = await evalExpression(expr, aEnv, sf);
        const bVal = await evalExpression(expr, bEnv, sf);

        if (
          collation?.enabled &&
          typeof aVal === "string" &&
          typeof bVal === "string"
        ) {
          const order = collator.compare(aVal, bVal);
          if (order != 0) {
            return desc ? -order : order;
          }
        } else if (aVal < bVal) {
          return desc ? 1 : -1;
        } else if (aVal > bVal) {
          return desc ? -1 : 1;
        }
        // If equal, continue to next orderBy clause
      }
      return 0; // All orderBy clauses were equal
    });
  }

  // Apply the select
  if (query.select) {
    const newResult = [];
    for (const item of result) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      newResult.push(await evalExpression(query.select, itemEnv, sf));
    }
    result = newResult;
  }

  // Apply distinct filter (after select to filter on selected values)
  if (query.distinct) {
    const seen = new Set();
    const distinctResult = [];

    for (const item of result) {
      // For non-primitive values, we use a JSON string as the key for comparison
      const key = typeof item === "object" && item !== null
        ? JSON.stringify(item)
        : item;

      if (!seen.has(key)) {
        seen.add(key);
        distinctResult.push(item);
      }
    }

    result = distinctResult;
  }

  // Apply the limit and offset
  if (query.limit !== undefined && query.offset !== undefined) {
    result = result.slice(query.offset, query.offset + query.limit);
  } else if (query.limit !== undefined) {
    result = result.slice(0, query.limit);
  } else if (query.offset !== undefined) {
    result = result.slice(query.offset);
  }

  return result;
}

export async function queryLua<T = any>(
  kv: KvPrimitives,
  prefix: KvKey,
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame = LuaStackFrame.lostFrame,
  enricher?: (key: KvKey, item: any) => any,
): Promise<T[]> {
  const result: T[] = [];
  for await (
    let { key, value } of kv.query({ prefix })
  ) {
    if (enricher) {
      value = enricher(key, value);
    }
    if (query.where) {
      // Enrich
      const itemEnv = buildItemEnv(query.objectVariable, value, env, sf);
      if (!await evalExpression(query.where, itemEnv, sf)) {
        continue;
      }
    }
    result.push(value);
  }
  return applyTransforms(result, query, env, sf);
}

export class DataStoreQueryCollection implements LuaQueryCollection {
  constructor(
    private readonly dataStore: DataStore,
    readonly prefix: string[],
  ) {}

  query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
  ): Promise<any[]> {
    return queryLua(this.dataStore.kv, this.prefix, query, env, sf);
  }
}
