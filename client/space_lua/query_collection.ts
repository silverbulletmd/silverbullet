import type { LuaExpression } from "./ast.ts";
import { LuaEnv, luaGet, luaKeys, LuaStackFrame, LuaTable } from "./runtime.ts";
import { evalExpression } from "./eval.ts";
import { asyncQuickSort } from "./util.ts";
import type { DataStore } from "../data/datastore.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";

import type { QueryCollationConfig } from "../../plug-api/types/config.ts";

import type { KvKey } from "../../plug-api/types/datastore.ts";

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
      itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
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
  constructor(private readonly array: T[]) {
  }

  query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
    collation?: QueryCollationConfig,
  ): Promise<any[]> {
    return applyQuery(this.array, query, env, sf, collation);
  }
}

/**
 * Applies a given query (where, order by, limit etc.) to a set of results
 */
export async function applyQuery(
  results: any[],
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame,
  collation?: QueryCollationConfig,
): Promise<any[]> {
  // Shallow copy to avoid updating underlying data structures
  results = results.slice();

  // Filter results based on `where` clause first
  if (query.where) {
    const filteredResults = [];
    for (const value of results) {
      // Enrich value
      const itemEnv = buildItemEnv(query.objectVariable, value, env, sf);
      if (await evalExpression(query.where, itemEnv, sf)) {
        filteredResults.push(value);
      }
    }
    results = filteredResults;
  }

  // Apply `order by` next
  if (query.orderBy) {
    // Retrieve from config API if not passed
    if (collation === undefined) {
      // @ts-ignore: Hack to access client via the browser
      const config = globalThis.client.config; // HACK: Shouldn't be using client here directly

      collation = config.get("queryCollation", {});
    }
    // Both arguments are optional, so passing undefined is fine
    const collator = Intl.Collator(collation?.locale, collation?.options);

    results = await asyncQuickSort(results, async (a, b) => {
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
    for (const item of results) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      const val = await evalExpression(query.select, itemEnv, sf);
      // Skip nil results - selecting a missing field produces no row
      if (val !== null && val !== undefined) {
        newResult.push(val);
      }
    }
    results = newResult;
  }

  // Apply distinct filter (after select to filter on selected values)
  if (query.distinct) {
    const seen = new Set();
    const distinctResult = [];

    for (const item of results) {
      // For non-primitive values, we use a JSON string as the key for comparison
      const key = generateKey(item);

      if (!seen.has(key)) {
        seen.add(key);
        distinctResult.push(item);
      }
    }

    results = distinctResult;
  }

  // Apply the limit and offset
  if (query.limit !== undefined && query.offset !== undefined) {
    results = results.slice(query.offset, query.offset + query.limit);
  } else if (query.limit !== undefined) {
    results = results.slice(0, query.limit);
  } else if (query.offset !== undefined) {
    results = results.slice(query.offset);
  }

  return results;
}

export async function queryLua<T = any>(
  kv: KvPrimitives,
  prefix: KvKey,
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame = LuaStackFrame.lostFrame,
  enricher?: (key: KvKey, item: any) => any,
): Promise<T[]> {
  const results: T[] = [];
  // Accumulate all results into an array
  for await (
    let { key, value } of kv.query({ prefix })
  ) {
    if (enricher) {
      value = enricher(key, value);
    }
    results.push(value);
  }

  return applyQuery(results, query, env, sf);
}

function generateKey(value: any) {
  if (value instanceof LuaTable) {
    return JSON.stringify(value.toJS());
  }
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : value;
}
export class DataStoreQueryCollection implements LuaQueryCollection {
  constructor(
    private readonly dataStore: DataStore,
    readonly prefix: string[],
  ) {
  }

  query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
  ): Promise<any[]> {
    return queryLua(this.dataStore.kv, this.prefix, query, env, sf);
  }
}
