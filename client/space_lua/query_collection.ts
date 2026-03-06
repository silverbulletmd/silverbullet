import type {
  LuaBinaryExpression,
  LuaDynamicField,
  LuaExpression,
  LuaExpressionField,
  LuaFilteredCallExpression,
  LuaFunctionBody,
  LuaFunctionCallExpression,
  LuaParenthesizedExpression,
  LuaPropField,
  LuaUnaryExpression,
} from "./ast.ts";

import {
  jsToLuaValue,
  luaCall,
  LuaEnv,
  LuaFunction,
  luaGet,
  luaKeys,
  LuaRuntimeError,
  LuaStackFrame,
  LuaTable,
  luaTruthy,
  type LuaValue,
  singleResult,
} from "./runtime.ts";
import { evalExpression, luaOp } from "./eval.ts";
import { asyncMergeSort } from "./util.ts";
import type { DataStore } from "../data/datastore.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";

import type { QueryCollationConfig } from "../../plug-api/types/config.ts";

import type { KvKey } from "../../plug-api/types/datastore.ts";

import { executeAggregate, getAggregateSpec } from "./aggregates.ts";

// Sentinel value representing SQL NULL in query results.
export const LIQ_NULL = Symbol.for("silverbullet.sqlNull");

export function isSqlNull(v: any): boolean {
  return v === LIQ_NULL;
}

// Build environment for post-`group by` clauses. Injects `key` and `group`
// as top-level variables. Unpacks first group item fields and group-by key
// fields as locals so that bare field access works after grouping.
function buildGroupItemEnv(
  objectVariable: string | undefined,
  groupByNames: string[] | undefined,
  item: any,
  parentGlobals: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(parentGlobals);
  itemEnv.setLocal("_", item);
  if (item instanceof LuaTable) {
    const keyVal = item.rawGet("key");
    const groupVal = item.rawGet("group");
    const firstItem = (groupVal instanceof LuaTable)
      ? groupVal.rawGet(1)
      : undefined;

    if (firstItem) {
      for (const k of luaKeys(firstItem)) {
        if (typeof k !== "string") continue;
        itemEnv.setLocal(k, luaGet(firstItem, k, sf.astCtx ?? null, sf));
      }
    }

    if (objectVariable) {
      itemEnv.setLocal(objectVariable, firstItem ?? item);
    }
    if (keyVal !== undefined) {
      itemEnv.setLocal("key", keyVal);
    }
    if (groupVal !== undefined) {
      itemEnv.setLocal("group", groupVal);
    }

    if (keyVal instanceof LuaTable) {
      for (const k of luaKeys(keyVal)) {
        if (typeof k !== "string") continue;
        itemEnv.setLocal(k, luaGet(keyVal, k, sf.astCtx ?? null, sf));
      }
    }
    // For single-key group by, bind the key name as a local
    if (
      !(keyVal instanceof LuaTable) &&
      groupByNames &&
      groupByNames.length === 1
    ) {
      itemEnv.setLocal(groupByNames[0], keyVal);
    }
  }
  return itemEnv;
}

/**
 * Build an environment for evaluating per-item expressions in queries.
 *
 * When `objectVariable` is NOT set: item fields are unpacked as locals
 * and shadow any globals. The item is also bound to `_`.
 *
 * When `objectVariable` IS set: only the object variable is bound.
 * Item fields are NOT unpacked - the user opted into qualified access
 * (e.g. `p.name`) and bare names must resolve from the parent env.
 */
function buildItemEnvLocal(
  objectVariable: string | undefined,
  item: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(env);
  if (objectVariable) {
    itemEnv.setLocal(objectVariable, item);
  } else {
    // Unpack item fields as locals so unqualified access works
    itemEnv.setLocal("_", item);
    if (item instanceof LuaTable) {
      for (const key of luaKeys(item)) {
        itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
      }
    } else if (typeof item === "object" && item !== null) {
      for (const key of luaKeys(item)) {
        itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
      }
    }
  }
  return itemEnv;
}

