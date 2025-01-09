import type { LuaExpression } from "$common/space_lua/ast.ts";
import {
  LuaEnv,
  luaGet,
  luaKeys,
  type LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { asyncQuickSort } from "$common/space_lua/util.ts";

function buildItemEnv(item: any, env: LuaEnv, sf: LuaStackFrame): LuaEnv {
  const itemEnv = new LuaEnv(env);
  for (const key of luaKeys(item)) {
    itemEnv.setLocal(key, luaGet(item, key, sf));
  }
  return itemEnv;
}

export type LuaOrderBy = {
  expr: LuaExpression;
  desc: boolean;
};

export type LuaSelect = {
  name: string;
  expr?: LuaExpression;
};

/**
 * Represents a query for a collection
 */
export type LuaCollectionQuery = {
  // The filter expression evaluated with Lua
  where?: LuaExpression;
  // The order by expression evaluated with Lua
  orderBy?: LuaOrderBy[];
  // The select expression evaluated with Lua
  select?: LuaSelect[];
  // The limit of the query
  limit?: number;
  // The offset of the query
  offset?: number;
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
  ): Promise<any[]> {
    let result: any[] = [];

    // Filter the array
    for (const item of this.array) {
      const itemEnv = buildItemEnv(item, env, sf);
      if (query.where && !await evalExpression(query.where, itemEnv, sf)) {
        continue;
      }
      result.push(item);
    }

    // Apply the select
    if (query.select) {
      const newResult = [];
      for (const item of result) {
        const itemEnv = buildItemEnv(item, env, sf);
        const newItem: Record<string, any> = {};
        for (const select of query.select) {
          if (select.expr) {
            newItem[select.name] = await evalExpression(
              select.expr,
              itemEnv,
              sf,
            );
          } else {
            newItem[select.name] = item[select.name];
          }
        }
        newResult.push(newItem);
      }
      result = newResult;
    }

    // Apply the order by
    if (query.orderBy) {
      result = await asyncQuickSort(result, async (a, b) => {
        // Compare each orderBy clause until we find a difference
        for (const { expr, desc } of query.orderBy!) {
          const aEnv = buildItemEnv(a, env, sf);
          const bEnv = buildItemEnv(b, env, sf);

          const aVal = await evalExpression(expr, aEnv, sf);
          const bVal = await evalExpression(expr, bEnv, sf);

          if (aVal < bVal) {
            return desc ? 1 : -1;
          }
          if (aVal > bVal) {
            return desc ? -1 : 1;
          }
          // If equal, continue to next orderBy clause
        }
        return 0; // All orderBy clauses were equal
      });
    }

    // Apply the limit and offset
    if (query.limit !== undefined && query.offset !== undefined) {
      result = result.slice(query.offset, query.offset + query.limit);
    } else if (query.limit !== undefined) {
      result = result.slice(0, query.limit);
    } else if (query.offset !== undefined) {
      result = result.slice(query.offset);
    }

    return Promise.resolve(result);
  }
}
