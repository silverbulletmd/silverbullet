// Wildcard expansion helpers for `select` / `group by` / `order by`.
//
// Joined rows are LuaTables keyed by source alias
// (`from p = pages, t = tags` -> `{ p = <page>, t = <tag> }`); single-source
// rows use the source row directly.
//
// Multi-source wildcards always emit `<source>_<col>` keys to prevent silent
// collisions (e.g. both `p` and `t` having a `name` column). Single-source
// queries keep bare column names since there is nothing to disambiguate.
//
// - `*`: single-source: bare column names; multi-source: `<source>_<col>`
//   for every column of every source.
//
// - `<src>.*`: single-source: bare column names; multi-source: `<src>_<col>`
//   for every column of `<src>`.
//
// - `*.<col>`: single-source: bare column name; multi-source: `<source>_<col>`
//   per source.
//
// Aliases (`alias = expr`) always win and stay unqualified.
//
// Note: Missing columns surface as `SLIQ_NULL` rather than throwing.

import type {
  ASTCtx,
  LuaStarColumnField,
  LuaStarField,
  LuaStarSourceField,
  LuaTableField,
} from "./ast.ts";
import type { LuaCollectionQuery } from "./query_collection.ts";
import { SLIQ_NULL } from "./sliq_null.ts";
import {
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  type LuaValue,
  luaGet,
  luaKeys,
} from "./runtime.ts";

export type WildcardField =
  | LuaStarField
  | LuaStarSourceField
  | LuaStarColumnField;

export function isWildcardField(f: LuaTableField): f is WildcardField {
  return (
    f.type === "StarField" ||
    f.type === "StarSourceField" ||
    f.type === "StarColumnField"
  );
}

export function hasWildcardFields(fields: readonly LuaTableField[]): boolean {
  return fields.some(isWildcardField);
}

export function resolveSourceItem(
  sourceName: string,
  query: LuaCollectionQuery,
  item: any,
): any {
  const names = query.sourceNames ?? [];
  if (names.length > 1) {
    if (!names.includes(sourceName)) return undefined;
    if (item instanceof LuaTable) return item.rawGet(sourceName);
    if (item && typeof item === "object") return item[sourceName];
    return undefined;
  }
  if (names.length === 1 && names[0] === sourceName) {
    return item;
  }
  return undefined;
}

export function* iterSourceEntries(
  sourceItem: any,
  sf: LuaStackFrame,
): IterableIterator<[string, LuaValue]> {
  if (sourceItem === null || sourceItem === undefined) return;
  if (sourceItem instanceof LuaTable) {
    for (const key of luaKeys(sourceItem)) {
      yield [String(key), luaGet(sourceItem, key, sf.astCtx ?? null, sf)];
    }
    return;
  }
  if (typeof sourceItem !== "object") return;
  for (const key of luaKeys(sourceItem)) {
    yield [String(key), luaGet(sourceItem, key, sf.astCtx ?? null, sf)];
  }
}

export function readColumn(
  sourceItem: any,
  column: string,
  sf: LuaStackFrame,
): LuaValue {
  if (sourceItem === null || sourceItem === undefined) return SLIQ_NULL;
  if (sourceItem instanceof LuaTable) {
    return luaGet(sourceItem, column, sf.astCtx ?? null, sf);
  }
  if (typeof sourceItem !== "object") return SLIQ_NULL;
  return luaGet(sourceItem, column, sf.astCtx ?? null, sf);
}

function withSliqNull(v: LuaValue): LuaValue {
  return v === null || v === undefined ? SLIQ_NULL : v;
}

export function expandStarAllInto(
  result: LuaTable,
  query: LuaCollectionQuery,
  item: any,
  sf: LuaStackFrame,
): void {
  const names = query.sourceNames ?? [];
  if (names.length > 1) {
    // Multi-source: qualify every column with its source alias so that
    // overlapping columns (e.g. `id` in both `a` and `b`) do NOT silently
    // overwrite each other in the resulting LuaTable!
    for (const name of names) {
      const src = resolveSourceItem(name, query, item);
      if (src === undefined || src === null) continue;
      for (const [k, v] of iterSourceEntries(src, sf)) {
        void result.set(`${name}_${k}`, withSliqNull(v), sf);
      }
    }
    return;
  }
  for (const [k, v] of iterSourceEntries(item, sf)) {
    void result.set(k, withSliqNull(v), sf);
  }
}

export function expandStarSourceInto(
  source: string,
  result: LuaTable,
  query: LuaCollectionQuery,
  item: any,
  sf: LuaStackFrame,
  ctx: ASTCtx,
): void {
  const names = query.sourceNames ?? [];

  // Implicit alias `_` for unaliased single-source queries
  if (source === "_" && names.length === 0) {
    expandStarAllInto(result, query, item, sf);
    return;
  }

  if (names.length === 0 || !names.includes(source)) {
    throw new LuaRuntimeError(
      `missing 'from' clause entry for table "${source}"`,
      sf.withCtx(ctx),
    );
  }
  const src = resolveSourceItem(source, query, item);
  if (src === undefined || src === null) return;
  // Single-source queries keep bare column names; multi-source qualify so
  // a sibling `select t.*, p.*` cannot collide
  const multi = names.length > 1;
  for (const [k, v] of iterSourceEntries(src, sf)) {
    void result.set(multi ? `${source}_${k}` : k, withSliqNull(v), sf);
  }
}

export function expandStarColumnInto(
  column: string,
  result: LuaTable,
  query: LuaCollectionQuery,
  item: any,
  sf: LuaStackFrame,
): void {
  const names = query.sourceNames ?? [];
  if (names.length > 1) {
    for (const name of names) {
      const src = resolveSourceItem(name, query, item);
      void result.set(
        `${name}_${column}`,
        withSliqNull(readColumn(src, column, sf)),
        sf,
      );
    }
    return;
  }
  void result.set(column, withSliqNull(readColumn(item, column, sf)), sf);
}

// Returns the non-wildcard fields that still need regular evaluation
export function expandWildcardsInto(
  fields: readonly LuaTableField[],
  result: LuaTable,
  query: LuaCollectionQuery,
  item: any,
  sf: LuaStackFrame,
): LuaTableField[] {
  const remaining: LuaTableField[] = [];
  for (const f of fields) {
    switch (f.type) {
      case "StarField":
        expandStarAllInto(result, query, item, sf);
        break;
      case "StarSourceField":
        expandStarSourceInto(f.source, result, query, item, sf, f.ctx);
        break;
      case "StarColumnField":
        expandStarColumnInto(f.column, result, query, item, sf);
        break;
      default:
        remaining.push(f);
    }
  }
  return remaining;
}
