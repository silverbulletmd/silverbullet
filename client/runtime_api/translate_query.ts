import { parseExpressionString } from "../space_lua/parse.ts";
import type {
  LuaCollectionQuery,
  LuaOrderBy,
} from "../space_lua/query_collection.ts";
import type { LuaExpression } from "../space_lua/ast.ts";

export type FilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "startsWith";

export type FilterValue = string;

export type Filter = { field: string; op: FilterOp; value: FilterValue };

export type OrderKey = { field: string; desc: boolean };

export type ListRequest = {
  tag: string;
  filters: Filter[];
  order: OrderKey[];
  limit: number;
  offset: number;
  select?: string[];
};

export type TranslatedQuery = {
  query: LuaCollectionQuery;
  equivalentLua: string;
};

const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export class TranslationError extends Error {
  constructor(
    public code: string,
    public cause: string,
  ) {
    super(`${code}: ${cause}`);
  }
}

function validateField(field: string): string {
  if (!FIELD_PATH_RE.test(field)) {
    throw new TranslationError("bad_field", `invalid field path: ${field}`);
  }
  return field;
}

export function serializeLuaValue(raw: FilterValue): string {
  if (raw.startsWith("num:")) return String(Number(raw.slice(4)));
  if (raw.startsWith("str:")) return JSON.stringify(raw.slice(4));
  if (raw.startsWith("bool:"))
    return raw.slice(5) === "true" ? "true" : "false";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (raw === "true" || raw === "false") return raw;
  if (raw === "null") return "nil";
  return JSON.stringify(raw);
}

function clauseFor(filter: Filter): string {
  const f = `_it.${validateField(filter.field)}`;
  switch (filter.op) {
    case "eq":
      return `${f} == ${serializeLuaValue(filter.value)}`;
    case "ne":
      return `${f} ~= ${serializeLuaValue(filter.value)}`;
    case "gt":
      return `${f} > ${serializeLuaValue(filter.value)}`;
    case "gte":
      return `${f} >= ${serializeLuaValue(filter.value)}`;
    case "lt":
      return `${f} < ${serializeLuaValue(filter.value)}`;
    case "lte":
      return `${f} <= ${serializeLuaValue(filter.value)}`;
    case "startsWith": {
      const lit = serializeLuaValue(filter.value);
      return `string.sub(${f}, 1, #${lit}) == ${lit}`;
    }
    case "contains": {
      const lit = serializeLuaValue(filter.value);
      return `string.find(${f}, ${lit}, 1, true) ~= nil`;
    }
    case "in": {
      const parts = filter.value
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        throw new TranslationError(
          "bad_query",
          "in operator requires at least one value",
        );
      }
      return parts.map((p) => `(${f} == ${serializeLuaValue(p)})`).join(" or ");
    }
  }
  throw new TranslationError(
    "unknown_operator",
    `unknown operator: ${(filter as any).op}`,
  );
}

export function translateListRequest(req: ListRequest): TranslatedQuery {
  const tag = req.tag;
  if (!tag) throw new TranslationError("bad_query", "tag is required");

  // Defensive coercion: callers serializing across the bridge may end up
  // with `null` here when no filters/order are present.
  const filters = req.filters ?? [];
  const order = req.order ?? [];

  const rawClauses = filters.map((f) => clauseFor(f));
  const whereClauses = rawClauses.map((c) => `(${c})`);
  const whereStr =
    rawClauses.length === 0
      ? ""
      : rawClauses.length === 1
        ? rawClauses[0]
        : whereClauses.join(" and ");

  const orderStr = order
    .map((o) => `_it.${validateField(o.field)}${o.desc ? " desc" : ""}`)
    .join(", ");

  const selectStr = req.select
    ? `{ ${req.select.map((f) => `${validateField(f)} = _it.${f}`).join(", ")} }`
    : "";

  const parts: string[] = [`from _it = index.tag(${JSON.stringify(tag)})`];
  if (whereStr) parts.push(`where ${whereStr}`);
  if (orderStr) parts.push(`order by ${orderStr}`);
  if (selectStr) parts.push(`select ${selectStr}`);
  parts.push(
    req.offset > 0 ? `limit ${req.limit}, ${req.offset}` : `limit ${req.limit}`,
  );
  const equivalentLua = parts.join(" ");

  const query: LuaCollectionQuery = {
    objectVariable: "_it",
    limit: req.limit,
    offset: req.offset,
  };
  if (whereStr) {
    query.where = parseExpressionString(
      whereClauses.length === 1 ? whereClauses[0].slice(1, -1) : whereStr,
    ) as LuaExpression;
  }
  if (order.length) {
    query.orderBy = order.map<LuaOrderBy>((o) => ({
      expr: parseExpressionString(`_it.${o.field}`) as LuaExpression,
      desc: o.desc,
    }));
  }
  if (req.select?.length) {
    query.select = parseExpressionString(selectStr) as LuaExpression;
  }

  return { query, equivalentLua };
}