export { buildItemEnvLocal as buildItemEnv };

export type LuaOrderBy = {
  expr: LuaExpression;
  desc: boolean;
  nulls?: "first" | "last";
  using?: string | LuaFunctionBody;
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

// Wrap any object, array, or LuaQueryCollection as a queryable collection
export function toCollection(obj: any): LuaQueryCollection {
  if (
    obj instanceof ArrayQueryCollection ||
    obj instanceof DataStoreQueryCollection
  ) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return new ArrayQueryCollection(obj);
  }
  return new ArrayQueryCollection([obj]);
}

function containsAggregate(expr: LuaExpression): boolean {
  switch (expr.type) {
    case "FilteredCall": {
      const fc = (expr as LuaFilteredCallExpression).call;
      if (fc.prefix.type === "Variable" && getAggregateSpec(fc.prefix.name)) {
        return true;
      }
      return containsAggregate(fc) ||
        containsAggregate((expr as LuaFilteredCallExpression).filter);
    }
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

  if (expr.type === "FilteredCall") {
    const filtered = expr as LuaFilteredCallExpression;
    const fc = filtered.call;
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
          filtered.filter,
        );
      }
    }

    return evalExpression(expr, env, sf);
  }

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
  if (expr.type === "Parenthesized") {
    const paren = expr as LuaParenthesizedExpression;
    return singleResult(await recurse(paren.expression));
  }
  return evalExpression(expr, env, sf);
}

/**
 * Collect the canonical key order from an array of select results.
 * Finds the first LuaTable that has the maximum number of string keys
 * and returns its keys in insertion order.  This represents the
 * "complete" column set in the order the user wrote in `select { ... }`.
 */
function collectCanonicalKeyOrder(results: any[]): string[] | null {
  let best: string[] | null = null;
  for (const item of results) {
    if (item instanceof LuaTable) {
      const keys = luaKeys(item).filter(
        (k): k is string => typeof k === "string",
      );
      if (!best || keys.length > best.length) {
        best = keys;
      }
    }
  }
  return best;
}

function normalizeSelectResults(results: any[]): any[] {
  if (results.length === 0) return results;
  const canonicalKeys = collectCanonicalKeyOrder(results);
  if (!canonicalKeys || canonicalKeys.length === 0) return results;
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!(item instanceof LuaTable)) continue;
    let needsRebuild = false;
    for (const k of canonicalKeys) {
      const v = item.rawGet(k);
      if (v === undefined || v === null) {
        needsRebuild = true;
        break;
      }
    }
    if (!needsRebuild) continue;
    const rebuilt = new LuaTable();
    for (const k of canonicalKeys) {
      const v = item.rawGet(k);
      rebuilt.rawSet(
        k,
        (v === undefined || v === null) ? LIQ_NULL : v,
      );
    }
    for (const k of luaKeys(item)) {
      if (typeof k !== "string") {
        rebuilt.rawSet(k, item.rawGet(k));
      }
    }
    results[i] = rebuilt;
  }
  return results;
}

function resolveUsing(
  using: string | LuaFunctionBody | undefined,
  env: LuaEnv,
  _sf: LuaStackFrame,
): LuaValue | null {
  if (using === undefined) return null;
  if (typeof using === "string") {
    return env.get(using) ?? null;
  }
  return new LuaFunction(using, env);
}

// Compare values using a custom comparator with SWO violation detection
async function usingCompare(
  luaCmp: LuaValue,
  aVal: any,
  bVal: any,
  originalA: number,
  originalB: number,
  desc: boolean,
  sf: LuaStackFrame,
  violated: boolean[],
  keyIdx: number,
): Promise<number> {
  const res = luaTruthy(
    singleResult(
      await luaCall(luaCmp, [aVal, bVal], sf.astCtx ?? {}, sf),
    ),
  );
  const reverseRes = luaTruthy(
    singleResult(
      await luaCall(luaCmp, [bVal, aVal], sf.astCtx ?? {}, sf),
    ),
  );

  // both true means SWO violation
  if (res && reverseRes) {
    violated[keyIdx] = true;
    return originalA < originalB ? -1 : 1;
  }

  if (res) return desc ? 1 : -1;
  if (reverseRes) return desc ? -1 : 1;
  return 0;
}

