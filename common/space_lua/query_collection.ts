import type { LuaExpression } from "$common/space_lua/ast.ts";
import {
  LuaEnv,
  luaGet,
  luaKeys,
  type LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { asyncQuickSort } from "$common/space_lua/util.ts";
import type { DataStore } from "$lib/data/datastore.ts";

function buildItemEnv(
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
};

export function findAllQueryVariables(query: LuaCollectionQuery): string[] {
  const variables = new Set<string>();

  // Helper to traverse an expression and collect variables
  function findVariables(expr: LuaExpression) {
    if (!expr) return;

    switch (expr.type) {
      case "Variable":
        variables.add(expr.name);
        break;
      case "Binary":
        findVariables(expr.left);
        findVariables(expr.right);
        break;
      case "Unary":
        findVariables(expr.argument);
        break;
      case "TableAccess":
        findVariables(expr.object);
        findVariables(expr.key);
        break;
      case "FunctionCall":
        findVariables(expr.prefix);
        expr.args.forEach(findVariables);
        break;
      case "TableConstructor":
        expr.fields.forEach((field) => {
          switch (field.type) {
            case "DynamicField":
              findVariables(field.key);
              findVariables(field.value);
              break;
            case "PropField":
              findVariables(field.value);
              break;
            case "ExpressionField":
              findVariables(field.value);
              break;
          }
        });
        break;
      case "PropertyAccess":
        findVariables(expr.object);
        break;
      case "Parenthesized":
        findVariables(expr.expression);
        break;
    }
  }

  // Check all parts of the query that can contain expressions
  if (query.where) {
    findVariables(query.where);
  }

  if (query.orderBy) {
    query.orderBy.forEach((ob) => findVariables(ob.expr));
  }

  if (query.select) {
    findVariables(query.select);
  }

  return Array.from(variables);
}

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
    const result: any[] = [];

    // Filter the array
    for (const item of this.array) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      if (query.where && !await evalExpression(query.where, itemEnv, sf)) {
        continue;
      }
      result.push(item);
    }

    return applyTransforms(result, query, env, sf);
  }
}

async function applyTransforms(
  result: any[],
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<any[]> {
  // Apply the order by
  if (query.orderBy) {
    result = await asyncQuickSort(result, async (a, b) => {
      // Compare each orderBy clause until we find a difference
      for (const { expr, desc } of query.orderBy!) {
        const aEnv = buildItemEnv(query.objectVariable, a, env, sf);
        const bEnv = buildItemEnv(query.objectVariable, b, env, sf);

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

  // Apply the select
  if (query.select) {
    const newResult = [];
    for (const item of result) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      newResult.push(await evalExpression(query.select, itemEnv, sf));
    }
    result = newResult;
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

export class DataStoreQueryCollection implements LuaQueryCollection {
  constructor(
    private readonly dataStore: DataStore,
    readonly prefix: string[],
  ) {}

  async query(
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
  ): Promise<any[]> {
    const result: any[] = [];
    for await (
      const { value } of this.dataStore.kv.query({ prefix: this.prefix })
    ) {
      // Enrich
      this.dataStore.enrichObject(value);
      const itemEnv = buildItemEnv(query.objectVariable, value, env, sf);
      if (query.where && !await evalExpression(query.where, itemEnv, sf)) {
        continue;
      }
      result.push(value);
    }
    return applyTransforms(result, query, env, sf);
  }
}
