import type {
  LuaBinaryExpression,
  LuaDynamicField,
  LuaExpression,
  LuaExpressionField,
  LuaFunctionCallExpression,
  LuaParenthesizedExpression,
  LuaPropField,
  LuaUnaryExpression,
} from "./ast.ts";
import {
  LuaEnv,
  luaGet,
  luaKeys,
  LuaStackFrame,
  LuaTable,
  luaTruthy,
  type LuaValue,
  singleResult,
} from "./runtime.ts";
import { evalExpression, luaOp } from "./eval.ts";
import { asyncQuickSort } from "./util.ts";
import type { DataStore } from "../data/datastore.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";

import type { QueryCollationConfig } from "../../plug-api/types/config.ts";

import type { KvKey } from "../../plug-api/types/datastore.ts";

import { executeAggregate, getAggregateSpec } from "./aggregates.ts";

export { buildItemEnv } from "./query_env.ts";
import { buildItemEnv } from "./query_env.ts";

// Build environment for post-`group by` clauses (`having`, `select`,
// `order by`).  Injects `key` and `group` as top-level variables.  Also
// unpacks the `group by` key fields as locals so that `group by name,
// tag` makes `name` and `tag` accessible.
function buildGroupItemEnv(
  objectVariable: string | undefined,
  groupByNames: string[] | undefined,
  item: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(env);
  if (objectVariable) {
    itemEnv.setLocal(objectVariable, item);
  } else {
    itemEnv.setLocal("_", item);
  }
  if (item instanceof LuaTable) {
    const keyVal = item.rawGet("key");
    const groupVal = item.rawGet("group");

    if (!objectVariable && groupVal instanceof LuaTable) {
      const firstItem = groupVal.rawGet(1);
      if (firstItem) {
        for (const k of luaKeys(firstItem)) {
          itemEnv.setLocal(
            k,
            luaGet(firstItem, k, sf.astCtx ?? null, sf),
          );
        }
      }
    }

    if (keyVal !== undefined) {
      itemEnv.setLocal("key", keyVal);
    }
    if (groupVal !== undefined) {
      itemEnv.setLocal("group", groupVal);
    }

    if (keyVal instanceof LuaTable) {
      for (const k of luaKeys(keyVal)) {
        itemEnv.setLocal(
          k,
          luaGet(keyVal, k, sf.astCtx ?? null, sf),
        );
      }
    }
    if (
      !(keyVal instanceof LuaTable) && groupByNames &&
      groupByNames.length === 1
    ) {
      itemEnv.setLocal(groupByNames[0], keyVal);
    }
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
  // The group by expressions evaluated with Lua
  groupBy?: LuaExpression[];
  // The having expression evaluated with Lua
  having?: LuaExpression;
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

// Check whether an expression tree contains any aggregate function call.
function containsAggregate(expr: LuaExpression): boolean {
  switch (expr.type) {
    case "FunctionCall": {
      const fc = expr as LuaFunctionCallExpression;
      if (fc.prefix.type === "Variable" && getAggregateSpec(fc.prefix.name)) {
        return true;
      }
      return fc.args.some(containsAggregate);
    }
    case "Binary": {
      const bin = expr as LuaBinaryExpression;
      return containsAggregate(bin.left) || containsAggregate(bin.right);
    }
    case "Unary": {
      const un = expr as LuaUnaryExpression;
      return containsAggregate(un.argument);
    }
    case "Parenthesized": {
      const p = expr as LuaParenthesizedExpression;
      return containsAggregate(p.expression);
    }
    case "TableConstructor":
      return expr.fields.some((f) => {
        switch (f.type) {
          case "PropField":
            return containsAggregate((f as LuaPropField).value);
          case "DynamicField": {
            const df = f as LuaDynamicField;
            return containsAggregate(df.key) || containsAggregate(df.value);
          }
          case "ExpressionField":
            return containsAggregate((f as LuaExpressionField).value);
          default:
            return false;
        }
      });
    default:
      return false;
  }
}

/**
 * Evaluate an expression in aggregate-aware mode.
 *
 * When a FunctionCall matches a registered aggregate name, the aggregate
 * protocol is executed instead of normal call semantics.  All other
 * expressions fall through to normal evalExpression.
 */
export async function evalExpressionWithAggregates(
  expr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
  groupItems: LuaTable,
  objectVariable: string | undefined,
  outerEnv: LuaEnv,
): Promise<LuaValue> {
  // Fast path: no aggregate calls in tree -> normal eval
  if (!containsAggregate(expr)) {
    return evalExpression(expr, env, sf);
  }

  const recurse = (e: LuaExpression) =>
    evalExpressionWithAggregates(
      e,
      env,
      sf,
      groupItems,
      objectVariable,
      outerEnv,
    );

  // Direct aggregate call
  if (expr.type === "FunctionCall") {
    const fc = expr as LuaFunctionCallExpression;
    if (fc.prefix.type === "Variable") {
      const name = fc.prefix.name;
      const spec = getAggregateSpec(name);
      if (spec) {
        const valueExpr = fc.args.length > 0 ? fc.args[0] : null;
        return executeAggregate(
          spec,
          groupItems,
          valueExpr,
          objectVariable,
          outerEnv,
          sf,
          evalExpression,
        );
      }
    }
  }

  // Recurse into field values
  if (expr.type === "TableConstructor") {
    const table = new LuaTable();
    let nextArrayIndex = 1;
    for (const field of expr.fields) {
      switch (field.type) {
        case "PropField": {
          const pf = field as LuaPropField;
          const value = await recurse(pf.value);
          table.set(pf.key, value, sf);
          break;
        }
        case "DynamicField": {
          const df = field as LuaDynamicField;
          const key = await evalExpression(df.key, env, sf);
          const value = await recurse(df.value);
          table.set(key, value, sf);
          break;
        }
        case "ExpressionField": {
          const ef = field as LuaExpressionField;
          const value = await recurse(ef.value);
          table.rawSetArrayIndex(nextArrayIndex, value);
          nextArrayIndex++;
          break;
        }
      }
    }
    return table;
  }

  // Recurse operands, apply via luaOp
  if (expr.type === "Binary") {
    const bin = expr as LuaBinaryExpression;

    if (bin.operator === "and") {
      const left = singleResult(await recurse(bin.left));
      if (!luaTruthy(left)) return left;
      return singleResult(await recurse(bin.right));
    }
    if (bin.operator === "or") {
      const left = singleResult(await recurse(bin.left));
      if (luaTruthy(left)) return left;
      return singleResult(await recurse(bin.right));
    }

    const left = singleResult(await recurse(bin.left));
    const right = singleResult(await recurse(bin.right));
    return luaOp(
      bin.operator,
      left,
      right,
      undefined,
      undefined,
      expr.ctx,
      sf,
    );
  }

  // Recurse argument, apply operator
  if (expr.type === "Unary") {
    const un = expr as LuaUnaryExpression;
    const arg = singleResult(await recurse(un.argument));
    switch (un.operator) {
      case "-":
        return typeof arg === "number" ? -arg : luaOp(
          "-",
          0,
          arg,
          undefined,
          undefined,
          expr.ctx,
          sf,
        );
      case "not":
        return !luaTruthy(arg);
      case "#":
        return evalExpression(expr, env, sf);
      case "~":
        if (typeof arg === "number") return ~arg;
        throw new Error("attempt to perform bitwise operation on a non-number");
      default:
        return evalExpression(expr, env, sf);
    }
  }

  // Unwrap
  if (expr.type === "Parenthesized") {
    const paren = expr as LuaParenthesizedExpression;
    return singleResult(await recurse(paren.expression));
  }

  return evalExpression(expr, env, sf);
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

  const grouped = !!query.groupBy;

  // Collect `group by` key names for unpacking into the environment.
  let groupByNames: string[] | undefined;

  // Apply `group by`
  if (query.groupBy) {
    groupByNames = query.groupBy.map((expr) => {
      if (expr.type === "Variable") {
        return expr.name;
      }
      if (expr.type === "PropertyAccess") {
        return expr.property;
      }
      return undefined as unknown as string;
    }).filter(Boolean);

    const groups = new Map<string, { key: any; items: any[] }>();
    for (const item of results) {
      const itemEnv = buildItemEnv(query.objectVariable, item, env, sf);
      // Evaluate all `group by` expressions to form a composite key
      const keyParts: any[] = [];
      for (const expr of query.groupBy) {
        keyParts.push(await evalExpression(expr, itemEnv, sf));
      }
      const compositeKey = keyParts.length === 1
        ? generateKey(keyParts[0])
        : JSON.stringify(keyParts.map(generateKey));
      let entry = groups.get(compositeKey);
      if (!entry) {
        // Unwrap single key; multi-key to `LuaTable` with named fields
        let keyVal: any;
        if (keyParts.length === 1) {
          keyVal = keyParts[0];
        } else {
          const kt = new LuaTable();
          for (let i = 0; i < keyParts.length; i++) {
            kt.rawSetArrayIndex(i + 1, keyParts[i]);
            if (groupByNames && groupByNames[i]) {
              kt.rawSet(groupByNames[i], keyParts[i]);
            }
          }
          keyVal = kt;
        }
        entry = { key: keyVal, items: [] };
        groups.set(compositeKey, entry);
      }
      entry.items.push(item);
    }
    // Convert groups to result rows with `key` and `group`
    results = [];
    for (const { key, items } of groups.values()) {
      const groupTable = new LuaTable();
      for (let i = 0; i < items.length; i++) {
        groupTable.rawSetArrayIndex(i + 1, items[i]);
      }
      const row = new LuaTable();
      row.rawSet("key", key);
      row.rawSet("group", groupTable);
      results.push(row);
    }
  }

  // Apply `having` -- aggregate-aware when grouped
  if (query.having) {
    const filteredResults = [];
    for (const value of results) {
      const itemEnv = buildGroupItemEnv(
        query.objectVariable,
        groupByNames,
        value,
        env,
        sf,
      );
      let condResult;
      if (grouped) {
        const groupTable = (value as LuaTable).rawGet("group");
        condResult = await evalExpressionWithAggregates(
          query.having,
          itemEnv,
          sf,
          groupTable,
          query.objectVariable,
          env,
        );
      } else {
        condResult = await evalExpression(query.having, itemEnv, sf);
      }
      if (condResult) {
        filteredResults.push(value);
      }
    }
    results = filteredResults;
  }

  const mkEnv = grouped
    ? (ov: string | undefined, item: any, e: LuaEnv, s: LuaStackFrame) =>
      buildGroupItemEnv(ov, groupByNames, item, e, s)
    : buildItemEnv;

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
        const aEnv = mkEnv(query.objectVariable, a, env, sf);
        const bEnv = mkEnv(query.objectVariable, b, env, sf);

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

  // Apply the select -- aggregate-aware when grouped
  if (query.select) {
    const newResult = [];
    for (const item of results) {
      const itemEnv = mkEnv(query.objectVariable, item, env, sf);
      if (grouped) {
        const groupTable = (item as LuaTable).rawGet("group");
        newResult.push(
          await evalExpressionWithAggregates(
            query.select,
            itemEnv,
            sf,
            groupTable,
            query.objectVariable,
            env,
          ),
        );
      } else {
        newResult.push(await evalExpression(query.select, itemEnv, sf));
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