/**
 * Pre-compute all sort keys for each result item (Schwartzian transform)
 * and evaluate each `order by` expression exactly once per item
 */
async function precomputeSortKeys(
  results: any[],
  orderBy: LuaOrderBy[],
  mkEnv: (
    ov: string | undefined,
    item: any,
    e: LuaEnv,
    s: LuaStackFrame,
  ) => LuaEnv,
  objectVariable: string | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  grouped: boolean,
  selectResults: any[] | undefined,
): Promise<any[][]> {
  const allKeys: any[][] = new Array(results.length);
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const itemEnv = mkEnv(objectVariable, item, env, sf);
    if (selectResults) {
      const row = selectResults[i];
      if (row) {
        for (const k of luaKeys(row)) {
          const v = luaGet(row, k, sf.astCtx ?? null, sf);
          itemEnv.setLocal(k, isSqlNull(v) ? null : v);
        }
      }
    }
    const keys: any[] = new Array(orderBy.length);
    for (let j = 0; j < orderBy.length; j++) {
      if (grouped) {
        const groupTable = (item as LuaTable).rawGet("group");
        keys[j] = await evalExpressionWithAggregates(
          orderBy[j].expr,
          itemEnv,
          sf,
          groupTable,
          objectVariable,
          env,
        );
      } else {
        keys[j] = await evalExpression(orderBy[j].expr, itemEnv, sf);
      }
    }
    allKeys[i] = keys;
  }
  return allKeys;
}

/**
 * Compare two items by their pre-computed sort keys without Lua
 * expressions evaluation.
 */
async function sortKeyCompare(
  a: { val: any; idx: number },
  b: { val: any; idx: number },
  orderBy: LuaOrderBy[],
  aKeys: any[],
  bKeys: any[],
  collation: QueryCollationConfig | undefined,
  collator: Intl.Collator,
  resolvedUsing: (LuaValue | null)[],
  violated: boolean[],
  sf: LuaStackFrame,
): Promise<number> {
  for (let idx = 0; idx < orderBy.length; idx++) {
    const { desc, nulls } = orderBy[idx];
    const aVal = aKeys[idx];
    const bVal = bKeys[idx];

    // Handle nulls positioning
    const aIsNull = aVal === null || aVal === undefined;
    const bIsNull = bVal === null || bVal === undefined;
    if (aIsNull || bIsNull) {
      if (aIsNull && bIsNull) continue;
      // Default: nulls last for asc, nulls first for desc
      const nullsLast = nulls === "last" || (nulls === undefined && !desc);
      if (aIsNull) return nullsLast ? 1 : -1;
      return nullsLast ? -1 : 1;
    }

    const usingFn = resolvedUsing[idx];
    if (usingFn) {
      const cmp = await usingCompare(
        usingFn,
        aVal,
        bVal,
        a.idx,
        b.idx,
        desc,
        sf,
        violated,
        idx,
      );
      if (cmp !== 0) return cmp;
    } else if (
      collation?.enabled &&
      typeof aVal === "string" &&
      typeof bVal === "string"
    ) {
      const order = collator.compare(aVal, bVal);
      if (order !== 0) {
        return desc ? -order : order;
      }
    } else if (aVal < bVal) {
      return desc ? 1 : -1;
    } else if (aVal > bVal) {
      return desc ? -1 : 1;
    }
  }
  return 0;
}

export async function applyQuery(
  results: any[],
  query: LuaCollectionQuery,
  env: LuaEnv,
  sf: LuaStackFrame,
  collation?: QueryCollationConfig,
): Promise<any[]> {
  results = results.slice();
  if (query.where) {
    const filteredResults = [];
    for (const value of results) {
      const itemEnv = buildItemEnvLocal(
        query.objectVariable,
        value,
        env,
        sf,
      );
      if (await evalExpression(query.where, itemEnv, sf)) {
        filteredResults.push(value);
      }
    }
    results = filteredResults;
  }

  const grouped = !!query.groupBy;

  // Collect group-by key names for unpacking into the post-group environment.
  let groupByNames: string[] | undefined;

  if (query.groupBy) {
    // Extract bare names from group-by expressions for local binding
    groupByNames = query.groupBy.map((expr) => {
      if (expr.type === "Variable") {
        return expr.name;
      }
      if (expr.type === "PropertyAccess") {
        return expr.property;
      }
      return undefined as unknown as string;
    }).filter(Boolean);

    const groups = new Map<
      string,
      { key: any; items: any[] }
    >();
    const groupByExprs = query.groupBy as LuaExpression[];

    for (const item of results) {
      const itemEnv = buildItemEnvLocal(
        query.objectVariable,
        item,
        env,
        sf,
      );

      const keyParts: any[] = [];
      const keyRecord: Record<string, any> = {};

      for (const expr of groupByExprs) {
        if (expr.type === "Variable") {
          const v = await evalExpression(expr, itemEnv, sf);
          keyParts.push(v);
          keyRecord[expr.name] = v;
        } else if (expr.type === "PropertyAccess") {
          const v = await evalExpression(expr, itemEnv, sf);
          keyParts.push(v);
          keyRecord[expr.property] = v;
        } else {
          const v = await evalExpression(expr, itemEnv, sf);
          keyParts.push(v);
        }
      }

      const compositeKey = keyParts.length === 1
        ? generateKey(keyParts[0])
        : JSON.stringify(keyParts.map(generateKey));
      let entry = groups.get(compositeKey);
      if (!entry) {
        let keyVal: any;
        if (keyParts.length === 1) {
          keyVal = keyParts[0];
        } else {
          const kt = new LuaTable();
          // Always populate array indices from keyParts
          for (let i = 0; i < keyParts.length; i++) {
            kt.rawSetArrayIndex(i + 1, keyParts[i]);
          }
          // Additionally set named fields for Variable/PropertyAccess exprs
          for (const name in keyRecord) {
            kt.rawSet(name, keyRecord[name]);
          }
          keyVal = kt;
        }
        entry = {
          key: keyVal,
          items: [],
        };
        groups.set(compositeKey, entry);
      }
      entry.items.push(item);
    }

    results = [];
    for (const { key, items } of groups.values()) {
      const groupTable = new LuaTable();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        groupTable.rawSetArrayIndex(
          i + 1,
          (item instanceof LuaTable || typeof item !== "object" ||
              item === null)
            ? item
            : jsToLuaValue(item),
        );
      }
      const row = new LuaTable();
      row.rawSet("key", key);
      row.rawSet("group", groupTable);
      results.push(row);
    }
  }

  if (query.having) {
    const filteredResults = [];
    for (const value of results) {
      let condResult;
      if (grouped) {
        const itemEnv = buildGroupItemEnv(
          query.objectVariable,
          groupByNames,
          value,
          env,
          sf,
        );
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
        const itemEnv = buildItemEnvLocal(
          query.objectVariable,
          value,
          env,
          sf,
        );
        condResult = await evalExpression(query.having, itemEnv, sf);
      }
      if (condResult) {
        filteredResults.push(value);
      }
    }
    results = filteredResults;
  }

  const mkEnv = grouped
    ? (
      ov: string | undefined,
      item: any,
      e: LuaEnv,
      s: LuaStackFrame,
    ) => buildGroupItemEnv(ov, groupByNames, item, e, s)
    : buildItemEnvLocal;

  let selectResults: any[] | undefined;

  if (grouped && query.select && query.orderBy) {
    selectResults = [];
    for (const item of results) {
      const itemEnv = mkEnv(query.objectVariable, item, env, sf);
      const groupTable = (item as LuaTable).rawGet("group");
      const selected = await evalExpressionWithAggregates(
        query.select,
        itemEnv,
        sf,
        groupTable,
        query.objectVariable,
        env,
      );
      selectResults.push(selected);
    }
    selectResults = normalizeSelectResults(selectResults);
  }

  if (query.orderBy) {
    if (collation === undefined) {
      // @ts-ignore: Hack to access client via the browser
      const config = globalThis.client.config;
      collation = config.get("queryCollation", {});
    }
    const collator = Intl.Collator(collation?.locale, collation?.options);

    const resolvedUsing: (LuaValue | null)[] = [];
    const violated: boolean[] = [];
    for (const ob of query.orderBy) {
      resolvedUsing.push(resolveUsing(ob.using, env, sf));
      violated.push(false);
    }

    // Decorate: pre-compute all sort keys once (Schwartzian transform)
    const sortKeys = await precomputeSortKeys(
      results,
      query.orderBy,
      mkEnv,
      query.objectVariable,
      env,
      sf,
      grouped,
      selectResults,
    );

    // Tag each result with its original index for stable sorting
    const tagged = results.map((val, idx) => ({ val, idx }));

    // Sort: compare cached keys only, no Lua eval in comparator
    await asyncMergeSort(tagged, (a, b) =>
      sortKeyCompare(
        a,
        b,
        query.orderBy!,
        sortKeys[a.idx],
        sortKeys[b.idx],
        collation,
        collator,
        resolvedUsing,
        violated,
        sf,
      ));

    // Check for SWO violations in comparators
    for (let i = 0; i < violated.length; i++) {
      if (violated[i]) {
        throw new LuaRuntimeError(
          `order by #${
            i + 1
          }: 'using' comparator violates strict weak ordering`,
          sf,
        );
      }
    }

    if (selectResults) {
      const reorderedResults: any[] = new Array(tagged.length);
      const reorderedSelect: any[] = new Array(tagged.length);
      for (let i = 0; i < tagged.length; i++) {
        reorderedResults[i] = tagged[i].val;
        reorderedSelect[i] = selectResults[tagged[i].idx];
      }
      results = reorderedResults;
      selectResults = reorderedSelect;
    } else {
      results = tagged.map((t) => t.val);
    }
  }

  if (query.select) {
    if (selectResults) {
      results = selectResults;
    } else {
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
    results = normalizeSelectResults(results);
  }

  if (query.distinct) {
    const seen = new Set();
    const distinctResult = [];
    for (const item of results) {
      const key = generateKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        distinctResult.push(item);
      }
    }
    results = distinctResult;
  }

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
  if (isSqlNull(value)) {
    return "__SQL_NULL__";
  }
  if (value instanceof LuaTable) {
    return JSON.stringify(luaTableToJSWithNulls(value));
  }
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : value;
}

function luaTableToJSWithNulls(
  table: LuaTable,
  sf = LuaStackFrame.lostFrame,
): any {
  if (table.length > 0) {
    const arr: any[] = [];
    for (let i = 1; i <= table.length; i++) {
      const v = table.rawGet(i);
      arr.push(
        isSqlNull(v)
          ? "__SQL_NULL__"
          : v instanceof LuaTable
          ? luaTableToJSWithNulls(v, sf)
          : v,
      );
    }
    return arr;
  }
  const obj: Record<string, any> = {};
  for (const key of luaKeys(table)) {
    const v = table.rawGet(key);
    obj[key] = isSqlNull(v)
      ? "__SQL_NULL__"
      : v instanceof LuaTable
      ? luaTableToJSWithNulls(v, sf)
      : v;
  }
  return obj;
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
